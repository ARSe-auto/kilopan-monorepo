import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION } from "./gobierno.ts";
import { versionVigente, entitlementVigente, FEATURES } from "./config.ts";
import type { Sesion } from "./sesion.ts";
import { ROLES, type Rol } from "../../../../packages/nucleo-comun/src/constants.ts";

// La apertura del vehículo-día [AC-FVEH-06] — §4.5, §4.4, §2, §9.3 centinela 5.
//
// ─── EL SOLAPE LO DECIDE LA BASE ─────────────────────────────────────────────────────
//
// Acá no hay un `select` que pregunte «¿ya hay un turno abierto?». Ese chequeo es una carrera:
// dos aperturas simultáneas del mismo vehículo pasan las dos por el hueco y la jornada queda
// duplicada — dos odómetros, dos vehículos-día para la EEVD (§2). El EXCLUDE de `turnos` lo
// resuelve PostgreSQL, que es el único que ve las dos a la vez, y acá solo se traduce su
// `23P01` al 422 tipado que el §4.2 pide de una mutación de planificación. Como la violación
// aborta la transacción entera, el rebote es de CERO filas por construcción.
//
// ─── LA CONFIGURACIÓN SE CONGELA AL ABRIR, Y CON LOS ENTITLEMENTS DE VERDAD ──────────
//
// El §4.4 dice que un turno corre entero con UNA versión, así que `config_version_id` es NOT
// NULL. Si el tenant todavía no tiene ninguna versión sellada —hoy nadie más las sella—, la
// apertura sella la primera, y lo hace con los entitlements efectivos LEÍDOS de `control`. No
// con `{}`: un snapshot vacío se ve igual que uno donde todas las features están apagadas, y
// mañana alguien leería «este turno corrió sin el módulo X» sobre un turno que sí lo tenía.
// La lectura va por la conexión propia a `control` (§4.1 prohíbe la consulta cross-database,
// no tener dos conexiones), igual que `tenantIdEnControl`.
//
// La deriva de versión con turno abierto —cambiar `parametros` no altera el turno en curso y
// sí el siguiente— es de AC-FVEH-18 y no se adelanta acá.

/** Quién puede abrir una jornada. `cliente` no: es la empresa CONTRATANTE (§4.3), que mira su
 *  portal y no opera vehículos; abrirle un turno le daría un vehículo-día que no es suyo. */
export const ROLES_QUE_ABREN_TURNO: readonly Rol[] = ROLES.filter((r) => r !== "cliente");

export type Turno = {
  id: string;
  vehiculo_id: string;
  config_version_id: string;
  estado: string;
  abierto_en: Date;
  cerrado_en: Date | null;
};

export type AperturaDeTurno =
  | { tipo: "ok"; turno: Turno }
  | { tipo: "vehiculo_no_existe" }
  | { tipo: "vehiculo_inactivo" }
  | { tipo: "documento_vencido" }
  | { tipo: "certificacion_vencida" }
  | { tipo: "turno_solapado" };

const COLUMNAS = `id::text as id, vehiculo_id::text as vehiculo_id,
                  config_version_id::text as config_version_id, estado::text as estado,
                  abierto_en, cerrado_en`;

/** El código que PostgreSQL usa para una violación de restricción EXCLUDE. */
const EXCLUSION_VIOLATION = "23P01";

