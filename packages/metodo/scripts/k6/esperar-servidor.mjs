#!/usr/bin/env node
// esperar-servidor.mjs — reintenta un GET hasta que el servidor de producción de FLOTA
// responda, para que `rafaga-matinal.sh` [AC-FPOD-15] no lance el k6 contra un puerto que
// todavía está compilando.
//
// SIN curl: la lista blanca de comandos del motor autónomo (.claude/settings.json) no lo
// permite, y un healthcheck normal no alcanza igual (apps/flota/e2e/esqueleto.spec.ts explica
// por qué el SSR de Next responde 200 aunque falten los estáticos) — acá basta con que el
// servidor ACEPTE la conexión y conteste algo, el bootstrap real del k6 es el que mide si
// hidrata. Mismo criterio que documenta `apps/flota/playwright.config.ts` para su webServer.
const url = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 60_000);

if (!url) {
  console.error("uso: esperar-servidor.mjs <url> [timeoutMs]");
  process.exit(2);
}

const desde = Date.now();
for (;;) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    console.log(`esperar-servidor: ${url} responde`);
    process.exit(0);
  } catch {
    if (Date.now() - desde > timeoutMs) {
      console.error(`esperar-servidor: ${url} no respondió en ${timeoutMs} ms`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
