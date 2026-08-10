import type { Pool, PoolClient } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION, offsetChileMin } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import {
  clasificar,
  SEVERIDAD_DE_LECTURA,
  MAGNITUDES,
  type FlagDeLectura,
  type Magnitud,
} from "../dominio/lecturas.ts";
import { EV } from "../../../../packages/nucleo-comun/src/constants.ts";

// La ingesta de odómetro y SOC [AC-FVEH-05] — §4.6, §4.2, §9.3 centinela 4.
//
// ─── ESTE ENDPOINT NO SABE DECIR QUE NO ─────────────────────────────────────────────
//
// No hay un solo camino de acá que devuelva 4xx por el CONTENIDO de la lectura. Es la regla de
// oro del §4.2 con sujeto: el chofer ya miró el tablero y ya tecleó lo que vio; un 422 no le
// devuelve el dato, se lo borra. Lo que hay es flag + evento + fila en «Por revisar», que es
// la diferencia entre «lo tenemos y sabemos que hay que mirarlo» y «no lo tenemos».
//
// (Sí rebota lo que no es la lectura: sin sesión, o con una magnitud que no existe. Eso no es
// degradar un dato del terreno, es una llamada mal formada.)
//
// ─── LA IDEMPOTENCIA ES DOBLE, Y LAS DOS MITADES SIRVEN PARA COSAS DISTINTAS ────────
//
// `client_uuid` cubre el replay del outbox: el mismo teléfono reintentando. La tripleta
// (instrumento, sensor, ts_dispositivo) cubre el archivo de un logger importado dos veces,
// donde no hay `client_uuid` ninguno (§4.6). Un replay devuelve 200 con la fila que YA estaba
// —no 201— y no vuelve a escribir evento ni fila de revisión: repetir el aviso haría que la
// bandeja contara tres veces un incidente que ocurrió una.
//
// ─── LA PROYECCIÓN NO SE TOCA DESDE ACÁ ─────────────────────────────────────────────
//
// `vehiculos.odometro`/`soc` los mueve el trigger de la 0019, y el guardián de la 0016 rebota
// a cualquier otro. Este archivo inserta en `reading` y lee el resultado; si algún día alguien
// «arregla» una proyección con un UPDATE desde el servidor, la base lo rechaza.

export type LecturaEntrante = {
  magnitud: string;
  valor: number;
  turnoId: string | null;
  clientUuid: string | null;
  tsDispositivo: Date;
  tzOffsetMin: number | null;
  contexto: string | null;
};

export type Registrada = {
  id: string;
  magnitud: Magnitud;
  valor: number;
  flags: FlagDeLectura[];
  repetida: boolean;
  proyeccion: { odometro: number | null; soc: number | null } | null;
};

export type ResultadoLectura =
  | { tipo: "ok"; lectura: Registrada }
  | { tipo: "magnitud_desconocida" };

const EVENTO_DE_FLAG: Record<FlagDeLectura, (typeof EVENTOS_OPERACION)[keyof typeof EVENTOS_OPERACION]> = {
  soc_fuera_de_rango: EVENTOS_OPERACION.lectura_soc_fuera_de_rango,
  odometro_retrocedido: EVENTOS_OPERACION.lectura_odometro_retrocedido,
  reloj_desfasado: EVENTOS_OPERACION.lectura_reloj_desfasado,
  sin_turno: EVENTOS_OPERACION.lectura_sin_turno,
};

/** Lo que ya tiene proyectado el vehículo de este turno, para juzgar la monotonicidad. */
async function proyeccionDelTurno(
  c: PoolClient,
  turnoId: string | null,
): Promise<{ vehiculoId: string; odometro: number | null; soc: number | null } | null> {
  if (!turnoId) return null;
  const { rows } = await c.query<{ vehiculo_id: string; odometro: number | null; soc: number | null }>(
    `select v.id::text as vehiculo_id, v.odometro, v.soc
       from turnos t join vehiculos v on v.id = t.vehiculo_id
      where t.id = $1`,
    [turnoId],
  );
  const fila = rows[0];
  return fila ? { vehiculoId: fila.vehiculo_id, odometro: fila.odometro, soc: fila.soc } : null;
}

