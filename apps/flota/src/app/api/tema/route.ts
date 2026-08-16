import { headers } from "next/headers";
import { poolDe } from "../../../servidor/conexion.ts";
import { temaDelTenant, guardarTema } from "../../../servidor/tema.ts";
import { CONTRASTE } from "../../../../../../packages/nucleo-comun/src/constants.ts";

// El tema del tenant: leerlo (lo consume el bootstrap) y guardarlo (lo consumirá el panel
// admin white-label del hito g) [AC-FMIG-02] — §5.1, §4.4, §2 métrica 3.
//
// Sin parámetro de ruta: el tenant sale de `x-flota-tenant-bd`, igual que `/api/tenant`. Sin
// esa cabecera no se adivina nada — 404, como el resto de las puertas de este ruteo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  const tema = await temaDelTenant(poolDe(bd));
  return Response.json({ tema });
}

export async function PUT(peticion: Request) {
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  let cuerpo: { accent_color?: unknown; logo_url?: unknown };
  try {
    cuerpo = (await peticion.json()) as { accent_color?: unknown; logo_url?: unknown };
  } catch {
    cuerpo = {};
  }

  const resultado = await guardarTema(poolDe(bd), cuerpo.accent_color, cuerpo.logo_url);

  // Los dos rebotes son 422 TIPADO y en es-CL (§4.2, §0): quien recibe esto es el panel del
  // dueño, y tiene que poder decir qué pasó sin traducir un código.
  if (resultado.tipo === "accent_invalido") {
    return Response.json(
      { error: "accent_invalido", mensaje: "El color de acento tiene que ser un hexadecimal #rrggbb." },
      { status: 422 },
    );
  }
  if (resultado.tipo === "contraste_insuficiente") {
    return Response.json(
      {
        error: "contraste_insuficiente",
        mensaje:
          `El acento ${resultado.accentColor} no alcanza el contraste mínimo de ${CONTRASTE.texto}:1 ` +
          "contra el fondo claro o el oscuro — elegí un color más saturado u oscuro.",
      },
      { status: 422 },
    );
  }

  return Response.json({ tema: resultado.tema }, { status: 200 });
}
