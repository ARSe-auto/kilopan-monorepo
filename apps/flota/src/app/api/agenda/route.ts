import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../servidor/gobierno.ts";
import { agendarBloque, listarBloques, TIPOS_DE_BLOQUE } from "../../../servidor/agenda.ts";

// La agenda por vehículo [AC-FVEH-07] — §3.E1.4, §5.2-F1, §9.3 centinela 5.
//
// No está bajo `/api/gobierno/**`: el §5.2-F1 dice que la agenda «se edita en web por operador
// y admin». Ponerla en el panel del dueño le sacaría al operador la mitad de su trabajo — el
// mismo §5.4 le reserva «asignar a rutas», y asignar es agendar.
//
// PLANIFICACIÓN (§4.2): valida online y REBOTA con error tipado. Un bloque de agenda es una
// intención sobre el futuro, no un hecho del terreno: rebotarlo no pierde nada que haya
// ocurrido, y dejarlo pasar con flag dejaría dos cosas agendadas a la misma hora — un chofer
// esperando y una entrega que no salió.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const url = new URL(peticion.url);
  const vehiculoId = url.searchParams.get("vehiculo_id") ?? "";
  if (!esUuid(vehiculoId)) return noExiste();

  const desde = new Date(url.searchParams.get("desde") ?? "");
  const hasta = new Date(url.searchParams.get("hasta") ?? "");
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    return Response.json(
      { error: "ventana_invalida", mensaje: "Decime desde y hasta qué día querés ver la agenda." },
      { status: 422 },
    );
  }
  return Response.json({ bloques: await listarBloques(g.acto.pool, vehiculoId, desde, hasta) });
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

  const empiezaEn = new Date(String(cuerpo.empieza_en ?? ""));
  const terminaEn = new Date(String(cuerpo.termina_en ?? ""));
  if (Number.isNaN(empiezaEn.getTime()) || Number.isNaN(terminaEn.getTime())) {
    return Response.json(
      { error: "ventana_invalida", mensaje: "El bloque necesita una hora de inicio y una de fin." },
      { status: 422 },
    );
  }

  const alta = await agendarBloque(g.acto.pool, g.acto.sesion, g.acto.slug, {
    vehiculoId: String(cuerpo.vehiculo_id ?? ""),
    tipo: String(cuerpo.tipo ?? ""),
    empiezaEn,
    terminaEn,
    nota: cuerpo.nota ? String(cuerpo.nota) : null,
  });

  if (alta.tipo === "vehiculo_no_existe") {
    return Response.json(
      { error: "vehiculo_no_existe", mensaje: "Ese vehículo no está en tu flota." },
      { status: 422 },
    );
  }
  if (alta.tipo === "tipo_invalido") {
    return Response.json(
      {
        error: "tipo_invalido",
        mensaje: "Un bloque es una ruta, una recarga, una mantención o un descanso.",
        tipos: TIPOS_DE_BLOQUE,
      },
      { status: 422 },
    );
  }
  if (alta.tipo === "ventana_invalida") {
    return Response.json(
      { error: "ventana_invalida", mensaje: "El bloque tiene que terminar después de empezar." },
      { status: 422 },
    );
  }
  if (alta.tipo === "documento_vencido") {
    // §4.5 con el feature encendido: no se le agenda trabajo futuro a un camión que hoy no
    // puede circular. El mensaje nombra la causa, no el síntoma.
    return Response.json(
      {
        error: "documento_vencido",
        mensaje: "Ese vehículo tiene un documento vencido. Renovalo antes de agendarle trabajo.",
      },
      { status: 422 },
    );
  }
  if (alta.tipo === "bloque_solapado") {
    // Centinela 5, con un mensaje que se puede actuar: quien lo lee está armando la semana y
    // necesita saber que el problema es el choque, no el formulario.
    return Response.json(
      {
        error: "bloque_solapado",
        mensaje: "Ese vehículo ya tiene algo agendado en esa hora. Movelo o cambiá el horario.",
      },
      { status: 422 },
    );
  }
  return Response.json({ bloque: alta.bloque }, { status: 201 });
}
