import type { Pool, PoolClient } from "pg";
import { clasificacionDesdeComentario, type ClaseTabla } from "../dominio/clasificacion-tablas.ts";

export type { ClaseTabla };

/** Lee el `COMMENT ON TABLE` REAL de la BD del tenant (no el linter estático de migraciones) y
 *  lo traduce a la clase que declara [AC-FPOD-20] — §4.2. `obj_description` resuelve `tabla`
 *  como `regclass` contra el search_path del rol que llama, igual que cualquier query normal
 *  de la app. */
export async function clasificacionDeTabla(
  c: Pool | PoolClient,
  tabla: string,
): Promise<ClaseTabla | null> {
  const { rows } = await c.query<{ comentario: string | null }>(
    `select obj_description($1::regclass, 'pg_class') as comentario`,
    [tabla],
  );
  return clasificacionDesdeComentario(rows[0]?.comentario ?? null);
}

export type VeredictoDeClase =
  | { tipo: "ok" }
  | { tipo: "fuera_de_clase"; tabla: string; clase: ClaseTabla | null };

/**
 * La frontera de clases impuesta por el MOTOR [AC-FPOD-20] — §4.2: toda mutación que aterriza
 * por el camino de sync solo puede apuntar a una tabla clasificada CAPTURA. El 2xx-siempre de la
 * regla de oro (§0 HTTP) rige SOLO para esa clase — PLANIFICACIÓN (o una tabla sin clasificar)
 * es `"fuera_de_clase"`, y el llamador rebota 422 tipado ANTES de escribir una sola fila.
 *
 * Las validaciones de DOMINIO del lado PLANIFICACIÓN (solape de agenda, certificación vencida,
 * etc. — centinela 5 §9.3) no son de este módulo: esta guardia solo impone la frontera de clase,
 * no el contenido. Los módulos de agenda/rutas/tarifas siguen siendo dueños de esas reglas en
 * SU propio camino online (§4.2).
 */
export async function exigirClaseCaptura(c: Pool | PoolClient, tabla: string): Promise<VeredictoDeClase> {
  const clase = await clasificacionDeTabla(c, tabla);
  if (clase !== "CAPTURA") return { tipo: "fuera_de_clase", tabla, clase };
  return { tipo: "ok" };
}
