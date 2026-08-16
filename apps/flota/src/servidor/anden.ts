import type { Pool, PoolClient } from "pg";
import { verificarPin } from "./pin.ts";
import { registrarEvento, EVENTOS, EVENTOS_OPERACION } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { huellaNueva } from "../dominio/anden.ts";
import { secretoNuevo, hashDeSecreto } from "../dominio/secretos.ts";

// El dispositivo de andén y su rotación por PIN [AC-FIDN-07] — §4.3, §5.4 F-D, §4.7 (centinela 9).
//
// ─── LAS DOS MITADES DEL §5.4 F-D ─────────────────────────────────────────────────
//
// «El admin lo enrola como activo del tenant (sin persona dueña); los operarios rotan por PIN».
// Son dos actos con dueños distintos: el primero es del `admin_tenant` y pasa una sola vez por
// aparato; el segundo lo hace cualquier operario, en el andén, varias veces por turno.
//
// ─── POR QUÉ EL ANDÉN NO PUEDE ENROLARSE POR EL CAMINO NORMAL ─────────────────────
//
// El de AC-FIDN-04 empareja usuario + dispositivo + rol y sella el secreto contra la clave
// pública del teléfono de una PERSONA. Acá no hay persona: el aparato es del tenant, y el CHECK
// `dispositivos_persona_segun_tipo` del 0011 lo hace imposible de fingir. Por eso el secreto se
// le entrega al DUEÑO, que es quien tiene el aparato delante mientras lo instala en la mesa del
// andén, y se muestra UNA vez — en la base queda solo su hash, igual que el otro (§4.3).
//
// ─── EL LOCKOUT SIGUE SIENDO POR USUARIO, Y ACÁ SE VE POR QUÉ ─────────────────────
//
// La rotación pasa por `verificarPin` (AC-FIDN-06) sin una sola excepción: el bloqueo cae sobre
// el operario que se equivocó y jamás sobre el aparato. En un andén, un lockout por dispositivo
// sería el turno entero de una flota detenido porque alguien tipeó mal cinco veces.
//
// ─── LO QUE LA ROTACIÓN NO HACE, QUE ES EL CENTINELA 9 ────────────────────────────
//
// No borra nada del aparato. El §4.7 es literal: al autenticarse otra identidad se purga SOLO el
// snapshot —que es re-descargable— y el outbox del anterior persiste firmado por SU enrolamiento.
// Del lado del servidor eso se sostiene con la `huella` que esta rotación devuelve: es la
// partición del outbox de ese operario en este aparato (`cliente/identidad.ts`) y la llave con
// la que `firmaDelEnrolamiento` (servidor/capturas.ts) le anota a él —y no a quien esté
// autenticado cuando el lote finalmente salga— la entrega que hizo en la calle.

export type AndenEnrolado = { dispositivoId: string; secreto: string };

/**
 * Enrola un dispositivo de andén como activo del tenant (§5.4 F-D). Devuelve el secreto UNA vez:
 * quien lo pierda no lo puede recuperar, porque en la base quedó solo el hash.
 *
 * Nace con `is_standalone` y `storage_persisted` en `false`, que es la verdad hasta que el
 * aparato reporte su entorno (AC-FIDN-05): el andén es el aparato donde MÁS importa que
 * `persist()` esté concedido —es el que acumula outbox de varias personas— y regalarle un `true`
 * de fábrica sería esconder justo eso en el inventario que el dueño mira.
 */
