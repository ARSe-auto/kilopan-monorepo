import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Proxy CI BLOQUEANTE de VoiceOver [AC-FMIG-20] — §5.7, §9.2.
//
// ─── LO QUE ESTE ARCHIVO MECANIZA, Y LO QUE NO ────────────────────────────────────
//
// §5.7 enumera «VoiceOver completa apertura/POD/recepción» DENTRO del gate axe+Lighthouse — no
// como checklist humana. El texto de este AC pide dos cosas medibles, y las dos corren juntas
// acá, flujo por flujo:
//
//   1. Reglas axe de NOMBRE ACCESIBLE y ROL CORRECTO sobre TODOS los controles interactivos de
//      cada pantalla que el flujo atraviesa (`auditarNombreYRol`, abajo).
//   2. Verificación automatizada de que el ORDEN DE FOCO completa el flujo por navegación
//      SECUENCIAL (`caminoPorFoco`, abajo): cada paso se busca EXCLUSIVAMENTE por su rol y su
//      nombre accesible —jamás por testid, que es como VoiceOver lo encuentra—, tiene que
//      aparecer en el árbol de accesibilidad EN O DESPUÉS del último control tocado —un lector
//      de pantalla que avanza en línea recta no llega hasta ahí sin retroceder— y tiene que
//      admitir foco REAL (`document.activeElement`) antes de tocarlo.
//
// La pasada de VoiceOver real —el aparato, encendido, con una persona— es AC-FMIG-12,
// complemento humano que jamás bloquea el loop (§9.2). Este archivo es la mitad que SÍ lo
// bloquea: un control sin nombre accesible, con el rol equivocado, o que rompe la secuencia
// (fuera de orden o inalcanzable por foco) pone el build en rojo.
//
// ─── POR QUÉ `.focus()` Y NO UN Tab DE TECLADO ────────────────────────────────────
//
// Mismo precedente que `pod-a11y-gate.spec.ts` (AC-FPOD-23) y `pod-voiceover-f4.spec.ts`
// (AC-FPOD-24): este proyecto corre sobre WebKit (`devices["iPhone 13"]`, terreno = teléfono) y
// WebKit headless reproduce el modo «Full Keyboard Access» APAGADO de Safari real, donde un Tab
// de teclado NO mueve el foco a `<button>` — solo a campos de texto. VoiceOver tampoco navega por
// Tab: desliza por el árbol de accesibilidad en su orden, que es EXACTAMENTE lo que
// `indiceDeFoco` mide sobre el DOM real en vez de simular una tecla que ni el propio motor
// respeta.
//
// ─── FIXTURES: LOS TRES FLUJOS DEL §5.7, CADA UNO CON SU PROPIA PERSONA ───────────
//
// Apertura y POD comparten el mismo chofer (dos pantallas del mismo rol, en el mismo dispositivo,
// una detrás de la otra); recepción es un `operador` aparte (§4.3: un dispositivo personal ACTIVO
// por operario impide compartir el mismo entre roles). RUTs 37 y 39: los dos libres de la lista
// congelada (§7.8) al momento de escribir esto — 38 y el resto hasta 36 ya los tomó otra suite,
// y agregar uno nuevo no hace falta habiendo dos disponibles.
// Base PROPIA (`hechos`): comparte tenant con las suites de POD/turnos a propósito (ver el
// comentario de `preparar-tenants.mjs` sobre esa base), y dispositivos/patentes/nombres son
// propios de este archivo para no chocar con ninguna.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = rutDeFixture(37);
const RUT_OPERADOR = rutDeFixture(39);
const RUT_PANADERIA = rutDeFixture(6);

const SECRETO_CHOFER = secretoNuevo();
const SECRETO_OPERADOR = secretoNuevo();

const PATENTE_APERTURA = "AVO0001";
const PATENTE_RECEPCION = "AVO0002";

