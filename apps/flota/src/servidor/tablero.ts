import type { Pool } from "pg";
import { rangoEfectivoKm, maxDistanceKm, semaforoDeSalida, type Semaforo } from "../../../../packages/nucleo-comun/src/energia.ts";

// El tablero «Listos para salir» (F1) [AC-FVEH-12] — §5.2-F1, §3.E1.12, §5.7.
//
// ─── LO QUE SE PUEDE VERIFICAR HOY, Y LO QUE NO ────────────────────────────────────
//
// El AC lo acota él mismo: la rama «necesario» —cuántos km pide el plan del día— espera
// `rutas.km_presupuesto_energia`, que la SUMINISTRA el hito (d). Hasta entonces no hay contra
// qué comparar, y el semáforo resuelve en su tercer estado en vez de inventar un veredicto.
// Lo verificable hoy es lo otro: la fórmula única aplicada, la sugerencia a 1 clic y la
// degradación con estado vacío accionable.
//
// ─── LA SUGERENCIA DE RECARGA NO INVENTA HORARIOS ─────────────────────────────────
//
// El §5.2-F1 dice «1 clic SUGIERE el bloque de recarga AC nocturna». Qué es «nocturna» no está
// cerrado en ninguna parte, así que la ventana no se inventa: sale de la AGENDA REAL del
// vehículo — el hueco entre el fin de su último bloque de hoy y el comienzo del primero de
// mañana. Si no tiene agenda, no hay hueco que proponer y la respuesta lo dice.
//
// Y la sugerencia se SUGIERE: no inserta el bloque. Si el clic crea directamente o pide
// confirmación es la **pregunta 14** de la spec 02, y elegir acá una de las dos la respondería
// por el dueño — encima sin que nadie lo notara, porque el resultado se vería igual de bien.

export type FilaDelTablero = {
  vehiculo_id: string;
  patente: string;
  soc: number | null;
  rango_efectivo_km: number | null;
  max_distance_km: number | null;
  semaforo: Semaforo;
  /** Qué falta para poder decidir. Vacío = se pudo calcular todo lo que hoy se puede. */
  falta: string[];
};

type FilaCruda = {
  vehiculo_id: string;
  patente: string;
  soc: number | null;
  autonomia_nominal_km: number | null;
  soh_pct: number | null;
  factor_consumo: string | null;
  reserva_pct: number | null;
};

export async function tablero(pool: Pool): Promise<FilaDelTablero[]> {
  const { rows } = await pool.query<FilaCruda>(
    `select v.id::text as vehiculo_id, v.patente, v.soc, v.autonomia_nominal_km, v.soh_pct,
            p.factor_consumo::text as factor_consumo, p.reserva_pct
       from vehiculos v
       left join parametros p on true
      where v.activo
      order by v.patente`,
  );

  return rows.map((f) => {
    const datos = { autonomiaNominalKm: f.autonomia_nominal_km, sohPct: f.soh_pct };
    const parametros = {
      factorConsumo: f.factor_consumo === null ? null : Number(f.factor_consumo),
      reservaPct: f.reserva_pct,
    };
    // Qué le falta a ESTE vehículo para poder decidir. Se nombra en vez de mostrar un guion:
    // el §5.7 pide un vacío ACCIONABLE, y «—» no le dice a nadie qué cargar.
    const falta: string[] = [];
    if (f.autonomia_nominal_km === null) falta.push("autonomía");
    if (f.soh_pct === null) falta.push("salud de la batería");
    if (f.soc === null) falta.push("carga actual");

    return {
      vehiculo_id: f.vehiculo_id,
      patente: f.patente,
      soc: f.soc,
      rango_efectivo_km: rangoEfectivoKm(datos, parametros),
      max_distance_km: f.soc === null ? null : maxDistanceKm(f.soc, datos, parametros),
      // El «necesario» del plan del día lo suministra el hito (d): sin él, el semáforo no
      // afirma nada. Verde diría que el vehículo llega, y nadie midió contra qué.
      semaforo: semaforoDeSalida(f.soc, null, datos, parametros),
      falta,
    };
  });
}

export type Sugerencia =
  | { tipo: "ok"; empieza_en: Date; termina_en: Date }
  | { tipo: "sin_agenda" }
  | { tipo: "vehiculo_no_existe" };

/** Milisegundos de un día, para recorrer la agenda de hoy y la de mañana. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * El hueco nocturno de ESTE vehículo, derivado de su agenda real.
 *
 * No hay un horario de «noche» escrito en ninguna parte del maestro y acá no se inventa uno:
 * la ventana es la que su propia agenda deja libre entre el fin de lo último de hoy y el
 * comienzo de lo primero de mañana. Un vehículo sin agenda no tiene hueco que proponer, y eso
 * se dice — proponerle una ventana de la nada sería inventarle la jornada.
 */
export async function sugerirRecargaNocturna(
  pool: Pool,
  vehiculoId: string,
  desde: Date,
): Promise<Sugerencia> {
  const { rows: existe } = await pool.query("select 1 from vehiculos where id = $1", [vehiculoId]);
  if (existe.length === 0) return { tipo: "vehiculo_no_existe" };

  const hasta = new Date(desde.getTime() + 2 * UN_DIA_MS);
  const { rows } = await pool.query<{ ultimo_hoy: Date | null; primero_manana: Date | null }>(
    `select max(termina_en) filter (where empieza_en < $3) as ultimo_hoy,
            min(empieza_en) filter (where empieza_en >= $3) as primero_manana
       from bloques_agenda
      where vehiculo_id = $1 and empieza_en >= $2 and empieza_en < $4`,
    [vehiculoId, desde, new Date(desde.getTime() + UN_DIA_MS), hasta],
  );
  const { ultimo_hoy: ultimoHoy, primero_manana: primeroManana } = rows[0]!;
  if (!ultimoHoy || !primeroManana) return { tipo: "sin_agenda" };
  if (primeroManana <= ultimoHoy) return { tipo: "sin_agenda" };

  return { tipo: "ok", empieza_en: ultimoHoy, termina_en: primeroManana };
}
