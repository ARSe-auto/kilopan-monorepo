import { headers } from "next/headers";
import { sesionDelTenant } from "../../../../../servidor/gobierno.ts";
import { importarEncargosCliente, COLUMNAS_DEL_CSV_CLIENTE } from "../../../../../servidor/encargos.ts";

// Importación CSV del portal del contratante [AC-FPOR-09] — spec 07 §3.E1.10, §4.2, §5.7.
//
// Mismo contrato de respuesta que `/api/encargos/importar` (AC-FRUT-02: archivo_vacio /
// faltan_columnas / filas_invalidas / 201), con dos diferencias que son las que cierran este AC:
// la empresa SIEMPRE sale de `sesion.empresaClienteId` —jamás del archivo ni del body, mismo
// candado que el alta individual (AC-FPOR-08)— y cada fila nace `solicitado`, no `aceptado`
// (`importarEncargosCliente`, servidor/encargos.ts). La granularidad todo-o-nada es PROVISIONAL,
// ligada a la pregunta 4 de la spec: mientras no se responda, un lote mixto rebota entero.
//
// «Sin conexión se deshabilita» (§5.7) es responsabilidad del CLIENTE (`cliente/nuevo/page.tsx`
// deshabilita el control con `navigator.onLine`): esta ruta ni sabe ni necesita saber si quien
// la llamó estaba offline un segundo antes, la deshabilitación es de la UI, no del servidor.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json({ error: "sin_acceso", mensaje: "Este panel es del contratante." }, { status: 403 });

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();
  const empresaClienteId = g.acto.sesion.empresaClienteId;
  if (!empresaClienteId) return SIN_ACCESO();

  const texto = await peticion.text();
  const resultado = await importarEncargosCliente(g.acto.pool, g.acto.sesion, empresaClienteId, texto);

  if (resultado.tipo === "archivo_vacio") {
    return Response.json(
      { error: "archivo_vacio", mensaje: "El archivo no tiene ninguna fila debajo del encabezado." },
      { status: 422 },
    );
  }
  if (resultado.tipo === "faltan_columnas") {
    return Response.json(
      {
        error: "faltan_columnas",
        mensaje: `Al archivo le faltan estas columnas: ${resultado.columnas.join(", ")}.`,
        columnas: resultado.columnas,
        esperadas: COLUMNAS_DEL_CSV_CLIENTE,
      },
      { status: 422 },
    );
  }
  if (resultado.tipo === "filas_invalidas") {
    return Response.json(
      {
        error: "filas_invalidas",
        mensaje:
          `Hay ${resultado.filas.length} fila(s) con problemas y no se importó nada. ` +
          "Corregilas y volvé a subir el archivo.",
        filas: resultado.filas,
        pendiente:
          "Si una fila mala tiene que invalidar el archivo entero o solo esa fila lo decide el dueño (pregunta 4).",
      },
      { status: 422 },
    );
  }
  return Response.json({ creados: resultado.creados, repetidos: resultado.repetidos }, { status: 201 });
}
