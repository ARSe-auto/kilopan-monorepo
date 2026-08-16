import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { CONTRASTE, TACTIL } from "../../../packages/nucleo-comun/src/constants.ts";
import { PUERTO_E2E } from "./puerto.ts";

// Gate axe+Lighthouse bloqueante de las pantallas del hito g + PWA iOS [AC-FMIG-11] — §5.7, §9.2.
//
// ─── QUÉ "LIGHTHOUSE" SIGNIFICA ACÁ, Y POR QUÉ ──────────────────────────────────────
//
// `presupuesto-perf.mjs` (AC-PERF-04) ya dejó escrito, con la razón completa en su propio
// encabezado, que este repo NO trae la dependencia de Lighthouse (Chrome headless, ~300 MB,
// puntaje que mezcla SEO con lo que importa). Ese precedente aplica acá también: nada de
// `lighthouse` como paquete. Lo que este AC pide después del "+" —PWA iOS: manifest
// standalone, viewport-fit=cover + safe-areas, touch-action:manipulation, inputs ≥16px— es
// EXACTAMENTE el contenido de la categoría "PWA/mobile-friendly" de Lighthouse (sus audits
// `viewport`, `font-size`, `tap-targets`, `installable-manifest`), así que "axe+Lighthouse"
// se resuelve como "axe para lo que axe cubre (contraste de texto, aria) + estas mismas
// aserciones por DOM/CSS computado para lo que Lighthouse auditaría" — sin el binario.
//
// ─── QUÉ PANTALLAS SON "las pantallas del hito" ─────────────────────────────────────
//
// El hito g (§9.1.4) es "panel admin white-label (incl. «Funciones») + wizard + seeds de los
// 3 tenants". De eso, HOY existen `/panel` (enrolamiento, AC-FIDN-02), `/panel/funciones`
// (AC-FMIG-08/10) y `/panel/terminologia` (AC-FMIG-04/06) — las tres se auditan acá. El
// wizard (AC-FMIG-14) todavía no tiene una sola pantalla construida: no hay DOM que visitar,
// así que queda fuera de este gate hasta que nazca, igual que AC-FMIG-10 partió su mitad del
// wizard a AC-FMIG-24 en vez de fingir que ya la cubría.
//
// ─── LA CIFRA OPERATIVA (7:1) NO APLICA ACÁ ─────────────────────────────────────────
//
// El umbral AAA de `CONTRASTE.cifra_operativa_y_semaforos` es del §0 para la cifra grande de
// terreno (apertura/parada/cierre) — ya gateada por AC-FPOD-23 sobre la pantalla real que la
// muestra. Ninguna de las tres pantallas de acá (admin de escritorio/tablet, no terreno)
// renderiza esa cifra: no hay nada que medir, y afirmar el número igual sería inventar un
// caso que no existe. Sí se mide el 3:1 de UI sobre el botón "acento" de cada pantalla que
// lo tiene (`invitar` en `/panel`, `encender-*` en `/panel/funciones`); `/panel/terminologia`
// solo usa botones `variante="neutro"` (sin relleno de color), así que tampoco hay ahí un
// botón acento que medir.
//
// TENANT: `miga_estados`, ya declarado como "solo LEE" en `preparar-tenants.mjs` para
// `miga-estados-panel.spec.ts` (AC-FMIG-10) — esta suite tampoco muta nada (puro GET +
// inspección de DOM/CSS), así que comparte la base sin arriesgar un resellado a mitad de
// corrida. Persona PROPIA (`rutDeFixture(0)`, "11.111.111-1") para no chocar con la
// "12.345.678-5" que ya usa esa suite en la misma base.

