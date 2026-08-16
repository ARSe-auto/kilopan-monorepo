import { test, expect } from "@playwright/test";
import { SEMAFORO } from "../../../packages/nucleo-comun/src/constants.ts";

// Nivel 0 del «Hoy» [AC-FSEM-01] — §2.1 de la spec 05.
//
// La pantalla renderiza sobre las semillas literales de `semaforo-fixtures.ts` mientras el
// digest real (`GET /api/semaforo/digest` contra `signal_rule`) no exista — decisión de
// alcance declarada en `apps/flota/src/app/hoy/page.tsx` y en el manifiesto de rutas. Este
// e2e cubre exactamente lo que el AC pide del Nivel 0: cuántas tarjetas, cuáles, y qué
// muestra cada color — no la evaluación de señales (AC-FSEM-02/07/08/16-19), que son de
// otros ACs de este mismo módulo.

test("seed A (daas, con SLA): el tope de SEMAFORO.tarjetas_max tarjetas, incluida la SLA [AC-FSEM-01]", async ({ page }) => {
  await page.goto("/hoy?seed=a");
  const tarjetas = page.getByTestId("tarjeta-hoy");
  await expect(tarjetas).toHaveCount(SEMAFORO.tarjetas_max);
  await expect(page.locator('[data-testid="tarjeta-hoy"][data-dominio="daas_sla"]')).toBeVisible();
});

test("seed C (mi_flota, sin SLA): 5 tarjetas fijas, sin hueco donde iría la SLA [AC-FSEM-01]", async ({ page }) => {
  await page.goto("/hoy?seed=c");
  const tarjetas = page.getByTestId("tarjeta-hoy");
  await expect(tarjetas).toHaveCount(5);
  await expect(page.locator('[data-testid="tarjeta-hoy"][data-dominio="daas_sla"]')).toHaveCount(0);
});

test("verde muestra SOLO el agregado — sin contador ni excepción [AC-FSEM-01]", async ({ page }) => {
  await page.goto("/hoy?seed=a");
  // Entregas vs plan viene verde en el fixture de seed A.
  const tarjeta = page.locator('[data-testid="tarjeta-hoy"][data-dominio="entregas_vs_plan"]');
  await expect(tarjeta).toHaveAttribute("data-color", "verde");
  await expect(tarjeta.getByTestId("agregado-verde")).toContainText("34/40");
  await expect(tarjeta.getByTestId("contador-excepciones")).toHaveCount(0);
  await expect(tarjeta.getByTestId("excepcion-mas-antigua")).toHaveCount(0);
});

test("rojo muestra contador + la excepción MÁS ANTIGUA por record_time, no la primera del arreglo [AC-FSEM-01]", async ({ page }) => {
  await page.goto("/hoy?seed=a");
  // Datos/sync viene rojo en el fixture, con 3 excepciones fuera de orden: la más vieja
  // (9 h) va en el MEDIO del arreglo, no primera — si la pantalla mostrara la primera del
  // arreglo en vez de comparar `record_time`, este caso la delata.
  const tarjeta = page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]');
  await expect(tarjeta).toHaveAttribute("data-color", "rojo");
  await expect(tarjeta.getByTestId("agregado-verde")).toHaveCount(0);
  await expect(tarjeta.getByTestId("contador-excepciones")).toHaveText("3");
  await expect(tarjeta.getByTestId("excepcion-mas-antigua")).toContainText("Hueco de secuencia");
});

test("amarillo también cuenta y muestra su propia excepción más antigua [AC-FSEM-01]", async ({ page }) => {
  await page.goto("/hoy?seed=a");
  const tarjeta = page.locator('[data-testid="tarjeta-hoy"][data-dominio="turnos_conductores"]');
  await expect(tarjeta).toHaveAttribute("data-color", "amarillo");
  await expect(tarjeta.getByTestId("contador-excepciones")).toHaveText("2");
  await expect(tarjeta.getByTestId("excepcion-mas-antigua")).toContainText("Turno de Marcela");
});

test("el color nunca es la única señal: la palabra viaja siempre, no solo el punto [AC-FSEM-01]", async ({ page }) => {
  await page.goto("/hoy?seed=a");
  const rotulo = page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').getByTestId("color-tarjeta");
  await expect(rotulo).toContainText("Rojo");
});

// ─── Contracción sin residuos, tenant C en `mi_flota` [AC-FSEM-13] — spec 05 §2.7 ──────────
//
// El AC pide, con estas palabras, «e2e tenant C: 5 tarjetas, cero CLP de tarifas visible,
// semáforo operativo». Las 5 tarjetas ya las cubre AC-FSEM-01 arriba; lo que suma este test es
// la parte de la contracción: aunque la tarjeta Caja/custodia/liquidación sigue viva en
// `mi_flota` (custodia es operativa, no comercial — §2.7 «custodia sigue viva»), CERO cifra en
// CLP llega a la pantalla — ni de esa tarjeta ni de ninguna otra, porque el módulo entero no
// tiene una sola columna de dinero (grep-gate de AC-FSEM-09) — y el tablero renderiza operativo
// de punta a punta, no un estado de error o degradado.
test("seed C (mi_flota): cero CLP de tarifas visible y el tablero queda operativo [AC-FSEM-13]", async ({ page }) => {
  await page.goto("/hoy?seed=c");

  const tarjetas = page.getByTestId("tarjeta-hoy");
  await expect(tarjetas).toHaveCount(5);

  // La tarjeta del dominio contraíble por `liquidacion_por_cliente` sigue renderizando —la
  // contracción es de LA SEÑAL, no de la tarjeta entera (custodia sigue viva, §2.7)— pero
  // ningún signo de peso ni cifra CLP aparece en el texto visible de la página entera.
  const cajaCustodia = page.locator('[data-testid="tarjeta-hoy"][data-dominio="caja_custodia_liquidacion"]');
  await expect(cajaCustodia).toBeVisible();

  const textoDeLaPagina = await page.locator("body").innerText();
  expect(textoDeLaPagina, "ninguna cifra en CLP debe llegar a la pantalla del semáforo").not.toMatch(/\$\s?\d/);
  expect(textoDeLaPagina.toUpperCase()).not.toContain("CLP");

  // «Semáforo operativo»: sin banner de error ni estado degradado — el tablero real, no una
  // pantalla de falla disfrazada de vacío.
  await expect(page.getByTestId("error-hoy")).toHaveCount(0);
});
