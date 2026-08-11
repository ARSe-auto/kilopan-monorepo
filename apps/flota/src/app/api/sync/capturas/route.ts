import { headers } from "next/headers";
import { sesionParaSincronizarCapturas, esUuid } from "../../../../servidor/gobierno.ts";
import { aterrizarCapturas, capturaBienFormada, type CapturaEntrante } from "../../../../servidor/capturas.ts";

// El endpoint de sync de capturas del POD [AC-FPOD-03] — §4.2, §0 (fila HTTP), §4.6, §5.2 F4.
//
// SYNC DE CAPTURA = 2xx SIEMPRE (§0, §4.2). Ninguna rama de acá contesta 4xx por el CONTENIDO de
// una entrega: el chofer ya la hizo, y un rebote no le devuelve la parada, se la borra. Lo que
// rebota 422 es la llamada mal formada —sin `client_uuid`, sin parada, con una hora ilegible—,
// que no es un dato del terreno degradado sino un mensaje sin sujeto ni reloj.
//
// La respuesta trae UN ACUSE POR CAPTURA, y es lo que el aparato usa para sacarlas de la cola.
// Contestar un 2xx pelado dejaría al outbox borrando por el código de estado: la cola quedaría
// vacía aunque el servidor no se hubiera quedado con nada.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CapturaCruda = Record<string, unknown>;

function leer(cruda: CapturaCruda): Partial<CapturaEntrante> {
  const ts = cruda.ts_dispositivo === undefined ? null : new Date(String(cruda.ts_dispositivo));
  return {
    clientUuid: cruda.client_uuid === undefined ? undefined : String(cruda.client_uuid),
    paradaId: cruda.parada_id === undefined ? undefined : String(cruda.parada_id),
    tsDispositivo: ts ?? undefined,
    tzOffsetMin: cruda.tz_offset_min === undefined ? undefined : Number(cruda.tz_offset_min),
    resultado: cruda.resultado === undefined ? undefined : String(cruda.resultado),
    metodoEntrega: cruda.metodo_entrega === undefined || cruda.metodo_entrega === null ? null : String(cruda.metodo_entrega),
    motivoId: cruda.motivo_id === undefined || cruda.motivo_id === null ? null : String(cruda.motivo_id),
    items: cruda.items ?? null,
    evidencias: cruda.evidencias ?? [],
    // El turno cuya config CONGELADA juzga la captura [AC-FPOD-06]. Mal formado o ausente ⇒
    // `null`, que juzga contra la vigente — no es motivo de rebote: la captura es CAPTURA.
    turnoId: esUuid(String(cruda.turno_id ?? "")) ? String(cruda.turno_id) : null,
    // El undo post-replay [AC-FPOD-08] (§4.7). Ausente ⇒ `null`: es una captura de terreno, que
    // es el 99 % del tráfico. Mal formado NO se convierte en null acá — lo mira
    // `capturaBienFormada`, porque una corrección sin original a la que apuntar es una llamada
    // sin sujeto, no un dato del terreno degradado.
    supersedeDe: cruda.supersede_de === undefined || cruda.supersede_de === null ? null : String(cruda.supersede_de),
    motivo: cruda.motivo === undefined || cruda.motivo === null ? null : String(cruda.motivo),
  };
}

export async function POST(peticion: Request) {
  // La única guardia que deja pasar un aparato revocado [AC-FPOD-07] — §4.3, §4.2: la captura
  // que trae de ANTES de la revocación no rebota, se clasifica por `g.acto.revocadoEn`.
  const g = await sesionParaSincronizarCapturas(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const crudas = Array.isArray(cuerpo.capturas) ? (cuerpo.capturas as CapturaCruda[]) : null;
  if (crudas === null) {
    return Response.json(
      {
        error: "lote_invalido",
        mensaje: "El replay manda la cola entera en `capturas` (§4.7): una lista, aunque tenga una sola.",
      },
      { status: 422 },
    );
  }

  const leidas = crudas.map(leer);
  if (!leidas.every(capturaBienFormada)) {
    return Response.json(
      {
        error: "captura_mal_formada",
        mensaje:
          "Toda captura viaja con `client_uuid`, la parada, el doble reloj y su resultado (§0, §4.6).",
      },
      { status: 422 },
    );
  }

  const acuses = await aterrizarCapturas(
    g.acto.pool,
    g.acto.sesion,
    g.acto.slug,
    leidas as CapturaEntrante[],
    g.acto.revocadoEn,
  );
  return Response.json({ acuses }, { status: 200 });
}