let paradaEntregaId = "";
let paradaRecepcionId = "";
let empresaRecepcionId = "";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    // Borrado idempotente antes de sembrar: un reintento de este worker vuelve a correr este
    // `beforeAll` contra la MISMA base —no hay rollback entre intentos—, y el segundo insert de
    // la misma persona chocaba con `personas_tenant_id_rut_key` (mismo motivo documentado en
    // `panel-a11y-pwa-gate.spec.ts`, AC-FMIG-11).
    await c.sql(
      "delete from dispositivos where persona_id in (select id from personas where rut = any($1))",
      [[RUT_CHOFER, RUT_OPERADOR]],
    );
    await c.sql("delete from usuarios where persona_id in (select id from personas where rut = any($1))", [
      [RUT_CHOFER, RUT_OPERADOR],
    ]);
    await c.sql("delete from personas where rut = any($1)", [[RUT_CHOFER, RUT_OPERADOR]]);

    const [personaChofer] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien navega apertura y POD solo con el rol') returning id::text as id",
      [RUT_CHOFER],
    );
    const [usuarioChofer] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
      [personaChofer!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [personaChofer!.id, hashDeSecreto(SECRETO_CHOFER), usuarioChofer!.id],
    );
    await c.sql(
      `insert into vehiculos (patente, tipo, autonomia_nominal_km, soh_pct) values ($1, 'furgón', 300, 95)
         on conflict (tenant_id, patente) do update set tipo = excluded.tipo`,
      [PATENTE_APERTURA],
    );

    const [personaOperador] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien navega la recepción solo con el rol') returning id::text as id",
      [RUT_OPERADOR],
    );
    const [usuarioOperador] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'operador') returning id::text as id",
      [personaOperador!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [personaOperador!.id, hashDeSecreto(SECRETO_OPERADOR), usuarioOperador!.id],
    );

    // La parada de entrega del flujo POD — mismo fixture mínimo que `pod-a11y-gate.spec.ts`
    // (AC-FPOD-23): candado abierto, manifiesto ya confirmado, sin `vehiculos` ni `turnos` de
    // por medio porque esta pantalla no los lee.
    const [empresaEntrega] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del proxy VoiceOver')
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [RUT_PANADERIA],
    );
    const [origenEntrega] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Depósito del proxy VoiceOver — POD') returning id::text as id",
    );
    const [rutaEntrega] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, publicada_en, version) values ('Ruta del proxy VoiceOver — POD', now(), 1)
       returning id::text as id`,
    );
    const [cargaEntrega] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [rutaEntrega!.id, origenEntrega!.id],
    );
    const [destinoEntrega] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Sucursal del proxy VoiceOver — POD') returning id::text as id",
    );
    const [paradaEntrega] = await c.sql<{ id: string }>(
      `insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2)
       returning id::text as id`,
      [rutaEntrega!.id, destinoEntrega!.id],
    );
    paradaEntregaId = paradaEntrega!.id;
    const [encargoEntrega] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 5) returning id::text as id",
      [empresaEntrega!.id, destinoEntrega!.id],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 5)", [
      paradaEntrega!.id,
      encargoEntrega!.id,
    ]);
    await c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [cargaEntrega!.id, empresaEntrega!.id],
    );

    // La parada de carga del flujo de recepción — mismo patrón mínimo que `carga.spec.ts`
    // (AC-FRUT-07), una sola empresa: alcanza para recorrer el flujo entero por foco.
    const [vehiculoRecepcion] = await c.sql<{ id: string }>(
      `insert into vehiculos (patente, tipo) values ($1, 'furgón')
         on conflict (tenant_id, patente) do update set tipo = excluded.tipo
       returning id::text as id`,
      [PATENTE_RECEPCION],
    );
    const [empresaRecepcion] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del proxy VoiceOver')
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [RUT_PANADERIA],
    );
    empresaRecepcionId = empresaRecepcion!.id;
    const [destinoRecepcion] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Sucursal del proxy VoiceOver — andén') returning id::text as id",
    );
    const [rutaRecepcion] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, vehiculo_id, publicada_en, version)
       values ('Ruta del proxy VoiceOver — andén', $1, now(), 1) returning id::text as id`,
      [vehiculoRecepcion!.id],
    );
    const [paradaRecepcion] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [rutaRecepcion!.id, destinoRecepcion!.id],
    );
    paradaRecepcionId = paradaRecepcion!.id;
    const [encargoRecepcion] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 5) returning id::text as id",
      [empresaRecepcionId, destinoRecepcion!.id],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 5)", [
      paradaRecepcion!.id,
      encargoRecepcion!.id,
    ]);
  });
});

async function sesionDe(page: Page, secreto: string) {
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
}

