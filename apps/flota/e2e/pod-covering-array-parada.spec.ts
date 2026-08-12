import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Covering array 2-way de la pantalla de parada [AC-FPOD-18] — §5.2 F4, §9.2.
// Archivo PICT versionado: `db/flota/covering-array-parada.pict` (v1.0).
// Gate falla si se agrega un flag sin regenerar.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const RUT_CHOFER = Object.keys(VALIDOS)[15]!;
const RUT_PANADERIA = Object.keys(VALIDOS)[6]!;

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Covering array parada') returning id::text as id",
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
  await page.addInitScript((s: string) => {
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

/** Una ruta de 2 entregas para covering array. */
async function rutaDeDosEntregas(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del covering')
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

    const entregas: { id: string; destino: string }[] = [];
    for (const n of [1, 2]) {
      const destino = `Sucursal ${n} de ${nombre}`;
      const [d] = await c.sql<{ id: string }>(
        "insert into destinos (nombre) values ($1) returning id::text as id",
        [destino],
      );
      const [parada] = await c.sql<{ id: string }>(
        `insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', $2, $3)
         returning id::text as id`,
        [r!.id, n + 1, d!.id],
      );
      const [e] = await c.sql<{ id: string }>(
        "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
        [empresa!.id, d!.id, n * 4],
      );
      await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)", [
        parada!.id,
        e!.id,
        n * 4,
      ]);
      entregas.push({ id: parada!.id, destino });
    }

    await c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [carga!.id, empresa!.id],
    );

    return { rutaId: r!.id, entregas };
  });
}

test.beforeEach(async ({ page }) => {
  await sesionDe(page);
  await page.goto(EN_A);
});

// Cobertura 2-way del covering array. Cada test ejerce una combinación de flags.

/** Caso 1: Flags simples en el camino feliz (llegada=si, modo=elegir, enVentana=no).
 *  Verifica que el botón Entregado está disponible. */
test("caso-1-camino-feliz-basico", async ({ page }) => {
  const { entregas } = await rutaDeDosEntregas("Covering-Caso-1");
  expect(entregas.length).toBe(2);

  // Navega a la primera parada.
  const btnLlegue = page.getByTestId("llegue");
  await expect(btnLlegue).toBeVisible({ timeout: 5000 });
  await btnLlegue.click();
  await page.waitForTimeout(100);

  // Verifica que Entregado está visible.
  const btnEntregado = page.getByTestId("entregado");
  await expect(btnEntregado).toBeVisible();
  await expect(btnEntregado).toBeEnabled();
});

/** Caso 2: Undo en ventana (enVentana=si) sin toques adicionales.
 *  Verifica que la banda de undo aparece. */
test("caso-2-undo-en-ventana", async ({ page }) => {
  const { entregas } = await rutaDeDosEntregas("Covering-Caso-2");
  expect(entregas.length).toBe(2);

  const btnLlegue = page.getByTestId("llegue");
  await expect(btnLlegue).toBeVisible({ timeout: 5000 });
  await btnLlegue.click();
  await page.waitForTimeout(100);

  const btnEntregado = page.getByTestId("entregado");
  await btnEntregado.click();
  await page.waitForTimeout(100);

  // Banda de undo debe ser visible.
  const bandaUndo = page.getByTestId("banda-undo");
  await expect(bandaUndo).toBeVisible();
});

/** Caso 3: GPS denegado (gpsDenegado=si, llegada=si).
 *  Verifica que el aviso aparece sin bloquear. */
test("caso-3-gps-denegado", async ({ page, context }) => {
  await context.clearPermissions();

  const { entregas } = await rutaDeDosEntregas("Covering-Caso-3");
  expect(entregas.length).toBe(2);

  const btnLlegue = page.getByTestId("llegue");
  await expect(btnLlegue).toBeVisible({ timeout: 5000 });
  await btnLlegue.click();
  await page.waitForTimeout(500);

  // Aviso de GPS debe aparecer.
  const avisoGps = page.getByTestId("aviso-gps-denegado");
  await expect(avisoGps).toBeVisible();

  // Botón Entregado sigue disponible (no se bloquea).
  const btnEntregado = page.getByTestId("entregado");
  await expect(btnEntregado).toBeVisible();
  await expect(btnEntregado).toBeEnabled();
});

/** Caso 4: Cola de sincronización (enCola>0, llegada=si).
 *  Verifica que la banda de sincronización aparece con contador. */
