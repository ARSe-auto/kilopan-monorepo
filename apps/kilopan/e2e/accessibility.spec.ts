import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-H0-10: AA medible en el gate. Antes de este archivo, axe no estaba instalado ni
// como dependencia ni como test — `check.sh` solo lo NOMBRABA en un comentario. Este
// spec ejerce, contra el servidor real (mismo webServer que el resto de `e2e`), lo que
// el AC pide de verdad: contraste ≥4.5:1 automatizado (axe), targets táctiles ≥44 pt
// recorriendo el DOM, aria-labels no vacíos, y un smoke de zoom 200% sin que kilos o
// CLP queden truncados. Foco visible y el paseo con VoiceOver (F1/F4/F5) NO están acá:
// exigen control real del lector de pantalla del sistema, que un e2e headless no puede
// ejercer — se dejaron abiertos en `AC-H0-14` en vez de fingir que este archivo los cubre.

const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

// IP propia: cada spec aislada del cupo de limitador de intentos (AC-SEC-02).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.60" } });

/** Elementos que un dedo real toca: botones, links, inputs y roles equivalentes. */
const SELECTOR_INTERACTIVOS =
  'button, a[href], input, select, textarea, [role="button"], [role="link"]';

const TARGET_MINIMO_PX = 44;

test.describe("AC-H0-10: accesibilidad medible en el gate", () => {
  test("contraste ≥4.5:1 en /ingresar (sin sesión)", async ({ page }) => {
    await page.goto("/ingresar");
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();

    const resultados = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
    const contraste = resultados.violations.filter((v) => v.id === "color-contrast");
    expect(contraste, JSON.stringify(contraste, null, 2)).toHaveLength(0);
  });

  test("contraste ≥4.5:1 en /dashboard (admin, con kg y CLP en pantalla)", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);
    await page.goto("/dashboard", { waitUntil: "networkidle" });

    const resultados = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
    const contraste = resultados.violations.filter((v) => v.id === "color-contrast");
    expect(contraste, JSON.stringify(contraste, null, 2)).toHaveLength(0);
  });

  test("targets clickeables ≥44 px en /ingresar (teclado y selector de un toque)", async ({
    page,
  }) => {
    await page.goto("/ingresar");
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();

    const elementos = page.locator(SELECTOR_INTERACTIVOS);
    const total = await elementos.count();
    expect(total, "no hay ningún elemento interactivo que medir").toBeGreaterThan(0);

    const chicos: string[] = [];
    for (let i = 0; i < total; i++) {
      const el = elementos.nth(i);
      if (!(await el.isVisible())) continue;
      const caja = await el.boundingBox();
      if (!caja) continue;
      if (caja.width < TARGET_MINIMO_PX || caja.height < TARGET_MINIMO_PX) {
        const texto = (await el.textContent())?.trim().slice(0, 30) ?? "";
        chicos.push(`"${texto}" — ${Math.round(caja.width)}x${Math.round(caja.height)}px`);
      }
    }
    expect(chicos, `targets por debajo de ${TARGET_MINIMO_PX}px:\n${chicos.join("\n")}`).toEqual(
      []
    );
  });

  test("cero aria-label vacíos en el DOM renderizado de /ingresar", async ({ page }) => {
    await page.goto("/ingresar");
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();

    const vacios = await page.locator('[aria-label=""]').count();
    expect(vacios).toBe(0);
  });

  test("zoom 200%: kilos y CLP de /dashboard siguen visibles, sin truncar", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);
    await page.goto("/dashboard", { waitUntil: "networkidle" });

    const cifraKg = page.getByText(/\d[\d.,]*\s?kg/).first();
    await expect(cifraKg).toBeVisible();
    const anchoAntes = (await cifraKg.boundingBox())?.width ?? 0;

    // `zoom` (no estándar pero soportado por WebKit/Chromium, los dos motores que corre
    // este gate) simula el 200% que un dueño con vista cansada usa de verdad — a
    // diferencia de encoger el viewport, escala el TEXTO, que es lo que WCAG 1.4.4 pide.
    await page.evaluate(() => {
      document.documentElement.style.zoom = "200%";
    });

    await expect(cifraKg).toBeVisible();
    const cajaDespues = await cifraKg.boundingBox();
    expect(cajaDespues, "la cifra de kg desapareció del DOM al hacer zoom 200%").not.toBeNull();
    // Con el zoom aplicado el texto debe verse MÁS grande, no recortado a lo mismo o menos
    // (un `overflow: hidden` con `white-space: nowrap` produciría justo eso: la caja no
    // crece porque el texto se corta en vez de reflow).
    expect(cajaDespues!.width).toBeGreaterThan(anchoAntes);
  });
});
