// rafaga-matinal.js — k6 «ráfaga matinal» [AC-FPOD-15] — §0 Capacidad, §9.2.
//
// Corre SOLO desde el pipeline nightly aparte (`rafaga-matinal.sh` / el workflow con
// `schedule:`), JAMÁS dentro de `check.sh` (§9.2: "jamás dentro del gate de 10 min").
//
// Dos escenarios, parametrizados 100% desde `parametros.generado.json` (fuente única = la fila
// Capacidad del §0, packages/nucleo-comun/src/constants.ts) — cero número mágico copiado a
// mano acá, a propósito: un cambio en `CAPACIDAD` se propaga corriendo
// `generar-parametros.mjs`, no editando dos archivos que un día divergen.
//
//   bootstrap: N=dispositivos_con_turno_abierto iteraciones de GET /entrega?parada=<uuid>
//              (el snapshot real de la pantalla de parada, apps/flota/src/app/entrega/page.tsx).
//   sync:      POST /api/sync/capturas sostenido a `replays_por_segundo` durante la ráfaga,
//              con hasta `usuarios_concurrentes_por_celula` VUs por célula.
//
// Los `thresholds` son los que HACEN FALLAR el pipeline (exit code de `k6 run` ≠ 0): p95
// bootstrap < CAPACIDAD.p95_bootstrap_ms y p95 sync < CAPACIDAD.p95_sync_ms.
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const parametros = JSON.parse(open("./parametros.generado.json"));
const CAP = parametros.capacidad;

// El manifiesto de EJECUCIÓN (uuids reales + secreto en claro) que `sembrar-carga.mjs` deja en
// disco — nunca comiteado, distinto en cada corrida del nightly (§4.1: los uuid los da la BD).
const MANIFIESTO_PATH = __ENV.K6_MANIFIESTO_PATH;
const dispositivos = new SharedArray("dispositivos", function () {
  return JSON.parse(open(MANIFIESTO_PATH));
});

const BASE_URL = __ENV.K6_BASE_URL || "http://k6_rafaga_matinal.localhost:3310";

const bootstrapMs = new Trend("flota_bootstrap_ms", true);
const syncMs = new Trend("flota_sync_ms", true);

export const options = {
  scenarios: {
    bootstrap: {
      executor: "shared-iterations",
      exec: "bootstrap",
      vus: Math.min(CAP.usuarios_concurrentes_por_celula, dispositivos.length || 1),
      iterations: CAP.dispositivos_con_turno_abierto,
      maxDuration: "10m",
    },
    sync: {
      executor: "constant-arrival-rate",
      exec: "sync",
      rate: CAP.replays_por_segundo,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: Math.min(CAP.usuarios_concurrentes_por_celula, 500),
      maxVUs: CAP.usuarios_concurrentes_por_celula,
      startTime: "10m",
    },
  },
  thresholds: {
    // §0: "p95 bootstrap <400 ms" y "p95 sync <250 ms" como umbrales que FALLAN el pipeline.
    flota_bootstrap_ms: [`p(95)<${CAP.p95_bootstrap_ms}`],
    flota_sync_ms: [`p(95)<${CAP.p95_sync_ms}`],
  },
};

function dispositivoDe(indice) {
  return dispositivos[indice % dispositivos.length];
}

export function bootstrap() {
  const d = dispositivoDe(__ITER);
  const res = http.get(`${BASE_URL}/entrega?parada=${d.paradaId}`, {
    tags: { flujo: "bootstrap" },
  });
  bootstrapMs.add(res.timings.duration);
  check(res, { "bootstrap: 200": (r) => r.status === 200 });
}

export function sync() {
  const d = dispositivoDe(__VU * 1000 + __ITER);
  const cuerpo = JSON.stringify({
    capturas: [
      {
        client_uuid: crypto.randomUUID(),
        parada_id: d.paradaId,
        ts_dispositivo: new Date().toISOString(),
        tz_offset_min: -180,
        resultado: "exito",
      },
    ],
  });
  const res = http.post(`${BASE_URL}/api/sync/capturas`, cuerpo, {
    headers: { "content-type": "application/json", authorization: `Portador ${d.secreto}` },
    tags: { flujo: "sync" },
  });
  syncMs.add(res.timings.duration);
  // §4.2: CAPTURA responde 2xx SIEMPRE — un 4xx/5xx acá es la señal de carga, no de negocio.
  check(res, { "sync: 2xx": (r) => r.status >= 200 && r.status < 300 });
}
