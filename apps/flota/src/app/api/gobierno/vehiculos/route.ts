import { headers } from "next/headers";
import { guardia } from "../../../../servidor/gobierno.ts";
import { crearVehiculo } from "../../../../servidor/vehiculos.ts";
import { MENSAJE_PATENTE, TIPO_LARGO_MAX } from "../../../../dominio/patentes.ts";

// El alta de vehículo, que es un acto del dueño [AC-FVEH-01] — §5.4, §9.3 centinela 15.
//
// Vive bajo `/api/gobierno/**` y no en `/api/vehiculos` porque el §5.4 la pone, con esas
// palabras, dentro del «plano de control exclusivo del `admin_tenant`», al lado de aprobar
// accesos y revocar aparatos. La consecuencia práctica importa tanto como la doctrinal: el
// barrido autogenerado de AC-FIDN-12 recoge toda ruta de este prefijo, así que el rebote 403
// con rol `operador` y el 404 sin sesión quedan probados sobre esta puerta sin escribir una
// lista a mano — y sobre todo, quedan probados sobre la puerta que se agregue mañana.
//
// La LECTURA no está acá: vive en `/api/vehiculos`, porque el mismo §5.4 dice que el operador
// «solo lee y asigna a rutas». Un 403 sobre el listado le impediría hacer lo que sí puede.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const g = await guardia(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: { patente?: unknown; tipo?: unknown };
  try {
    cuerpo = (await peticion.json()) as { patente?: unknown; tipo?: unknown };
  } catch {
    cuerpo = {};
  }

  const alta = await crearVehiculo(g.acto.pool, g.acto.sesion, {
    patente: cuerpo.patente,
    tipo: cuerpo.tipo,
  });

  // Los tres rebotes son 422 TIPADO y con texto en es-CL (§4.2, §0): quien recibe esto es la
  // pantalla del dueño, que tiene que poder decir qué pasó sin traducir un código.
  if (alta.tipo === "patente_invalida") {
    return Response.json(
      { error: "patente_invalida", mensaje: MENSAJE_PATENTE[alta.motivo] },
      { status: 422 },
    );
  }
  if (alta.tipo === "tipo_invalido") {
    return Response.json(
      {
        error: "tipo_invalido",
        mensaje: `Elegí o escribí el tipo del vehículo (hasta ${TIPO_LARGO_MAX} caracteres).`,
      },
      { status: 422 },
    );
  }
  if (alta.tipo === "patente_duplicada") {
    // Nombrar la patente es lo que convierte el rebote en algo accionable: quien la tipeó
    // acaba de descubrir que el vehículo ya está dado de alta, y eso casi nunca es un error
    // suyo — es que otra persona de la empresa lo cargó antes.
    return Response.json(
      {
        error: "patente_duplicada",
        mensaje: `Ya hay un vehículo con la patente ${alta.patente} en esta cuenta.`,
        patente: alta.patente,
      },
      { status: 422 },
    );
  }

  return Response.json({ vehiculo: alta.vehiculo }, { status: 201 });
}
