import type { Pool } from "pg";
import { calcularEcoScoreSemanal, type EcoScoreDeChofer, type FilaEcoScore } from "../dominio/eco-score.ts";

// Eco-score v1 sin hardware [AC-FTEL-08] — §11 punto 6: consumo declarado (kilometraje) contra
// `km_presupuesto_energia` de las rutas, por chofer y por semana.
//
// Mismo criterio de acceso que `torre-de-control.ts::puedeVerTorreDeControl` (AC-FTEL-04): es
// pantalla del GESTOR, no del terreno — el chofer no tiene por qué ver la eficiencia de sus
// colegas, y el `cliente` (contratante) queda excluido de frente, mismo motivo del §4.3.
const ROLES_CON_ACCESO = new Set(["admin_tenant", "operador"]);

export function puedeVerEcoScore(rol: string): boolean {
  return ROLES_CON_ACCESO.has(rol);
}

type FilaCruda = {
  chofer_id: string;
  chofer_nombre: string;
  semana: string;
  km_presupuesto_energia: string | null;
  km_recorridos: string;
};

/**
 * Arma las filas del eco-score desde la BD real y las agrega con la función pura de dominio
 * [AC-FTEL-08]. No hay columna `turnos.chofer_id` —no existe, y agregarla es DDL de sesión
 * supervisada (AGENTS.md)—, así que quién manejó sale de `eventos` sobre `turno.abierto`, el
 * MISMO join que `gobierno.ts::auditoriaDeAccesos` usa para resolver un actor a su nombre.
 *
 * `rutas` se casa con su turno por vehículo + fecha (un turno es el vehículo-día, §4.5) y el
 * kilometraje declarado sale de `reading`: el MÁXIMO menos el MÍNIMO de odómetro capturado
 * dentro de ESE turno — nunca de la proyección global de `vehiculos.odometro`, que mezclaría
 * turnos de días distintos.
 */
export async function ecoScoreSemanal(pool: Pool): Promise<EcoScoreDeChofer[]> {
  const { rows } = await pool.query<FilaCruda>(
    `with turno_chofer as (
       select t.id as turno_id, t.vehiculo_id, t.abierto_en::date as fecha,
              u.id::text as chofer_id, p.nombre as chofer_nombre
         from turnos t
         join eventos e on e.objeto_tabla = 'turnos' and e.objeto_id = t.id
         join evento_tipo et on et.id = e.tipo_id and et.codigo = 'turno.abierto'
         join usuarios u on u.id = e.actor_id
         join personas p on p.id = u.persona_id
     ),
     km_por_turno as (
       select r.turno_id, (max(r.valor_int) - min(r.valor_int)) as km
         from reading r
         join magnitud m on m.id = r.magnitud_id and m.codigo = 'odometro'
        where r.turno_id is not null
        group by r.turno_id
     )
     select tc.chofer_id, tc.chofer_nombre,
            date_trunc('week', ru.fecha_servicio)::date::text as semana,
            ru.km_presupuesto_energia::text as km_presupuesto_energia,
            coalesce(kt.km, 0)::text as km_recorridos
       from rutas ru
       join turno_chofer tc on tc.vehiculo_id = ru.vehiculo_id and tc.fecha = ru.fecha_servicio
       left join km_por_turno kt on kt.turno_id = tc.turno_id
      where not ru.es_maestra`,
  );

  const filas: FilaEcoScore[] = rows.map((f) => ({
    choferId: f.chofer_id,
    choferNombre: f.chofer_nombre,
    semana: f.semana,
    kmPresupuestoEnergia: f.km_presupuesto_energia === null ? null : Number(f.km_presupuesto_energia),
    kmRecorridos: Math.max(0, Number(f.km_recorridos)),
  }));

  return calcularEcoScoreSemanal(filas);
}
