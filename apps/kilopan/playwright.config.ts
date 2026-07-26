import { defineConfig, devices } from "@playwright/test";

// Tanda 6 de la auditoría: hasta que este archivo existiera, `check.sh --full`
// reportaba el paso e2e como SALTADO y ninguno de los 76 defectos confirmados hacía
// fallar el gate — "verde" no significaba "probado". Arranca acotado a propósito:
// dos pruebas reales contra el servidor real (no mocks), no una lista aspiracional.
// AC-PERF-04: las pantallas de la madrugada no pueden colgarse en 4G malo — de ahí el
// viewport móvil (390×844, el mismo que usó la auditoría) en vez del desktop por
// defecto de Playwright.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3300",
    trace: "on-first-retry",
    ...devices["iPhone 13"],
  },
  webServer: {
    command: "pnpm run dev",
    url: "http://localhost:3300",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