export async function abrirTurno(
  pool: Pool,
  sesion: Sesion,
  slug: string,
  vehiculoId: string,
): Promise<AperturaDeTurno> {
  try {
    return await enActo(pool, async (c) => {
      const { rows: vehiculo } = await c.query<{ activo: boolean }>(
        "select activo from vehiculos where id = $1",
        [vehiculoId],
      );
      if (vehiculo.length === 0) return { tipo: "vehiculo_no_existe" };
      // Un vehículo desactivado no abre jornada: el §5.4 le da al dueño la desactivación para
      // sacarlo de la operación, y dejarlo abrir turnos igual vaciaría ese acto de contenido.
      if (!vehiculo[0]!.activo) return { tipo: "vehiculo_inactivo" };

      // El rebote del §4.5, SOLO con el feature encendido [AC-FVEH-03]. Abrir la jornada es
      // planificar: es la puerta por la que un camión con la revisión técnica vencida sale a
      // la calle, y con el feature apagado no rebota nada — mismo patrón que
      // `vehicle_certification` (§4.9).
      if (await entitlementVigente(c, slug, FEATURES.documentos_vencidos_bloquean)) {
        const { rows: vencidos } = await c.query<{ vencido: boolean }>(
          "select tiene_documentos_vencidos($1) as vencido",
          [vehiculoId],
        );
        if (vencidos[0]!.vencido) return { tipo: "documento_vencido" };
      }

      // El mismo patrón para las certificaciones del §4.9, con su PROPIA feature: una empresa
      // puede querer que un permiso vencido detenga el camión y que una certificación de
      // instrumento vencida no lo haga [AC-FVEH-14].
      if (await entitlementVigente(c, slug, FEATURES.certificaciones_vencidas_bloquean)) {
        const { rows: vencidas } = await c.query<{ vencida: boolean }>(
          "select tiene_certificaciones_vencidas($1) as vencida",
          [vehiculoId],
        );
        if (vencidas[0]!.vencida) return { tipo: "certificacion_vencida" };
      }

      const configVersionId = await versionVigente(c, slug);
      const { rows } = await c.query<Turno>(
        `insert into turnos (vehiculo_id, config_version_id) values ($1, $2)
         returning ${COLUMNAS}`,
        [vehiculoId, configVersionId],
      );
      const turno = rows[0]!;
      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.turno_abierto,
        objetoTabla: "turnos",
        objetoId: turno.id,
        sesion,
        payload: { vehiculo_id: vehiculoId, config_version_id: configVersionId },
      });
      return { tipo: "ok", turno };
    });
  } catch (error) {
    // El EXCLUDE de la base, traducido. Cualquier otro error sube: un 500 honesto es mejor
    // que un 422 que le dice a quien abre el turno que el problema es suyo.
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
      return { tipo: "turno_solapado" };
    }
    throw error;
  }
}

/** Los turnos del tenant, del más reciente al más viejo. */
export async function listarTurnos(pool: Pool): Promise<Turno[]> {
  const { rows } = await pool.query<Turno>(
    `select ${COLUMNAS} from turnos order by abierto_en desc`,
  );
  return rows;
}

// ─── Cierre forzado del turno que quedó abierto [AC-FVEH-22] — KR-41, §5.6, §4.5 ─────
//
// Hasta este AC, el semáforo detectaba el turno sin cerrar —el rojo del Anexo B— sin que
// existiera acción alguna que lo resolviera: un rojo sin salida, contra el contrato del §5.6
// de que la cola tiende a cero cada día. Esto es la salida.
//
// ES PLANIFICACIÓN, no captura, y por eso rebota. Lo hace alguien sentado con red mirando la
// bandeja, no una persona de pie al lado de un camión: rebotar acá no pierde ningún hecho del
// terreno, y dejar pasar un cierre sin motivo sí perdería la única explicación que ese turno
// va a tener dentro de tres meses.
//
// NO ALIMENTA LA PROYECCIÓN DEL VEHÍCULO. El KR-41 lo dice literal: «sin alimentar
// monotonicidad». No escribe `reading` de odómetro ni de SOC, y por lo tanto no mueve
// `vehiculos.odometro`/`soc` — inventarle un kilometraje a un turno que nadie cerró sería
// exactamente el dato falso que la proyección existe para no tener.

/** Quién puede cerrar por la fuerza (KR-41): el operador y el dueño, y nadie más. */
export const ROLES_QUE_CIERRAN_FORZADO: readonly Rol[] = ["operador", "admin_tenant"];

export type CierreForzado =
  | { tipo: "ok"; turnoId: string }
  | { tipo: "no_existe" }
  | { tipo: "sin_motivo" }
  | { tipo: "motivo_desconocido" }
  | { tipo: "ya_no_esta_abierto" };

