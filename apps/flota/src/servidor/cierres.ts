import type { Pool, PoolClient } from "pg";
import { enActo, enLectura, registrarEvento, EVENTOS_OPERACION, esUuid } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { uuidDeterminista } from "./encargos.ts";
import {
  flagsDelCierre,
  SEVERIDAD_DEL_CIERRE,
  FLAG_DESCUADRADO,
  type TerminosDeEmpresa,
} from "../dominio/cierre.ts";

// El cierre de la ruta y su ecuación de custodia por empresa [AC-FRUT-11]
// — §3.E1.6, §4.5, §5.2 F5, §4.2, §4.8.
//
// ─── LOS NÚMEROS NO SE CALCULAN ACÁ ───────────────────────────────────────────────
//
// Salen de `ecuacion_de_cierre()`, la función SECURITY DEFINER de la migración 0045. El §4.5
// pone las reglas de negocio en la base y esta es una de ellas: sumada en TypeScript tendría una
// segunda copia el día que el portal del contratante muestre su renglón, y dos copias de una
// reconciliación se separan siempre el mes que alguien reclama.
//
// ─── ES CAPTURA: EL CIERRE JAMÁS REBOTA ───────────────────────────────────────────
//
// Cuando esto llega, el día ya terminó y el camión ya volvió. Un 422 no le devuelve al chofer la
// reconciliación que hizo en el estacionamiento — se la borra. Por eso el bloqueo del «no cierra
// descuadrada» vive en el CLIENTE contra el snapshot (§4.2), y acá un cierre descuadrado entra
// 2xx con su flag, su evento y su fila en «Por revisar».

/** Un renglón de la ecuación, tal como sale de la función de la base. Todo en bultos (§4.8). */
export type RenglonDeCierre = TerminosDeEmpresa & { diferencia: number };

/** Los enteros llegan como texto desde `pg` cuando la suma es `bigint`; acá se normalizan. */
function renglonesDe(filas: readonly Record<string, unknown>[]): RenglonDeCierre[] {
  return filas.map((f) => ({
    empresa_cliente_id: String(f.empresa_cliente_id),
    empresa: String(f.empresa),
    cargado: Number(f.cargado),
    entregado: Number(f.entregado),
    devuelto: Number(f.devuelto),
    faltante: Number(f.faltante),
    diferencia: Number(f.diferencia),
  }));
}

async function ecuacion(c: PoolClient, rutaId: string): Promise<RenglonDeCierre[]> {
  const { rows } = await c.query("select * from ecuacion_de_cierre($1)", [rutaId]);
  return renglonesDe(rows as Record<string, unknown>[]);
}

/**
 * La ecuación de una ruta, YA calculada (§5.2 F5).
 *
 * El chofer la abre y la ve: el flujo no la hace calcular a nadie. Si todavía no hay cierre, los
 * términos declarados valen cero y la ruta aparece descuadrada por todo lo que subió — que es la
 * verdad hasta que alguien diga dónde quedó.
 */
export async function ecuacionDeRuta(
  pool: Pool,
  sesion: Sesion,
  rutaId: string,
): Promise<{ existe: boolean; renglones: RenglonDeCierre[]; cerrada: boolean }> {
  return enLectura(pool, sesion, async (c) => {
    const { rows: ruta } = await c.query("select 1 from rutas where id = $1", [rutaId]);
    if (!ruta[0]) return { existe: false, renglones: [], cerrada: false };
    const { rows: cierre } = await c.query("select 1 from cierres_ruta where ruta_id = $1", [
      rutaId,
    ]);
    return { existe: true, renglones: await ecuacion(c, rutaId), cerrada: Boolean(cierre[0]) };
  });
}

export type Declaracion = {
  empresa_cliente_id: string;
  devuelto: number;
  faltante: number;
  /** El motivo de catálogo elegido cuando la clasificación fue «devuelto» [AC-FRUT-21]. Sin él
   *  no se materializa la fila de `devoluciones` — la captura igual entra, degradada de detalle
   *  y no de existencia: la ecuación cuadra igual, porque lee `cierre_ruta_empresa`, no acá. */
  motivo_id: string | null;
};

export type Cierre =
  | { tipo: "ruta_no_existe" }
  | {
      tipo: "ok";
      cierre_id: string;
      repetido: boolean;
      renglones: RenglonDeCierre[];
      /** Vacío = la ruta cerró cuadrada. Con `cierre_descuadrado` = entró igual [AC-FRUT-11]. */
      flags: string[];
    };

/**
 * Materializa el detalle de un `devuelto`: empresa, bultos y motivo del catálogo [AC-FRUT-21].
 *
 * El `client_uuid` se DERIVA de `(cierreId, empresaClienteId)` y no se sortea — el mismo patrón
 * que «duplicar encargos de ayer» (AC-FRUT-17, `encargos.ts::uuidDeterminista`): `cierreId` nace
 * UNA vez por cierre (la fila `cierres_ruta` es append-only, y `cerrarRuta` solo llega hasta acá
 * en la rama que la crea, jamás en un replay), así que dos declaraciones para la misma empresa
 * dentro del mismo cierre resuelven al mismo `client_uuid` y el `on conflict do nothing` deja
 * exactamente una fila — el centinela 1 sin pedirle un uuid propio al aparato por cada devolución.
 */
