import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { UNDO } from "../../../packages/nucleo-comun/src/constants.ts";

// Telemetría `toques_flujo` como CONTRATO, el mecanismo GEMELO del e2e que cuenta eventos
// [AC-FRUT-19, AC-FPOD-14] — §5.3, §4.6, §10.
//
// ─── QUÉ PRUEBA ESTE ARCHIVO, Y QUÉ NO ─────────────────────────────────────────────
//
// Que los CINCO flujos del módulo (alta de encargo F1, publicar día F1, recepción/custodia F2,
// cierre de ruta F5, entrega de terreno F4) manden a `client_metric` una fila `toques_flujo` cuyo
// `valor_int` es EXACTAMENTE el número de toques que este mismo test contó — la cláusula literal
// del AC. No vuelve a probar la conducta de negocio de esos flujos (agrupación, DTE gate,
// ecuación de cierre, bucle de terreno): eso ya lo cubren AC-FRUT-01/05/07/11 y AC-FPOD-01, y
// este archivo solo mira si el toque QUEDÓ REGISTRADO donde el §10 lo va a leer.
//
// ─── EL ENDPOINT ES EL REAL, DESDE AC-FPOD-14 ─────────────────────────────────────
//
// `POST /api/sync/capturas` ya entiende `metricas[]` (AC-FPOD-14, `servidor/metricas-sync.ts`),
// igual que ya entendía `capturas`/`recargas` (AC-FPOD-03/13). Hasta este AC este archivo
// fixtureaba el aterrizaje con `page.route` —el aterrizaje genérico todavía no existía—; ahora
// el mismo POST que manda `cliente/toques-flujo.ts::completarFlujo` aterriza de verdad, y este
// test deja de fixturear nada: ejerce el servidor real, igual que `pod-feliz.spec.ts` ejerce el
// bucle de terreno contra el servidor real.
//
// ─── POR QUÉ CINCO VEHÍCULOS Y NO UNO ──────────────────────────────────────────────
//
// Publicar día, recepción de carga, cierre de ruta y entrega de terreno necesitan cada uno su
// propia ruta en un estado distinto (sin publicar / publicada con parada de carga / publicada y
// ya cuadrada / publicada con el sub-manifiesto de su parada de carga confirmado). Un solo
// vehículo forzaría a los flujos a compartir una ruta que ningún estado real tiene, y el fixture
// terminaría probando su propio andamiaje en vez del contrato del AC.

// El tenant de los HECHOS, como en carga.spec.ts y cierre-ruta.spec.ts: esta suite deja un
// manifiesto (append-only, §7.4) y no puede compartir el tenant por defecto sin romper la
// limpieza de las demás suites.
const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const EMPRESA = "Panadería de los toques";
const DESTINO = "Sucursal de los toques";
const PATENTE_PUBLICAR = "KLPQ19";
const PATENTE_CARGA = "KLPQ20";
const PATENTE_CIERRE = "KLPQ21";
const PATENTE_ENTREGA = "KLPQ22";

