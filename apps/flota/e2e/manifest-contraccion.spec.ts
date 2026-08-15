import { test, expect } from "@playwright/test";
import { MODULOS_GRUPO_DAAS } from "../src/dominio/manifest.ts";

// Contracción del manifest en `mi_flota` [AC-FPOR-03] — spec 07 §1, §2, centinela 11 (§9.3.11).
//
// El manifest se resuelve en el Server Component de `/hoy` (mismo patrón que el Nivel 0 del
// semáforo, AC-FSEM-01/13): sobre la semilla del tenant C del maestro (`?seed=c`, `mi_flota`)
// el grupo DaaS —tarifas, liquidación por cliente, portal del contratante, facturación— no se
// agrega al arreglo que llega al HTML. Este archivo cubre lo que el AC pide con esas palabras:
// (1) el manifest no incluye el grupo, sin huecos donde irían esos enlaces; (2) «sin parpadeo»
// con aserción MECÁNICA —un `MutationObserver` instalado ANTES de que la navegación empiece a
// parsear el documento, así que observa la construcción del DOM entera y no un muestreo de
// frames— entre el bootstrap y el render estable; (3) el semáforo del tenant C sigue sin
// tarjeta SLA y sin una sola cifra CLP visible (ya probado por AC-FSEM-01/13 en
// `hoy-nivel-0.spec.ts`; se re-afirma acá porque el AC pide exactamente ESTE combo en un solo
// e2e del tenant C, «UI contraída y cero CLP de tarifas visibles»).

const CLAVES_GRUPO_DAAS = MODULOS_GRUPO_DAAS.map((m) => m.clave);

test("seed C (mi_flota): el manifest NO incluye el grupo DaaS — sin huecos, lo operativo sigue [AC-FPOR-03]", async ({
  page,
}) => {
  await page.goto("/hoy?seed=c");

  const nav = page.getByTestId("manifest-modulos");
  await expect(nav).toBeVisible();

  // Lo operativo puro sigue completo: ni un módulo de menos por el hecho de contraer el grupo.
  await expect(page.locator('[data-testid="modulo-nav"][data-modulo="hoy"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="modulo-nav"][data-modulo="turno"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="modulo-nav"][data-modulo="rutas"]')).toHaveCount(1);

  // Cero rastro del grupo DaaS: sin hueco (el nodo no existe), sin candado (no hay un nodo
  // deshabilitado en su lugar — un candado es del panel admin del hito g, no de acá).
  for (const clave of CLAVES_GRUPO_DAAS) {
    await expect(
      page.locator(`[data-testid="modulo-nav"][data-modulo="${clave}"]`),
      `mi_flota no debería ofrecer el módulo «${clave}» — está en el grupo DaaS que el §3 apaga`,
    ).toHaveCount(0);
  }
  await expect(page.getByTestId("modulo-nav")).toHaveCount(3);
});

test("seed A (daas): el manifest SÍ incluye el grupo DaaS completo [AC-FPOR-03]", async ({ page }) => {
  await page.goto("/hoy?seed=a");
  await expect(page.getByTestId("modulo-nav")).toHaveCount(3 + CLAVES_GRUPO_DAAS.length);
  for (const clave of CLAVES_GRUPO_DAAS) {
    await expect(page.locator(`[data-testid="modulo-nav"][data-modulo="${clave}"]`)).toHaveCount(1);
  }
});

test("seed C (mi_flota): sin parpadeo — el grupo DaaS jamás toca el DOM, ni un instante [AC-FPOR-03]", async ({
  page,
}) => {
  // `addInitScript` corre antes de que el documento navegado empiece a evaluar CUALQUIER
  // script propio — Playwright lo garantiza para el próximo `goto`. El observer arranca sobre
  // `document.documentElement` con `childList: true, subtree: true` antes de que el parser del
  // navegador inserte el primer nodo del body, así que capta la construcción del DOM entera:
  // no es un muestreo de N frames, es cada mutación real entre el bootstrap y el render
  // estable. Si algún día el manifest se resolviera con un fetch en el cliente que muestre el
  // grupo DaaS y lo retire un tick después, este test lo delata aunque el estado FINAL ya esté
  // limpio — que es exactamente el caso que un `toHaveCount(0)` al final, solo, no cubre.
  await page.addInitScript((clavesGrupoDaas: string[]) => {
    const vistos = new Set<string>();
    (window as unknown as { __modulosDaasVistos: Set<string> }).__modulosDaasVistos = vistos;
    const marcar = (nodo: Node) => {
      if (!(nodo instanceof Element)) return;
      const candidatos = [
        ...(nodo.matches?.("[data-testid='modulo-nav']") ? [nodo] : []),
        ...Array.from(nodo.querySelectorAll?.("[data-testid='modulo-nav']") ?? []),
      ];
      for (const el of candidatos) {
        const clave = el.getAttribute("data-modulo");
        if (clave && clavesGrupoDaas.includes(clave)) vistos.add(clave);
      }
    };
    const observer = new MutationObserver((mutaciones) => {
      for (const m of mutaciones) m.addedNodes.forEach(marcar);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }, CLAVES_GRUPO_DAAS);

  await page.goto("/hoy?seed=c");
  // Render estable: sin peticiones en vuelo, ni un timer de hidratación pendiente.
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("manifest-modulos")).toBeVisible();

  const vistos = await page.evaluate(
    () => Array.from((window as unknown as { __modulosDaasVistos: Set<string> }).__modulosDaasVistos),
  );
  expect(vistos, "ningún módulo del grupo DaaS debió tocar el DOM en ningún momento, ni un instante").toEqual([]);
});

test("seed C (mi_flota): manifest contraído + semáforo sin SLA + cero CLP, en el mismo e2e del tenant C [AC-FPOR-03]", async ({
  page,
}) => {
  await page.goto("/hoy?seed=c");

  // El manifest: ya probado arriba con detalle, se re-afirma en la misma corrida del combo.
  await expect(page.getByTestId("modulo-nav")).toHaveCount(3);

  // El semáforo: sin tarjeta SLA (AC-FSEM-01) y cero CLP visible en TODA la página
  // (AC-FSEM-13) — el AC pide este combo explícitamente para el tenant C.
  await expect(page.locator('[data-testid="tarjeta-hoy"][data-dominio="daas_sla"]')).toHaveCount(0);
  const textoDeLaPagina = await page.locator("body").innerText();
  expect(textoDeLaPagina, "ninguna cifra en CLP debe llegar a la pantalla contraída").not.toMatch(/\$\s?\d/);
  expect(textoDeLaPagina.toUpperCase()).not.toContain("CLP");
});
