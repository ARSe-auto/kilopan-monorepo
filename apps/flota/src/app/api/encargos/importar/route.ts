import { headers } from "next/headers";
import { sesionDelTenant } from "../../../../servidor/gobierno.ts";
import { importarEncargos, COLUMNAS_DEL_CSV } from "../../../../servidor/encargos.ts";

// Importación CSV de la bandeja (F1) [AC-FRUT-02] — §5.2-F1, §4.2, §9.3.1.
//
// LA GRANULARIDAD ESTÁ ABIERTA (pregunta 6 de la spec 03): si una fila inválida invalida el
// archivo entero o solo esa fila. Esta implementación elige Todo-o-nada y lo declara como
// provisional — no porque salga gratis de una transacción, sino porque es la que se puede
// deshacer: una importación a medias deja al operador sin saber qué entró, y completarla son
// veinte altas a mano; volver a subir el archivo corregido es un clic.
//
// Se reportan TODAS las filas malas con su número de LÍNEA tal como se ve en Excel —el
// encabezado cuenta—, no la primera. Quien arma el archivo lo corrige de una vez en vez de
// subirlo cinco veces descubriendo un error por vez.
//
// El cuerpo es el CSV en texto plano: el parser es propio (`dominio/csv.ts`) y no una
// dependencia, por el mismo criterio que el codificador de QR — este es el camino por el que
// entran los datos de negocio de los clientes del tenant.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const texto = await peticion.text();
  const resultado = await importarEncargos(g.acto.pool, g.acto.sesion, texto);

  if (resultado.tipo === "archivo_vacio") {
    // «No había nada que importar» y «se importaron cero» son dos cosas distintas, y la segunda
    // dejaría al operador esperando encargos que nunca pidió.
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
        esperadas: COLUMNAS_DEL_CSV,
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
        // Se dice qué política se aplicó, porque todavía no está decidida (pregunta 6).
        pendiente:
          "Si una fila mala tiene que invalidar el archivo entero o solo esa fila lo decide el dueño (pregunta 6).",
      },
      { status: 422 },
    );
  }
  return Response.json({ creados: resultado.creados, repetidos: resultado.repetidos }, { status: 201 });
}
