import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { CONTRASTE, TACTIL } from "../../../packages/nucleo-comun/src/constants.ts";
import { PUERTO_E2E } from "./puerto.ts";

// Gate AA de la pantalla de parada, medible en CI [AC-FPOD-23] — §5.7, §9.2.
//
// ─── LA SEGUNDA VEZ, CON EL FIXTURE DE UNA SUITE QUE YA CORRE EN VERDE ────────────
//
// Dos intentos anteriores de este AC murieron sin mirar un pixel: la semilla insertaba
// `vehiculos(empresa_id, modelos_json, soc_por_ciento, odometro_km)` cuando la tabla real
// tiene `(patente, tipo, capacidad_bultos, capacidad_kg, bateria_wh, ...)` — un esquema que
// esta pantalla ni siquiera necesita. La pantalla de parada NO lee `vehiculos` ni `turnos`
// (los lee la de apertura de turno); su fixture es EXACTAMENTE el de `pod-feliz.spec.ts`
// (AC-FPOD-01, verde), copiado y no reescrito de memoria.
//
// ─── QUÉ MIDE CADA UMBRAL, Y CONTRA QUÉ FUENTE ────────────────────────────────────
//
// Los tres contrastes (texto/UI/cifra) y los dos targets (operativo/tecla) salen de
// `CONTRASTE`/`TACTIL` en `packages/nucleo-comun/src/constants.ts` — la familia canónica
// del §0 — nunca escritos a mano acá: un cambio de umbral en la fuente mueve este gate solo.
// axe-core cubre el contraste de TEXTO (`color-contrast`, AA — `CONTRASTE.texto` para
// texto normal, `CONTRASTE.ui` para texto grande) y los aria-label vacíos; lo que axe NO
// cubre por defecto —contraste no-textual de UI (WCAG 1.4.11) y el umbral AAA propio que
// este módulo exige para la cifra operativa y los semáforos (R4, más estricto que el AAA
// de texto grande que usaría `wcag2aaa`)— se mide a mano contra el DOM real con la fórmula
// de luminancia relativa de WCAG.
//
// El foco visible SÍ entra acá (a diferencia de KiloPan AC-H0-14, que lo separó en un AC de
// sesión supervisada junto con el paseo completo de VoiceOver): el texto de este AC solo pide
// «foco» como ítem de checklist, no un recorrido de lector de pantalla —eso es AC-FPOD-24,
// aparte— así que un Tab real + inspección de `outline`/`box-shadow` computado alcanza para
// el criterio EXACTO que este AC declara.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const RUT_CHOFER = rutDeFixture(28);
const RUT_PANADERIA = rutDeFixture(6);

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien audita la pantalla') returning id::text as id",
      [RUT_CHOFER],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );
  });
});

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

/** Una parada de entrega con el manifiesto ya confirmado — mismo fixture que
 *  `pod-feliz.spec.ts` (AC-FPOD-01), sin `vehiculos` ni `turnos`: esta pantalla no los lee. */
