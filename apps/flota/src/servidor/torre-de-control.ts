import type { Pool } from "pg";
import { antiguedadDePosicion } from "../dominio/torre-de-control.ts";

// La torre de control del gestor [AC-FTEL-04] — §5.7, §11: última posición conocida por
// vehículo EN RUTA, con la antigüedad honesta del dato.
//
// Mismo criterio de acceso que `liquidaciones.ts::puedeVerLiquidaciones` (AC-FTAR-07): esta
// puerta es del operador Y del admin, no del dueño exclusivamente — el §11 la llama «pantalla
// del gestor», y ni el chofer/responsable de carga (terreno) ni el `cliente` (contratante, que
// el §4.3 y AC-FTEL-05 excluyen explícitamente del mapa de flota) entran acá.
const ROLES_CON_ACCESO = new Set(["admin_tenant", "operador"]);

export function puedeVerTorreDeControl(rol: string): boolean {
  return ROLES_CON_ACCESO.has(rol);
}

type AntiguedadPlana = { minutos: number; texto: string; desactualizada: boolean };

export type FilaTorreDeControl = {
  vehiculo_id: string;
  patente: string;
  turno_id: string;
  posicion:
    | ({ lat: number; lng: number } & AntiguedadPlana)
    // `null`: turno abierto pero el chofer todavía no capturó ni un fix — el mapa DEGRADA, no
    // inventa una posición que no existe (§5.7, §11).
    | null;
};

type FilaCruda = {
  vehiculo_id: string;
  patente: string;
  turno_id: string;
  lat: number | null;
  lng: number | null;
  recibida_en: string | null;
};

/**
 * Última posición por vehículo EN RUTA (turno abierto), para la torre de control [AC-FTEL-04].
 *
 * `ahora` viaja como parámetro —y no `new Date()` adentro— para que la antigüedad de TODAS las
 * filas de una misma respuesta se calcule contra el MISMO instante (una consulta que tarda no
 * puede hacer que la primera fila salga "hace 2 min" y la última "hace 3 min" del mismo pull) y
 * para que el test de dominio pueda inyectar un reloj fijo.
 */
export async function vehiculosEnRuta(pool: Pool, ahora: Date): Promise<FilaTorreDeControl[]> {
  const { rows } = await pool.query<FilaCruda>(
    `select v.id::text as vehiculo_id, v.patente, t.id::text as turno_id,
            p.lat, p.lng, p.recibida_en::text as recibida_en
       from vehiculos v
       join turnos t on t.vehiculo_id = v.id and t.estado = 'abierto'
       left join lateral (
         select lat, lng, recibida_en from posiciones
          where turno_id = t.id
          order by recibida_en desc
          limit 1
       ) p on true
      where v.activo
      order by v.patente`,
  );

  return rows.map((f) => ({
    vehiculo_id: f.vehiculo_id,
    patente: f.patente,
    turno_id: f.turno_id,
    posicion:
      f.lat === null || f.lng === null || f.recibida_en === null
        ? null
        : { lat: f.lat, lng: f.lng, ...antiguedadDePosicion(f.recibida_en, ahora) },
  }));
}
