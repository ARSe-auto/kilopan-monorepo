import type { Pool, PoolClient } from "pg";
import { sellar, secretoNuevo, hashDeSecreto, type Sobre } from "../dominio/secretos.ts";

// La aprobación del dueño, en 1 acto [AC-FIDN-04] — §4.3, §5.4 F-C.
//
// Empareja persona + dispositivo + rol y RECIÉN AHÍ emite el secreto. El orden importa y es
// el del §4.3: la invitación dio derecho a solicitar (AC-FIDN-03) y nada más; hasta que el
// dueño no aprueba, en el tenant no existe ni la persona ni el aparato.
//
// PASA ENTERO EN UNA TRANSACCIÓN. Si la creación del usuario quedara fuera, un fallo a mitad
// dejaría una persona sin rol o un aparato con secreto emitido contra nadie — y el secreto ya
// habría viajado. O entra todo, o no entra nada.
//
// El `audit_trail` no se escribe acá: lo ponen los triggers de las tablas (AC-FIDN-01), para
// que quede auditado cualquier cambio y no solo el que pase por esta puerta.

export type Rebote =
  | "solicitud_inexistente"
  | "ya_resuelta"
  | "cliente_sin_empresa"
  | "rut_ya_registrado";

export type ResultadoAprobacion =
  | {
      tipo: "aprobada";
      usuarioId: string;
      dispositivoId: string;
      sobre: Sobre;
      /** Cuántos aparatos anteriores quedaron revocados EN ESTE MISMO acto (§5.4 F-E). */
      dispositivosRevocados?: number;
    }
  | { tipo: "rebote"; motivo: Rebote; titularActual?: { personaId: string; nombre: string } };

type FilaSolicitud = {
  id: string;
  estado: string;
  tipo: string;
  persona_id: string | null;
  rut_propuesto: string;
  nombre_propuesto: string;
  pin_hash: string;
  clave_publica: string;
  rol: string | null;
  is_standalone: boolean;
  storage_persisted: boolean;
};

/**
 * Gancho que corre DENTRO de la transacción del acto, justo antes del commit [AC-FIDN-12].
 *
 * Existe para que el evento de gobierno del panel del dueño entre o no entre junto con la
 * aprobación, y no después. Un evento escrito tras el commit es un evento que un fallo de red
 * deja sin escribir: la auditoría pasaría a decir menos actos de los que ocurrieron, que es la
 * única forma en que una bitácora miente sin que nadie mienta. Es opcional porque la
 * aprobación se puede invocar sin panel —así la ejercen las pruebas de AC-FIDN-04— y porque
 * este módulo no debe saber qué es un evento de gobierno.
 */
export type Registrar = (c: PoolClient) => Promise<void>;

async function enTransaccion<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    const salida = await fn(cliente);
    await cliente.query("commit");
    return salida;
  } catch (error) {
    await cliente.query("rollback");
    throw error;
  } finally {
    cliente.release();
  }
}

/**
 * Aprueba una solicitud pendiente. `empresaClienteId` solo aplica al rol `cliente`.
 *
 * El rol NO viene por parámetro: sale de la invitación con que se solicitó. Dejarlo elegir al
 * aprobar convertiría un toque en una decisión de permisos tomada sin mirar, y el §5.4 lo
 * describe como «1 toque» justamente porque lo que se aprueba ya está definido.
 */