// ─── (1) REGLAS AXE DE NOMBRE ACCESIBLE Y ROL CORRECTO ─────────────────────────────
//
// Filtradas a lo que el TEXTO del AC pide —nombre accesible y rol— y no al resto del gate AA
// (contraste, targets, PWA), que ya vive en AC-FPOD-23/AC-FMIG-11/AC-FMIG-19: sumarlas acá
// duplicaría el oráculo y, si algún día se movieran los umbrales de contraste, este AC se
// pondría rojo por algo que no le compete.
const REGLAS_NOMBRE_Y_ROL = [
  "button-name",
  "link-name",
  "input-button-name",
  "aria-command-name",
  "aria-input-field-name",
  "aria-toggle-field-name",
  "aria-tooltip-name",
  "select-name",
  "image-alt",
  "role-img-alt",
  "svg-img-alt",
  "aria-allowed-role",
  "aria-roles",
  "aria-valid-attr-value",
  "aria-valid-attr",
  "aria-required-attr",
];

async function auditarNombreYRol(page: Page, contexto: string) {
  const resultados = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const violaciones = resultados.violations.filter((v) => REGLAS_NOMBRE_Y_ROL.includes(v.id));
  expect(violaciones, `${contexto}:\n${JSON.stringify(violaciones, null, 2)}`).toHaveLength(0);

  const vacios = await page.locator('[aria-label=""]').count();
  expect(vacios, `${contexto}: hay al menos un aria-label vacío en el DOM`).toBe(0);
}

// ─── (2) ORDEN DE FOCO POR NAVEGACIÓN SECUENCIAL ───────────────────────────────────

/** El índice, en el árbol de accesibilidad VISIBLE, del control que Playwright ya resolvió como
 *  `objetivo`. `-1` si no está entre los controles interactivos visibles — el mismo resultado que
 *  vería VoiceOver deslizando y sin encontrar nada. Un solo viaje al navegador: compara identidad
 *  de nodo con `indexOf`, no una segunda ronda de locators. */
async function indiceDeFoco(page: Page, objetivo: Locator): Promise<number> {
  const elemento = await objetivo.elementHandle();
  if (!elemento) return -1;
  return page.evaluate((el) => {
    const selector = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="radio"]';
    const nodos = [...document.querySelectorAll(selector)].filter((n) => {
      const caja = (n as HTMLElement).getBoundingClientRect();
      const estilo = getComputedStyle(n as HTMLElement);
      return caja.width > 0 && caja.height > 0 && estilo.visibility !== "hidden" && estilo.display !== "none";
    });
    return nodos.indexOf(el as Element);
  }, elemento);
}

/** Recorre un flujo EXCLUSIVAMENTE por rol "button" + nombre accesible (jamás por testid — así
 *  es como VoiceOver encuentra un control), exigiendo en cada paso que el control esté (a)
 *  presente por su nombre accesible, (b) en o después del último tocado —el orden de foco no
 *  retrocede— y (c) realmente enfocable. Si cualquiera de los tres falla, el flujo quedó
 *  incompletable por foco — el caso de rebote EXACTO del texto del AC. */
function caminoPorFoco(page: Page) {
  let ultimoIndice = -1;
  return {
    async avanzar(nombre: string) {
      const objetivo = page.getByRole("button", { name: nombre, exact: true });
      await expect(
        objetivo,
        `"${nombre}" no aparece por su nombre accesible con rol "button" — VoiceOver tampoco lo encontraría`,
      ).toBeVisible();

      const indice = await indiceDeFoco(page, objetivo);
      expect(indice, `"${nombre}" no está entre los controles interactivos visibles`).toBeGreaterThanOrEqual(0);
      expect(
        indice,
        `"${nombre}" quedó ANTES del último control tocado (índice ${indice} < ${ultimoIndice}): un lector ` +
          `de pantalla que avanza en línea recta no llega hasta acá sin retroceder`,
      ).toBeGreaterThanOrEqual(ultimoIndice);
      ultimoIndice = indice;

      await objetivo.focus();
      const enfocado = await objetivo.evaluate((el) => el === document.activeElement);
      expect(
        enfocado,
        `"${nombre}" tiene rol y nombre correctos pero NO admite foco real: VoiceOver no puede pararse en él`,
      ).toBe(true);

      await objetivo.click();
    },
    reiniciar() {
      ultimoIndice = -1;
    },
  };
}

