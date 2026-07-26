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
// distDir propio (ver next.config.ts): así el build del e2e no pisa el `.next` que
// check.sh ya usó para el chequeo standalone y el presupuesto de performance.
const DIST_E2E = ".next-e2e";

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
    // Contra un BUILD DE PRODUCCIÓN, no `next dev`. `next dev` compila cada ruta en su
    // primera visita — dentro de check.sh --full, justo después de otro `next build` y
    // con la máquina cargada, esa compilación se comía el timeout de 30 s de un click y
    // el mismo commit pasaba o fallaba según el momento en que corriera (visto en vivo
    // el 26-jul-2026: dos tests distintos, mismo síntoma, en corridas separadas por
    // minutos). Testear la compilación en caliente no es testear el producto.
    // Sin generateStaticParams/force-static en ninguna ruta (grep verificado): el build
    // no toca la BD, así que puede correr con DB_MODE=pglite sin riesgo de escribir en
    // producción — la razón original de preparar-base.mjs sigue vigente para el server.
    //
    // NO ES `next start`: next.config.ts tiene `output: "standalone"`, y Next mismo lo
    // advierte en el arranque — "next start" does not work with "output: standalone"
    // configuration. No es cosmético: con esa combinación /api/auth/login respondía
    // pero el POST nunca llegaba a aparecer en el log del servidor y el navegador se
    // quedaba en "Ingresando…" hasta el timeout del test — sin ningún error explícito
    // que apuntara a la causa. El servidor real es `node <distDir>/standalone/.../server.js`,
    // el mismo binario que corre en producción (Railway), así que el e2e termina
    // ejerciendo exactamente lo que se despliega — no una aproximación.
    // DB_MODE y KILOPAN_PGLITE_DIR vienen del `env` de abajo y se heredan en los CUATRO
    // pasos (el build no los usa —no toca la BD— pero heredarlos no le hace daño). Solo
    // PORT es propio del último paso.
    command: [
      `node e2e/preparar-base.mjs`,
      `NEXT_DIST_DIR=${DIST_E2E} pnpm exec next build`,
      `NEXT_DIST_DIR=${DIST_E2E} node scripts/copiar-estaticos-standalone.mjs`,
      `PORT=${PUERTO} node ${DIST_E2E}/standalone/apps/kilopan/server.js`,
    ].join(" && "),
    url: `http://localhost:${PUERTO}`,
    // Nunca reusar: un servidor previo dejó abierta la base de la corrida anterior, y los
    // tests arrancarían sobre datos que ya no coinciden con datos-semilla.json.
    reuseExistingServer: false,
    // El build real tarda más que el arranque de `next dev`; con el timeout viejo
    // (180 s) alcanzaba de sobra en máquina descargada, pero dentro del gate completo
    // —con lint/typecheck/build/audit ya corridos— más margen es más barato que un
    // segundo modo de fallo por timeout, esta vez en el arranque del webServer.
    timeout: 300_000,
    stdout: "pipe",
    env: {
      DB_MODE: "pglite",
      KILOPAN_PGLITE_DIR: BASE_E2E,
    },
  },
});
