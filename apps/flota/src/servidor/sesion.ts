import type { Pool } from "pg";
import { hashDeSecreto } from "../dominio/secretos.ts";
import { vencioPorInactividad } from "../dominio/anden.ts";

// La sesión de FLOTA [AC-FIDN-09] — §4.3, §5.4, y la respuesta del dueño a la pregunta 1
// (09-ago-2026): en el teléfono personal la sesión dura mientras el dispositivo siga enrolado
// y sin revocar.
//
// QUÉ ES UNA SESIÓN ACÁ. El secreto que la aprobación emitió al aparato (AC-FIDN-04),
// presentado en cada request. No hay cookie, no hay token con vencimiento, no hay refresh: la
// sesión ES el aparato, y por eso el dueño la corta poniendo `revocado_at`.
//
// POR QUÉ ESO ES LO CORRECTO Y NO UN ATAJO. Un token con vencimiento propio tendría que
// caducar para que la revocación surtiera efecto, y esa ventana es justo la que no puede
// existir cuando alguien perdió el teléfono en la calle. Acá cada request vuelve a preguntar
// por la fila del aparato, así que el corte del §5.4 F-F es inmediato de verdad: sin trabajo
// de fondo, sin lista de revocados que sincronizar, sin nada que se pueda olvidar de correr.
// El costo es una consulta por request contra la BD del tenant, que ya está abierta.
//
// El secreto llega en `Authorization: Portador <secreto>`. Se compara por HASH: en la base no
// hay con qué entrar aunque alguien se la lleve entera.

export type Sesion = {
  dispositivoId: string;
  personaId: string;
  usuarioId: string;
  rol: string;
  /** Las dos condiciones del §4.3 [AC-FIDN-05]. Un aparato al que le falte una TIENE sesión
   *  —si no, no habría dónde decirle qué le falta, que es la degradación VISIBLE que el AC
   *  pide— pero no está operable para capturar en terreno. Quien pregunte por lo segundo usa
   *  `enrolamientoCompleto`, no el hecho de que la sesión resuelva. */
  isStandalone: boolean;
  storagePersisted: boolean;
  /** La empresa contratante, SOLO para el rol `cliente` [AC-FRUT-12]. Es lo que la política de
   *  fila del §7.2 compara: sin ella, una sesión de cliente no ve ninguna fila —falla hacia el
   *  cierre— porque una sesión de cliente sin empresa es un error de programación. */
  empresaClienteId: string | null;
};

export type VeredictoSesion =
  | { tipo: "valida"; sesion: Sesion }
  | {
      // Revocado, pero CON identidad y CON la marca de tiempo del corte [AC-FPOD-07] — §4.3. El
      // `tipo` sigue siendo "invalida" y el `motivo` sigue siendo "revocada" a propósito: todo
      // llamador que solo mira `tipo !== "valida"` (guardia, sesionDelTenant, /api/sesion) sigue
      // rebotando exactamente igual que antes — esto SOLO agrega los datos que necesita el motor
      // de sync de capturas para clasificar lo que llega DESPUÉS de la revocación (§4.2: la
      // captura del terreno jamás rebota, ni siquiera la de un aparato dado de baja).
      tipo: "invalida";
      motivo: "revocada";
      sesion: Sesion;
      revocadoEn: Date;
    }
  // El aparato de andén existe y está sano, pero nadie tipeó su PIN todavía —o la identidad
  // anterior se venció por inactividad (§0 `SESION.anden_inactividad_minutos`) [AC-FIDN-07]. Es
  // un motivo propio y no un "desconocida" porque acá SÍ hay a quién decírselo: la pantalla del
  // andén pide el PIN, que es exactamente la salida (§5.4 F-D).
  | { tipo: "invalida"; motivo: "sin_credencial" | "desconocida" | "usuario_inactivo" | "anden_sin_identidad" };

/** `Authorization: Portador <secreto>` → el secreto, o null. */
export function secretoDe(cabecera: string | null | undefined): string | null {
  const m = /^Portador\s+(\S+)$/i.exec(String(cabecera ?? "").trim());
  return m ? m[1]! : null;
}

/**
 * Resuelve la sesión de un request. Devuelve el motivo cuando no hay, porque el servidor lo
 * necesita para decidir entre «autenticate» y «te revocaron» — pero quien responda al cliente
 * NO tiene que reenviar ese detalle: un aparato robado no necesita enterarse de que lo dieron
 * de baja, solo de que no entra.
 */