async function materializarDevolucion(
  c: PoolClient,
  sesion: Sesion,
  datos: {
    cierreId: string;
    empresaClienteId: string;
    bultos: number;
    motivoId: string;
    tsDispositivo: string;
    tzOffsetMin: number;
  },
): Promise<void> {
  const { rows } = await c.query<{ id: string }>(
    `insert into devoluciones
       (cierre_id, empresa_cliente_id, bultos, motivo_id, ts_dispositivo, tz_offset_min, client_uuid)
     values ($1, $2, $3, $4, $5, $6, $7)
       on conflict do nothing
     returning id::text as id`,
    [
      datos.cierreId,
      datos.empresaClienteId,
      datos.bultos,
      datos.motivoId,
      datos.tsDispositivo,
      datos.tzOffsetMin,
      uuidDeterminista(`devolucion|${datos.cierreId}|${datos.empresaClienteId}`),
    ],
  );
  if (!rows[0]) return;
  await registrarEvento(c, {
    codigo: EVENTOS_OPERACION.devolucion_registrada,
    objetoTabla: "devoluciones",
    objetoId: rows[0].id,
    sesion,
    payload: { cierre_id: datos.cierreId, empresa_cliente_id: datos.empresaClienteId, bultos: datos.bultos },
  });
}

/**
 * Cierra la ruta con la clasificación táctil que trae el aparato (§5.2 F5).
 *
 * El orden importa y no es cosmético: primero se ESCRIBEN los términos declarados y recién
 * después se le pregunta a la base si cuadra. Al revés —juzgar antes de escribir— habría que
 * repetir la suma en TypeScript para saber qué va a pasar, que es exactamente la segunda copia
 * que esta función existe para no tener.
 */
export async function cerrarRuta(
  pool: Pool,
  sesion: Sesion,
  datos: {
    rutaId: string;
    turnoId: string | null;
    declaraciones: Declaracion[];
    clientUuid: string | null;
    tsDispositivo: string;
    tzOffsetMin: number;
  },
): Promise<Cierre> {
  return enActo(
    pool,
    async (c) => {
      const { rows: ruta } = await c.query("select 1 from rutas where id = $1", [datos.rutaId]);
      if (!ruta[0]) return { tipo: "ruta_no_existe" } as const;

      // Dos conflictos posibles, y ninguno puede rebotar (§4.2): el replay del outbox —mismo
      // `client_uuid`— y un segundo cierre de la misma ruta desde otro aparato. Los dos LIGAN al
      // que ya está: cerrar dos veces sería reconciliar el mismo día dos veces sin forma de
      // saber cuál vale, y la tabla es append-only.
      const { rows } = await c.query<{ id: string }>(
        `insert into cierres_ruta (ruta_id, turno_id, ts_dispositivo, tz_offset_min, client_uuid)
         values ($1, $2, $3, $4, $5)
           on conflict do nothing
         returning id::text as id`,
        [datos.rutaId, datos.turnoId, datos.tsDispositivo, datos.tzOffsetMin, datos.clientUuid],
      );

      if (!rows[0]) {
        const { rows: previo } = await c.query<{ id: string }>(
          "select id::text as id from cierres_ruta where ruta_id = $1 limit 1",
          [datos.rutaId],
        );
        // El replay NO vuelve a degradar: repetir el aviso haría que «Por revisar» contara tres
        // veces un cierre que ocurrió una, y esa es la forma exacta en que la bandeja del §5.6
        // deja de mirarse. Los renglones viajan igual — el aparato tiene que poder mostrarlos.
        const renglones = await ecuacion(c, datos.rutaId);
        return {
          tipo: "ok" as const,
          cierre_id: previo[0]!.id,
          repetido: true,
          renglones,
          flags: flagsDelCierre(renglones),
        };
      }

      const cierreId = rows[0].id;
      for (const d of datos.declaraciones) {
        const devuelto = Math.max(0, Math.trunc(d.devuelto));
        // Un ítem declarado para una empresa que no es de esta ruta NO rebota el acto entero: es
        // CAPTURA. La FK lo deja entrar si la empresa existe en el tenant, y la ecuación lo
        // muestra como su propio renglón descuadrado, que es más visible que descartarlo callado.
        await c.query(
          `insert into cierre_ruta_empresa (cierre_id, empresa_cliente_id, devuelto, faltante)
           values ($1, $2, $3, $4)
             on conflict do nothing`,
          [cierreId, d.empresa_cliente_id, devuelto, Math.max(0, Math.trunc(d.faltante))],
        );
        if (devuelto > 0 && d.motivo_id && esUuid(d.motivo_id)) {
          await materializarDevolucion(c, sesion, {
            cierreId,
            empresaClienteId: d.empresa_cliente_id,
            bultos: devuelto,
            motivoId: d.motivo_id,
            tsDispositivo: datos.tsDispositivo,
            tzOffsetMin: datos.tzOffsetMin,
          });
        }
      }

      const renglones = await ecuacion(c, datos.rutaId);
      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.cierre_ruta_cerrada,
        objetoTabla: "cierres_ruta",
        objetoId: cierreId,
        sesion,
        payload: { ruta_id: datos.rutaId, empresas: renglones.length },
      });

      const flags = flagsDelCierre(renglones);
      if (flags.length > 0) {
        const sinCuadrar = renglones.filter((r) => r.diferencia !== 0);
        await registrarEvento(c, {
          codigo: EVENTOS_OPERACION.cierre_descuadrado,
          objetoTabla: "cierres_ruta",
          objetoId: cierreId,
          sesion,
          payload: {
            ruta_id: datos.rutaId,
            empresas: sinCuadrar.map((r) => ({
              empresa_cliente_id: r.empresa_cliente_id,
              diferencia: r.diferencia,
            })),
          },
        });
        await c.query("insert into review_queue (origen, severidad, nota) values ($1, $2, $3)", [
          `cierre.${FLAG_DESCUADRADO}`,
          SEVERIDAD_DEL_CIERRE,
          `La ruta cerró sin cuadrar para ${sinCuadrar.length} empresa(s).`,
        ]);
      }

      return { tipo: "ok" as const, cierre_id: cierreId, repetido: false, renglones, flags };
    },
    sesion,
  );
}