export async function enrolarAnden(
  c: PoolClient,
  datos: { sesion: Sesion },
): Promise<AndenEnrolado> {
  const secreto = secretoNuevo();
  const { rows } = await c.query<{ id: string }>(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
     values ('anden', null, $1, $2, now())
     returning id::text as id`,
    [hashDeSecreto(secreto), datos.sesion.usuarioId],
  );
  const dispositivoId = rows[0]!.id;
  await registrarEvento(c, {
    codigo: EVENTOS.anden_enrolado,
    objetoTabla: "dispositivos",
    objetoId: dispositivoId,
    sesion: datos.sesion,
  });
  return { dispositivoId, secreto };
}

export type Rotacion =
  | { tipo: "rotada"; huella: string; usuarioId: string; rol: string; nombre: string }
  | { tipo: "rebote"; motivo: "credenciales_invalidas" | "bloqueado" | "no_es_anden" };

/**
 * Otro operario toma el andén (§5.4 F-D). RUT + PIN, y la identidad anterior se cierra.
 *
 * RUT DESCONOCIDO Y PIN EQUIVOCADO RESPONDEN LO MISMO, por la misma razón que AC-FIDN-08: si
 * difirieran, el aparato apoyado en la mesa del andén sería un buscador de RUTs de la empresa
 * para cualquiera que pase por ahí.
 */
export async function rotarIdentidad(
  pool: Pool,
  datos: { dispositivoId: string; rut: string; pin: string },
): Promise<Rotacion> {
  const { rows: aparato } = await pool.query<{ tipo: string }>(
    "select tipo::text as tipo from dispositivos where id = $1 and revocado_at is null",
    [datos.dispositivoId],
  );
  if (aparato[0]?.tipo !== "anden") return { tipo: "rebote", motivo: "no_es_anden" };

  const { rows: personas } = await pool.query<{ usuario_id: string; rol: string; nombre: string }>(
    `select u.id::text as usuario_id, u.rol::text as rol, p.nombre
       from personas p join usuarios u on u.persona_id = p.id and u.activo
      where p.rut = $1`,
    [datos.rut],
  );
  const operario = personas[0];
  // El RUT que no existe se verifica igual contra un usuario imposible para no devolver antes
  // que el otro camino: la diferencia de tiempo entre «no existe» y «PIN malo» sería el mismo
  // oráculo que el cuerpo idéntico evita.
  const veredicto = await verificarPin(
    pool,
    operario?.usuario_id ?? "00000000-0000-0000-0000-000000000000",
    datos.pin,
  );
  if (veredicto.tipo === "bloqueado") return { tipo: "rebote", motivo: "bloqueado" };
  if (veredicto.tipo !== "correcto" || !operario) {
    return { tipo: "rebote", motivo: "credenciales_invalidas" };
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    // La anterior se cierra ANTES de abrir la nueva: el índice parcial de «una abierta por
    // aparato» rebotaría el insert si se hiciera al revés, igual que en el re-enrolamiento
    // (AC-FIDN-08). Y cerrarla es todo lo que la rotación le hace al operario que se va — su
    // outbox no se toca, que es el centinela 9.
    await cliente.query(
      `update sesiones_anden set cerrada_en = now()
        where dispositivo_id = $1 and cerrada_en is null and usuario_id <> $2`,
      [datos.dispositivoId, operario.usuario_id],
    );
    const { rows } = await cliente.query<{ huella: string }>(
      `insert into sesiones_anden (dispositivo_id, usuario_id, huella)
       values ($1, $2, $3)
       on conflict (tenant_id, dispositivo_id, usuario_id)
         do update set cerrada_en = null, abierta_en = now(), ultimo_uso_en = now()
       returning huella`,
      [datos.dispositivoId, operario.usuario_id, huellaNueva()],
    );
    const huella = rows[0]!.huella;
    await registrarEvento(cliente, {
      codigo: EVENTOS_OPERACION.anden_identidad_rotada,
      objetoTabla: "dispositivos",
      objetoId: datos.dispositivoId,
      sesion: {
        dispositivoId: datos.dispositivoId,
        personaId: "",
        usuarioId: operario.usuario_id,
        rol: operario.rol,
        isStandalone: false,
        storagePersisted: false,
        empresaClienteId: null,
      },
    });
    await cliente.query("commit");
    return {
      tipo: "rotada",
      huella,
      usuarioId: operario.usuario_id,
      rol: operario.rol,
      nombre: operario.nombre,
    };
  } catch (error) {
    await cliente.query("rollback");
    throw error;
  } finally {
    cliente.release();
  }
}

// Quién está trabajando AHORA en un aparato de andén lo resuelve `servidor/sesion.ts`
// (`identidadDeAnden`) y no este archivo, a propósito: es parte de responder «¿hay sesión?», la
// pregunta que cada request se hace, y traerla acá obligaría a `sesion.ts` a importar este
// módulo —que importa `gobierno.ts`, que importa `sesion.ts`— por un ciclo que no aporta nada.
