import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// La agenda por vehículo [AC-FVEH-07] — §3.E1.4, §4.5, §9.3 centinela 5.
//
// ─── EL SOLAPE LO DECIDE LA BASE ────────────────────────────────────────────────────
//
// Igual que en `turnos`, y por el mismo motivo: preguntar antes de escribir es una carrera que
// dos ediciones simultáneas ganan, y el resultado es un camión con dos cosas agendadas a la
// misma hora — un chofer esperando y una entrega que no salió. Acá solo se traduce el `23P01`
// de PostgreSQL al 422 tipado del §4.2, y el rebote es de CERO filas por construcción porque
// la violación aborta la transacción entera.
//
// ─── «DUPLICAR SEMANA» CLONA LO REAL, JAMÁS UNA PLANTILLA ──────────────────────────
//
// El §3.E1.4 lo dice con esas palabras. La diferencia es de fondo: una plantilla es lo que
// alguien planeó alguna vez y quedó guardado; los bloques reales son lo que la semana pasada
// de verdad tuvo, con los arreglos que se le hicieron el martes. Clonar la plantilla devuelve
// la agenda al estado del que ya se había corregido.
//
// ─── LA COLISIÓN ESTÁ BLOQUEADA POR LA PREGUNTA 12, Y ESO SE RESPETA ───────────────
//
// El maestro no cierra qué pasa cuando la semana destino ya tiene bloques: ¿todo-o-nada, o
// bloque-a-bloque con reporte de los que rebotaron? Acá NO se elige. La operación no procede y
// devuelve un error que lo dice con todas las letras. Elegir «todo-o-nada» porque es lo que
// sale gratis de una transacción sería responder la pregunta por el dueño y, peor, dejarla
// respondida sin que nadie lo note: el día que él conteste «bloque a bloque», el código ya
// tendría la otra conducta y nadie recordaría que fue un accidente.

export type Bloque = {
  id: string;
  vehiculo_id: string;
  tipo: string;
  empieza_en: Date;
  termina_en: Date;
  nota: string | null;
};

export const TIPOS_DE_BLOQUE = ["ruta", "recarga", "mantencion", "descanso"] as const;
export type TipoDeBloque = (typeof TIPOS_DE_BLOQUE)[number];

export type AltaDeBloque =
  | { tipo: "ok"; bloque: Bloque }
  | { tipo: "vehiculo_no_existe" }
  | { tipo: "tipo_invalido" }
  | { tipo: "ventana_invalida" }
  | { tipo: "bloque_solapado" };

const COLUMNAS = `id::text as id, vehiculo_id::text as vehiculo_id, tipo::text as tipo,
                  empieza_en, termina_en, nota`;

const EXCLUSION_VIOLATION = "23P01";

export async function agendarBloque(
  pool: Pool,
  sesion: Sesion,
  datos: { vehiculoId: string; tipo: string; empiezaEn: Date; terminaEn: Date; nota: string | null },
): Promise<AltaDeBloque> {
  if (!(TIPOS_DE_BLOQUE as readonly string[]).includes(datos.tipo)) return { tipo: "tipo_invalido" };
  if (!(datos.terminaEn > datos.empiezaEn)) return { tipo: "ventana_invalida" };

  try {
    return await enActo(pool, async (c) => {
      const { rows: vehiculo } = await c.query("select 1 from vehiculos where id = $1", [
        datos.vehiculoId,
      ]);
      if (vehiculo.length === 0) return { tipo: "vehiculo_no_existe" };

      const { rows } = await c.query<Bloque>(
        `insert into bloques_agenda (vehiculo_id, tipo, empieza_en, termina_en, nota)
         values ($1, $2::bloque_tipo, $3, $4, $5) returning ${COLUMNAS}`,
        [datos.vehiculoId, datos.tipo, datos.empiezaEn, datos.terminaEn, datos.nota],
      );
      const bloque = rows[0]!;
      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.agenda_bloque_creado,
        objetoTabla: "bloques_agenda",
        objetoId: bloque.id,
        sesion,
        payload: { vehiculo_id: datos.vehiculoId, tipo: datos.tipo },
      });
      return { tipo: "ok", bloque };
    });
  } catch (error) {
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) return { tipo: "bloque_solapado" };
    throw error;
  }
}

/** Los bloques de un vehículo dentro de una ventana. La pantalla pide una semana. */
export async function listarBloques(
  pool: Pool,
  vehiculoId: string,
  desde: Date,
  hasta: Date,
): Promise<Bloque[]> {
  const { rows } = await pool.query<Bloque>(
    `select ${COLUMNAS} from bloques_agenda
      where vehiculo_id = $1 and empieza_en >= $2 and empieza_en < $3
      order by empieza_en`,
    [vehiculoId, desde, hasta],
  );
  return rows;
}

export type Duplicacion =
  | { tipo: "ok"; clonados: number }
  | { tipo: "vehiculo_no_existe" }
  | { tipo: "semana_vacia" }
  | { tipo: "colision_no_resuelta" };

/** Siete días, en milisegundos. La semana del §3.E1.4: «los bloques REALES de 7 días atrás». */
const UNA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Clona en la semana que empieza en `desde` los bloques REALES de la semana anterior.
 *
 * `semana_vacia` es un desenlace propio y no un «ok con cero»: si la semana anterior no tuvo
 * nada, quien apretó el botón esperaba una agenda y se quedó con la pantalla igual. Decírselo
 * es la diferencia entre «no había qué copiar» y «la app no hizo nada».
 */
export async function duplicarSemana(
  pool: Pool,
  sesion: Sesion,
  vehiculoId: string,
  desde: Date,
): Promise<Duplicacion> {
  const anterior = new Date(desde.getTime() - UNA_SEMANA_MS);
  try {
    return await enActo(pool, async (c) => {
      const { rows: vehiculo } = await c.query("select 1 from vehiculos where id = $1", [vehiculoId]);
      if (vehiculo.length === 0) return { tipo: "vehiculo_no_existe" };

      const { rows: clonados } = await c.query<{ id: string }>(
        `insert into bloques_agenda (vehiculo_id, tipo, empieza_en, termina_en, nota)
         select vehiculo_id, tipo, empieza_en + interval '7 days', termina_en + interval '7 days', nota
           from bloques_agenda
          where vehiculo_id = $1 and empieza_en >= $2 and empieza_en < $3
          order by empieza_en
         returning id::text as id`,
        [vehiculoId, anterior, desde],
      );
      if (clonados.length === 0) return { tipo: "semana_vacia" };

      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.agenda_semana_duplicada,
        objetoTabla: "bloques_agenda",
        objetoId: clonados[0]!.id,
        sesion,
        payload: { vehiculo_id: vehiculoId, clonados: clonados.length },
      });
      return { tipo: "ok", clonados: clonados.length };
    });
  } catch (error) {
    // La semana destino ya tenía algo. NO se decide qué hacer: la pregunta 12 está abierta y
    // esta rama existe para que la respuesta llegue del dueño y no de un accidente del código.
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
      return { tipo: "colision_no_resuelta" };
    }
    throw error;
  }
}
