import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";

// El reporte de energía por semana [AC-FVEH-13] — §3.E1.12, §4.8, §9.3 centinela 10.
//
// EL DINERO NO SE FILTRA ACÁ: lo filtra la RLS de la base. Esta ruta consulta `energia_semanal`
// y devuelve lo que la política de rol le deje ver — con `app.current_role` en chofer o
// responsable_carga, la vista no tiene filas que sumar y el reporte sale vacío. Un filtro
// escrito en el servidor sería un `if` que alguien puede olvidar en la próxima pantalla; la
// política se aplica a toda consulta, incluida la que todavía no existe.
//
// EL AHORRO vs diésel no está: falta el rendimiento de referencia (pregunta 3). Se dice en la
// respuesta en vez de mandar un cero — un cero acá se leería como «no ahorraste nada».
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { rows } = await g.acto.pool.query(
    `select semana, sesiones, wh, costo_clp, sesiones_sin_costo
       from energia_semanal order by semana desc limit 12`,
  );
  return Response.json({
    semanas: rows,
    ahorro_vs_diesel:
      "Pendiente del rendimiento diésel de referencia (km/l), que el dueño todavía no fijó.",
  });
}