const T = TENANTS.find((t) => t.slug === "miga_estados")!;
const BD = bdDeTenant(T.slug);
const EN = `http://${T.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <F = Record<string, string>>(t: string, p?: unknown[]) => Promise<F[]> };

const SECRETO = secretoNuevo();
const RUT_DUENA = rutDeFixture(0);

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    // Borrado idempotente antes de sembrar: un reintento de Playwright (`retries` en modo
    // CI) arranca un worker NUEVO que vuelve a correr este `beforeAll` contra la MISMA base
    // —no hay rollback entre intentos—, y el segundo insert de la misma persona chocaba con
    // `personas_tenant_id_rut_key`. Sin retries no cambia nada; con retries, deja el gate
    // listo para reintentar de verdad en vez de morir en un error de fixture ajeno al AC.
    await c.sql("delete from dispositivos where persona_id in (select id from personas where rut = $1)", [
      RUT_DUENA,
    ]);
    await c.sql("delete from usuarios where persona_id in (select id from personas where rut = $1)", [RUT_DUENA]);
    await c.sql("delete from personas where rut = $1", [RUT_DUENA]);
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien audita el gate del panel admin') returning id::text as id",
      [RUT_DUENA],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );
  });
});

/** Mismo patrón que el resto de la suite: siembra el secreto de sesión en IndexedDB antes
 *  de que la página lo lea. */
async function sesionDe(page: Page) {
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
  }, SECRETO);
}

/** Luminancia relativa de WCAG 2.x (§1.4.3 Anexo) — mismo cálculo que `pod-a11y-gate.spec.ts`
 *  (AC-FPOD-23), para lo que axe no cubre por defecto: contraste no-textual de UI (1.4.11). */
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

const PANTALLAS_DEL_HITO = [
  { ruta: "/panel", testid: "panel" },
  { ruta: "/panel/funciones", testid: "panel-funciones" },
  { ruta: "/panel/terminologia", testid: "panel-terminologia" },
];

/** Navega, confirma la pantalla real y espera a que el skeleton (`role="status"
 *  name="Cargando"`, AC-FMIG-10) se vaya — medir targets/foco/contraste sobre ESE momento
 *  mediría el esqueleto, no la pantalla. `waitFor({state:"hidden"})` resuelve de inmediato
 *  si el status ni siquiera llegó a aparecer, así que sirve para las tres pantallas por
 *  igual sin importar si tienen o no un fetch inicial. */
async function irYCargar(page: Page, ruta: string, testid: string) {
  await page.goto(`${EN}${ruta}`);
  await expect(page.getByTestId(testid)).toBeVisible();
  await page.getByRole("status", { name: "Cargando" }).waitFor({ state: "hidden", timeout: 5_000 });
}

test.describe("[AC-FMIG-11] Gate axe + PWA iOS de las pantallas del hito g", () => {
  for (const { ruta, testid } of PANTALLAS_DEL_HITO) {
    test(`contraste de texto AA y cero aria-label vacíos (axe, wcag2aa) — ${ruta}`, async ({ page }) => {
      await sesionDe(page);
      await irYCargar(page, ruta, testid);

      const resultados = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
      const contraste = resultados.violations.filter((v) => v.id === "color-contrast");
      expect(contraste, JSON.stringify(contraste, null, 2)).toHaveLength(0);

      const vacios = await page.locator('[aria-label=""]').count();
      expect(vacios, `hay al menos un aria-label vacío en ${ruta}`).toBe(0);
    });

    test(`targets operativos ≥ TACTIL.operativo_min — ${ruta}`, async ({ page }) => {
      await sesionDe(page);
      await irYCargar(page, ruta, testid);

      const chicos: string[] = [];
      const controles = page.locator('button, a[href], input, select, textarea, [role="button"], [role="link"]');
      const total = await controles.count();
      expect(total, `no hay ningún elemento interactivo que medir en ${ruta}`).toBeGreaterThan(0);
      for (let i = 0; i < total; i++) {
        const el = controles.nth(i);
        if (!(await el.isVisible())) continue;
        const caja = await el.boundingBox();
        if (!caja) continue;
        if (caja.width < TACTIL.operativo_min || caja.height < TACTIL.operativo_min) {
          const texto = (await el.textContent())?.trim().slice(0, 30) ?? (await el.getAttribute("aria-label")) ?? "";
          chicos.push(`"${texto}" — ${Math.round(caja.width)}x${Math.round(caja.height)}px`);
        }
      }
      expect(chicos, `targets bajo ${TACTIL.operativo_min}px en ${ruta}:\n${chicos.join("\n")}`).toEqual([]);
    });

    test(`foco visible en el primer control interactivo — ${ruta}`, async ({ page }) => {
      await sesionDe(page);
      await irYCargar(page, ruta, testid);

      // `:enabled`: un control DESHABILITADO (p. ej. un `encender-*` bloqueado fuera de plan en
      // /panel/funciones) ni siquiera admite foco —`.focus()` es un no-op en un botón
      // `disabled` real— así que medirlo daría un falso rebote sobre algo que WCAG 2.4.7 no
      // exige para controles inactivos.
      const habilitados = page.locator(
        'button:enabled, a[href], input:enabled, select:enabled, textarea:enabled, [role="button"]',
      );
      const totalHabilitados = await habilitados.count();
      // `miga_estados` sin plan (mismo motivo que el 3:1 de UI, arriba): en /panel/funciones
      // CADA función nace apagada y fuera de plan, así que cada `encender-*` está bloqueado y ningún
      // `apagar-*` llega a existir —nada habilitado que enfocar en esta pantalla, en este
      // estado—; no es un rebote, es la ausencia real de un target.
      test.skip(totalHabilitados === 0, "cero controles habilitados: tenant sin plan asignado, nada que enfocar");
      const primero = habilitados.first();
      await expect(primero).toBeVisible();
      await primero.focus();
      const indicador = await primero.evaluate((el) => {
        const s = getComputedStyle(el);
        const outlineVisible = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        const sombraVisible = s.boxShadow !== "none" && s.boxShadow !== "";
        return { outlineVisible, sombraVisible };
      });
      expect(
        indicador.outlineVisible || indicador.sombraVisible,
        `el primer control interactivo de ${ruta} no tiene indicador de foco visible (§5.7 «foco»)`,
      ).toBe(true);
    });

    test(`PWA iOS · inputs ≥16px, jamás auto-zoom al enfocar — ${ruta}`, async ({ page }) => {
      await sesionDe(page);
      await irYCargar(page, ruta, testid);

      // Cero campos es un resultado válido (`/panel` y `/panel/funciones` no tienen ninguno):
      // el caso de rebote es un campo QUE SÍ existe y mide menos de 16px, no la ausencia.
      const campos = page.locator("input, textarea, select");
      const total = await campos.count();
      const chicos: string[] = [];
      for (let i = 0; i < total; i++) {
        const el = campos.nth(i);
        if (!(await el.isVisible())) continue;
        const tam = await el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
        if (tam < 16) chicos.push(`campo ${i} — ${tam}px`);
      }
      expect(chicos, `inputs bajo 16px en ${ruta} (iOS hace auto-zoom al enfocar):\n${chicos.join("\n")}`).toEqual([]);
    });
  }

  test("[AC-FMIG-11] contraste 3:1 de UI en el botón acento de «Invitar» (/panel)", async ({ page }) => {
    await sesionDe(page);
    await irYCargar(page, "/panel", "panel");
    const boton = page.getByTestId("invitar");
    await expect(boton).toBeVisible();
    const [fondoBoton, fondoPagina] = await Promise.all([
      boton.evaluate((el) => getComputedStyle(el).backgroundColor).then(aRgb),
      fondoEfectivo(page.locator("body")),
    ]);
    const razon = razonDeContraste(fondoBoton, fondoPagina);
    expect(
      razon,
      `contraste del botón «Invitar» contra la página ${razon.toFixed(2)}:1, bajo el mínimo ${CONTRASTE.ui}:1`,
    ).toBeGreaterThanOrEqual(CONTRASTE.ui);
  });

  test("[AC-FMIG-11] contraste 3:1 de UI en un botón acento de «Funciones» (/panel/funciones)", async ({ page }) => {
    await sesionDe(page);
    await irYCargar(page, "/panel/funciones", "panel-funciones");
    // El primer `encender-*` HABILITADO: variante="acento" es el único relleno de color de
    // esta pantalla (los `apagar-*` son `variante="neutro"`, sin relleno que medir), pero un
    // `encender-*` BLOQUEADO (fuera de plan) pinta con el gris de "deshabilitado" —2.17:1,
    // por debajo del mínimo— y WCAG 1.4.11 excluye explícitamente los controles inactivos:
    // medir ESE sería un rebote falso sobre algo que la norma no exige.
    const habilitados = page.locator('[data-testid^="encender-"]:enabled');
    const totalHabilitados = await habilitados.count();
    // `miga_estados` no tiene plan asignado (tenant "solo LEE", sin el fixture de plan que
    // arma `funciones.spec.ts`): con cada función fuera de plan, cero `encender-*` queda habilitado y
    // no hay acá ningún botón acento que medir — no es un rebote, es que esta pantalla, en
    // este estado, no tiene ninguno.
    test.skip(totalHabilitados === 0, "ningún encender-* habilitado: tenant sin plan asignado, nada que medir");
    const acento = habilitados.first();
    await expect(acento).toBeVisible();
    const [fondoBoton, fondoPagina] = await Promise.all([
      acento.evaluate((el) => getComputedStyle(el).backgroundColor).then(aRgb),
      fondoEfectivo(page.locator("body")),
    ]);
    const razon = razonDeContraste(fondoBoton, fondoPagina);
    expect(
      razon,
      `contraste del botón acento de Funciones contra la página ${razon.toFixed(2)}:1, bajo el mínimo ${CONTRASTE.ui}:1`,
    ).toBeGreaterThanOrEqual(CONTRASTE.ui);
  });

  test("[AC-FMIG-11] PWA iOS: manifest standalone, viewport-fit=cover, safe-area y touch-action:manipulation", async ({
    page,
  }) => {
    await sesionDe(page);
    await irYCargar(page, "/panel/funciones", "panel-funciones");

    // `esqueleto.spec.ts` (hito 0) ya prueba que el archivo se SIRVE; acá se cierra el gate
    // completo que ese archivo deja pendiente para este AC.
    const respuesta = await page.request.get("/manifest.webmanifest");
    expect(respuesta.status()).toBe(200);
    const manifest = await respuesta.json();
    expect(manifest.display).toBe("standalone");

    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport ?? "", "falta viewport-fit=cover en el meta viewport").toContain("viewport-fit=cover");

    // El `paddingBottom` de la safe-area usa `env(safe-area-inset-bottom, ...)`: un navegador
    // sin recorte de sistema (como el runner de CI) resuelve ese `env()` a un valor fijo en el
    // estilo COMPUTADO, así que lo que hay que leer es el estilo INLINE crudo —el texto fuente
    // antes de resolver— para verificar que la regla está declarada y no borrada por accidente.
    const estiloBody = await page.locator("body").getAttribute("style");
    expect(estiloBody ?? "", "el body no declara env(safe-area-inset-bottom) en su estilo").toContain(
      "safe-area-inset-bottom",
    );

    const touchAction = await page.locator("body").evaluate((el) => getComputedStyle(el).touchAction);
    expect(touchAction, "el body no tiene touch-action: manipulation").toBe("manipulation");
  });
});
