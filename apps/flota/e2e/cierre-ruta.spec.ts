import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// El cierre de la ruta y su ecuación de custodia por empresa (F5) [AC-FRUT-11]
// — §3.E1.6, §4.5, §5.2 F5, §4.2, §4.8.
//
// ─── LO QUE ESTE ARCHIVO PROTEGE ──────────────────────────────────────────────────
//
//   1. Que la ruta NO CIERRE DESCUADRADA en el cliente. Es la regla que se afloja sola: el día
//      que falten dos bultos y sean las nueve de la noche, «casi cuadra» es la tentación. El
//      botón no existe hasta que cuadre, y la pantalla dice cuánto falta y cuáles son las dos
//      salidas — no un botón gris ni solo color (§5.7).
//   2. Que la clasificación TÁCTIL asigne el descuadre a `devuelto` o a `faltante` con un toque,
//      y que eso quede escrito en la base como término de la ecuación (§5.2 F5).
//   3. Que un cierre descuadrado llegado POR SYNC entre igual: 2xx, fila, flag, evento y «Por
//      revisar» — jamás un rebote (§4.2). El día ya terminó; rechazar no lo deshace.
//   4. Que el flujo del chofer no contenga NI UN CLP (§4.8, §5.2 F5).

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const PATENTE = "KLPC11";

/** La ruta del caso feliz: cargó 10, entregó 7, faltan 3 por explicar. */
let rutaDescuadrada = "";
/** La ruta del caso (c): se cierra por la API, sin clasificar nada. */
let rutaPorSync = "";
/** La tercera es solo para MIRAR: las otras dos quedan cerradas y ya no muestran la ecuación. */
let rutaParaMirar = "";
/** Dedicada al cierre por sync de AC-FRUT-21: propia, para no cerrar una ruta que otro test
 *  todavía necesita ver DESCUADRADA o SIN cerrar. */
let rutaDevolucionSync = "";
let empresaId = "";
/** El catálogo de motivos del tenant [AC-FRUT-13], del que sale el de la devolución [AC-FRUT-21]. */
let motivoId = "";

/** Arma una ruta publicada con carga y entrega de UNA empresa, y su manifiesto ya confirmado. */
async function armarRuta(
  c: Conexion,
  datos: { vehiculo: string; destino: string; cargado: number; entregado: number },
): Promise<string> {
  const [r] = await c.sql<{ id: string }>(
    `insert into rutas (nombre, vehiculo_id, publicada_en, version)
     values ('Ruta de la madrugada', $1, now(), 1) returning id::text as id`,
    [datos.vehiculo],
  );
  const [carga] = await c.sql<{ id: string }>(
    "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
    [r!.id, datos.destino],
  );
  const [entrega] = await c.sql<{ id: string }>(
    "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2) returning id::text as id",
    [r!.id, datos.destino],
  );
  const [e] = await c.sql<{ id: string }>(
    "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
    [empresaId, datos.destino, datos.cargado],
  );
  const [item] = await c.sql<{ id: string }>(
    "insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3) returning id::text as id",
    [carga!.id, e!.id, datos.cargado],
  );
  // `qty_entregada` la escribe el módulo 04 al capturar el POD; para los ACs de este módulo la
  // spec 03 fija que ese insumo se FIXTUREA en CI, y esto es exactamente eso.
  await c.sql(
    "insert into items (parada_id, encargo_id, qty_planificada, qty_entregada) values ($1, $2, $3, $4)",
    [entrega!.id, e!.id, datos.cargado, datos.entregado],
  );
  const [m] = await c.sql<{ id: string }>(
    `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
     values ($1, $2, now(), -240) returning id::text as id`,
    [carga!.id, empresaId],
  );
  await c.sql(
    `insert into manifiesto_items (manifiesto_id, item_id, qty_declarada, qty_confirmada)
     values ($1, $2, $3, $3)`,
    [m!.id, item!.id, datos.cargado],
  );
  return r!.id;
}

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien maneja la ruta') returning id::text as id",
      [Object.keys(VALIDOS)[2]!],
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

    const [v] = await c.sql<{ id: string }>(
      `insert into vehiculos (patente, tipo) values ($1, 'furgon')
         on conflict (tenant_id, patente) do update set tipo = excluded.tipo
       returning id::text as id`,
      [PATENTE],
    );
    const [emp] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del barrio')
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [Object.keys(VALIDOS)[4]!],
    );
    empresaId = emp!.id;
    const [mot] = await c.sql<{ id: string }>(
      `insert into motivos (codigo, etiqueta, estado_asociado, orden)
       values ('devolucion_cierre', 'No quiso recibir', 'parada_fallida', 1)
       returning id::text as id`,
    );
    motivoId = mot!.id;
    const [d] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Sucursal del cierre') returning id::text as id",
    );

    rutaDescuadrada = await armarRuta(c, {
      vehiculo: v!.id,
      destino: d!.id,
      cargado: 10,
      entregado: 7,
    });
    rutaPorSync = await armarRuta(c, {
      vehiculo: v!.id,
      destino: d!.id,
      cargado: 6,
      entregado: 2,
    });
    rutaParaMirar = await armarRuta(c, {
      vehiculo: v!.id,
      destino: d!.id,
      cargado: 4,
      entregado: 4,
    });
    rutaDevolucionSync = await armarRuta(c, {
      vehiculo: v!.id,
      destino: d!.id,
      cargado: 5,
      entregado: 3,
    });
  });
});