let empresaId = "";
let destinoId = "";
let rutaCierreId = "";
let paradaEntregaId = "";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien mide los toques') returning id::text as id",
      [rutDeFixture(42)],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'operador') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );

    const [emp] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, $2)
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [rutDeFixture(43), EMPRESA],
    );
    empresaId = emp!.id;
    const [d] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ($1) returning id::text as id",
      [DESTINO],
    );
    destinoId = d!.id;

    // El vehículo de «armar rutas»: SIN ruta todavía — la crea el flujo, en vivo.
    await c.sql(
      `insert into vehiculos (patente, tipo) values ($1, 'furgon')
         on conflict (tenant_id, patente) do update set tipo = excluded.tipo
       returning id::text as id`,
      [PATENTE_PUBLICAR],
    );
    // Un encargo de hoy, sin asignar: lo que «armar rutas» necesita en la bandeja.
    await c.sql("insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3)", [
      empresaId,
      destinoId,
      15,
    ]);

    // El vehículo de recepción de carga: ruta PUBLICADA con su parada de carga y lo declarado
    // por la empresa (mismo patrón que carga.spec.ts) — el conteo real de bultos en el andén
    // no es lo que este archivo prueba.
    const [vCarga] = await c.sql<{ id: string }>(
      `insert into vehiculos (patente, tipo) values ($1, 'furgon')
         on conflict (tenant_id, patente) do update set tipo = excluded.tipo
       returning id::text as id`,
      [PATENTE_CARGA],
    );
    const [rCarga] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, vehiculo_id, publicada_en, version)
       values ('Ruta de recepción', $1, now(), 1) returning id::text as id`,
      [vCarga!.id],
    );
    const [paradaCarga] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [rCarga!.id, destinoId],
    );
    const [encargoCarga] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
      [empresaId, destinoId, 10],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)", [
      paradaCarga!.id,
      encargoCarga!.id,
      10,
    ]);

    // El vehículo del cierre: ruta PUBLICADA, ya CUADRADA (cargado = entregado, sin devuelto ni
    // faltante) — así «Cerrar la ruta» está disponible desde el primer render y el único toque
    // de este flujo es el botón mismo, sin clasificación táctil de por medio.
    const [vCierre] = await c.sql<{ id: string }>(
      `insert into vehiculos (patente, tipo) values ($1, 'furgon')
         on conflict (tenant_id, patente) do update set tipo = excluded.tipo
       returning id::text as id`,
      [PATENTE_CIERRE],
    );
    const [rCierre] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, vehiculo_id, publicada_en, version)
       values ('Ruta del cierre', $1, now(), 1) returning id::text as id`,
      [vCierre!.id],
    );
    rutaCierreId = rCierre!.id;
    const [cargaCierre] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [rutaCierreId, destinoId],
    );
    const [entregaCierre] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2) returning id::text as id",
      [rutaCierreId, destinoId],
    );
    const [encargoCierre] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
      [empresaId, destinoId, 6],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)", [
      cargaCierre!.id,
      encargoCierre!.id,
      6,
    ]);
    // `qty_entregada` la escribe el módulo 04 al capturar el POD; para los ACs de este módulo
    // ese insumo se FIXTUREA en CI (misma nota que cierre-ruta.spec.ts).
    await c.sql(
      "insert into items (parada_id, encargo_id, qty_planificada, qty_entregada) values ($1, $2, $3, $3)",
      [entregaCierre!.id, encargoCierre!.id, 6],
    );
    const [manifiestoCierre] = await c.sql<{ id: string }>(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240) returning id::text as id`,
      [cargaCierre!.id, empresaId],
    );
    const [itemDeclarado] = await c.sql<{ id: string }>(
      "select id::text as id from items where parada_id = $1",
      [cargaCierre!.id],
    );
    await c.sql(
      `insert into manifiesto_items (manifiesto_id, item_id, qty_declarada, qty_confirmada)
       values ($1, $2, $3, $3)`,
      [manifiestoCierre!.id, itemDeclarado!.id, 6],
    );

    // El vehículo de la entrega de terreno [AC-FPOD-14]: ruta PUBLICADA con su sub-manifiesto YA
    // confirmado en el andén (el candado de F4 está abierto desde el primer render, mismo estado
    // previo que `pod-feliz.spec.ts::rutaDeTresEntregas` usa para el camino feliz).
    const [vEntrega] = await c.sql<{ id: string }>(
      `insert into vehiculos (patente, tipo) values ($1, 'furgon')
         on conflict (tenant_id, patente) do update set tipo = excluded.tipo
       returning id::text as id`,
      [PATENTE_ENTREGA],
    );
    const [rEntrega] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, vehiculo_id, publicada_en, version)
       values ('Ruta de los toques', $1, now(), 1) returning id::text as id`,
      [vEntrega!.id],
    );
    const [cargaEntrega] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [rEntrega!.id, destinoId],
    );
    const [paradaEntrega] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2) returning id::text as id",
      [rEntrega!.id, destinoId],
    );
    paradaEntregaId = paradaEntrega!.id;
    const [encargoEntrega] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
      [empresaId, destinoId, 8],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)", [
      paradaEntrega!.id,
      encargoEntrega!.id,
      8,
    ]);
    await c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [cargaEntrega!.id, empresaId],
    );
  });
});

