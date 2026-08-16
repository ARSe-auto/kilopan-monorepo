import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { MODULOS_PORTAL_CLIENTE } from "../src/dominio/manifest-cliente.ts";
import { origenDe } from "./puerto.ts";

// El manifest del portal del contratante, de punta a punta [AC-FPOR-07] — spec 07 §2.
//
// A DIFERENCIA de `portal-aislamiento.spec.ts` (AC-FPOR-06, HTTP crudo con `playwrightRequest`
// contra las 4 lecturas por id), esta suite navega con `page.goto()` REAL: la sesión vive en el
// IndexedDB del navegador —mismo mecanismo que `pod-feliz.spec.ts`— así que ejerce el shell
// completo (`layout.tsx`, las 4 pantallas «use client», `pedir()`) tal como lo vería el
// contratante, no solo el contrato de servidor.
//
// El AC pide DOS cosas del texto: (1) el manifest = EXACTAMENTE las 4 pantallas del §3.E1.10, y
// (2) recorrerlas TODAS sin encontrar rutas completas, datos de otra empresa, telemetría EV ni
// módulos del operador. Lo segundo se prueba sembrando una SEGUNDA empresa contratante del
// MISMO tenant (misma mecánica que AC-FPOR-06) y contando: si el portal de X mostrara algo de Y,
// los conteos de acá arriba no cerrarían.

const SLUG = "portal_manifest";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUTS = Object.keys(VALIDOS);
const RUT_PERSONA = RUTS[16]!;
const RUT_EMPRESA_PROPIA = RUTS[17]!;
const RUT_EMPRESA_VECINA = RUTS[18]!;
const RAZON_SOCIAL_VECINA = "Contratante Vecina del Manifest SpA";
const SECRETO = secretoNuevo();

async function sellarPortalOn() {
  await con(BD, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      "e2e AC-FPOR-07 — portal_contratante=true",
      JSON.stringify({ portal_contratante: true }),
    ]),
  );
}

async function empresaConDestino(sql: Conexion["sql"], rut: string, razonSocial: string) {
  const [empresa] = await sql<{ id: string }>(
    "insert into empresas_cliente (rut, razon_social) values ($1, $2) returning id::text as id",
    [rut, razonSocial],
  );
  const [destino] = await sql<{ id: string }>(
    "insert into destinos (nombre, comuna) values ($1, 'Providencia') returning id::text as id",
    [`Local de ${razonSocial}`],
  );
  return { empresaId: empresa!.id, destinoId: destino!.id };
}

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    const propia = await empresaConDestino(c.sql, RUT_EMPRESA_PROPIA, "Farmacia del portal (seed A)");
    const vecina = await empresaConDestino(c.sql, RUT_EMPRESA_VECINA, RAZON_SOCIAL_VECINA);

    // Dos encargos PROPIOS —uno solicitado, uno aceptado, los dos de HOY por el default de
    // `fecha_servicio`— y UNO de la vecina: si «Encargos» contara 3, el filtro por empresa no
    // estaría aplicándose desde el navegador.
    await c.sql(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 3, 'solicitado')",
      [propia.empresaId, propia.destinoId],
    );
    await c.sql(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 5, 'aceptado')",
      [propia.empresaId, propia.destinoId],
    );
    await c.sql(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 9, 'solicitado')",
      [vecina.empresaId, vecina.destinoId],
    );

    // Una liquidación propia, una de la vecina: mismo criterio de conteo para «Liquidación».
    await c.sql(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, current_date - 6, current_date)",
      [propia.empresaId],
    );
    await c.sql(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, current_date - 6, current_date)",
      [vecina.empresaId],
    );

    const [persona] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Cliente del manifest') returning id::text as id",
      [RUT_PERSONA],
    );
    const [usuario] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'cliente', $2) returning id::text as id",
      [persona!.id, propia.empresaId],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [persona!.id, hashDeSecreto(SECRETO), usuario!.id],
    );
  });

  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'daas' where slug = $1", [SLUG]));
  await sellarPortalOn();
});

/** La sesión ES el aparato (§4.3): se guarda el secreto en el MISMO IndexedDB que
 *  `cliente/aparato.ts` lee, ANTES de que la página navegada corra un solo script propio —
 *  idéntico mecanismo a `pod-feliz.spec.ts`. */
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

