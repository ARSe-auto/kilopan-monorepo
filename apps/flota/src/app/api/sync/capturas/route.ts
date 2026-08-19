import { headers } from "next/headers";
import { sesionParaSincronizarCapturas, esUuid } from "../../../../servidor/gobierno.ts";
import { aterrizarCapturas, capturaBienFormada, type CapturaEntrante } from "../../../../servidor/capturas.ts";
import {
  aterrizarRecargas,
  capturaDeRecargaBienFormada,
  type RecargaCapturaEntrante,
} from "../../../../servidor/recarga-sync.ts";
import {
  aterrizarMetricas,
  metricaBienFormada,
  type MetricaEntrante,
} from "../../../../servidor/metricas-sync.ts";
import {
  aterrizarPosiciones,
  posicionBienFormada,
  type PosicionEntrante,
} from "../../../../servidor/posiciones-sync.ts";
import { exigirClaseCaptura } from "../../../../servidor/clasificacion-tablas.ts";

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
    // La secuencia monotónica del dispositivo [AC-FPOD-10] — §4.7. Ausente o ilegible ⇒ `null`:
    // NO es motivo de rebote, una PWA vieja que todavía no manda el campo sigue siendo una
    // captura real.
    secuenciaDispositivo: secuenciaLegible(cruda.secuencia_dispositivo),
  };
}

