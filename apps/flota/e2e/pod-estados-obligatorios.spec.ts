import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { UNDO } from "../../../packages/nucleo-comun/src/constants.ts";
import { PUERTO_E2E } from "./puerto.ts";

// Los 4 estados obligatorios de la pantalla de parada (§5.7) [AC-FPOD-22]: vacío accionable ·
// skeleton <50 ms y spinner solo >400 ms · error es-CL con recuperación (las capturas JAMÁS
// muestran rechazo) · sin conexión con contador real de cola.
//
// ─── EL «SIN CONEXIÓN» YA EXISTÍA, LOS OTROS TRES NO ──────────────────────────────
//
// `por-sincronizar` con su contador real es AC-FPOD-03; acá se ejerce de nuevo, minimalista,
// porque el AC pide que LOS CUATRO se prueben desde el mismo lugar. Los otros tres eran huecos
// reales del componente: nada mostraba «esta ruta no tiene más paradas» como algo ACCIONABLE
// (era un párrafo suelto), nada distinguía «cargando» de «se cayó», y —el más serio— la promesa
// de `identidadDelAparato()` no tenía `.catch()`: un IndexedDB bloqueado dejaba al chofer mirando
// una pantalla sin «Llegué» para siempre, sin ningún aviso.
//
// ─── CÓMO SE FUERZA UN APARATO QUE TARDA O QUE FALLA ──────────────────────────────
//
// Ni la demora ni el fallo de IndexedDB se pueden pedir desde un test contra un navegador real:
// se sustituye `indexedDB.open` (mismo patrón que `fingirNavegador` de `entorno.spec.ts`) y se
// verifica la conducta de NUESTRO código ante cada respuesta — la demora reenvía el request real
// después de un `setTimeout`, el fallo dispara `onerror` una vez y de ahí en más deja pasar el
// request real, que es lo que hace que «Reintentar» recupere de verdad.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
/** Chofer PROPIO de esta suite: el §4.3 admite un dispositivo personal activo por operario. */
const RUT_CHOFER = rutDeFixture(27);
const RUT_PANADERIA = rutDeFixture(6);

