import { headers } from "next/headers";
import { sesionDelTenant } from "../../../servidor/gobierno.ts";
import { registrarLectura } from "../../../servidor/lecturas.ts";
import { MAGNITUDES } from "../../../dominio/lecturas.ts";

// Odómetro y SOC declarados [AC-FVEH-05] — §4.6, §4.2, §0 fila HTTP, §9.3 centinela 4.
//
// SYNC DE CAPTURA = 2xx SIEMPRE (§0). Ninguna rama de acá contesta 4xx por el CONTENIDO de la
// lectura: un SOC de 150, un odómetro que retrocede o un reloj corrido entran igual, con su
// flag, su evento y su fila en «Por revisar». El §4.2 lo dice y el centinela 4 lo mide con un
// número: rechazos = 0.
//
// Lo que SÍ rebota es lo que no es un dato del terreno: sin sesión (404 pelado, como el resto
// de la app) o una magnitud que no existe (422) — eso no es una captura degradada, es una
// llamada mal formada, y aceptarla en silencio guardaría números sin significado.
//
// La respuesta trae los flags y la PROYECCIÓN resultante: el aparato necesita ver el valor ya
// acotado sin volver a preguntar, que es lo que le permite mostrar «quedó en 100%» cuando
// alguien tecleó 150 con el teléfono en una mano.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const valor = Number(cuerpo.valor);
  if (!Number.isInteger(valor)) {
    return Response.json(
      {
        error: "valor_no_entero",
        mensaje: "La lectura viaja como número entero (§0): kilómetros enteros y carga en %.",
      },
      { status: 422 },
    );
  }

  const tsDispositivo = cuerpo.ts_dispositivo ? new Date(String(cuerpo.ts_dispositivo)) : new Date();
  if (Number.isNaN(tsDispositivo.getTime())) {
    return Response.json(
      { error: "ts_dispositivo_invalido", mensaje: "La hora del aparato no se pudo leer." },
      { status: 422 },
    );
  }

  const resultado = await registrarLectura(g.acto.pool, g.acto.sesion, {
    magnitud: String(cuerpo.magnitud ?? ""),
    valor,
    turnoId: cuerpo.turno_id ? String(cuerpo.turno_id) : null,
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
    tsDispositivo,
    tzOffsetMin: cuerpo.tz_offset_min === undefined ? null : Number(cuerpo.tz_offset_min),
    contexto: cuerpo.contexto ? String(cuerpo.contexto) : null,
  });

  if (resultado.tipo === "magnitud_desconocida") {
    return Response.json(
      {
        error: "magnitud_desconocida",
        mensaje: "Esa magnitud no existe en esta cuenta.",
        magnitudes: MAGNITUDES,
      },
      { status: 422 },
    );
  }

  // 200 y no 201 cuando la fila ya estaba: un replay del outbox no creó nada, y decir 201 le
  // haría creer al aparato que su reintento produjo una segunda lectura.
  return Response.json(
    { lectura: resultado.lectura },
    { status: resultado.lectura.repetida ? 200 : 201 },
  );
}