function secuenciaLegible(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** La métrica que trae el `metricas` del cuerpo [AC-FPOD-14] — el gemelo de `leer`/`leerRecarga`
 *  para la telemetría del cliente (§4.6): mismas columnas snake_case que `client_metric`, el
 *  mismo formato que ya arma `dominio/toques-flujo.ts::metricaDeToques`. */
function leerMetrica(cruda: CapturaCruda): Partial<MetricaEntrante> {
  const ts = cruda.ts === undefined ? null : new Date(String(cruda.ts));
  return {
    clientUuid: cruda.client_uuid === undefined ? undefined : String(cruda.client_uuid),
    tipo: cruda.tipo === undefined ? undefined : (String(cruda.tipo) as MetricaEntrante["tipo"]),
    flujo: cruda.flujo === undefined || cruda.flujo === null ? null : String(cruda.flujo),
    valorInt: cruda.valor_int === undefined ? undefined : Number(cruda.valor_int),
    tsDispositivo: ts ?? undefined,
    tzOffsetMin: cruda.tz_offset_min === undefined ? undefined : Number(cruda.tz_offset_min),
  };
}

/** La posición que trae el `posiciones` del cuerpo [AC-FTEL-03] — el gemelo de `leer`/`leerRecarga`
 *  para el rastreo en vivo (§4.6, §11): mismas columnas snake_case que `posiciones`, con el doble
 *  reloj del aparato que la 0075 dejó listo. */
function leerPosicion(cruda: CapturaCruda): Partial<PosicionEntrante> {
  const ts = cruda.ts_dispositivo === undefined ? null : new Date(String(cruda.ts_dispositivo));
  return {
    clientUuid: cruda.client_uuid === undefined ? undefined : String(cruda.client_uuid),
    turnoId: cruda.turno_id === undefined ? undefined : String(cruda.turno_id),
    lat: cruda.lat === undefined ? undefined : Number(cruda.lat),
    lng: cruda.lng === undefined ? undefined : Number(cruda.lng),
    precisionM:
      cruda.precision_m === undefined || cruda.precision_m === null ? null : Number(cruda.precision_m),
    tsDispositivo: ts ?? undefined,
    tzOffsetMin: cruda.tz_offset_min === undefined ? undefined : Number(cruda.tz_offset_min),
  };
}

/** El cierre de recarga que trae el `recargas` del cuerpo [AC-FPOD-13] — el gemelo de `leer`
 *  para la cola de recarga, sin `costo_clp`: el flujo del chofer no lo tiene (§4.8). */
function leerRecarga(cruda: CapturaCruda): Partial<RecargaCapturaEntrante> {
  const ts = cruda.ts_dispositivo === undefined ? null : new Date(String(cruda.ts_dispositivo));
  return {
    clientUuid: cruda.client_uuid === undefined ? undefined : String(cruda.client_uuid),
    vehiculoId: cruda.vehiculo_id === undefined ? undefined : String(cruda.vehiculo_id),
    turnoId: cruda.turno_id === undefined || cruda.turno_id === null ? null : String(cruda.turno_id),
    wh: cruda.wh === undefined ? undefined : Number(cruda.wh),
    socInicial: cruda.soc_inicial === undefined || cruda.soc_inicial === null ? null : Number(cruda.soc_inicial),
    socFinal: cruda.soc_final === undefined || cruda.soc_final === null ? null : Number(cruda.soc_final),
    tsDispositivo: ts ?? undefined,
    tzOffsetMin: cruda.tz_offset_min === undefined ? undefined : Number(cruda.tz_offset_min),
  };
}

export async function POST(peticion: Request) {
  // La única guardia que deja pasar un aparato revocado [AC-FPOD-07] — §4.3, §4.2: la captura
  // que trae de ANTES de la revocación no rebota, se clasifica por `g.acto.revocadoEn`.
  const g = await sesionParaSincronizarCapturas(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  // La frontera de clases del MOTOR [AC-FPOD-20] — §4.2: `eventos` es el aterrizaje universal de
  // TODA captura de este endpoint (POD y recarga, §4.6); si algún día dejara de estar clasificada
  // CAPTURA — migración rota, tabla equivocada — el 2xx-siempre NO se aplica, y el endpoint
  // rebota 422 tipado antes de tocar el cuerpo de la petición, con 0 filas escritas.
  const veredictoClase = await exigirClaseCaptura(g.acto.pool, "eventos");
  if (veredictoClase.tipo === "fuera_de_clase") {
    return Response.json(
      {
        error: "mutacion_fuera_de_clase",
        mensaje:
          `La tabla "${veredictoClase.tabla}" no es de clase CAPTURA — el 2xx-siempre del camino ` +
          "de sync rige solo para esa clase (§4.2).",
      },
      { status: 422 },
    );
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  // `capturas` (POD), `recargas` [AC-FPOD-13], `metricas` [AC-FPOD-14] y `posiciones`
  // [AC-FTEL-03] viajan en el MISMO cuerpo, y basta con que UNA de las cuatro venga: un lote que
  // solo vacía la cola de rastreo no tiene por qué mandar `capturas` vacío para no rebotar.
  const capturasProvistas = cuerpo.capturas !== undefined;
  const recargasProvistas = cuerpo.recargas !== undefined;
  const metricasProvistas = cuerpo.metricas !== undefined;
  const posicionesProvistas = cuerpo.posiciones !== undefined;
  if (!capturasProvistas && !recargasProvistas && !metricasProvistas && !posicionesProvistas) {
    return Response.json(
      {
        error: "lote_invalido",
        mensaje:
          "El replay manda la cola en `capturas`, `recargas`, `metricas` y/o `posiciones` (§4.7): una lista, aunque tenga una sola.",
      },
      { status: 422 },
    );
  }
  if (capturasProvistas && !Array.isArray(cuerpo.capturas)) {
    return Response.json(
      { error: "lote_invalido", mensaje: "`capturas` viaja como lista (§4.7)." },
      { status: 422 },
    );
  }
  if (recargasProvistas && !Array.isArray(cuerpo.recargas)) {
    return Response.json(
      { error: "lote_invalido", mensaje: "`recargas` viaja como lista (§4.7)." },
      { status: 422 },
    );
  }
  if (metricasProvistas && !Array.isArray(cuerpo.metricas)) {
    return Response.json(
      { error: "lote_invalido", mensaje: "`metricas` viaja como lista (§4.7)." },
      { status: 422 },
    );
  }
  if (posicionesProvistas && !Array.isArray(cuerpo.posiciones)) {
    return Response.json(
      { error: "lote_invalido", mensaje: "`posiciones` viaja como lista (§4.7)." },
      { status: 422 },
    );
  }

  const crudas = Array.isArray(cuerpo.capturas) ? (cuerpo.capturas as CapturaCruda[]) : [];
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

  const recargasCrudas = Array.isArray(cuerpo.recargas) ? (cuerpo.recargas as CapturaCruda[]) : [];
  const recargasLeidas = recargasCrudas.map(leerRecarga);
  if (!recargasLeidas.every(capturaDeRecargaBienFormada)) {
    return Response.json(
      {
        error: "recarga_mal_formada",
        mensaje: "Todo cierre de recarga viaja con `client_uuid`, `vehiculo_id`, `wh` y el doble reloj (§0, §4.6).",
      },
      { status: 422 },
    );
  }

  const metricasCrudas = Array.isArray(cuerpo.metricas) ? (cuerpo.metricas as CapturaCruda[]) : [];
  const metricasLeidas = metricasCrudas.map(leerMetrica);
  if (!metricasLeidas.every(metricaBienFormada)) {
    return Response.json(
      {
        error: "metrica_mal_formada",
        mensaje:
          "Toda métrica viaja con `client_uuid`, `tipo` del catálogo, `valor_int` entero y el doble reloj (§0, §4.6).",
      },
      { status: 422 },
    );
  }

  const posicionesCrudas = Array.isArray(cuerpo.posiciones) ? (cuerpo.posiciones as CapturaCruda[]) : [];
  const posicionesLeidas = posicionesCrudas.map(leerPosicion);
  if (!posicionesLeidas.every(posicionBienFormada)) {
    return Response.json(
      {
        error: "posicion_mal_formada",
        mensaje:
          "Toda posición viaja con `client_uuid`, `turno_id`, `lat`/`lng` y el doble reloj (§0, §4.6).",
      },
      { status: 422 },
    );
  }

  // La huella del enrolamiento que capturó el lote [AC-FPOD-09] — §4.7. Ausente o mal formada ⇒
  // `null`, y el hecho se atribuye a la sesión que lo trae: NO es motivo de rebote, porque el
  // 99 % de los lotes los manda quien los capturó y una versión vieja de la PWA no manda el campo.
  const enrolamiento =
    typeof cuerpo.enrolamiento === "string" && cuerpo.enrolamiento !== "" ? cuerpo.enrolamiento : null;

  const acuses = await aterrizarCapturas(
    g.acto.pool,
    g.acto.sesion,
    g.acto.slug,
    leidas as CapturaEntrante[],
    g.acto.revocadoEn,
    enrolamiento,
  );

  // El cierre de recarga [AC-FPOD-13]: mismo endpoint, mismo POST, acuse aparte porque su forma
  // es otra (sin `config_version_id` ni `flags` — la regla de oro del §4.2 para esta captura es
  // más simple: 2xx siempre, idempotente, cero monto).
  const acusesRecarga =
    recargasLeidas.length === 0
      ? []
      : await aterrizarRecargas(g.acto.pool, g.acto.sesion, recargasLeidas as RecargaCapturaEntrante[]);

  // La telemetría [AC-FPOD-14] — ídem, mismo endpoint, mismo POST: `metricaBienFormada` ya filtró
  // lo que no es CAPTURA real, así que lo que llega acá aterriza sin rebote (§4.2).
  const acusesMetricas =
    metricasLeidas.length === 0
      ? []
      : await aterrizarMetricas(g.acto.pool, g.acto.sesion, metricasLeidas as MetricaEntrante[]);

  // La posición en vivo [AC-FTEL-03] — ídem, mismo endpoint, mismo POST: `posicionBienFormada` ya
  // filtró lo que no es CAPTURA real; lo que llega acá aterriza salvo que el turno haya cerrado
  // entre la captura y el replay, la única excepción del §4.2 (§7.8, 0074).
  const acusesPosiciones =
    posicionesLeidas.length === 0
      ? []
      : await aterrizarPosiciones(g.acto.pool, g.acto.sesion, posicionesLeidas as PosicionEntrante[]);

  return Response.json(
    {
      acuses,
      acuses_recarga: acusesRecarga,
      acuses_metricas: acusesMetricas,
      acuses_posiciones: acusesPosiciones,
    },
    { status: 200 },
  );
}
