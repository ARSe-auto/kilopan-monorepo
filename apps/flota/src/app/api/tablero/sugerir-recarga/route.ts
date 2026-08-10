import { headers } from "next/headers";
import { sesionDelTenant, esUuid } from "../../../../servidor/gobierno.ts";
import { sugerirRecargaNocturna } from "../../../../servidor/tablero.ts";

// «1 clic sugiere el bloque de recarga AC nocturna» (§5.2-F1) [AC-FVEH-12].
//
// SUGIERE, no crea. El verbo es el del maestro, y si el clic debe insertar el bloque
// directamente o pedir confirmación antes es la **pregunta 14** de la spec 02. Elegir acá una
// de las dos la respondería por el dueño — y encima sin que nadie lo notara, porque el
// resultado se vería igual de bien en pantalla.
//
// La ventana NO se inventa: sale del hueco que la agenda real del vehículo deja entre el fin de
// lo último de hoy y el comienzo de lo primero de mañana. Qué es «nocturna» no está cerrado en
// el maestro, y un horario fijo escrito acá sería una jornada inventada para todas las flotas.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: { vehiculo_id?: unknown; desde?: unknown };
  try {
    cuerpo = (await peticion.json()) as { vehiculo_id?: unknown; desde?: unknown };
  } catch {
    cuerpo = {};
  }

  const vehiculoId = String(cuerpo.vehiculo_id ?? "");
  if (!esUuid(vehiculoId)) {
    return Response.json(
      { error: "vehiculo_no_existe", mensaje: "Decime de qué vehículo querés la sugerencia." },
      { status: 422 },
    );
  }
  const desde = cuerpo.desde ? new Date(String(cuerpo.desde)) : new Date();
  if (Number.isNaN(desde.getTime())) {
    return Response.json(
      { error: "fecha_invalida", mensaje: "No se pudo leer el día de la sugerencia." },
      { status: 422 },
    );
  }

  const sugerencia = await sugerirRecargaNocturna(g.acto.pool, vehiculoId, desde);
  if (sugerencia.tipo === "vehiculo_no_existe") {
    return Response.json(
      { error: "vehiculo_no_existe", mensaje: "Ese vehículo no está en tu flota." },
      { status: 422 },
    );
  }
  if (sugerencia.tipo === "sin_agenda") {
    // Estado vacío ACCIONABLE (§5.7): dice qué falta para poder sugerir, en vez de proponer
    // una ventana de la nada — que sería inventarle la jornada a la empresa.
    return Response.json(
      {
        error: "sin_agenda",
        mensaje:
          "Este vehículo no tiene agenda para hoy y mañana, así que no hay hueco nocturno que proponer. " +
          "Armá su semana y volvé a intentar.",
      },
      { status: 422 },
    );
  }
  // La sugerencia se DEVUELVE; insertarla es la pregunta 14 y no se decide acá.
  return Response.json({
    sugerencia: {
      tipo: "recarga",
      empieza_en: sugerencia.empieza_en,
      termina_en: sugerencia.termina_en,
    },
    pendiente: "Si este clic debe crear el bloque o pedir confirmación lo decide el dueño (pregunta 14).",
  });
}