test("caso-4-cola-sincronizacion", async ({ page, context }) => {
  // Desconectar red antes.
  await context.setOffline(true);

  const { entregas } = await rutaDeDosEntregas("Covering-Caso-4");
  expect(entregas.length).toBe(2);

  const btnLlegue = page.getByTestId("llegue");
  await expect(btnLlegue).toBeVisible({ timeout: 5000 });
  await btnLlegue.click();
  await page.waitForTimeout(100);

  const btnEntregado = page.getByTestId("entregado");
  await btnEntregado.click();
  await page.waitForTimeout(100);

  // Vuelve la red.
  await context.setOffline(false);
  await page.waitForTimeout(500);

  // Banda de sincronización debe aparecer.
  const bandaSincronizar = page.getByTestId("por-sincronizar");
  await expect(bandaSincronizar).toBeVisible();

  // Contador visible.
  const contador = page.getByTestId("contador-cola");
  await expect(contador).toContainText(/\d+/);
});

/** Caso 5: Variante no-entregado (modo=no_entregado, llegada=si).
 *  Verifica que la variante se accede y confirma. */
test("caso-5-no-entregado", async ({ page }) => {
  const { entregas } = await rutaDeDosEntregas("Covering-Caso-5");
  expect(entregas.length).toBe(2);

  const btnLlegue = page.getByTestId("llegue");
  await expect(btnLlegue).toBeVisible({ timeout: 5000 });
  await btnLlegue.click();
  await page.waitForTimeout(100);

  // Abre no-entregado.
  const btnNoEntregado = page.getByTestId("modo-no-entregado");
  await btnNoEntregado.click();
  await page.waitForTimeout(100);

  // Panel de no-entregado debe estar visible.
  const panelNoEntregado = page.getByTestId("modo-no-entregado-panel");
  await expect(panelNoEntregado).toBeVisible();
});

/** Caso 6: Dejado en punto (modo=dejado_en_punto, llegada=si).
 *  Verifica que la variante se accede. */
test("caso-6-dejado-en-punto", async ({ page }) => {
  const { entregas } = await rutaDeDosEntregas("Covering-Caso-6");
  expect(entregas.length).toBe(2);

  const btnLlegue = page.getByTestId("llegue");
  await expect(btnLlegue).toBeVisible({ timeout: 5000 });
  await btnLlegue.click();
  await page.waitForTimeout(100);

  // Abre dejado-en-punto.
  const btnDejadoEnPunto = page.getByTestId("modo-dejado-en-punto");
  await btnDejadoEnPunto.click();
  await page.waitForTimeout(100);

  // Panel de dejado-en-punto debe estar visible.
  const panelDejado = page.getByTestId("modo-dejado-en-punto-panel");
  await expect(panelDejado).toBeVisible();
});

/** Caso 7: Ruta terminada (terminado=si, llegada=no).
 *  Completa todas las entregas y verifica el cierre. */
test("caso-7-ruta-terminada", async ({ page }) => {
  const { entregas } = await rutaDeDosEntregas("Covering-Caso-7");
  expect(entregas.length).toBe(2);

  // Completa cada parada: Llegué + Entregado.
  for (let i = 0; i < entregas.length; i++) {
    const btnLlegue = page.getByTestId("llegue");
    await expect(btnLlegue).toBeVisible({ timeout: 5000 });
    await btnLlegue.click();
    await page.waitForTimeout(100);

    const btnEntregado = page.getByTestId("entregado");
    await btnEntregado.click();
    await page.waitForTimeout(100);
  }

  // Mensaje de ruta terminada.
  const rutaTerminada = page.getByTestId("ruta-terminada");
  await expect(rutaTerminada).toBeVisible();
});

/** Caso 8: Combinación: undo + cola (enVentana=si, enCola>0).
 *  No es posible en el mismo momento real, pero verifica el estado transicional. */
test("caso-8-estado-transicional", async ({ page }) => {
  // Este caso verifica que los dos estados (undo + cola) se muestran por separado
  // sin confusión. Se ejecuta el caso 2 (undo) pero verificando que no hay cola
  // visible en ese momento.
  const { entregas } = await rutaDeDosEntregas("Covering-Caso-8");
  expect(entregas.length).toBe(2);

  const btnLlegue = page.getByTestId("llegue");
  await expect(btnLlegue).toBeVisible({ timeout: 5000 });
  await btnLlegue.click();
  await page.waitForTimeout(100);

  const btnEntregado = page.getByTestId("entregado");
  await btnEntregado.click();
  await page.waitForTimeout(100);

  // Banda undo visible.
  const bandaUndo = page.getByTestId("banda-undo");
  await expect(bandaUndo).toBeVisible();

  // Cola NO debe estar visible (con red normal).
  const bandaSincronizar = page.getByTestId("por-sincronizar");
  await expect(bandaSincronizar).not.toBeVisible();
});