async function sesionDe(page: Page, secreto: string) {
  await page.addInitScript((s) => {
    const guardar = () =>
      new Promise<void>((res) => {
        const p = indexedDB.open("flota-aparato", 1);
        p.onupgradeneeded = () => p.result.createObjectStore("claves");
        p.onsuccess = () => {
          const req = p.result.transaction("claves", "readwrite").objectStore("claves").put(s, "secreto-de-sesion");
          req.onsuccess = () => res();
          req.onerror = () => res();
        };
      });
    void guardar();
  }, secreto);
}

/** Cuenta ACCIONES con la convención cerrada del §5.3, una por FLUJO — la misma convención que
 *  ya defienden los e2e de presupuesto de AC-FRUT-01/05/07. */
function contadorPorFlujo(page: Page) {
  const conteos: Record<string, number> = {};
  return {
    de(flujo: string): number {
      return conteos[flujo] ?? 0;
    },
    async tocar(flujo: string, testid: string) {
      conteos[flujo] = (conteos[flujo] ?? 0) + 1;
      await page.getByTestId(testid).click();
    },
    async teclear(flujo: string, caracteres: string, dentroDe: string) {
      conteos[flujo] = (conteos[flujo] ?? 0) + 1;
      const alcance = page.getByTestId(dentroDe);
      for (const c of caracteres) await alcance.getByRole("button", { name: c, exact: true }).click();
    },
  };
}

/** La última fila `toques_flujo` de ese flujo — la que ESTE test acaba de producir. */
async function ultimoValorDe(flujo: string): Promise<number | null> {
  const filas = await con(BD_A, (c: Conexion) =>
    c.sql<{ valor_int: string }>(
      `select valor_int::text as valor_int from client_metric
        where tipo = 'toques_flujo' and flujo = $1
        order by record_time desc limit 1`,
      [flujo],
    ),
  );
  return filas[0] ? Number(filas[0].valor_int) : null;
}

/** Espera la respuesta fixtureada del endpoint de sync — solo resuelve DESPUÉS del INSERT. */
function esperarMetrica(page: Page) {
  return page.waitForResponse(
    (r) => r.url().endsWith("/api/sync/capturas") && r.status() === 200,
    { timeout: UNDO.ventana_ms + 10_000 },
  );
}

