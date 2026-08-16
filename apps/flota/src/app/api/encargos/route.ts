import { headers } from "next/headers";
import { sesionDelTenant, esUuid } from "../../../servidor/gobierno.ts";
import { crearEncargo, listarEncargos } from "../../../servidor/encargos.ts";

// La bandeja de encargos (F1) [AC-FRUT-01] — §3.E1.5, §5.2-F1, §4.2.
//
// PLANIFICACIÓN: acá SÍ se rebota, al revés que todo lo del módulo 02. Un encargo lo tipea
// alguien sentado con red antes de que exista el camión — rebotar no pierde ningún hecho del
// mundo, y dejar entrar 600 bultos sí produce una ruta que no se puede cargar.
//
// Los dos rebotes del AC van con 0 filas y con mensajes DISTINTOS: el de bultos se arregla
// cambiando un número, el de `attrs` se arregla mirando la definición del vertical. Un
// «datos inválidos» para los dos dejaría a quien tipea probando a ciegas.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  const fecha = new URL(peticion.url).searchParams.get("fecha");
  return Response.json({ encargos: await listarEncargos(g.acto.pool, g.acto.sesion, fecha) });
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

  const empresaClienteId = String(cuerpo.empresa_cliente_id ?? "");
  const destinoId = String(cuerpo.destino_id ?? "");
  if (!esUuid(empresaClienteId) || !esUuid(destinoId)) {
    return Response.json(
      { error: "faltan_datos", mensaje: "Un encargo necesita su empresa y su destino." },
      { status: 422 },
    );
  }

  const alta = await crearEncargo(g.acto.pool, g.acto.sesion, {
    empresaClienteId,
    destinoId,
    bultos: Number(cuerpo.bultos),
    fechaServicio: cuerpo.fecha_servicio ? String(cuerpo.fecha_servicio) : null,
    attrs: (cuerpo.attrs ?? {}) as Record<string, unknown>,
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
  });

  if (alta.tipo === "empresa_no_existe") {
    return Response.json(
      { error: "empresa_no_existe", mensaje: "Esa empresa no está en tu lista de contratantes." },
      { status: 422 },
    );
  }
  if (alta.tipo === "destino_no_existe") {
    return Response.json(
      { error: "destino_no_existe", mensaje: "Ese destino no está cargado todavía." },
      { status: 422 },
    );
  }
  if (alta.tipo === "bultos_fuera_de_rango") {
    return Response.json(
      {
        error: "bultos_fuera_de_rango",
        mensaje: "Los bultos van de 1 a 500. Un cero no es un encargo y más de 500 es un camión entero.",
      },
      { status: 422 },
    );
  }
  if (alta.tipo === "attrs_invalidos") {
    return Response.json(
      {
        error: "attrs_invalidos",
        mensaje: "Falta un dato del tipo de carga, o uno de los que mandaste no es de ese tipo.",
        detalle: alta.detalle,
      },
      { status: 422 },
    );
  }
  return Response.json({ encargo: alta.encargo }, { status: alta.repetido ? 200 : 201 });
}