async function sesionDe(page: Page) {
  await page.addInitScript((s) => {
    const guardar = () =>
      new Promise<void>((res) => {
        const p = indexedDB.open("flota-aparato", 1);
        p.onupgradeneeded = () => p.result.createObjectStore("claves");
        p.onsuccess = () => {
          const r = p.result
            .transaction("claves", "readwrite")
            .objectStore("claves")
            .put(s, "secreto-de-sesion");
          r.onsuccess = () => res();
          r.onerror = () => res();
        };
      });
    void guardar();
  }, SECRETO);
}

test("[AC-FRUT-11] la ruta no cierra descuadrada, y la clasificación táctil la cuadra", async ({
  page,
}) => {
  await sesionDe(page);
  await page.goto(`${EN_A}/ruta/cerrar?ruta=${rutaDescuadrada}`);
  await expect(page.getByTestId("pantalla-cierre-ruta")).toBeVisible();

  // La ecuación llega YA calculada (§5.2 F5): el chofer la mira, no la hace.
  await expect(page.getByTestId(`empresa-${empresaId}`)).toBeVisible();
  await expect(page.getByTestId("descuadre")).toBeVisible();
  // Y DICE qué falta, en texto: un botón gris sin explicación deja al chofer sin saber qué hacer.
  await expect(page.getByTestId("descuadre")).toContainText("3");

  // El botón NO EXISTE mientras no cuadre. Deshabilitado sería la misma prohibición dicha peor.
  await expect(page.getByTestId("cerrar-ruta")).toHaveCount(0);

  // UN toque: los tres bultos volvieron al depósito (§5.2 F5).
  await page.getByTestId(`devuelto-${empresaId}`).click();
  await expect(page.getByTestId("descuadre")).toHaveCount(0);

  // El botón NO EXISTE todavía: falta el motivo de la devolución [AC-FRUT-21] — un tercer toque,
  // del catálogo, jamás un campo de texto (§7.6).
  await expect(page.getByTestId("cerrar-ruta")).toHaveCount(0);
  await expect(page.getByTestId(`motivo-${empresaId}`)).toBeVisible();
  await page.getByRole("radio", { name: "No quiso recibir" }).click();

  await page.getByTestId("cerrar-ruta").click();
  await expect(page.getByTestId("ruta-cerrada")).toBeVisible();

  const filas = await con(BD_A, (c: Conexion) =>
    c.sql<{ devuelto: string; faltante: string }>(
      `select cre.devuelto::text as devuelto, cre.faltante::text as faltante
         from cierre_ruta_empresa cre
         join cierres_ruta c on c.id = cre.cierre_id
        where c.ruta_id = $1`,
      [rutaDescuadrada],
    ),
  );
  expect(filas.length).toBe(1);
  expect(Number(filas[0]!.devuelto)).toBe(3);
  expect(Number(filas[0]!.faltante)).toBe(0);

  // Y la ecuación de la base cuadra para esa empresa: `cargado = entregado + devuelto + faltante`.
  const ecuacion = await con(BD_A, (c: Conexion) =>
    c.sql<{ cargado: string; entregado: string; diferencia: string }>(
      "select cargado::text as cargado, entregado::text as entregado, diferencia::text as diferencia from ecuacion_de_cierre($1)",
      [rutaDescuadrada],
    ),
  );
  expect(Number(ecuacion[0]!.cargado)).toBe(10);
  expect(Number(ecuacion[0]!.entregado)).toBe(7);
  expect(Number(ecuacion[0]!.diferencia)).toBe(0);

  // [AC-FRUT-21] La clasificación táctil MATERIALIZÓ la devolución: empresa, bultos y motivo.
  // Fixture equivalente al «1 devolución» del seed A (§10, hito g, aún no construido).
  const devoluciones = await con(BD_A, (c: Conexion) =>
    c.sql<{ bultos: string; motivo_id: string; empresa_cliente_id: string }>(
      `select bultos::text as bultos, motivo_id::text as motivo_id,
              empresa_cliente_id::text as empresa_cliente_id
         from devoluciones d join cierres_ruta c on c.id = d.cierre_id
        where c.ruta_id = $1`,
      [rutaDescuadrada],
    ),
  );
  expect(devoluciones.length).toBe(1);
  expect(Number(devoluciones[0]!.bultos)).toBe(3);
  expect(devoluciones[0]!.motivo_id).toBe(motivoId);
  expect(devoluciones[0]!.empresa_cliente_id).toBe(empresaId);
});