test("[AC-FRUT-19, AC-FPOD-14] los cinco flujos emiten `toques_flujo`, y el conteo coincide con el que este e2e contó", async ({
  page,
}) => {
  await sesionDe(page, SECRETO);
  const c = contadorPorFlujo(page);

  // ─── Fase 1 · alta de encargo (F1) [AC-FRUT-01] ──────────────────────────────
  await page.goto(`${EN_A}/bandeja`);
  await expect(page.getByTestId("bandeja")).toBeVisible();
  await c.tocar("alta_encargo", `empresa-${EMPRESA}`);
  await c.tocar("alta_encargo", `destino-${DESTINO}`);
  await c.teclear("alta_encargo", "12", "teclado-bultos");
  const metricaAlta = esperarMetrica(page);
  await c.tocar("alta_encargo", "guardar-encargo");
  await expect(page.getByTestId("rebote-encargo")).toHaveCount(0);
  await metricaAlta;

  expect(await ultimoValorDe("alta_encargo")).toBe(c.de("alta_encargo"));

  // ─── Fase 2 · armar y publicar el día (F1) [AC-FRUT-05] ──────────────────────
  await page.goto(`${EN_A}/rutas`);
  await expect(page.getByTestId("armar-rutas")).toBeVisible();
  await c.tocar("publicar_dia", (await primerEncargoTestId(page))!);
  await c.tocar("publicar_dia", `vehiculo-${PATENTE_PUBLICAR}`);
  await c.tocar("publicar_dia", "armar-ruta");
  await expect(page.getByTestId("ruta-armada")).toBeVisible();
  await c.tocar("publicar_dia", "ir-a-listos");

  await expect(page.getByTestId("listos-para-salir")).toBeVisible();
  await expect(page.getByTestId(`semaforo-${PATENTE_PUBLICAR}`)).toBeVisible();
  const metricaPublicar = esperarMetrica(page);
  await c.tocar("publicar_dia", `publicar-dia-${PATENTE_PUBLICAR}`);
  await expect(page.getByTestId(`publicacion-${PATENTE_PUBLICAR}`)).toContainText("Día publicado");
  await metricaPublicar;

  expect(await ultimoValorDe("publicar_dia")).toBe(c.de("publicar_dia"));

  // ─── Fase 3 · recepción de carga en el andén (F2) [AC-FRUT-07] ───────────────
  await page.goto(`${EN_A}/carga`);
  await expect(page.getByTestId("recepcion-de-carga")).toBeVisible();
  await c.teclear("recepcion_custodia", "1234", "teclado-pin");
  await c.tocar("recepcion_custodia", "continuar-pin");
  await c.tocar("recepcion_custodia", `vehiculo-${PATENTE_CARGA}`);
  await expect(page.getByTestId("paso-conteo")).toBeVisible();
  const metricaCarga = esperarMetrica(page);
  await c.tocar("recepcion_custodia", `conforme-${empresaId}`);
  await expect(page.getByTestId(`confirmado-${empresaId}`)).toBeVisible({ timeout: 15_000 });
  await metricaCarga;

  expect(await ultimoValorDe("recepcion_custodia")).toBe(c.de("recepcion_custodia"));

  // ─── Fase 4 · cierre de la ruta, ya cuadrada (F5) [AC-FRUT-11] ───────────────
  await page.goto(`${EN_A}/ruta/cerrar?ruta=${rutaCierreId}`);
  await expect(page.getByTestId("pantalla-cierre-ruta")).toBeVisible();
  await expect(page.getByTestId("descuadre")).toHaveCount(0);
  const metricaCierre = esperarMetrica(page);
  await c.tocar("cierre_ruta", "cerrar-ruta");
  await expect(page.getByTestId("ruta-cerrada")).toBeVisible();
  await metricaCierre;

  expect(await ultimoValorDe("cierre_ruta")).toBe(c.de("cierre_ruta"));

  // ─── Fase 5 · entrega en terreno, camino feliz (F4) [AC-FPOD-01, AC-FPOD-14] ─────
  await page.goto(`${EN_A}/entrega?parada=${paradaEntregaId}`);
  await expect(page.getByTestId("parada-actual")).toBeVisible();
  const metricaEntrega = esperarMetrica(page);
  await c.tocar("entrega_pod", "llegue");
  await c.tocar("entrega_pod", "entregado");
  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await metricaEntrega;

  expect(await ultimoValorDe("entrega_pod")).toBe(c.de("entrega_pod"));

  // Y el resumen: los cinco flujos, cada uno con un toque real medido y ninguno en cero — un
  // contador que no midió nada sería una fila vacía que el §10 no puede promediar.
  for (const flujo of [
    "alta_encargo",
    "publicar_dia",
    "recepcion_custodia",
    "cierre_ruta",
    "entrega_pod",
  ]) {
    expect(c.de(flujo), `el flujo ${flujo} no registró ningún toque`).toBeGreaterThan(0);
  }
});

/** El `data-testid` del primer `encargo-<id>` de «armar rutas» — dinámico, así que se lee del
 *  DOM en vez de adivinar el UUID que la BD le puso. */
async function primerEncargoTestId(page: Page): Promise<string | null> {
  const boton = page.locator('[data-testid^="encargo-"]').first();
  await expect(boton).toBeVisible();
  return boton.getAttribute("data-testid");
}
