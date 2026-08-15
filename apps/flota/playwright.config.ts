import { defineConfig, devices } from "@playwright/test";

// Puerto 3311, el del e2e de esta app en `docs/CONTRATO_PUERTOS.md`. NO el 3311 «porque
// sí» y NO el 3301: ese es del e2e de apps/kilopan y `check.sh` lo protege con un lock
// compartido entre worktrees. Un esqueleto de esta app ya nació pineado al 3301 una vez
// (08-ago-2026) y dejó a otro agente esperando un puerto que nunca se iba a liberar; un
// gate perdido por colisión de infraestructura le suma un strike a un AC sano.
// 3311 por omisión —el del contrato— y `FLOTA_E2E_PUERTO` para el SEGUNDO motor: dos
// worktrees construyendo a la vez necesitan un puerto cada uno o el webServer del segundo
// aborta con «is already used» y el rojo parece de la prueba (docs/CONTRATO_PUERTOS.md).
const PUERTO = Number(process.env.FLOTA_E2E_PUERTO ?? 3311);
// distDir propio: así el build del e2e no pisa el `.next` que `check.sh --full` ya usó
// para el chequeo standalone y para el presupuesto de performance, ambos ANTES de este
// paso. `next dev` reescribiría ese directorio en modo desarrollo y clavaría el gate en
// rojo aunque la build de producción estuviera sana.
const DIST_E2E = ".next-e2e";
// Dominio base del e2e. `localhost` y no `flota.local` porque los navegadores mapean
// `*.localhost` al loopback por especificación, sin tocar /etc/hosts ni pedir sudo: así el
// navegador puede visitar el subdominio de un tenant de verdad. El ruteo por subdominio
// (AC-FTEN-05) hace que un host SIN subdominio sea 404, así que sin esto el e2e del shell
// estaría probando la página de «no encontrado».
const DOMINIO = "localhost";
const TENANT = "ruteo_activo";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://${TENANT}.${DOMINIO}:${PUERTO}`,
    trace: "on-first-retry",
    // Terreno antes que escritorio: la app se opera en un teléfono, de pie, con una mano.
    // 390×844 es el viewport que `check.sh` rotula en este paso.
    ...devices["iPhone 13"],
  },
  webServer: {
    // Contra un BUILD DE PRODUCCIÓN y el MISMO `servidor.mjs` que se despliega, jamás
    // `next dev`. `next dev` compila cada ruta en su primera visita, y
    // dentro del gate completo esa compilación se come el timeout de un click: el mismo
    // commit pasa o falla según lo cargada que esté la máquina. Testear la compilación en
    // caliente no es testear el producto.
    command: [
      // Los tenants del fixture de ruteo se siembran ANTES del build: si la base no está,
      // conviene enterarse en el primer segundo y no después de dos minutos de compilar.
      `node e2e/preparar-tenants.mjs`,
      `NEXT_DIST_DIR=${DIST_E2E} pnpm exec next build`,
      `NEXT_DIST_DIR=${DIST_E2E} NODE_ENV=production PORT=${PUERTO} node servidor.mjs`,
    ].join(" && "),
    env: { FLOTA_DOMINIO_BASE: DOMINIO },
    url: `http://${TENANT}.${DOMINIO}:${PUERTO}`,
    // Nunca reusar: un servidor previo sirve un build viejo y el e2e verificaría código
    // que ya no es el del árbol.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
  },
});