export async function registrarLectura(
  pool: Pool,
  sesion: Sesion,
  entrante: LecturaEntrante,
): Promise<ResultadoLectura> {
  if (!(MAGNITUDES as readonly string[]).includes(entrante.magnitud)) {
    return { tipo: "magnitud_desconocida" };
  }
  const magnitud = entrante.magnitud as Magnitud;

  return enActo(pool, async (c) => {
    const { rows: mag } = await c.query<{ id: string }>(
      "select id::text as id from magnitud where codigo = $1",
      [magnitud],
    );
    // La magnitud está sembrada por la migración 0019 en `tenant_template`: si falta, la base
    // está a medias y eso NO es un dato del terreno mal formado — sube y se ve como 500.
    if (!mag[0]) throw new Error(`la magnitud «${magnitud}» no está sembrada en esta base`);

    const antes = await proyeccionDelTurno(c, entrante.turnoId);
    const anterior = magnitud === "odometro" ? (antes?.odometro ?? null) : (antes?.soc ?? null);
    const recibidaEn = new Date();

    const flags = clasificar({
      magnitud,
      valor: entrante.valor,
      anterior,
      tsDispositivo: entrante.tsDispositivo,
      recibidaEn,
      tieneTurno: antes !== null,
    });

    const { rows } = await c.query<{ id: string }>(
      `insert into reading
         (magnitud_id, valor_int, fuente, contexto, turno_id, ts_dispositivo, tz_offset_min, client_uuid)
       values ($1, $2, $3::lectura_fuente, $4, $5, $6, $7, $8)
         on conflict (tenant_id, client_uuid) do nothing
       returning id::text as id`,
      [
        mag[0].id,
        entrante.valor,
        // E1 es EV DECLARADO: cero telemetría real (§3-FUERA). La fuente sale de la familia
        // canónica y no escrita a mano, para que el día que exista OBD haya UN lugar que tocar.
        EV.fuente_por_defecto,
        entrante.contexto,
        antes ? entrante.turnoId : null,
        entrante.tsDispositivo,
        entrante.tzOffsetMin ?? offsetChileMin(entrante.tsDispositivo),
        entrante.clientUuid,
      ],
    );

    if (!rows[0]) {
      // Replay: la fila ya estaba. Se devuelve LA MISMA, sin evento ni revisión de más.
      const { rows: previa } = await c.query<{ id: string }>(
        "select id::text as id from reading where client_uuid = $1",
        [entrante.clientUuid],
      );
      const despues = await proyeccionDelTurno(c, entrante.turnoId);
      return {
        tipo: "ok",
        lectura: {
          id: previa[0]!.id,
          magnitud,
          valor: entrante.valor,
          flags,
          repetida: true,
          proyeccion: despues ? { odometro: despues.odometro, soc: despues.soc } : null,
        },
      };
    }

    const id = rows[0].id;
    await registrarEvento(c, {
      codigo: EVENTOS_OPERACION.lectura_registrada,
      objetoTabla: "reading",
      objetoId: id,
      sesion,
      payload: { magnitud, valor: entrante.valor, flags },
    });

    for (const flag of flags) {
      await registrarEvento(c, {
        codigo: EVENTO_DE_FLAG[flag],
        objetoTabla: "reading",
        objetoId: id,
        sesion,
        payload: { magnitud, valor: entrante.valor, anterior },
      });
      await c.query(
        "insert into review_queue (origen, severidad, nota) values ($1, $2, $3)",
        [
          `lectura.${flag}`,
          SEVERIDAD_DE_LECTURA,
          `Lectura de ${magnitud} con valor ${entrante.valor}` +
            (anterior === null ? "" : ` (la anterior era ${anterior})`),
        ],
      );
    }

    // Se lee DESPUÉS del insert: el trigger de la 0019 ya movió la proyección, y devolverla es
    // lo que le permite al aparato mostrar el valor acotado sin volver a preguntar.
    const despues = await proyeccionDelTurno(c, entrante.turnoId);
    return {
      tipo: "ok",
      lectura: {
        id,
        magnitud,
        valor: entrante.valor,
        flags,
        repetida: false,
        proyeccion: despues ? { odometro: despues.odometro, soc: despues.soc } : null,
      },
    };
  });
}