test("[AC-FRUT-21] el motor de sync no rebota, y el replay deja exactamente 1 fila de devolución", async ({
  page,
}) => {
  await sesionDe(page);
  const comoElAparato = { Authorization: `Portador ${SECRETO}` };
  const clientUuid = crypto.randomUUID();
  const cuerpo = {
    empresas: [
      { empresa_cliente_id: empresaId, devuelto: 2, faltante: 0, motivo_id: motivoId },
    ],
    client_uuid: clientUuid,
    ts_dispositivo: new Date().toISOString(),
    tz_offset_min: -240,
  };

  const primera = await page.request.post(`${EN_A}/api/rutas/${rutaDevolucionSync}/cierre`, {
    headers: comoElAparato,
    data: cuerpo,
  });
  expect(primera.status()).toBe(201);

  // El replay del outbox: 2xx otra vez (§4.2), y NO una segunda fila (§9.3.1) — ni del cierre
  // ni de la devolución que colgó de él.
  const replay = await page.request.post(`${EN_A}/api/rutas/${rutaDevolucionSync}/cierre`, {
    headers: comoElAparato,
    data: { ...cuerpo, client_uuid: clientUuid },
  });
  expect(replay.ok()).toBe(true);

  const filas = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      `select count(*)::text as n
         from devoluciones d join cierres_ruta c on c.id = d.cierre_id
        where c.ruta_id = $1`,
      [rutaDevolucionSync],
    ),
  );
  expect(Number(filas[0]!.n)).toBe(1);
});

