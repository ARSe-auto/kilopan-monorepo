import { headers } from "next/headers";
import { sesionDelTenant, esUuid } from "../../../../servidor/gobierno.ts";
import { encargosDelCliente } from "../../../../servidor/portal-cliente.ts";
import { crearEncargo } from "../../../../servidor/encargos.ts";

// La lista de encargos propios, para las pantallas «Hoy» y «Encargos» del portal [AC-FPOR-07]
// — spec 07 §2.1, §2.2. Mismo candado que `/cliente/api/encargos/[id]` (AC-FPOR-06): 403 para
// una sesión de la casa, 404 pelado sin sesión — acá no hay id que pueda ser ajeno, así que la
// única fuga posible sería devolver encargos de OTRA empresa, y eso lo cierra el filtro
// `empresa_cliente_id = $1` de `encargosDelCliente`, no un chequeo en esta ruta.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json({ error: "sin_acceso", mensaje: "Este panel es del contratante." }, { status: 403 });

export async function GET() {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();

  const encargos = await encargosDelCliente(g.acto.pool, g.acto.sesion);
  return Response.json({ encargos });
}

// El alta del contratante [AC-FPOR-08] — spec 07 §2.3, §4.5, §4.2. Nace `solicitado`: lo
// decide `crearEncargo` mirando `sesion.rol`, no acá — es la misma función que usa la bandeja
// del operador (AC-FRUT-01), y la única diferencia de este llamador es la empresa: el
// contratante NUNCA la manda en el body, porque solo puede crear para la SUYA (a diferencia
// del operador, que sí elige entre varias). Mandarla igual y sobrescribirla sería confiar en
// el cliente para lo único que la sesión ya sabe con certeza.
export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();
  const empresaClienteId = g.acto.sesion.empresaClienteId;
  if (!empresaClienteId) return SIN_ACCESO();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const destinoId = String(cuerpo.destino_id ?? "");
  if (!esUuid(destinoId)) {
    return Response.json(
      { error: "faltan_datos", mensaje: "Un encargo necesita su destino." },
      { status: 422 },
    );
  }

  const alta = await crearEncargo(g.acto.pool, g.acto.sesion, {
    empresaClienteId,
    destinoId,
    bultos: Number(cuerpo.bultos),
    fechaServicio: cuerpo.fecha_servicio ? String(cuerpo.fecha_servicio) : null,
    attrs: {},
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
  });

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
  if (alta.tipo === "empresa_no_existe" || alta.tipo === "attrs_invalidos") {
    // La empresa sale de la sesión y `attrs` siempre viaja vacío desde este llamador — ninguna
    // de las dos la puede disparar un cliente real, pero el tipo discriminado las contempla.
    return Response.json(
      { error: "datos_invalidos", mensaje: "No se pudo crear el encargo." },
      { status: 422 },
    );
  }
  return Response.json({ encargo: alta.encargo }, { status: alta.repetido ? 200 : 201 });
}
