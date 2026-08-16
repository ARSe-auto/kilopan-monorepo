import { headers } from "next/headers";
import { guardia } from "../../../../servidor/gobierno.ts";
import { listarFunciones, alternarFuncion } from "../../../../servidor/funciones.ts";

// La pantalla «Funciones» del panel admin, por HTTP [AC-FMIG-08] — §5.5, §5.4.
//
// Vive bajo `/api/gobierno/**` con esas palabras exactas: el §5.5 pone la pantalla dentro
// del "plano de control exclusivo del dueño" que el §5.4 ya lista al lado de vehículos y
// enrolamiento. La consecuencia práctica: el barrido autogenerado de AC-FIDN-12
// (`e2e/gobierno.spec.ts`) recoge esta ruta sola y ya prueba sin sesión ⇒ 404 pelado y rol
// distinto de `admin_tenant` ⇒ 403 con CERO filas — es el "test calcado del patrón de
// vehículos §5.4" que pide el AC. Lo que este archivo prueba de más, en `e2e/funciones.spec.ts`,
// es lo que el barrido genérico no puede: el 422 de "fuera de plan" y que aplica al
// próximo bootstrap.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  return Response.json({ funciones: await listarFunciones(g.acto.slug) });
}

export async function PATCH(peticion: Request) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: { lookup_key?: unknown; enabled?: unknown };
  try {
    cuerpo = (await peticion.json()) as { lookup_key?: unknown; enabled?: unknown };
  } catch {
    cuerpo = {};
  }

  const lookupKey = typeof cuerpo.lookup_key === "string" ? cuerpo.lookup_key : "";
  if (!lookupKey || typeof cuerpo.enabled !== "boolean") {
    return Response.json(
      {
        error: "toggle_invalido",
        mensaje: "Indicá qué función y si querés encenderla o apagarla.",
      },
      { status: 422 },
    );
  }

  const resultado = await alternarFuncion(g.acto, lookupKey, cuerpo.enabled);

  if (resultado.tipo === "feature_desconocida") {
    return Response.json(
      { error: "feature_desconocida", mensaje: "Esa función no existe." },
      { status: 422 },
    );
  }
  // El rebote central del AC: encender algo fuera del plan del tenant. 422 tipado es-CL, y
  // CERO filas nuevas —ni en `tenant_feature_overrides` ni en `audit_trail`— porque
  // `alternarFuncion` devuelve antes de tocar ninguna de las dos.
  if (resultado.tipo === "fuera_de_plan") {
    return Response.json(
      {
        error: "fuera_de_plan",
        mensaje: `«${lookupKey}» no está incluida en tu plan. Pedí que te la agreguen para encenderla.`,
      },
      { status: 422 },
    );
  }

  return Response.json({ lookup_key: lookupKey, habilitada: resultado.habilitada });
}
