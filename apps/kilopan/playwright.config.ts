import { defineConfig, devices } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Tanda 6 de la auditoría: hasta que este archivo existiera, `check.sh --full`
// reportaba el paso e2e como SALTADO y ninguno de los 76 defectos confirmados hacía
// fallar el gate — "verde" no significaba "probado".
// AC-PERF-04: las pantallas de la madrugada no pueden colgarse en 4G malo — de ahí el
// viewport móvil (390×844, el mismo que usó la auditoría) en vez del desktop por
// defecto de Playwright.
//
// Base y puerto PROPIOS, no los de desarrollo. Dos razones, las dos aprendidas a golpes:
//   1. El camino dorado vende y cierra caja de verdad. El .env.local de este Mac apunta a
//      Postgres de PRODUCCIÓN, así que sin forzar DB_MODE acá el e2e dejaría ventas y
//      cierres falsos en los libros del cliente. e2e/preparar-base.mjs además se niega a
//      correr si no recibe las dos variables: falla cerrado, no en silencio.
//   2. pglite es un motor embebido de un solo proceso. Compartir directorio con `pnpm dev`
//      levantado hace que el e2e falle por el lock de la base y no por la app — media hora
//      de diagnóstico equivocado, dos veces, durante la auditoría.
const AQUI = dirname(fileURLToPath(import.meta.url));
const BASE_E2E = join(AQUI, "..", "..", "db", "data", "e2e-pglite");
const PUERTO = 3301;

export default defineConfig({
  testDir: "./e2e",
  // El camino dorado toca stock y caja compartidos: en paralelo los tests se pisan entre
  // sí y el resultado depende del orden en que arrancaron. Un e2e que falla distinto cada
  // vez no se lee, se ignora — y eso es peor que no tenerlo.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    trace: "on-first-retry",
    ...devices["iPhone 13"],
    // Pesar y entregar exigen foto tomada EN LA APP por getUserMedia (nunca un
    // <input type=file>, que dejaría adjuntar una foto vieja de la galería como si fuera
    // de esta bandeja). Sin cámara falsa esas dos pantallas son intesteables, que es
    // justamente por qué el e2e se había quedado en dos casos de autorización.
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
    // Las dos juntas: `permissions` REEMPLAZA el set del contexto, así que pedir solo
    // geolocalización deja la cámara denegada y el obturador nunca se habilita.
    permissions: ["geolocation", "camera"],
    // La entrega exige GPS y la BD rechaza cualquier punto fuera de Chile continental
    // (lat entre -56 y -17): estas coordenadas son las del cliente sembrado, así que la
    // entrega queda dentro de zona y no marcada como sospechosa.
    geolocation: { latitude: -33.4489, longitude: -70.6693 },
  },
  webServer: {
    command: `node e2e/preparar-base.mjs && pnpm exec next dev --port ${PUERTO}`,
    url: `http://localhost:${PUERTO}`,
    // Nunca reusar: un servidor previo dejó abierta la base de la corrida anterior, y los
    // tests arrancarían sobre datos que ya no coinciden con datos-semilla.json.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    env: {
      DB_MODE: "pglite",
      KILOPAN_PGLITE_DIR: BASE_E2E,
    },
  },
});
