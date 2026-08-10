import { headers } from "next/headers";
import { guardia } from "../../../../servidor/gobierno.ts";
import { conmutarModo, modoVigente, esModo } from "../../../../servidor/modo.ts";

// El selector de modo (§3) [AC-FRUT-14]. Es del DUEÑO: cambia qué módulos ve la operación
// entera, y el §5.4 pone esa clase de acto en el plano de control exclusivo.
//
// Conmutar es ADITIVO, jamás destructivo (centinela 11): pasar a `daas` deja la empresa
// implícita donde está —solo deja de ser la única— y volver a `mi_flota` no la crea de nuevo ni
// toca las contratantes que se dieron de alta mientras tanto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json({ modo: await modoVigente(g.acto.slug) });
}

export async function PATCH(peticion: Request) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const modo = String(cuerpo.modo ?? "");
  if (!esModo(modo)) {
    return Response.json(
      {
        error: "modo_desconocido",
        mensaje: "El modo es «mi_flota» o «daas». No hay otro.",
      },
      { status: 422 },
    );
  }

  const cambio = await conmutarModo(g.acto, modo);
  if (cambio.tipo === "tenant_no_existe") return new Response(null, { status: 404 });
  return Response.json({ modo: cambio.modo, empresas: cambio.empresas });
}