export async function aprobar(
  pool: Pool,
  solicitudId: string,
  aprobadorId: string,
  opciones: { empresaClienteId?: string; registrar?: Registrar } = {},
): Promise<ResultadoAprobacion> {
  return enTransaccion(pool, async (c) => {
    // LEFT JOIN y no JOIN: el re-enrolamiento no viene de una invitación (AC-FIDN-08), y con
    // un JOIN interno esas solicitudes sencillamente no existirían para esta función — la
    // aprobación devolvería «no existe» sobre una fila que está ahí, que es el peor rebote
    // posible porque manda a buscar el problema al lugar equivocado.
    const { rows } = await c.query<FilaSolicitud>(
      `select s.id, s.estado::text as estado, s.tipo::text as tipo, s.persona_id::text as persona_id,
              s.rut_propuesto, s.nombre_propuesto, s.pin_hash, s.clave_publica,
              s.is_standalone, s.storage_persisted, i.rol::text as rol
         from solicitudes_acceso s
         left join invitaciones i on i.id = s.invitacion_id
        where s.id = $1
          for update of s`,
      [solicitudId],
    );
    const solicitud = rows[0];
    if (!solicitud) return { tipo: "rebote", motivo: "solicitud_inexistente" };

    // El candado de arriba es lo que hace cierto el «UNA vez» ante dos aprobaciones
    // simultáneas: la segunda espera, lee `aprobada` y rebota. Sin él, dos toques a la vez
    // emitirían dos secretos para el mismo aparato y el segundo pisaría al primero.
    if (solicitud.estado !== "pendiente") return { tipo: "rebote", motivo: "ya_resuelta" };

    // ─── Teléfono nuevo: la persona YA existe y solo cambia de aparato (§5.4 F-E) ─────
    //
    // Todo pasa en ESTA transacción, que es lo que el AC pide con esas palabras: el anterior
    // queda revocado y el nuevo activo en el mismo acto. Partirlo en dos dejaría una ventana
    // —corta, pero real— con dos aparatos activos o con ninguno, y el índice único parcial de
    // AC-FIDN-01 rebotaría la mitad de las veces según cuál escritura llegara primero.
    if (solicitud.tipo === "reenrolamiento") {
      const personaId = solicitud.persona_id!;
      // Primero revocar, después crear: al revés, el índice `un personal activo por operario`
      // rebotaría el INSERT antes de que el UPDATE llegue a liberar el lugar.
      const { rowCount: revocados } = await c.query(
        "update dispositivos set revocado_at = now() where persona_id = $1 and tipo = 'personal' and revocado_at is null",
        [personaId],
      );

      const secreto = secretoNuevo();
      const sobre = await sellar(solicitud.clave_publica, secreto);
      // El entorno que el aparato declaró mientras esperaba viaja con él [AC-FIDN-05]: sin
      // esto, un teléfono nuevo nacería siempre «no operable» aunque la persona hubiera hecho
      // todo bien, y el enrolamiento se completaría dos pantallas después de que se completó.
      const { rows: nuevos } = await c.query<{ id: string }>(
        `insert into dispositivos
           (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
         values ('personal', $1, $2, $3, now(), $4, $5) returning id::text as id`,
        [personaId, hashDeSecreto(secreto), aprobadorId, solicitud.is_standalone, solicitud.storage_persisted],
      );

      await c.query(
        `update solicitudes_acceso
            set estado = 'aprobada', resuelta_por = $2, resuelta_en = now(), sobre = $3::jsonb
          where id = $1`,
        [solicitudId, aprobadorId, JSON.stringify(sobre)],
      );

      const { rows: usuario } = await c.query<{ id: string }>(
        "select id::text as id from usuarios where persona_id = $1 limit 1",
        [personaId],
      );
      await opciones.registrar?.(c);
      return {
        tipo: "aprobada",
        usuarioId: usuario[0]!.id,
        dispositivoId: nuevos[0]!.id,
        sobre,
        dispositivosRevocados: revocados ?? 0,
      };
    }

    if (solicitud.rol === "cliente" && !opciones.empresaClienteId) {
      // El CHECK de la tabla lo impediría igual (AC-FIDN-01), pero rebotar acá da el motivo
      // tipado que el §4.2 exige en vez de un error de restricción que la UI no sabe leer.
      return { tipo: "rebote", motivo: "cliente_sin_empresa" };
    }

    // EL REBOTE QUE LA PREGUNTA 10 TRASLADÓ HASTA ACÁ (respuesta del dueño, 09-ago-2026). En
    // la solicitud el RUT repetido NO se mira, porque quien la envía no está autenticado y
    // decirle «ese RUT ya está» le confirmaría quién trabaja en la empresa. Acá sí se nombra:
    // quien aprueba es el `admin_tenant` y ya conoce su nómina — y necesita el dato para
    // decidir en un toque si es la misma persona con teléfono nuevo (F-E) o un homónimo.
    const { rows: choque } = await c.query<{ id: string; nombre: string }>(
      "select id::text as id, nombre from personas where rut = $1",
      [solicitud.rut_propuesto],
    );
    if (choque[0]) {
      return {
        tipo: "rebote",
        motivo: "rut_ya_registrado",
        titularActual: { personaId: choque[0].id, nombre: choque[0].nombre },
      };
    }

    const { rows: personas } = await c.query<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
      [solicitud.rut_propuesto, solicitud.nombre_propuesto],
    );
    const personaId = personas[0]!.id;

    const { rows: usuarios } = await c.query<{ id: string }>(
      `insert into usuarios (persona_id, rol, empresa_cliente_id, pin_hash)
       values ($1, $2::rol_usuario, $3, $4) returning id::text as id`,
      [personaId, solicitud.rol!, opciones.empresaClienteId ?? null, solicitud.pin_hash],
    );
    const usuarioId = usuarios[0]!.id;

    // El secreto nace, se sella y su hash queda en la fila. El valor en claro no se guarda ni
    // se devuelve: lo único que sale de acá es el sobre, que sin la privada del aparato no
    // sirve para nada.
    const secreto = secretoNuevo();
    const sobre = await sellar(solicitud.clave_publica, secreto);

    const { rows: dispositivos } = await c.query<{ id: string }>(
      `insert into dispositivos
         (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), $4, $5) returning id::text as id`,
      [personaId, hashDeSecreto(secreto), aprobadorId, solicitud.is_standalone, solicitud.storage_persisted],
    );

    await c.query(
      `update solicitudes_acceso
          set estado = 'aprobada', resuelta_por = $2, resuelta_en = now(), sobre = $3::jsonb
        where id = $1`,
      [solicitudId, aprobadorId, JSON.stringify(sobre)],
    );

    await opciones.registrar?.(c);
    return { tipo: "aprobada", usuarioId, dispositivoId: dispositivos[0]!.id, sobre };
  });
}

