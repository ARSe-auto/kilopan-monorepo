import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { CONTRASTE } from "../../../packages/nucleo-comun/src/constants.ts";
import { tarjetasNivelCero } from "../src/dominio/semaforo.ts";
import { seedA } from "../src/dominio/semaforo-fixtures.ts";

/** Mismo cuerpo que serviría `GET /api/semaforo/digest?seed=a` hoy (AC-FSEM-06: la ruta real
 *  sirve sobre estas mismas semillas) — lo usan las rutas mockeadas de abajo para responder
 *  «sin cambios de verdad» sin depender de un 304 (Playwright no deja `route.fulfill` con
 *  status 304: lo trata como redirección). */
const CUERPO_DIGEST_A = JSON.stringify({ tarjetas: tarjetasNivelCero(seedA()) });

// AA y estados de pantalla del Nivel 0 de «Hoy» [AC-FSEM-12] — spec 05 §5.7/§9.2, §5.1/§5.7 de
// `docs/PROMPT_MAESTRO_FLOTA.md`. Cinco criterios, un AC:
//
//   1. Ningún estado comunicado SOLO por color — verificable apagando el CSS de color.
//   2. Contraste ≥7:1 en indicadores semafóricos + cifra operativa, tema claro Y OSCURO.
//   3. Los 4 estados obligatorios de «Hoy»: vacío accionable, skeleton <50 ms, error con
//      recuperación, sin conexión con contador real.
//   4. Snapshot 375px con términos extremos del tenant B sin truncar cifras.
//   5. La misma e2e corre DOS VECES (terminología base y extrema) sin cambiar un selector.
//
// `/hoy` no exige sesión para renderizar (sirve sobre fixtures locales mientras el digest real
// no exista — AC-FSEM-01/06), así que estos tests no montan tenant ni BD, a diferencia de
// `pod-a11y-gate.spec.ts`/`pod-estados-obligatorios.spec.ts` (mismo patrón que ya usa
// `hoy-nivel-0.spec.ts`). El refresco de fondo (poll silencioso) sigue intentando `GET
// /api/semaforo/digest` sin sesión y fallando con 404 — igual que en TODA la suite de este
// módulo desde AC-FSEM-09 — sin que estos tests dependan de eso.

/** Luminancia relativa de WCAG 2.x (§1.4.3 Anexo) — copiado de `pod-a11y-gate.spec.ts`
 *  (AC-FPOD-23): no hay un módulo de utilidades de e2e compartido todavía y este AC no lo
 *  inventa, mismo criterio que ese archivo. */
function luminanciaRelativa([r, g, b]: [number, number, number]): number {
  const canal = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function razonDeContraste(a: [number, number, number], b: [number, number, number]): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  const [l1, l2] = la >= lb ? [la, lb] : [lb, la];
  return (l1 + 0.05) / (l2 + 0.05);
}

