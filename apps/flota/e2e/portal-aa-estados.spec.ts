import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import {
  TERMINOLOGIA_PORTAL_BASE,
  TERMINOLOGIA_PORTAL_EXTREMA_TENANT_B,
} from "../src/dominio/portal-terminologia.ts";
import { origenDe } from "./puerto.ts";

// Gate GUI del portal por sub-checks [AC-FPOR-12] — spec 07 §5, §5.1/§5.7/§9.2 de
// `docs/PROMPT_MAESTRO_FLOTA.md`. Seis criterios, un AC:
//
//   (a) las 4 pantallas nacen con los 4 estados obligatorios.
//   (b) axe wcag2aa: cero color-contrast, cero aria-label vacíos — tema claro Y oscuro.
//   (c) formatos es-CL y cero strings visibles en inglés.
//   (d) tema local (claro/oscuro automático) — el theming COMPLETO del tenant (logo + acento
//       vía CSS custom properties del bootstrap) sigue siendo AC-FMIG-02 (módulo 08, no
//       construido — mismo alcance que ya documenta `hoy/tablero-de-hoy.tsx` para AC-FSEM-12).
//   (e) la e2e del portal corre DOS veces (terminología base y extrema) sin cambiar selector.
//   (f) snapshot 375px con términos al máximo largo, sin truncar.
//
// Empresa A (con datos): ejercita carga/éxito/terminología/AA sobre contenido real. Empresa B
// (sin datos, mismo tenant): ejercita el vacío accionable — mismo criterio de aislamiento que
// `portal-manifest-cliente.spec.ts` (AC-FPOR-07), reutilizado acá para que el vacío no dependa
// de vaciar la BD entre tests.

const SLUG = "portal_aa_estados";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_PERSONA_A = rutDeFixture(0);
const RUT_EMPRESA_A = rutDeFixture(1);
const RUT_PERSONA_B = rutDeFixture(2);
const RUT_EMPRESA_B = rutDeFixture(4);
const SECRETO_A = secretoNuevo();
const SECRETO_B = secretoNuevo();

let liquidacionId = "";
let encargoConEntregaId = "";

async function sellarPortalOn() {
  await con(BD, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      "e2e AC-FPOR-12 — portal_contratante=true",
      JSON.stringify({ portal_contratante: true }),
    ]),
  );
}

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    // ── Empresa A: destino, encargo solicitado, encargo aceptado CON entrega éxito + evidencia,
    //    liquidación cerrada con una línea (`devengar_entrega`) — todo lo que las pantallas
    //    necesitan para nacer en su estado de CONTENIDO, no en el vacío. ──
    const [empresaA] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Contratante del gate GUI SpA') returning id::text as id",
      [RUT_EMPRESA_A],
    );
    const empresaAId = empresaA!.id;
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local del gate GUI', 'Providencia') returning id::text as id",
    );
    await c.sql(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 3, 'solicitado')",
      [empresaAId, destino!.id],
    );

    const [ruta] = await c.sql<{ id: string }>("insert into rutas (nombre) values ('Ruta del gate GUI') returning id::text as id");
    const [parada] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [ruta!.id, destino!.id],
    );
    const [encargoConEntrega] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 5, 'aceptado') returning id::text as id",
      [empresaAId, destino!.id],
    );
    encargoConEntregaId = encargoConEntrega!.id;
    const [pod] = await c.sql<{ id: string }>(
      "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', now(), -240) returning id::text as id",
      [encargoConEntrega!.id, parada!.id],
    );
    await c.sql(
      "insert into evidence (tipo, objeto_tabla, objeto_id, capturada_en, tz_offset_min) values ('firma', 'paradas', $1, now(), -240)",
      [parada!.id],
    );

    const [liquidacion] = await c.sql<{ id: string }>(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, current_date - 6, current_date) returning id::text as id",
      [empresaAId],
    );
    liquidacionId = liquidacion!.id;
    await c.sql("select devengar_entrega($1, $2)", [pod!.id, liquidacionId]);
    await c.sql("update liquidaciones set estado = 'cerrada' where id = $1", [liquidacionId]);

    const [personaA] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Cliente A del gate GUI') returning id::text as id",
      [RUT_PERSONA_A],
    );
    const [usuarioA] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'cliente', $2) returning id::text as id",
      [personaA!.id, empresaAId],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [personaA!.id, hashDeSecreto(SECRETO_A), usuarioA!.id],
    );

    // ── Empresa B: CERO encargos, CERO liquidaciones — el vacío accionable de verdad, no un
    //    filtro que da 0 filas por casualidad. ──
    const [empresaB] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Contratante vacía del gate GUI SpA') returning id::text as id",
      [RUT_EMPRESA_B],
    );
    const [personaB] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Cliente B del gate GUI') returning id::text as id",
      [RUT_PERSONA_B],
    );
    const [usuarioB] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'cliente', $2) returning id::text as id",
      [personaB!.id, empresaB!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [personaB!.id, hashDeSecreto(SECRETO_B), usuarioB!.id],
    );
  });

  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'daas' where slug = $1", [SLUG]));
  await sellarPortalOn();
});