/** El rechazo deja `rechazada` y no emite NADA: ni persona, ni usuario, ni aparato. */
export async function rechazar(
  pool: Pool,
  solicitudId: string,
  aprobadorId: string,
  opciones: { registrar?: Registrar } = {},
): Promise<ResultadoAprobacion | { tipo: "rechazada" }> {
  return enTransaccion(pool, async (c) => {
    const { rows } = await c.query<{ estado: string }>(
      "select estado::text as estado from solicitudes_acceso where id = $1 for update",
      [solicitudId],
    );
    if (!rows[0]) return { tipo: "rebote", motivo: "solicitud_inexistente" };
    if (rows[0].estado !== "pendiente") return { tipo: "rebote", motivo: "ya_resuelta" };

    await c.query(
      `update solicitudes_acceso
          set estado = 'rechazada', resuelta_por = $2, resuelta_en = now()
        where id = $1`,
      [solicitudId, aprobadorId],
    );
    await opciones.registrar?.(c);
    return { tipo: "rechazada" };
  });
}

/**
 * El aparato retira su sobre. De UN SOLO USO: la columna se vacía en la misma sentencia que
 * lo devuelve, así que dos retiros simultáneos no pueden llevarse los dos el secreto — el
 * `UPDATE … RETURNING` con la condición `sobre is not null` lo resuelve la base, sin candado
 * explícito y sin ventana entre leer y borrar.
 *
 * Devuelve null cuando no hay nada que retirar, y esa es la respuesta correcta tanto para
 * «todavía no aprobaron» como para «ya lo retiraste»: distinguirlas le diría a quien pregunta
 * si la solicitud existe.
 */
export async function retirarSobre(pool: Pool, solicitudId: string): Promise<Sobre | null> {
  // `RETURNING OLD` y no `RETURNING sobre`: el RETURNING normal devuelve el valor NUEVO, o
  // sea el null que este mismo UPDATE acaba de escribir — el sobre se borraba y no llegaba a
  // nadie, con el trabajador esperando una sesión que ya nunca iba a arrancar. Lo destapó el
  // test del retiro; sin él, la falla aparecía recién en el primer enrolamiento real.
  // `RETURNING OLD` es de PostgreSQL 18, que el §0 ya exige por `uuidv7()`.
  const { rows } = await pool.query<{ sobre: Sobre }>(
    `update solicitudes_acceso
        set sobre = null, sobre_retirado_en = now()
      where id = $1 and sobre is not null
      returning old.sobre as sobre`,
    [solicitudId],
  );
  return rows[0]?.sobre ?? null;
}
