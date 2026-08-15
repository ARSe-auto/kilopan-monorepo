import { headers } from "next/headers";
import { poolDe } from "../../../servidor/conexion.ts";
import { terminologiaDelTenant, guardarTermino } from "../../../servidor/terminologia.ts";
import { LABELS } from "../../../../../../packages/nucleo-comun/src/constants.ts";

// El catálogo de terminología ya resuelto del tenant vigente [AC-FMIG-04] — §5.1. Lo consume
// el panel `/panel/terminologia` y, más adelante, cualquier pantalla de terreno que renderice
// un `<Termino>` (packages/miga) del lado del cliente.
//
// Sin parámetro de ruta: el tenant sale de `x-flota-tenant-bd`, igual que `/api/tema`. Sin esa
// cabecera no se adivina nada — 404, como el resto de las puertas de este ruteo.
//
// SIN chequeo de rol, en las DOS puertas (GET y PUT): la restricción de quién puede EDITAR
// terminología queda BLOQUEADA por la Pregunta al dueño n.º 11, que la spec de AC-FMIG-06 deja
// explícitamente sin cerrar — «la restricción de rol NO se aserta acá». Mismo criterio que
// `PUT /api/tema` (AC-FMIG-02), que tampoco la tiene mientras esa pregunta siga abierta.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  const terminos = await terminologiaDelTenant(poolDe(bd));
  return Response.json({ terminos });
}

const ETIQUETA_TIPO: Record<string, string> = {
  navegacion: "de navegación",
  titulo: "de título",
  descripcion: "de descripción",
};

/**
 * Edita un término del diccionario del tenant [AC-FMIG-06] — §5.1, §4.4.
 *
 * El rebote es SIEMPRE 422 tipado es-CL (PLANIFICACIÓN, §4.2): singular/plural vacíos, el
 * largo por tipo (`LABELS.largo_max`, §0), un carácter prohibido (`LABELS.caracteres_prohibidos`)
 * o un `term_key` que no está en el catálogo renombrable —ahí caen, sin distinción para quien
 * pide, tanto un typo como un intento directo de renombrar un término de sistema/auditoría—.
 * La autoridad de cada uno de esos límites es la BD (`tenant_terminology_*`, AC-FTEN-10):
 * `guardarTermino` solo traduce el `constraint` violado.
 */
export async function PUT(peticion: Request) {
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  let cuerpo: { term_key?: unknown; singular?: unknown; plural?: unknown };
  try {
    cuerpo = (await peticion.json()) as { term_key?: unknown; singular?: unknown; plural?: unknown };
  } catch {
    cuerpo = {};
  }

  const resultado = await guardarTermino(poolDe(bd), cuerpo.term_key, cuerpo.singular, cuerpo.plural);

  if (resultado.tipo === "termino_no_editable") {
    return Response.json(
      { error: "termino_no_editable", mensaje: "Ese término no está disponible para editar." },
      { status: 422 },
    );
  }
  if (resultado.tipo === "vacio") {
    return Response.json(
      { error: "vacio", mensaje: "El singular y el plural son obligatorios." },
      { status: 422 },
    );
  }
  if (resultado.tipo === "largo_excedido") {
    const maximo = LABELS.largo_max[resultado.tipoTermino];
    return Response.json(
      {
        error: "largo_excedido",
        mensaje:
          `Un término ${ETIQUETA_TIPO[resultado.tipoTermino] ?? ""} no puede pasar de ${maximo} ` +
          "caracteres, en singular y en plural.",
      },
      { status: 422 },
    );
  }
  if (resultado.tipo === "caracter_prohibido") {
    return Response.json(
      {
        error: "caracter_prohibido",
        mensaje: `No podés usar los caracteres ${LABELS.caracteres_prohibidos.join(" ")} en un término.`,
      },
      { status: 422 },
    );
  }

  return Response.json({ termino: resultado.termino }, { status: 200 });
}