async function unaParadaLista(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del gate AA')
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [RUT_PANADERIA],
    );
    const [origen] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ($1) returning id::text as id",
      [`Depósito de ${nombre}`],
    );
    const [r] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, publicada_en, version) values ($1, now(), 1) returning id::text as id`,
      [nombre],
    );
    const [carga] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, origen!.id],
    );
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ($1) returning id::text as id",
      [`Sucursal de ${nombre}`],
    );
    const [parada] = await c.sql<{ id: string }>(
      `insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2)
       returning id::text as id`,
      [r!.id, destino!.id],
    );
    const [encargo] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 6) returning id::text as id",
      [empresa!.id, destino!.id],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 6)", [
      parada!.id,
      encargo!.id,
    ]);
    await c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [carga!.id, empresa!.id],
    );

    return { paradaId: parada!.id };
  });
}

/** Luminancia relativa de WCAG 2.x (§1.4.3 Anexo), sobre un color `rgb(r, g, b)`. */
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

/** El color de fondo EFECTIVO de un elemento: sube por los ancestros hasta encontrar uno
 *  opaco — el mismo comportamiento que un ojo real ve, a diferencia de leer solo el
 *  `background-color` propio, casi siempre transparente en esta app (§0). */
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

test.describe("[AC-FPOD-23] Gate AA de la pantalla de parada", () => {
  test("contraste de TEXTO AA (CONTRASTE.texto) y cero aria-label vacíos (axe, candado abierto)", async ({ page }) => {
    const { paradaId } = await unaParadaLista("la ruta del candado abierto");
    await sesionDe(page);
    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
    await expect(page.getByTestId("candado-abierto")).toBeVisible();

    const resultados = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
    const contraste = resultados.violations.filter((v) => v.id === "color-contrast");
    expect(contraste, JSON.stringify(contraste, null, 2)).toHaveLength(0);

    const vacios = await page.locator('[aria-label=""]').count();
    expect(vacios, "hay al menos un aria-label vacío en el DOM").toBe(0);
  });

  test("contraste de TEXTO AA (CONTRASTE.texto) y cero aria-label vacíos (axe, entrega en curso)", async ({ page }) => {
    const { paradaId } = await unaParadaLista("la ruta de la entrega en curso");
    await sesionDe(page);
    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
    await page.getByTestId("llegue").click();
    await expect(page.getByTestId("entrega-en-curso")).toBeVisible();

    const resultados = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
    const contraste = resultados.violations.filter((v) => v.id === "color-contrast");
    expect(contraste, JSON.stringify(contraste, null, 2)).toHaveLength(0);

    const vacios = await page.locator('[aria-label=""]').count();
    expect(vacios, "hay al menos un aria-label vacío en el DOM").toBe(0);
  });

  test("contraste 7:1 en la cifra operativa (R4 · CONTRASTE.cifra_operativa_y_semaforos)", async ({ page }) => {
    const { paradaId } = await unaParadaLista("la ruta de la cifra operativa");
    await sesionDe(page);
    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);

    const cifra = page.getByTestId("contador-paradas").locator("span").first();
    await expect(cifra).toBeVisible();
    const [texto, fondo] = await Promise.all([colorDeTexto(cifra), fondoEfectivo(cifra)]);
    const razon = razonDeContraste(texto, fondo);
    expect(
      razon,
      `contraste de la cifra operativa ${razon.toFixed(2)}:1, bajo el mínimo ${CONTRASTE.cifra_operativa_y_semaforos}:1`,
    ).toBeGreaterThanOrEqual(CONTRASTE.cifra_operativa_y_semaforos);
  });

  test("contraste 3:1 en UI del botón primario (R4 · CONTRASTE.ui)", async ({ page }) => {
    const { paradaId } = await unaParadaLista("la ruta del botón primario");
    await sesionDe(page);
    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);

    const boton = page.getByTestId("llegue");
    await expect(boton).toBeVisible();
    const [fondoBoton, fondoPagina] = await Promise.all([
      boton.evaluate((el) => getComputedStyle(el).backgroundColor).then(aRgb),
      fondoEfectivo(page.locator("body")),
    ]);
    const razon = razonDeContraste(fondoBoton, fondoPagina);
    expect(
      razon,
      `contraste del botón primario contra la página ${razon.toFixed(2)}:1, bajo el mínimo ${CONTRASTE.ui}:1`,
    ).toBeGreaterThanOrEqual(CONTRASTE.ui);
  });

  test("targets operativos y teclas del teclado propio (TACTIL.operativo_min / TACTIL.tecla_min)", async ({ page }) => {
    const { paradaId } = await unaParadaLista("la ruta de los targets");
    await sesionDe(page);
    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
    await page.getByTestId("llegue").click();
    await expect(page.getByTestId("entrega-en-curso")).toBeVisible();

    const chicos: string[] = [];
    const controles = page.locator('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="radio"]');
    const total = await controles.count();
    expect(total, "no hay ningún elemento interactivo que medir").toBeGreaterThan(0);
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
    expect(chicos, `targets bajo ${TACTIL.operativo_min}px:\n${chicos.join("\n")}`).toEqual([]);

    const teclasChicas: string[] = [];
    const teclas = page.getByRole("group", { name: "Teclado numérico" }).locator("button");
    const totalTeclas = await teclas.count();
    expect(totalTeclas, "el teclado numérico propio no está a la vista").toBeGreaterThan(0);
    for (let i = 0; i < totalTeclas; i++) {
      const caja = await teclas.nth(i).boundingBox();
      if (!caja) continue;
      if (caja.width < TACTIL.tecla_min || caja.height < TACTIL.tecla_min) {
        teclasChicas.push(`tecla ${i} — ${Math.round(caja.width)}x${Math.round(caja.height)}px`);
      }
    }
    expect(teclasChicas, `teclas bajo ${TACTIL.tecla_min}px:\n${teclasChicas.join("\n")}`).toEqual([]);
  });

  test("foco visible: el control enfocado deja outline/box-shadow computado", async ({ page }) => {
    const { paradaId } = await unaParadaLista("la ruta del foco");
    await sesionDe(page);
    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
    const boton = page.getByTestId("llegue");
    await expect(boton).toBeVisible();

    // Este proyecto corre sobre WebKit (`devices["iPhone 13"]`, terreno = teléfono): WebKit
    // headless reproduce el modo «Full Keyboard Access» APAGADO de Safari real, donde un
    // Tab de teclado NO mueve el foco a `<button>`/`<a>` —solo a campos de texto—, así que
    // `page.keyboard.press("Tab")` deja el foco en `document.body` sin tocar ningún control
    // y el test mediría aire, no el indicador. `locator.focus()` mueve el foco al control
    // exacto que un chofer SÍ puede alcanzar con VoiceOver/Switch Control (que no pasan por
    // el modo de teclado de escritorio), y lo que se audita después —el outline/box-shadow
    // computado sobre ESE control enfocado— es el mismo indicador visual que el AC pide.
    await boton.focus();
    const indicador = await boton.evaluate((el) => {
      const s = getComputedStyle(el);
      const outlineVisible = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const sombraVisible = s.boxShadow !== "none" && s.boxShadow !== "";
      return { outlineVisible, sombraVisible };
    });
    expect(
      indicador.outlineVisible || indicador.sombraVisible,
      `el control «Llegué» enfocado no tiene indicador de foco visible (§5.7 «foco»)`,
    ).toBe(true);
  });

  test("texto 200% sin truncar: la cifra operativa sigue visible y crece con el zoom", async ({ page }) => {
    const { paradaId } = await unaParadaLista("la ruta del zoom 200%");
    await sesionDe(page);
    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);

    const cifra = page.getByTestId("contador-paradas");
    await expect(cifra).toBeVisible();
    const numero = cifra.locator("span").first();
    const cajaAntes = await cifra.boundingBox();

    // `zoom` escala el TEXTO (lo que WCAG 1.4.4 pide), a diferencia de encoger el viewport —
    // mismo mecanismo que `apps/kilopan/e2e/accessibility.spec.ts` (AC-H0-10). Bajo el
    // `devices["iPhone 13"]` de este proyecto (WebKit + viewport móvil, §5.7 «terreno = uno
    // solo») el `zoom` en `documentElement` también REFLUYE el layout: el ancho de la caja
    // puede encogerse porque el contenido reparte su espacio distinto en un viewport lógico
    // más angosto —a diferencia de Chromium de escritorio, donde solo agranda—, así que
    // comparar el ANCHO no es la señal correcta acá. El ALTO sí lo es: la cifra ocupa una
    // sola línea antes y después (nunca envuelve en dos), así que su alto es directamente
    // proporcional al tamaño visual del texto — si el zoom la agrandó de verdad, el alto
    // crece; si algo la truncara, seguiría en el mismo alto con menos contenido visible.
    await page.evaluate(() => {
      document.documentElement.style.zoom = "200%";
    });

    await expect(cifra).toBeVisible();
    const cajaDespues = await cifra.boundingBox();
    expect(cajaDespues, "la cifra operativa desapareció del DOM al hacer zoom 200%").not.toBeNull();
    expect(
      cajaDespues!.height,
      `la cifra operativa no creció en alto con el zoom 200% (${cajaAntes?.height}px → ${cajaDespues!.height}px)`,
    ).toBeGreaterThan((cajaAntes?.height ?? 0) * 1.5);

    // Sin truncar (§5.7): ningún ancestro le recorta el contenido con overflow:hidden — el
    // caso literal que describe el comentario gemelo de KiloPan (overflow:hidden +
    // white-space:nowrap).
    const recortada = await numero.evaluate((el) => {
      let nodo: Element | null = el;
      while (nodo) {
        const s = getComputedStyle(nodo);
        const oculta = s.overflow === "hidden" || s.overflowX === "hidden";
        if (oculta && nodo.scrollWidth > nodo.clientWidth + 1) return true;
        nodo = nodo.parentElement;
      }
      return false;
    });
    expect(recortada, "un ancestro con overflow:hidden está recortando la cifra al 200%").toBe(false);
  });
});