test.beforeEach(async ({ page }) => {
  await sesionDe(page);
});

test("[AC-FPOR-07] la nav del portal expone EXACTAMENTE las 4 pantallas del §3.E1.10", async ({ page }) => {
  await page.goto(`${ORIGEN}/cliente`);
  await expect(page.getByTestId("manifest-cliente")).toBeVisible();
  await expect(page.getByTestId("modulo-nav-cliente")).toHaveCount(4);
  for (const modulo of MODULOS_PORTAL_CLIENTE) {
    await expect(
      page.locator(`[data-testid="modulo-nav-cliente"][data-modulo="${modulo.clave}"]`),
      `falta «${modulo.titulo}» en la nav del portal`,
    ).toHaveCount(1);
  }
});

// Telemetría EV y economía interna del operador que el §3.E1.10 dice que el cliente JAMÁS ve
// (§3.E1.12). Con límite de palabra: «soc»/«soh» de sobra calzarían como substring de una
// palabra española cualquiera («asociada», «resolución») y darían un falso rojo.
const TELEMETRIA_EV_SUBSTRING = ["batería", "autonomía", "odómetro", "ahorro", "diésel", "kwh", "wh/km"];
const TELEMETRIA_EV_PALABRA = [/\bsoc\b/i, /\bsoh\b/i];

for (const modulo of MODULOS_PORTAL_CLIENTE) {
  test(`[AC-FPOR-07] «${modulo.titulo}» (${modulo.ruta}): cero módulos del operador, cero telemetría EV`, async ({
    page,
  }) => {
    await page.goto(`${ORIGEN}${modulo.ruta}`);
    await expect(page.getByTestId("manifest-cliente")).toBeVisible();

    // El nav del OPERADOR (`dominio/manifest.ts`, AC-FPOR-03) usa testids sin el sufijo
    // `-cliente` — si aparecieran acá, el portal estaría sirviendo el panel de la casa.
    await expect(page.locator('[data-testid="modulo-nav"]')).toHaveCount(0);
    await expect(page.getByTestId("manifest-modulos")).toHaveCount(0);
    // La tarjeta del semáforo del operador (`hoy/page.tsx`, AC-FSEM-01) tampoco tiene nada que
    // hacer bajo `/cliente/*` — el portal no muestra el semáforo, es del operador (§3.E1.10).
    await expect(page.locator('[data-testid="tarjeta-hoy"]')).toHaveCount(0);

    const texto = (await page.locator("body").innerText()).toLowerCase();
    for (const prohibido of TELEMETRIA_EV_SUBSTRING) {
      expect(texto, `«${prohibido}» no debería aparecer en ${modulo.ruta}`).not.toContain(prohibido);
    }
    for (const patron of TELEMETRIA_EV_PALABRA) {
      expect(texto, `${patron} no debería aparecer en ${modulo.ruta}`).not.toMatch(patron);
    }
  });
}

test("[AC-FPOR-07] «Encargos» cuenta SOLO los 2 propios — el de la empresa vecina del mismo tenant no entra", async ({
  page,
}) => {
  await page.goto(`${ORIGEN}/cliente/encargos`);
  await expect(page.getByTestId("encargo-item")).toHaveCount(2);
});

test("[AC-FPOR-07] «Liquidación» cuenta SOLO la propia — la de la empresa vecina del mismo tenant no entra", async ({
  page,
}) => {
  await page.goto(`${ORIGEN}/cliente/liquidaciones`);
  await expect(page.getByTestId("liquidacion-item")).toHaveCount(1);
});

test("[AC-FPOR-07] «Hoy» resume los encargos propios de hoy (2, por el default de fecha_servicio) — nada de la vecina", async ({
  page,
}) => {
  await page.goto(`${ORIGEN}/cliente`);
  await expect(page.getByTestId("resumen-hoy-item")).toHaveCount(2); // solicitado + aceptado
  const total = await page.getByTestId("resumen-hoy-cantidad").allInnerTexts();
  expect(total.reduce((acc, n) => acc + Number(n), 0)).toBe(2);
});
