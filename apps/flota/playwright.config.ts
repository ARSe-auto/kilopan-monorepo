import { defineConfig, devices } from "@playwright/test";

// Puerto 3311, el del e2e de esta app en `docs/CONTRATO_PUERTOS.md`. NO el 3311 «porque
// sí» y NO el 3301: ese es del e2e de apps/kilopan y `check.sh` lo protege con un lock
// compartido entre worktrees. Un esqueleto de esta app ya nació pineado al 3301 una vez
// (08-ago-2026) y dejó a otro agente esperando un puerto que nunca se iba a liberar; un
// gate perdido por colisión de infraestructura le suma un strike a un AC sano.
const PUERTO = 3311;
// distDir propio: así el build del e2e no pisa el `.next` que `check.sh --full` ya usó
// para el chequeo standalone y para el presupuesto de performance, ambos ANTES de este
// paso. `next dev` reescribiría ese directorio en modo desarrollo y clavaría el gate en
// rojo aunque la build de producción estuviera sana.
const DIST_E2E = ".next-e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    trace: "on-first-retry",
    // Terreno antes que escritorio: la app se opera en un teléfono, de pie, con una mano.
    // 390×844 es el viewport que `check.sh` rotula en este paso.
    ...devices["iPhone 13"],
  },
  webServer: {
    // Contra un BUILD DE PRODUCCIÓN y su servidor standalone — el MISMO binario que se
    // despliega—, jamás `next dev`. `next dev` compila cada ruta en su primera visita, y
    // dentro del gate completo esa compilación se come el timeout de un click: el mismo
    // commit pasa o falla según lo cargada que esté la máquina. Testear la compilación en
    // caliente no es testear el producto.
    command: [
      `NEXT_DIST_DIR=${DIST_E2E} pnpm exec next build`,
      `NEXT_DIST_DIR=${DIST_E2E} node scripts/copiar-estaticos-standalone.mjs`,
      `PORT=${PUERTO} node ${DIST_E2E}/standalone/apps/flota/server.js`,
    ].join(" && "),
    url: `http://localhost:${PUERTO}`,
    // Nunca reusar: un servidor previo sirve un build viejo y el e2e verificaría código
    // que ya no es el del árbol.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
  },
});