test.describe("[AC-FMIG-20] Proxy CI bloqueante de VoiceOver — apertura, POD, recepción", () => {
  test("apertura de turno: nombre/rol correctos y foco secuencial de punta a punta", async ({ page }) => {
    await sesionDe(page, SECRETO_CHOFER);
    const camino = caminoPorFoco(page);

    await page.goto(`${EN_A}/turno/abrir`);
    await expect(page.getByTestId("paso-vehiculo")).toBeVisible();
    await auditarNombreYRol(page, "apertura · paso-vehiculo");

    await camino.avanzar(PATENTE_APERTURA);
    await expect(page.getByTestId("paso-chequeo")).toBeVisible();
    // Cada `paso` de este wizard reemplaza la sección anterior ENTERA (render condicional, no
    // hay dos pasos montados a la vez): sin foco movido a mano por la app, es la misma pantalla
    // que un lector de pantalla ve al aterrizar en un ESTADO NUEVO, así que el orden de foco
    // vuelve a contarse desde el principio de ESE estado — jamás hacia atrás DENTRO de él, que
    // es justo lo que el AC pide.
    camino.reiniciar();
    await camino.avanzar("Está todo bien");

    await expect(page.getByTestId("paso-odometro")).toBeVisible();
    await auditarNombreYRol(page, "apertura · paso-odometro");
    camino.reiniciar();
    for (const digito of "45000") await camino.avanzar(digito);
    await camino.avanzar("Continuar");

    await expect(page.getByTestId("paso-carga")).toBeVisible();
    camino.reiniciar();
    for (const digito of "78") await camino.avanzar(digito);
    await camino.avanzar("Continuar");

    await expect(page.getByTestId("paso-semaforo")).toBeVisible();
    await expect(page.getByTestId("semaforo-texto")).toBeVisible();
    await auditarNombreYRol(page, "apertura · paso-semaforo");
    camino.reiniciar();
    await camino.avanzar("Abrir turno");

    await expect(page.getByTestId("turno-abierto")).toBeVisible({ timeout: 15_000 });
  });

  test("POD (entrega feliz): nombre/rol correctos y foco secuencial de punta a punta", async ({ page }) => {
    await sesionDe(page, SECRETO_CHOFER);
    const camino = caminoPorFoco(page);

    await page.goto(`${EN_A}/entrega?parada=${paradaEntregaId}`);
    await expect(page.getByTestId("candado-abierto")).toBeVisible();
    await auditarNombreYRol(page, "POD · candado-abierto");

    await camino.avanzar("Llegué");
    await expect(page.getByTestId("entrega-en-curso")).toBeVisible();
    await auditarNombreYRol(page, "POD · entrega-en-curso");
    // Mismo motivo que en la apertura: "entrega-en-curso" reemplaza a "candado-abierto" entera.
    camino.reiniciar();

    await camino.avanzar("Entregado");
    await expect(page.getByText("Entregado. Se guarda en unos segundos.")).toBeVisible();
  });

  test("recepción de carga: nombre/rol correctos y foco secuencial de punta a punta", async ({ page }) => {
    await sesionDe(page, SECRETO_OPERADOR);
    const camino = caminoPorFoco(page);

    await page.goto(`${EN_A}/carga`);
    await expect(page.getByTestId("recepcion-de-carga")).toBeVisible();
    await expect(page.getByTestId("paso-pin")).toBeVisible();
    await auditarNombreYRol(page, "recepción · paso-pin");

    for (const digito of "1234") await camino.avanzar(digito);
    await camino.avanzar("Continuar");

    await expect(page.getByTestId("paso-vehiculo")).toBeVisible();
    // Mismo motivo que en la apertura: "paso-vehiculo" reemplaza a "paso-pin" entera.
    camino.reiniciar();
    await camino.avanzar(PATENTE_RECEPCION);

    await expect(page.getByTestId("paso-conteo")).toBeVisible();
    await auditarNombreYRol(page, "recepción · paso-conteo");
    camino.reiniciar();
    await camino.avanzar("Conforme");

    await expect(page.getByTestId(`confirmado-${empresaRecepcionId}`)).toBeVisible({ timeout: 15_000 });
  });
});