test.beforeAll(async () => {
  // Idempotente a propósito: un retry de Playwright corre este beforeAll en un worker NUEVO
  // (con OTRO secretoNuevo()), y la segunda pasada chocaba con personas(tenant_id, rut) y con
  // el índice parcial del único dispositivo personal activo. El upsert deja vigente el
  // secreto_hash de ESTE worker, que es el que sesionDe() siembra.
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      `insert into personas (rut, nombre) values ($1, 'Quien prueba los 4 estados')
       on conflict (tenant_id, rut) do update set nombre = excluded.nombre
       returning id::text as id`,
      [RUT_CHOFER],
    );
    const [u] = await c.sql<{ id: string }>(
      `insert into usuarios (persona_id, rol)
       select $1::uuid, 'chofer'
       where not exists (select 1 from usuarios where persona_id = $1 and rol = 'chofer')
       returning id::text as id`,
      [p!.id],
    );
    const enroladoPor =
      u?.id ??
      (await c.sql<{ id: string }>(
        "select id::text as id from usuarios where persona_id = $1 and rol = 'chofer' limit 1",
        [p!.id],
      ))[0]!.id;
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)
       on conflict (tenant_id, persona_id) where tipo = 'personal' and revocado_at is null
       do update set secreto_hash = excluded.secreto_hash`,
      [p!.id, hashDeSecreto(SECRETO), enroladoPor],
    );
  });
});

/** Semilla el secreto de sesión REAL en IndexedDB, ANTES de cualquier interceptor: los tests que
 *  fuerzan demora o fallo registran su propio `addInitScript` DESPUÉS de este, y el orden de
 *  registro es el orden de ejecución — la siembra usa `indexedDB.open` sin tocar. */
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

/** Cada `indexedDB.open` posterior tarda `demoraMs` de más antes de resolver — mismo request
 *  real, entregado tarde. Sirve para forzar la escalada del skeleton al aviso de demora
 *  (>400 ms) sin que la resolución real (offline, sin red) alcance a mostrarlo nunca. */
async function demorarAparato(page: Page, demoraMs: number) {
  await page.addInitScript((demora) => {
    const original = window.indexedDB.open.bind(window.indexedDB);
    window.indexedDB.open = (...args: Parameters<typeof original>) => {
      const real = original(...args);
      const falso: Partial<IDBOpenDBRequest> & { result?: IDBDatabase; error?: DOMException | null } = {};
      real.onupgradeneeded = () => {
        falso.result = real.result;
        if (typeof falso.onupgradeneeded === "function") (falso.onupgradeneeded as EventListener)(new Event("x"));
      };
      real.onsuccess = () => {
        window.setTimeout(() => {
          falso.result = real.result;
          if (typeof falso.onsuccess === "function") (falso.onsuccess as EventListener)(new Event("x"));
        }, demora);
      };
      real.onerror = () => {
        window.setTimeout(() => {
          falso.error = real.error;
          if (typeof falso.onerror === "function") (falso.onerror as EventListener)(new Event("x"));
        }, demora);
      };
      return falso as IDBOpenDBRequest;
    };
  }, demoraMs);
}

/** El PRIMER `indexedDB.open` posterior falla (§5.7 «error con recuperación»); de ahí en más deja
 *  pasar el request real — es lo que hace que «Reintentar» recupere de verdad y no simule un
 *  segundo fallo idéntico. */
async function fallarAparatoUnaVez(page: Page) {
  await page.addInitScript(() => {
    const original = window.indexedDB.open.bind(window.indexedDB);
    let usado = false;
    window.indexedDB.open = (...args: Parameters<typeof original>) => {
      if (usado) return original(...args);
      usado = true;
      const falso: Partial<IDBOpenDBRequest> & { error?: DOMException | null } = {};
      window.setTimeout(() => {
        falso.error = new DOMException("simulado a propósito", "UnknownError");
        if (typeof falso.onerror === "function") (falso.onerror as EventListener)(new Event("x"));
      }, 10);
      return falso as IDBOpenDBRequest;
    };
  });
}

/** Una ruta con una sola entrega, con el sub-manifiesto ya confirmado — el candado abierto desde
 *  el primer render, que es la forma más corta de llegar al contenido real detrás del gate de
 *  aparato en cada uno de los cuatro casos. */
async function rutaDeUnaEntrega(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería de los 4 estados')
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [RUT_PANADERIA],
    );
    const [origen] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ($1) returning id::text as id",
      [`Depósito de ${nombre}`],
    );
    const [r] = await c.sql<{ id: string }>(
      "insert into rutas (nombre, publicada_en, version) values ($1, now(), 1) returning id::text as id",
      [nombre],
    );
    const [carga] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, origen!.id],
    );
    const destino = `Sucursal única de ${nombre}`;
    const [d] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ($1) returning id::text as id",
      [destino],
    );
    const [parada] = await c.sql<{ id: string }>(
      `insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2)
       returning id::text as id`,
      [r!.id, d!.id],
    );
    const [e] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 3) returning id::text as id",
      [empresa!.id, d!.id],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 3)", [
      parada!.id,
      e!.id,
    ]);
    await c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [carga!.id, empresa!.id],
    );
    return { paradaId: parada!.id, destino };
  });
}

test("[AC-FPOD-22] vacío accionable: la ruta terminada dice qué pasó y ofrece una salida", async ({ page }) => {
  const { paradaId } = await rutaDeUnaEntrega("la ruta que se vacía sola");
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();

  // El número de «Capturadas» no se fija acá a propósito: online, el replay-on-mount (AC-FPOD-03)
  // puede vaciar la cola antes de que el test llegue a mirarla — ESE es el comportamiento
  // correcto, y fijarlo en 1 haría al test flaky por una razón que no tiene que ver con el AC.
  const vacio = page.getByTestId("ruta-terminada");
  await expect(vacio).toBeVisible();
  await expect(vacio).toContainText("Terminaste las entregas de esta ruta. Capturadas:");
  // Accionable, no un párrafo suelto: hay algo que tocar y va a alguna parte.
  const salida = page.getByTestId("volver-inicio");
  await expect(salida).toBeVisible();
  await expect(salida).toHaveAttribute("href", "/");
});

test("[AC-FPOD-22] skeleton instantáneo, y el aviso de demora recién pasados los 400 ms", async ({ page }) => {
  const { paradaId } = await rutaDeUnaEntrega("la ruta del aparato lento");
  await sesionDe(page);
  // 1600 y no 700: el aviso vive entre los 400 ms y la respuesta del aparato. Con 700 la
  // ventana era de 300 ms y bajo carga el polling del expect la perdía (pausa del 19-ago).
  await demorarAparato(page, 1600);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);

  // El skeleton está desde el primer instante — nada de un «Cargando…» de texto plano.
  await expect(page.getByTestId("cargando-aparato")).toBeVisible();
  // Y el aviso de demora NO está todavía: recién van a haber pasado unos pocos ms.
  await expect(page.getByTestId("aviso-demora-aparato")).toHaveCount(0);

  // Pasados los 400 ms sin que el aparato responda, la escalada aparece.
  await expect(page.getByTestId("aviso-demora-aparato")).toBeVisible({ timeout: 2_000 });
  await expect(page.getByTestId("aviso-demora-aparato")).toContainText("Sigue cargando");

  // Y cuando el aparato por fin responde, el contenido real reemplaza al skeleton entero.
  await expect(page.getByTestId("llegue")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("cargando-aparato")).toHaveCount(0);
});

test("[AC-FPOD-22] error es-CL con recuperación: el aparato que no arranca lo dice, y «Reintentar» recupera de verdad", async ({
  page,
}) => {
  const { paradaId } = await rutaDeUnaEntrega("la ruta del aparato que falla");
  await sesionDe(page);
  await fallarAparatoUnaVez(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);

  const error = page.getByTestId("error-aparato");
  await expect(error).toBeVisible();
  await expect(error.getByRole("alert")).toContainText("No se pudo preparar el aparato");
  // Es un fallo del APARATO, no de una captura: el §5.7 prohíbe la palabra para lo otro, y acá
  // no está describiendo lo otro.
  const texto = (await error.innerText()).toLowerCase();
  expect(texto).not.toContain("rechaz");

  // La recuperación es real: el segundo intento usa el `indexedDB.open` de verdad, y el
  // contenido de la parada aparece — no un simple «se fue el error».
  await error.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByTestId("error-aparato")).toHaveCount(0);
  await expect(page.getByTestId("llegue")).toBeVisible({ timeout: 5_000 });
});

test("[AC-FPOD-22] sin conexión con contador real de cola, y ni un rechazo a la vista", async ({ page }) => {
  const { paradaId, destino } = await rutaDeUnaEntrega("la ruta sin señal de los 4 estados");
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.context().setOffline(true);

  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();

  const cola = page.getByTestId("por-sincronizar");
  await expect(cola).toBeVisible({ timeout: UNDO.ventana_ms * 3 });
  await expect(cola).toContainText("Entregada — por sincronizar");
  await expect(page.getByTestId("contador-cola")).toHaveText("1", { timeout: UNDO.ventana_ms * 3 });

  const pantalla = (await page.getByTestId("tarjeta-de-entrega").innerText()).toLowerCase();
  expect(pantalla).not.toContain("rechaz");
  expect(pantalla).not.toContain("no se pudo");

  await page.context().setOffline(false);
});