function aRgb(css: string): [number, number, number] {
  const m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!m) throw new Error(`color no reconocido: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** El fondo EFECTIVO de un elemento, subiendo por los ancestros hasta uno opaco. */
async function fondoEfectivo(loc: Locator): Promise<[number, number, number]> {
  return loc.evaluate((el) => {
    let nodo: Element | null = el;
    while (nodo) {
      const bg = getComputedStyle(nodo).backgroundColor;
      const m = bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (m && (m[4] === undefined || Number(m[4]) > 0)) {
        return [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
      }
      nodo = nodo.parentElement;
    }
    return [255, 255, 255];
  });
}

async function colorDeTexto(loc: Locator): Promise<[number, number, number]> {
  const css = await loc.evaluate((el) => getComputedStyle(el).color);
  return aRgb(css);
}

async function contrasteDe(loc: Locator): Promise<number> {
  const [texto, fondo] = await Promise.all([colorDeTexto(loc), fondoEfectivo(loc)]);
  return razonDeContraste(texto, fondo);
}

test.describe("[AC-FSEM-12] color nunca es la única señal", () => {
  test("apagando el CSS de color, la etiqueta de estado y el banner siguen legibles por TEXTO", async ({ page }) => {
    await page.goto("/hoy?seed=a");
    // Neutraliza toda pista de color (texto y fondo a blanco/negro plano, sin matiz) y oculta el
    // punto decorativo — lo que quedara SOLO por color desaparece; lo que queda por texto, no.
    await page.addStyleTag({
      content: `
        [data-testid="tarjeta-hoy"] * { color: #000 !important; background: #fff !important; filter: grayscale(100%) !important; }
        [data-testid="tarjeta-hoy"] span[aria-hidden] { visibility: hidden !important; }
      `,
    });

    const rojo = page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').getByTestId("color-tarjeta");
    await expect(rojo).toContainText("Rojo");
    const amarillo = page
      .locator('[data-testid="tarjeta-hoy"][data-dominio="turnos_conductores"]')
      .getByTestId("color-tarjeta");
    await expect(amarillo).toContainText("Amarillo");
    const verde = page.locator('[data-testid="tarjeta-hoy"][data-dominio="entregas_vs_plan"]').getByTestId("color-tarjeta");
    await expect(verde).toContainText("Verde");
  });
});

test.describe("[AC-FSEM-12] contraste 7:1 en indicadores semafóricos y cifra operativa — claro y oscuro", () => {
  for (const esquema of ["light", "dark"] as const) {
    test(`tema ${esquema}: la etiqueta de color y la cifra operativa cruzan CONTRASTE.cifra_operativa_y_semaforos`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: esquema });
      await page.goto("/hoy?seed=a");

      const rojo = page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').getByTestId("color-tarjeta");
      await expect(rojo).toBeVisible();
      const razonRojo = await contrasteDe(rojo);
      expect(
        razonRojo,
        `[${esquema}] indicador rojo ${razonRojo.toFixed(2)}:1, bajo ${CONTRASTE.cifra_operativa_y_semaforos}:1`,
      ).toBeGreaterThanOrEqual(CONTRASTE.cifra_operativa_y_semaforos);

      const amarillo = page
        .locator('[data-testid="tarjeta-hoy"][data-dominio="turnos_conductores"]')
        .getByTestId("color-tarjeta");
      const razonAmarillo = await contrasteDe(amarillo);
      expect(
        razonAmarillo,
        `[${esquema}] indicador amarillo ${razonAmarillo.toFixed(2)}:1, bajo ${CONTRASTE.cifra_operativa_y_semaforos}:1`,
      ).toBeGreaterThanOrEqual(CONTRASTE.cifra_operativa_y_semaforos);

      const verde = page.locator('[data-testid="tarjeta-hoy"][data-dominio="entregas_vs_plan"]').getByTestId("color-tarjeta");
      const razonVerde = await contrasteDe(verde);
      expect(
        razonVerde,
        `[${esquema}] indicador verde ${razonVerde.toFixed(2)}:1, bajo ${CONTRASTE.cifra_operativa_y_semaforos}:1`,
      ).toBeGreaterThanOrEqual(CONTRASTE.cifra_operativa_y_semaforos);

      const cifra = page
        .locator('[data-testid="tarjeta-hoy"][data-dominio="entregas_vs_plan"]')
        .getByTestId("agregado-verde")
        .locator("span")
        .first();
      const razonCifra = await contrasteDe(cifra);
      expect(
        razonCifra,
        `[${esquema}] cifra operativa ${razonCifra.toFixed(2)}:1, bajo ${CONTRASTE.cifra_operativa_y_semaforos}:1`,
      ).toBeGreaterThanOrEqual(CONTRASTE.cifra_operativa_y_semaforos);
    });

    test(`tema ${esquema}: axe wcag2aa no reporta color-contrast ni aria-label vacíos`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: esquema });
      await page.goto("/hoy?seed=a");
      const resultados = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
      const contraste = resultados.violations.filter((v) => v.id === "color-contrast");
      expect(contraste, JSON.stringify(contraste, null, 2)).toHaveLength(0);
      const vacios = await page.locator('[aria-label=""]').count();
      expect(vacios).toBe(0);
    });
  }
});

test.describe("[AC-FSEM-12] los 4 estados obligatorios de «Hoy»", () => {
  test("vacío accionable: cero dominios evaluados muestra CTA, no un hueco en blanco", async ({ page }) => {
    await page.goto("/hoy?seed=vacio");
    await expect(page.getByTestId("tarjeta-hoy")).toHaveCount(0);
    const cta = page.getByTestId("cta-vacio-hoy");
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });

  test("skeleton instantáneo en el refresco manual, y el aviso de demora recién pasados los 400 ms", async ({
    page,
  }) => {
    await page.goto("/hoy?seed=a");
    await expect(page.getByTestId("tablero-hoy")).toBeVisible();

    await page.route("**/api/semaforo/digest**", async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.fulfill({ status: 200, contentType: "application/json", body: CUERPO_DIGEST_A });
    });

    await page.getByTestId("refrescar-ahora").click();
    // El skeleton está desde el primer instante.
    await expect(page.getByTestId("cargando-hoy")).toBeVisible();
    await expect(page.getByTestId("aviso-demora-hoy")).toHaveCount(0);
    // Pasados los 400 ms sin resolver, la escalada aparece.
    await expect(page.getByTestId("aviso-demora-hoy")).toBeVisible({ timeout: 2_000 });
    // Y cuando el digest por fin responde, el tablero real reemplaza al skeleton entero.
    await expect(page.getByTestId("tablero-hoy")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("cargando-hoy")).toHaveCount(0);
  });

  test("error es-CL con recuperación: el servidor que responde mal lo dice, y «Reintentar» recupera de verdad", async ({
    page,
  }) => {
    await page.goto("/hoy?seed=a");
    await expect(page.getByTestId("tablero-hoy")).toBeVisible();

    let falla = true;
    await page.route("**/api/semaforo/digest**", async (route) => {
      if (falla) {
        falla = false;
        await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: CUERPO_DIGEST_A });
    });

    await page.getByTestId("refrescar-ahora").click();
    const error = page.getByTestId("error-hoy");
    await expect(error).toBeVisible();
    await expect(error.getByRole("alert")).toContainText("No se pudo actualizar");

    await error.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByTestId("error-hoy")).toHaveCount(0);
    await expect(page.getByTestId("tablero-hoy")).toBeVisible({ timeout: 5_000 });
  });

  test("sin conexión con contador real de cola — offline de verdad, no un error de servidor", async ({ page }) => {
    await page.goto("/hoy?seed=a");
    await page.context().setOffline(true);
    await page.getByTestId("refrescar-ahora").click();
    await expect(page.getByTestId("banner-sin-conexion")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("cola-offline")).toHaveText(/\d+/);
    await page.context().setOffline(false);
  });
});

test.describe("[AC-FSEM-12] snapshot 375px con la terminología extrema del tenant B", () => {
  test("a 375px, con los términos más largos permitidos, ninguna cifra queda truncada", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/hoy?seed=a&terminologia=extremo");

    // Los términos extremos SÍ se ven (confirma que el fixture entró).
    await expect(
      page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').getByTestId("color-tarjeta"),
    ).toContainText("Muy urgente!");

    const cifra = page
      .locator('[data-testid="tarjeta-hoy"][data-dominio="entregas_vs_plan"]')
      .getByTestId("agregado-verde")
      .locator("span")
      .first();
    await expect(cifra).toBeVisible();
    const cifraTexto = (await cifra.textContent())?.trim();
    expect(cifraTexto, "la cifra operativa desapareció de su propio texto").toBeTruthy();

    const contador = page
      .locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]')
      .getByTestId("contador-excepciones");
    await expect(contador).toBeVisible();

    // Sin truncar: ningún ancestro recorta el contenido con overflow:hidden (mismo criterio que
    // `pod-a11y-gate.spec.ts` para el zoom 200%).
    for (const num of [cifra, contador]) {
      const recortada = await num.evaluate((el) => {
        let nodo: Element | null = el;
        while (nodo) {
          const s = getComputedStyle(nodo);
          const oculto = s.overflow === "hidden" || s.overflowX === "hidden";
          if (oculto && nodo.scrollWidth > nodo.clientWidth + 1) return true;
          nodo = nodo.parentElement;
        }
        return false;
      });
      expect(recortada, "un ancestro con overflow:hidden está recortando una cifra a 375px").toBe(false);
    }
  });
});

test.describe("[AC-FSEM-12] la e2e del módulo corre DOS veces sin cambiar un selector", () => {
  /** Mismos `data-testid`, dos vocabularios: prueba en carne propia que el selector no depende
   *  del texto renombrable — la propiedad que este AC exige del lado de la pantalla mientras la
   *  capa de copy real (`term_key`, AC-FMIG-04) no exista. */
  async function ejercerTablero(page: Page, terminologia: "base" | "extremo") {
    const url = terminologia === "extremo" ? "/hoy?seed=a&terminologia=extremo" : "/hoy?seed=a";
    await page.goto(url);

    const tarjetas = page.getByTestId("tarjeta-hoy");
    await expect(tarjetas).toHaveCount(6);

    const rojo = page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]');
    await expect(rojo).toHaveAttribute("data-color", "rojo");
    await expect(rojo.getByTestId("contador-excepciones")).toHaveText("3");

    const verde = page.locator('[data-testid="tarjeta-hoy"][data-dominio="entregas_vs_plan"]');
    await expect(verde).toHaveAttribute("data-color", "verde");
    await expect(verde.getByTestId("agregado-verde")).toContainText("34/40");

    const etiquetaRojo = await rojo.getByTestId("color-tarjeta").textContent();
    return { etiquetaRojo: etiquetaRojo?.trim() ?? "" };
  }

  test("terminología BASE", async ({ page }) => {
    const { etiquetaRojo } = await ejercerTablero(page, "base");
    expect(etiquetaRojo).toContain("Rojo");
  });

  test("terminología EXTREMA (tenant B) — mismos selectores, texto distinto", async ({ page }) => {
    const { etiquetaRojo } = await ejercerTablero(page, "extremo");
    expect(etiquetaRojo).toContain("Muy urgente!");
    expect(etiquetaRojo).not.toContain("Rojo");
  });
});