export async function cerrarTurnoPorLaFuerza(
  pool: Pool,
  sesion: Sesion,
  turnoId: string,
  datos: { motivoCodigo: string; nota: string | null },
): Promise<CierreForzado> {
  if (!datos.motivoCodigo.trim()) return { tipo: "sin_motivo" };

  return enActo(pool, async (c) => {
    const { rows: turno } = await c.query<{ estado: string }>(
      "select estado::text as estado from turnos where id = $1",
      [turnoId],
    );
    // El turno de OTRO tenant sencillamente no está en esta base (§4.1): sale 404, no 403.
    if (turno.length === 0) return { tipo: "no_existe" };

    const { rows: motivo } = await c.query<{ id: string; require_notes: boolean }>(
      "select id::text as id, require_notes from motivos where codigo = $1 and activo",
      [datos.motivoCodigo],
    );
    // El motivo es TIPADO, del catálogo del tenant (§4.5): un texto libre acá haría que la
    // bandeja se llenara de explicaciones que no se pueden agrupar ni contar.
    if (!motivo[0]) return { tipo: "motivo_desconocido" };
    if (motivo[0].require_notes && !datos.nota?.trim()) return { tipo: "sin_motivo" };

    const { rows } = await c.query<{ id: string }>(
      `update turnos
          set estado = 'cerrado_forzado', cerrado_en = now(),
              cierre_motivo_id = $2, cierre_nota = $3
        where id = $1 and estado = 'abierto'
        returning id::text as id`,
      [turnoId, motivo[0].id, datos.nota],
    );
    // Segundo cierre forzado sobre el mismo turno: 422 y 0 filas. No es idempotencia amable —
    // es planificación, y repetirla significaría que alguien creyó que el primero no había
    // ocurrido.
    if (!rows[0]) return { tipo: "ya_no_esta_abierto" };

    await registrarEvento(c, {
      codigo: EVENTOS_OPERACION.turno_cerrado_forzado,
      objetoTabla: "turnos",
      objetoId: turnoId,
      sesion,
      payload: { motivo: datos.motivoCodigo },
    });

    // Y RESUELVE la fila de «Por revisar» que originó la señal (§5.6): sin esto, el rojo
    // seguiría ahí después de haberlo arreglado, y la cola dejaría de tender a cero.
    await c.query(
      `update review_queue
          set estado = 'resuelta', resuelta_en = now(),
              nota = coalesce(nota || ' · ', '') || $1
        where origen = 'turno_sin_cerrar' and estado <> 'resuelta'`,
      [`Cerrado por la fuerza: ${datos.motivoCodigo}`],
    );
    return { tipo: "ok", turnoId };
  });
}

// ─── Cierre del turno (F5) [AC-FVEH-21] — §5.2-F5, §5.3, §4.5 ───────────────────────
//
// El cierre es PLANIFICACIÓN sobre el turno —cambia su estado, con red— pero lo que cuelga de
// él es CAPTURA: el chequeo post, la nota al siguiente turno y las dos lecturas. Por eso esta
// función solo cierra: las capturas van por sus propias puertas y, si alguna fallara, el turno
// ya quedó cerrado y nadie tiene que volver a hacerlo.
//
// «¿QUEDÓ ENCHUFADO?» ES OBLIGATORIO Y TIENE TRES VALORES. `true` quedó, `false` no quedó,
// `null` nadie preguntó — este último NO se puede llegar a él cerrando: el §5.2-F5 pone la
// pregunta en el cierre y el rojo del Anexo B se apoya en poder distinguir «no quedó» de
// «todavía no se preguntó».

export type CierreDeTurno =
  | { tipo: "ok"; turnoId: string }
  | { tipo: "no_existe" }
  | { tipo: "sin_respuesta_de_enchufe" }
  | { tipo: "ya_no_esta_abierto" };

export async function cerrarTurno(
  pool: Pool,
  sesion: Sesion,
  turnoId: string,
  datos: { enchufado: unknown },
): Promise<CierreDeTurno> {
  // Obligatorio, y con los dos valores explícitos: un `undefined` que se guardara como NULL
  // dejaría el turno indistinguible de uno que nadie cerró, y el Anexo B no podría decidir.
  if (typeof datos.enchufado !== "boolean") return { tipo: "sin_respuesta_de_enchufe" };

  return enActo(pool, async (c) => {
    const { rows: existe } = await c.query("select 1 from turnos where id = $1", [turnoId]);
    if (existe.length === 0) return { tipo: "no_existe" };

    const { rows } = await c.query<{ id: string }>(
      `update turnos
          set estado = 'cerrado', cerrado_en = now(), enchufado_confirmado = $2
        where id = $1 and estado = 'abierto'
        returning id::text as id`,
      [turnoId, datos.enchufado],
    );
    if (!rows[0]) return { tipo: "ya_no_esta_abierto" };

    await registrarEvento(c, {
      codigo: EVENTOS_OPERACION.turno_cerrado,
      objetoTabla: "turnos",
      objetoId: turnoId,
      sesion,
      payload: { enchufado: datos.enchufado },
    });
    return { tipo: "ok", turnoId };
  });
}

/**
 * La nota que el turno ANTERIOR del mismo vehículo dejó para este (§5.2-F5 → §5.2-F3).
 *
 * Sale del campo `nota` del chequeo POST, que es donde el §1.3 de la spec la pone. `null`
 * cuando no hay: la apertura no muestra un recuadro vacío, que enseñaría a ignorar el lugar
 * donde algún día va a haber algo importante.
 */
export async function notaDelTurnoAnterior(pool: Pool, vehiculoId: string): Promise<string | null> {
  const { rows } = await pool.query<{ nota: string | null }>(
    `select c.nota
       from chequeos c
       join turnos t on t.id = c.turno_id
      where t.vehiculo_id = $1 and c.momento = 'post' and c.nota is not null
      order by c.record_time desc
      limit 1`,
    [vehiculoId],
  );
  return rows[0]?.nota ?? null;
}