export async function resolverSesion(pool: Pool, cabecera: string | null): Promise<VeredictoSesion> {
  const secreto = secretoDe(cabecera);
  if (!secreto) return { tipo: "invalida", motivo: "sin_credencial" };

  const { rows } = await pool.query<{
    dispositivo_id: string;
    tipo: string;
    persona_id: string;
    usuario_id: string | null;
    rol: string | null;
    revocado_at: Date | null;
    activo: boolean | null;
    is_standalone: boolean;
    storage_persisted: boolean;
    empresa_cliente_id: string | null;
  }>(
    `select d.id::text  as dispositivo_id,
            d.tipo::text as tipo,
            d.persona_id::text as persona_id,
            u.id::text  as usuario_id,
            u.rol::text as rol,
            d.revocado_at,
            u.activo,
            d.is_standalone,
            d.storage_persisted,
            u.empresa_cliente_id::text as empresa_cliente_id
       from dispositivos d
       left join usuarios u on u.persona_id = d.persona_id
      where d.secreto_hash = $1`,
    [hashDeSecreto(secreto)],
  );

  const fila = rows[0];
  if (!fila) return { tipo: "invalida", motivo: "desconocida" };
  // EL CORTE. Se mira en CADA request y contra la fila, no contra una copia en memoria: es lo
  // que hace que «revocar en 1 toque» tenga efecto en el request siguiente y no en el próximo
  // vencimiento de algo.
  //
  // Se mira ANTES que `usuario_inactivo` a propósito: un aparato revocado sin usuario detrás
  // (el join no encuentra fila) no tiene con qué armar la `sesion` que pide el motor de sync
  // [AC-FPOD-07] — ahí no hay identidad que devolver y se cae al mismo "desconocida" de siempre.
  if (fila.revocado_at !== null) {
    if (!fila.usuario_id || !fila.rol) return { tipo: "invalida", motivo: "desconocida" };
    return {
      tipo: "invalida",
      motivo: "revocada",
      revocadoEn: fila.revocado_at,
      sesion: {
        dispositivoId: fila.dispositivo_id,
        personaId: fila.persona_id,
        usuarioId: fila.usuario_id,
        rol: fila.rol,
        isStandalone: fila.is_standalone,
        storagePersisted: fila.storage_persisted,
        empresaClienteId: fila.empresa_cliente_id,
      },
    };
  }
  // EL ANDÉN [AC-FIDN-07] — §4.3, §5.4 F-D. Su secreto identifica al APARATO y a nadie más: es
  // un activo del tenant y `dispositivos.persona_id` es null por CHECK, así que el join de
  // arriba no encuentra usuario y sin esta rama el andén no tendría sesión posible. Quién
  // trabaja ahí ahora sale de `sesiones_anden`, que es lo que el PIN establece y lo que la
  // inactividad cierra.
  if (fila.tipo === "anden") {
    const identidad = await identidadDeAnden(pool, fila.dispositivo_id);
    if (!identidad) return { tipo: "invalida", motivo: "anden_sin_identidad" };
    return {
      tipo: "valida",
      sesion: {
        dispositivoId: fila.dispositivo_id,
        personaId: identidad.personaId,
        usuarioId: identidad.usuarioId,
        rol: identidad.rol,
        isStandalone: fila.is_standalone,
        storagePersisted: fila.storage_persisted,
        empresaClienteId: identidad.empresaClienteId,
      },
    };
  }

  // La anonimización de la 21.719 desactiva al usuario (AC-FIDN-19); un aparato que sobreviva
  // a eso no puede seguir teniendo sesión.
  if (!fila.usuario_id || fila.activo !== true) return { tipo: "invalida", motivo: "usuario_inactivo" };

  return {
    tipo: "valida",
    sesion: {
      dispositivoId: fila.dispositivo_id,
      personaId: fila.persona_id,
      usuarioId: fila.usuario_id,
      rol: fila.rol!,
      isStandalone: fila.is_standalone,
      storagePersisted: fila.storage_persisted,
      empresaClienteId: fila.empresa_cliente_id,
    },
  };
}

export type IdentidadDeAnden = {
  usuarioId: string;
  personaId: string;
  rol: string;
  empresaClienteId: string | null;
};

/**
 * Quién está trabajando ahora en este aparato de andén [AC-FIDN-07] — §5.4 F-D, §0 (`SESION`).
 *
 * Vive acá y no en `servidor/anden.ts` porque es parte de responder «¿hay sesión?», la pregunta
 * que cada request se hace; aquel archivo importa `gobierno.ts`, que importa este, y traerlo
 * cerraría un ciclo por nada.
 *
 * LA INACTIVIDAD SE EVALÚA EN EL SERVIDOR Y CON LA CONSTANTE DEL §0, no con un intervalo escrito
 * en el SQL: el número es canónico y una segunda copia es lo que el gate de constantes impide.
 * La vencida se CIERRA, no se ignora — la auditoría del §3.E1.15 tiene que poder decir cuándo
 * terminó el turno de cada quien en el aparato compartido.
 *
 * Y `ultimo_uso_en` se mueve en cada request: un andén que pregunta está en uso. Sin eso, los
 * tres minutos del §0 se contarían desde que la persona tipeó el PIN y no desde que dejó de
 * trabajar, y el aparato la echaría a mitad de la carga.
 */
export async function identidadDeAnden(
  pool: Pool,
  dispositivoId: string,
  ahora: Date = new Date(),
): Promise<IdentidadDeAnden | null> {
  const { rows } = await pool.query<{
    id: string;
    usuario_id: string;
    persona_id: string;
    rol: string;
    empresa_cliente_id: string | null;
    ultimo_uso_en: Date;
  }>(
    `select s.id::text as id, s.usuario_id::text as usuario_id, u.persona_id::text as persona_id,
            u.rol::text as rol, u.empresa_cliente_id::text as empresa_cliente_id, s.ultimo_uso_en
       from sesiones_anden s
       join usuarios u on u.id = s.usuario_id and u.activo
      where s.dispositivo_id = $1 and s.cerrada_en is null`,
    [dispositivoId],
  );
  const abierta = rows[0];
  if (!abierta) return null;

  if (vencioPorInactividad(abierta.ultimo_uso_en, ahora)) {
    await pool.query("update sesiones_anden set cerrada_en = now() where id = $1", [abierta.id]);
    return null;
  }

  await pool.query("update sesiones_anden set ultimo_uso_en = now() where id = $1", [abierta.id]);
  return {
    usuarioId: abierta.usuario_id,
    personaId: abierta.persona_id,
    rol: abierta.rol,
    empresaClienteId: abierta.empresa_cliente_id,
  };
}

/** Revocar un aparato: un UPDATE, y el efecto es el request siguiente (§5.4 F-F). */
export async function revocarDispositivo(pool: Pool, dispositivoId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "update dispositivos set revocado_at = now() where id = $1 and revocado_at is null",
    [dispositivoId],
  );
  return (rowCount ?? 0) > 0;
}
