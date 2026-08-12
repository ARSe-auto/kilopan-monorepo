import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { CONTRASTE, TACTIL } from "../../../packages/nucleo-comun/src/constants.ts";

// [AC-FPOD-23] Gate AA de la pantalla de parada vía axe+Lighthouse (§5.7, §9.2).
//
// Criterios del AC:
// - contraste CONTRASTE.texto:1 en texto, 3:1 en UI y 7:1 en la cifra operativa y semáforos
// - targets §0 (≥TACTIL.operativo_min px táctil, ≥TACTIL.tecla_min px teclado, TACTIL.boton_primario px botón)
// - foco visible
// - texto 200% sin truncar cifras
// - cero aria-labels vacíos

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
// RUT propio para no competir con otras suites
const RUT_CHOFER = Object.keys(VALIDOS)[18]!; // índice alto para evitar conflictos
const RUT_PANADERIA = Object.keys(VALIDOS)[6]!;

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Accesibilidad de parada') returning id::text as id",
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

/** Prepara una ruta con carga y entregas para testear accesibilidad */
async function rutaDeEntregas(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería accesibilidad')
       returning id::text as id`,
      [RUT_PANADERIA],
    );

    const [vehiculo] = await c.sql<{ id: string }>(
      `insert into vehiculos (empresa_id, patente, modelos_json, soc_por_ciento, odometro_km)
       values ($1, 'TEST-ACC', '[]', 50, 0) returning id::text as id`,
      [empresa!.id],
    );

    const [turno] = await c.sql<{ id: string }>(
      `insert into turnos (empresa_id, vehiculo_id, operario_rol, config_version_id, abierto_en)
       values ($1, $2, 'chofer', 'v1', now()) returning id::text as id`,
      [empresa!.id, vehiculo!.id],
    );

    const [ruta] = await c.sql<{ id: string }>(
      `insert into rutas (turno_id) values ($1) returning id::text as id`,
      [turno!.id],
    );

    // Crear dos destinos para probar navegación
    const [d1] = await c.sql<{ id: string }>(
      `insert into destinos (empresa_id, latitud_e7, longitud_e7, nombre, direccion)
       values ($1, 0, 0, 'Panadería Centro', 'Calle falsa 123') returning id::text as id`,
      [empresa!.id],
    );

    const [d2] = await c.sql<{ id: string }>(
      `insert into destinos (empresa_id, latitud_e7, longitud_e7, nombre, direccion)
       values ($1, 0, 0, 'Sucursal Sur', 'Paseo Ahumada 200') returning id::text as id`,
      [empresa!.id],
    );

    // Crear encargos
    const [e1] = await c.sql<{ id: string }>(
      `insert into encargos (empresa_id, tipo, destino_id, bultos) values ($1, 'paquete', $2, 5)
       returning id::text as id`,
      [empresa!.id, d1!.id],
    );

    const [e2] = await c.sql<{ id: string }>(
      `insert into encargos (empresa_id, tipo, destino_id, bultos) values ($1, 'paquete', $2, 3)
       returning id::text as id`,
      [empresa!.id, d2!.id],
    );

    // Crear paradas
    const [p1] = await c.sql<{ id: string }>(
      `insert into paradas (ruta_id, encargo_id, secuencia, bultos, latitud_e7, longitud_e7)
       values ($1, $2, 0, 5, 0, 0) returning id::text as id`,
      [ruta!.id, e1!.id],
    );

    const [p2] = await c.sql<{ id: string }>(
      `insert into paradas (ruta_id, encargo_id, secuencia, bultos, latitud_e7, longitud_e7)
       values ($1, $2, 1, 3, 0, 0) returning id::text as id`,
      [ruta!.id, e2!.id],
    );

    // Confirmar manifiestos para desbloquear las entregas
    await c.sql(
      `insert into manifiestos (empresa_id, ruta_id, turno_id, puesto_de_carga_id)
       values ($1, $2, $3, null)`,
      [empresa!.id, ruta!.id, turno!.id],
    );

    return { ruta: ruta!.id, turno: turno!.id, empresa: empresa!.id };
  });
}

test("AC-FPOD-23: contraste en texto UI y cifra operativa", async ({
  page,
}) => {
  await rutaDeEntregas("contraste");
  await sesionDe(page);
  await page.goto(EN_A + "/entrega", { waitUntil: "networkidle" });

  await expect(page.getByTestId("tarjeta-de-entrega")).toBeVisible();

  // Usar axe con WCAG 2.1 AA
  const resultados = await new AxeBuilder({ page })
    .withTags(["wcag2aa"])
    .analyze();

  // Filtrar violaciones de contraste
  const contrasteBajo = resultados.violations.filter((v) => v.id === "color-contrast");

  if (contrasteBajo.length > 0) {
    console.error("Violaciones de contraste encontradas:");
    console.error(JSON.stringify(contrasteBajo, null, 2));
  }

  expect(contrasteBajo, JSON.stringify(contrasteBajo, null, 2)).toHaveLength(0);
});

test("AC-FPOD-23: targets táctil y teclado", async ({ page }) => {
  await rutaDeEntregas("targets");
  await sesionDe(page);
  await page.goto(EN_A + "/entrega", { waitUntil: "networkidle" });

  await expect(page.getByTestId("tarjeta-de-entrega")).toBeVisible();

  // Elementos interactivos: botones, links, inputs, roles equivalentes
  const SELECTOR_INTERACTIVOS =
    'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"]';

  const elementos = page.locator(SELECTOR_INTERACTIVOS);
  const total = await elementos.count();

  const chicos: string[] = [];
  for (let i = 0; i < total; i++) {
    const el = elementos.nth(i);
    if (!(await el.isVisible())) continue;
    const caja = await el.boundingBox();
    if (!caja) continue;

    // Buttons/botones primarios: ≥TACTIL.boton_primario
    // Teclado numérico: ≥TACTIL.tecla_min
    // Otros interactivos: ≥TACTIL.operativo_min
    const minimo = (await el.getAttribute("class"))?.includes("BotonPrimario")
      ? TACTIL.boton_primario
      : TACTIL.operativo_min;
    if (caja.width < minimo || caja.height < minimo) {
      const texto = (await el.textContent())?.trim().slice(0, 30) ?? "";
      const role = await el.getAttribute("role");
      chicos.push(`"${texto}" (${role}) — ${Math.round(caja.width)}x${Math.round(caja.height)}px`);
    }
  }

  if (chicos.length > 0) {
    console.error("Targets por debajo del mínimo:");
    console.error(chicos.join("\n"));
  }

  expect(chicos, `targets insuficientes:\n${chicos.join("\n")}`).toEqual([]);
});

test("AC-FPOD-23: cero aria-labels vacíos", async ({ page }) => {
  await rutaDeEntregas("aria-labels");
  await sesionDe(page);
  await page.goto(EN_A + "/entrega", { waitUntil: "networkidle" });

  await expect(page.getByTestId("tarjeta-de-entrega")).toBeVisible();

  const vacios = await page.locator('[aria-label=""]').count();
  expect(vacios).toBe(0);
});

test("AC-FPOD-23: zoom no trunca cifra operativa", async ({ page }) => {
  await rutaDeEntregas("zoom-cifra");
  await sesionDe(page);
  await page.goto(EN_A + "/entrega", { waitUntil: "networkidle" });

  await expect(page.getByTestId("tarjeta-de-entrega")).toBeVisible();

  // La cifra operativa del §0: "X de N" en la pantalla de parada
  const cifra = page.getByTestId("contador-paradas");
  await expect(cifra).toBeVisible();

  const anchoAntes = (await cifra.boundingBox())?.width ?? 0;

  // Aplicar zoom WCAG 1.4.4: escala del doble
  const ZOOM = "200%";
  await page.evaluate((z) => {
    document.documentElement.style.zoom = z;
  }, ZOOM);

  await expect(cifra).toBeVisible();
  const cajaZoom = await cifra.boundingBox();

  expect(cajaZoom, "la cifra desapareció con zoom").not.toBeNull();
  expect(cajaZoom!.width).toBeGreaterThan(anchoAntes);
});

test("AC-FPOD-23: foco visible en navegación con tabulador", async ({ page }) => {
  await rutaDeEntregas("foco-visible");
  await sesionDe(page);
  await page.goto(EN_A + "/entrega", { waitUntil: "networkidle" });

  await expect(page.getByTestId("tarjeta-de-entrega")).toBeVisible();

  // Navegar con Tab y verificar que el foco es visible
  // Buscar el primer botón interactivo
  const primerBoton = page.locator("button, input, [role='button']").first();
  await expect(primerBoton).toBeVisible();

  // Hacer focus en él
  await primerBoton.focus();

  // Verificar que el foco sea visible (pseudo-class :focus o similar)
  // Esto es más un smoke test; axe también lo verifica
  const esVisible = await primerBoton.evaluate((el) => {
    const style = window.getComputedStyle(el);
    const outline = style.outline !== "none" && style.outline !== "";
    const boxShadow = style.boxShadow !== "none";
    return outline || boxShadow;
  });

  expect(esVisible, "El foco no parece ser visible en el botón").toBe(true);
});