/** Misma mecánica que `portal-manifest-cliente.spec.ts`: la sesión es el aparato, sembrada en el
 *  MISMO IndexedDB que `cliente/aparato.ts` lee, antes de que la página navegada corra un script
 *  propio. */
function sesionDe(secreto: string) {
  return async (page: Page) => {
    await page.addInitScript((s) => {
      const guardar = () =>
        new Promise<void>((res) => {
          const r = indexedDB.open("flota-aparato", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("claves");
          r.onsuccess = () => {
            const tx = r.result.transaction("claves", "readwrite").objectStore("claves").put(s, "secreto-de-sesion");
            tx.onsuccess = () => res();
            tx.onerror = () => res();
          };
        });
      void guardar();
    }, secreto);
  };
}

const PANTALLAS = [
  { ruta: "/cliente", testid: "portal-hoy" },
  { ruta: "/cliente/encargos", testid: "portal-encargos" },
  { ruta: "/cliente/liquidaciones", testid: "portal-liquidaciones" },
  { ruta: "/cliente/nuevo", testid: "portal-nuevo" },
] as const;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (a) Los 4 estados obligatorios
// ─────────────────────────────────────────────────────────────────────────────────────────────

test.describe("[AC-FPOR-12] vacío accionable — empresa B, sin datos", () => {
  test.beforeEach(async ({ page }) => {
    await sesionDe(SECRETO_B)(page);
  });

  test("«Hoy»: CTA «Crear un encargo» visible y habilitado", async ({ page }) => {
    await page.goto(`${ORIGEN}/cliente`);
    await expect(page.getByTestId("resumen-hoy-item")).toHaveCount(0);
    const cta = page.getByTestId("cta-vacio-hoy");
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });

  test("«Encargos»: CTA «Crear un encargo» visible y habilitado", async ({ page }) => {
    await page.goto(`${ORIGEN}/cliente/encargos`);
    await expect(page.getByTestId("encargo-item")).toHaveCount(0);
    const cta = page.getByTestId("cta-vacio-encargos");
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });

  test("«Liquidación»: vacío informativo — nada que crear del lado del cliente", async ({ page }) => {
    await page.goto(`${ORIGEN}/cliente/liquidaciones`);
    await expect(page.getByTestId("liquidacion-item")).toHaveCount(0);
    await expect(page.getByText("Todavía no tenés liquidaciones")).toBeVisible();
  });
});

test.describe("[AC-FPOR-12] carga (skeleton) y error es-CL con recuperación — empresa A", () => {
  test.beforeEach(async ({ page }) => {
    await sesionDe(SECRETO_A)(page);
  });

  for (const [ruta, patronApi, testid] of [
    ["/cliente", "**/cliente/api/encargos", "portal-hoy"],
    ["/cliente/encargos", "**/cliente/api/encargos", "portal-encargos"],
    ["/cliente/liquidaciones", "**/cliente/api/liquidaciones", "portal-liquidaciones"],
  ] as const) {
    test(`${ruta}: skeleton durante la carga, error con «Reintentar» que recupera de verdad`, async ({ page }) => {
      let falla = false;
      await page.route(patronApi, async (route) => {
        if (falla) {
          falla = false;
          await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
        await route.continue();
      });

      await page.goto(`${ORIGEN}${ruta}`);
      await expect(page.getByRole("status", { name: "Cargando" }).first()).toBeVisible();
      await expect(page.getByRole("status", { name: "Cargando" })).toHaveCount(0, { timeout: 5_000 });

      // El locator se ancla a la pantalla (`getByTestId(testid)`) y no a `page` pelado: Next.js
      // App Router monta SIEMPRE un `role="alert"` propio (el "route announcer" de accesibilidad,
      // `__next-route-announcer__`), vacío y ajeno a `EstadoError`, dentro de un shadow root que
      // `document.querySelectorAll` no ve pero que SÍ cuenta para `getByRole` (que recorre el
      // árbol de accesibilidad real) — sin este scope, `toHaveCount(0)` nunca baja de 1 aunque
      // el error de la pantalla ya se resolvió.
      const pantalla = page.getByTestId(testid);
      falla = true;
      await page.reload();
      const error = pantalla.getByRole("alert").first();
      await expect(error).toBeVisible({ timeout: 5_000 });
      await error.locator("..").getByRole("button", { name: "Reintentar" }).click();
      await expect(pantalla.getByRole("alert")).toHaveCount(0, { timeout: 5_000 });
    });
  }
});

test.describe("[AC-FPOR-12] sin conexión — offline real, no un error de servidor", () => {
  test.beforeEach(async ({ page }) => {
    await sesionDe(SECRETO_A)(page);
  });

  const CASOS = [
    { ruta: "/cliente", testid: "hoy-sin-conexion" },
    { ruta: "/cliente/encargos", testid: "encargos-sin-conexion" },
    { ruta: "/cliente/liquidaciones", testid: "liquidaciones-sin-conexion" },
    { ruta: "/cliente/nuevo", testid: "nuevo-encargo-sin-conexion" },
  ] as const;

  for (const { ruta, testid } of CASOS) {
    test(`${ruta}: banner «${testid}» aparece offline y desaparece al volver la red`, async ({ page }) => {
      await page.goto(`${ORIGEN}${ruta}`);
      await expect(page.getByTestId(testid)).toHaveCount(0);
      await page.context().setOffline(true);
      await expect(page.getByTestId(testid)).toBeVisible({ timeout: 5_000 });
      await page.context().setOffline(false);
      await expect(page.getByTestId(testid)).toHaveCount(0, { timeout: 5_000 });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (b) axe wcag2aa — tema claro Y oscuro
// ─────────────────────────────────────────────────────────────────────────────────────────────

test.describe("[AC-FPOR-12] axe wcag2aa: cero color-contrast, cero aria-label vacíos", () => {
  test.beforeEach(async ({ page }) => {
    await sesionDe(SECRETO_A)(page);
  });

  for (const esquema of ["light", "dark"] as const) {
    for (const { ruta, testid } of PANTALLAS) {
      test(`tema ${esquema}: ${ruta}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: esquema });
        await page.goto(`${ORIGEN}${ruta}`);
        await expect(page.getByTestId(testid)).toBeVisible();
        const resultados = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
        const contraste = resultados.violations.filter((v) => v.id === "color-contrast");
        expect(contraste, JSON.stringify(contraste, null, 2)).toHaveLength(0);
        const vacios = await page.locator('[aria-label=""]').count();
        expect(vacios).toBe(0);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (c) es-CL — cero strings visibles en inglés
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Mismo criterio con límite de palabra que `TELEMETRIA_EV_PALABRA` de
// `portal-manifest-cliente.spec.ts`: sustrings sueltos («loading» dentro de una palabra
// española) darían falsos rojos, así que todo entra por `\b`.
const PALABRAS_INGLES = [/\bloading\b/i, /\berror\b/i, /\bretry\b/i, /\bsubmit\b/i, /\bcancel\b/i, /\bsave\b/i, /\bstatus\b/i, /\boffline\b/i, /\bempty\b/i];

test.describe("[AC-FPOR-12] es-CL: cero strings visibles en inglés", () => {
  test.beforeEach(async ({ page }) => {
    await sesionDe(SECRETO_A)(page);
  });

  for (const { ruta, testid } of PANTALLAS) {
    test(ruta, async ({ page }) => {
      await page.goto(`${ORIGEN}${ruta}`);
      await expect(page.getByTestId(testid)).toBeVisible();
      const texto = await page.locator("body").innerText();
      for (const patron of PALABRAS_INGLES) {
        expect(texto, `${patron} no debería aparecer en ${ruta}`).not.toMatch(patron);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (d) tema local claro/oscuro — el theming completo del tenant sigue siendo AC-FMIG-02
// ─────────────────────────────────────────────────────────────────────────────────────────────

test.describe("[AC-FPOR-12] dark mode automático de las 4 pantallas", () => {
  test.beforeEach(async ({ page }) => {
    await sesionDe(SECRETO_A)(page);
  });

  for (const { ruta, testid } of PANTALLAS) {
    test(`${ruta}: el fondo cambia con prefers-color-scheme, sin build ni deploy`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`${ORIGEN}${ruta}`);
      const main = page.getByTestId(testid);
      const fondoClaro = await main.evaluate((el) => getComputedStyle(el).backgroundColor);

      await page.emulateMedia({ colorScheme: "dark" });
      const fondoOscuro = await main.evaluate((el) => getComputedStyle(el).backgroundColor);

      expect(fondoOscuro, `${ruta} no cambió de fondo con el esquema oscuro`).not.toBe(fondoClaro);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (e) la e2e corre DOS veces (terminología base y extrema) sin cambiar un selector
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function ejercerPortal(page: Page, terminologia: "base" | "extremo") {
  const q = terminologia === "extremo" ? "?terminologia=extremo" : "";
  const esperado = terminologia === "extremo" ? TERMINOLOGIA_PORTAL_EXTREMA_TENANT_B : TERMINOLOGIA_PORTAL_BASE;

  await page.goto(`${ORIGEN}/cliente${q}`);
  const itemSolicitado = page.locator('[data-testid="resumen-hoy-item"][data-estado="solicitado"]');
  await expect(itemSolicitado).toBeVisible();
  await expect(itemSolicitado).toContainText(esperado.estadoEncargo.solicitado);

  await page.goto(`${ORIGEN}/cliente/encargos${q}`);
  const filaSolicitado = page.locator('[data-testid="encargo-item"][data-estado="solicitado"]');
  await expect(filaSolicitado).toContainText(esperado.estadoEncargo.solicitado);

  // El id viaja por `?id=` (mismo criterio que AC-FPOR-07): se navega DIRECTO con los dos
  // parámetros —id y terminologia— en vez de clickear el link de la lista, que no propaga
  // `?terminologia=` (el href de cada fila solo lleva `?id=`, por diseño de AC-FPOR-07/08).
  const qDetalle = terminologia === "extremo" ? "&terminologia=extremo" : "";
  await page.goto(`${ORIGEN}/cliente/encargos?id=${encargoConEntregaId}${qDetalle}`);
  await expect(page.getByTestId("encargo-resultado")).toContainText(esperado.resultadoEntrega.exito);

  await page.goto(`${ORIGEN}/cliente/liquidaciones${q}`);
  const filaLiquidacion = page.locator(`[data-testid="liquidacion-item"][data-id="${liquidacionId}"]`);
  await expect(filaLiquidacion).toContainText(esperado.estadoLiquidacion.cerrada);

  return esperado;
}

test.describe("[AC-FPOR-12] terminología BASE y EXTREMA — mismos selectores, texto distinto", () => {
  test.beforeEach(async ({ page }) => {
    await sesionDe(SECRETO_A)(page);
  });

  test("terminología BASE", async ({ page }) => {
    const esperado = await ejercerPortal(page, "base");
    expect(esperado.estadoEncargo.solicitado).toBe("Solicitado");
  });

  test("terminología EXTREMA (tenant B)", async ({ page }) => {
    const esperado = await ejercerPortal(page, "extremo");
    expect(esperado.estadoEncargo.solicitado).not.toBe("Solicitado");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (f) snapshot 375px con términos al máximo largo, sin truncar
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Sin truncar: ningún ancestro recorta el contenido con overflow:hidden — mismo criterio que
 *  `hoy-aa-estados.spec.ts`/`pod-a11y-gate.spec.ts`. */
async function noEstaRecortado(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => {
    let nodo: Element | null = el;
    while (nodo) {
      const s = getComputedStyle(nodo);
      const oculto = s.overflow === "hidden" || s.overflowX === "hidden";
      if (oculto && nodo.scrollWidth > nodo.clientWidth + 1) return false;
      nodo = nodo.parentElement;
    }
    return true;
  });
}

test.describe("[AC-FPOR-12] snapshot 375px con la terminología extrema del tenant B", () => {
  test.beforeEach(async ({ page }) => {
    await sesionDe(SECRETO_A)(page);
    await page.setViewportSize({ width: 375, height: 812 });
  });

  test("«Encargos»: el estado extremo se ve completo, sin recorte", async ({ page }) => {
    await page.goto(`${ORIGEN}/cliente/encargos?terminologia=extremo`);
    const fila = page.locator('[data-testid="encargo-item"][data-estado="solicitado"]');
    await expect(fila).toContainText(TERMINOLOGIA_PORTAL_EXTREMA_TENANT_B.estadoEncargo.solicitado);
    expect(await noEstaRecortado(fila)).toBe(true);
  });

  test("«Liquidación»: el estado extremo se ve completo, sin recorte", async ({ page }) => {
    await page.goto(`${ORIGEN}/cliente/liquidaciones?terminologia=extremo`);
    const fila = page.locator(`[data-testid="liquidacion-item"][data-id="${liquidacionId}"]`);
    await expect(fila).toContainText(TERMINOLOGIA_PORTAL_EXTREMA_TENANT_B.estadoLiquidacion.cerrada);
    expect(await noEstaRecortado(fila)).toBe(true);
  });
});