test("[AC-FRUT-11] el cierre descuadrado que llega por sync entra 2xx con flag, evento y cola", async ({
  page,
}) => {
  await sesionDe(page);
  await page.goto(`${EN_A}/ruta/cerrar?ruta=${rutaPorSync}`);
  await expect(page.getByTestId("pantalla-cierre-ruta")).toBeVisible();

  // La sesión de FLOTA no viaja en cookies: es el secreto del aparato guardado en IndexedDB, que
  // `pedir()` pone en `Authorization` (§4.3). Un request sin esa cabecera no tiene sesión y la
  // app contesta 404 —el mismo que da un id inexistente—, así que hay que mandarla a mano.
  const comoElAparato = { Authorization: `Portador ${SECRETO}` };
  const respuesta = await page.request.post(`${EN_A}/api/rutas/${rutaPorSync}/cierre`, {
    headers: comoElAparato,
    // Sin clasificar NADA: es el aparato que sincronizó saltándose el bloqueo del cliente.
    data: { empresas: [], client_uuid: crypto.randomUUID(), ts_dispositivo: new Date().toISOString() },
  });
  expect(respuesta.status()).toBe(201);
  const cuerpo = (await respuesta.json()) as { flags: string[]; renglones: { diferencia: number }[] };
  expect(cuerpo.flags).toContain("cierre_descuadrado");
  expect(cuerpo.renglones[0]!.diferencia).toBe(4);

  const [conteos] = await con(BD_A, (c: Conexion) =>
    c.sql<{ cierres: string; eventos: string; cola: string }>(
      `select (select count(*) from cierres_ruta where ruta_id = $1)::text as cierres,
              (select count(*) from eventos e
                 join evento_tipo t on t.id = e.tipo_id
                where t.codigo = 'cierre.descuadrado')::text as eventos,
              (select count(*) from review_queue where origen = 'cierre.cierre_descuadrado')::text as cola`,
      [rutaPorSync],
    ),
  );
  // La fila ENTRÓ —que es la regla de oro del §4.2— y quedó dicho que hay que mirarla.
  expect(Number(conteos!.cierres)).toBe(1);
  expect(Number(conteos!.eventos)).toBeGreaterThan(0);
  expect(Number(conteos!.cola)).toBeGreaterThan(0);

  // El replay del outbox: 2xx otra vez, y NO una segunda fila ni un segundo aviso (§9.3.1).
  const replay = await page.request.post(`${EN_A}/api/rutas/${rutaPorSync}/cierre`, {
    headers: comoElAparato,
    data: { empresas: [], client_uuid: crypto.randomUUID(), ts_dispositivo: new Date().toISOString() },
  });
  expect(replay.ok()).toBe(true);
  const [despues] = await con(BD_A, (c: Conexion) =>
    c.sql<{ cierres: string; cola: string }>(
      `select (select count(*) from cierres_ruta where ruta_id = $1)::text as cierres,
              (select count(*) from review_queue where origen = 'cierre.cierre_descuadrado')::text as cola`,
      [rutaPorSync],
    ),
  );
  expect(Number(despues!.cierres)).toBe(1);
  expect(Number(despues!.cola)).toBe(Number(conteos!.cola));
});

test("[AC-FRUT-11] el flujo del chofer no contiene ningún campo CLP", async ({ page }) => {
  await sesionDe(page);
  await page.goto(`${EN_A}/ruta/cerrar?ruta=${rutaParaMirar}`);
  // Se espera a que la ecuación esté PINTADA, no a que el cascarón exista: leer el texto mientras
  // todavía dice «Cargando…» daría verde sin haber mirado una sola cifra.
  await expect(page.getByTestId("terminos")).toBeVisible();

  // El §4.8 y el §5.2 F5: km, bultos y SOC — jamás dinero. Se mira el texto RENDERIZADO, que es
  // lo único que el chofer ve; un `grep` sobre el archivo no atraparía un peso que llegue por API.
  const texto = (await page.getByTestId("pantalla-cierre-ruta").innerText()).toLowerCase();
  for (const rastro of ["$", "clp", "precio", "tarifa", "monto", "pesos"]) {
    expect(texto).not.toContain(rastro);
  }
  await expect(page.getByTestId("pantalla-cierre-ruta")).toContainText("bultos");
});
