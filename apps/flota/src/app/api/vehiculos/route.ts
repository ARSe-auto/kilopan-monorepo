import { headers } from "next/headers";
import { sesionDelTenant, enActo } from "../../../servidor/gobierno.ts";
import { listarVehiculos } from "../../../servidor/vehiculos.ts";
import { FEATURES, moduloVigenteEncendido, moduloApagadoRespuesta } from "../../../servidor/config.ts";

// El listado de vehículos del tenant [AC-FVEH-01] — §5.4.
//
// Puerta aparte del alta a propósito. El §5.4 reparte así: el `admin_tenant` da de alta, edita
// y desactiva; el `operador` «solo lee y asigna a rutas». Meter la lectura bajo
// `/api/gobierno/**` le devolvería 403 al operador y le impediría asignar, que es exactamente
// lo que el maestro dice que sí puede hacer. Por eso acá la guardia es la de CUALQUIER sesión
// del tenant, y las mutaciones viven en `/api/gobierno/vehiculos`.
//
// Sin sesión válida: 404 pelado, igual que el resto del panel. Para quien no es de la casa, la
// flota del vecino no existe — ni su tamaño, que ya es información.
//
// La regla de contracción [AC-FMIG-09] — §5.5, §0: esta es una LECTURA, así que el módulo
// apagado responde 403 en su uso de GESTIÓN (la pantalla «Vehículos» del catálogo, que es lo
// único que el manifest apaga) — no un manifest silencioso ni una lista vacía disfrazada de
// flota real.
//
// `?operativo=1` NO pasa por esa puerta a propósito: turno/abrir, carga, agenda y rutas piden
// el mismo listado para ELEGIR un vehículo que ya existe dentro de una acción de terreno, no
// para administrar el catálogo — y «app mínima todo-OFF = abrir turno → paradas → cerrar
// turno sigue siendo producto completo» (§5.5) no se sostiene si apagar «Vehículos» le quita a
// esas cuatro pantallas el vehículo con el que arrancan. El candado real de la gestión (alta,
// documentos) sigue siendo `POST /api/gobierno/vehiculos` y sus hermanos, sin excepción.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const operativo = new URL(peticion.url).searchParams.get("operativo") === "1";
  if (!operativo) {
    const encendido = await enActo(
      g.acto.pool,
      (c) => moduloVigenteEncendido(c, g.acto.slug, FEATURES.modulo_vehiculos),
      g.acto.sesion,
    );
    if (!encendido) return moduloApagadoRespuesta();
  }

  return Response.json({ vehiculos: await listarVehiculos(g.acto.pool) });
}
