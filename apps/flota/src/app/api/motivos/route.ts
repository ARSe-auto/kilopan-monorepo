import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";
import { listarMotivos, sembrarMotivos } from "../../../servidor/motivos.ts";

// El catálogo de motivos del tenant [AC-FRUT-13] — §4.5, §4.4.
//
// El GET devuelve los ACTIVOS, que son los que alimentan un flujo nuevo. Con `?todos=1` devuelve
// también los apagados: el panel que administra el catálogo tiene que poder ver lo que apagó para
// volver a encenderlo, y una fila que desaparece de su propia pantalla de administración se lee
// como un dato perdido.
//
// El POST siembra desde `vertical_template.motivos[]` (§4.4) y es idempotente: llamarlo dos veces
// no duplica la lista ni pisa el orden que el tenant ya ajustó.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const todos = new URL(peticion.url).searchParams.get("todos") === "1";
  return Response.json({ motivos: await listarMotivos(g.acto.pool, todos) });
}

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }
  const vertical = String(cuerpo.vertical ?? "");
  if (vertical === "") {
    return Response.json(
      { error: "falta_vertical", mensaje: "Decí de qué vertical sembrar los motivos." },
      { status: 422 },
    );
  }
  return Response.json({ sembrados: await sembrarMotivos(g.acto.pool, vertical) });
}
