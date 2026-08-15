import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { registrarBaseline } from "./baseline-acciones.mjs";
import { UNDO } from "../../../packages/nucleo-comun/src/constants.ts";
import { PUERTO_E2E } from "./puerto.ts";

// El camino feliz de F4, contado en acciones [AC-FPOD-01] — §5.2 F4, §5.3, §4.7, §7.6.
//
// ─── LO QUE ESTE ARCHIVO PROTEGE ──────────────────────────────────────────────────
//
//   (a) la entrega feliz cuesta DOS acciones EXACTAS —«Llegué» y «Entregado»— con la
//       convención de conteo cerrada del §5.3 (un campo del teclado propio = 1 acción; se
//       cuentan ACCIONES, no keydowns);
//   (b) la segunda acción deja a la vista la tarjeta de la parada SIGUIENTE, sin un toque de
//       avance ni una navegación de por medio;
//   (c) la única confirmación es la banda de deshacer de `UNDO.ventana_ms`, sin una sola modal
//       en el camino (§7.6): deshacer dentro de la ventana devuelve a la parada, y vencida la
//       ventana la banda se va sola y el chofer sigue donde estaba.
//
// El conteo se registra además en el baseline (`packages/metodo/panel/acciones-entrega-feliz.json`)
// para que la regresión sea BLOQUEANTE en el sentido del §5.3: el techo no puede subir. Acá el
// techo además está fijado por el maestro —«entrega feliz = 2 exactas»— así que el test lo
// asevera contra el número, no solo contra el histórico.
//
// El replay de la cola hacia el servidor NO se ejerce acá: la fila `entregas_pod` donde aterriza
// es AC-FPOD-11 (esquema, sesión supervisada) y el motor de sync que la lleva es AC-FPOD-03/04.
// Este AC es dueño del bucle de terreno y de su presupuesto de toques.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
/** El chofer de esta suite, PROPIO: la base de `hechos` la comparten media docena de suites y
 *  el §4.3 solo admite un dispositivo personal activo por operario — compartir la persona con
 *  otra suite es que la segunda en correr no pueda enrolar su aparato. */
const RUT_CHOFER = Object.keys(VALIDOS)[8]!;
const RUT_PANADERIA = Object.keys(VALIDOS)[6]!;

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien reparte el bucle') returning id::text as id",
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

/** Cuenta ACCIONES con la convención cerrada del §5.3: un campo de teclado propio = 1. */
function contador(page: Page) {
  let acciones = 0;
  return {
    get acciones() {
      return acciones;
    },
    async tocar(testid: string) {
      acciones++;
      await page.getByTestId(testid).click();
    },
  };
}

/**
 * Una ruta con su carga y TRES entregas seguidas, todas con el manifiesto ya confirmado.
 *
 * Tres y no una: el «avance automático» solo se puede ver si hay una parada siguiente a la que
 * avanzar, y con dos no se distingue «avanza» de «se queda en la última».
 */
async function rutaDeTresEntregas(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del bucle')
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
    for (const n of [1, 2, 3]) {
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

    // El sub-manifiesto YA confirmado en el andén: es el ESTADO previo del camino feliz, no lo
    // que este AC ejerce (eso es AC-FRUT-07 y su candado, AC-FRUT-22).
    await c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [carga!.id, empresa!.id],
    );

    return { entregas };
  });
}

test("[AC-FPOD-01] la entrega feliz cuesta DOS acciones exactas y avanza sola a la parada siguiente", async ({
  page,
}) => {
  const { entregas } = await rutaDeTresEntregas("la ruta del bucle");
  await sesionDe(page);
  const c = contador(page);

  await page.goto(`${EN_A}/entrega?parada=${entregas[0]!.id}`);
  await expect(page.getByTestId("parada-actual")).toContainText(entregas[0]!.destino);
  // «7 de 23» del §5.2 F4: la posición en el bucle, en la cifra operativa.
  await expect(page.getByTestId("contador-paradas")).toContainText("1");
  await expect(page.getByTestId("contador-paradas")).toContainText("de 3");

  await c.tocar("llegue"); // 1 · llegué
  await c.tocar("entregado"); // 2 · entregado

  // El avance es parte de la segunda acción: la tarjeta a la vista ya es la de la parada 2, sin
  // un toque de «Siguiente» ni una navegación que el chofer tenga que esperar.
  await expect(page.getByTestId("parada-actual")).toContainText(entregas[1]!.destino);
  await expect(page.getByTestId("contador-paradas")).toContainText("2");
  await expect(page.getByTestId("llegue")).toBeVisible();

  expect(c.acciones, "el §5.2 F4 fija la entrega feliz en 2 acciones EXACTAS").toBe(2);

  // Ninguna modal en el camino (§7.6): la única confirmación es la banda de deshacer.
  await expect(page.getByTestId("banda-undo")).toBeVisible();
  expect(await page.locator('[role="dialog"], dialog').count()).toBe(0);

  const { baseline, acciones } = registrarBaseline({
    flujo: "entrega-feliz",
    ac: "AC-FPOD-01",
    acciones: c.acciones,
  });
  expect(acciones, "el contador no midió nada").toBeGreaterThan(0);
  expect(
    acciones,
    `la entrega feliz pasó de ${baseline} a ${acciones} acciones: una regresión del camino feliz no se mergea (§5.3)`,
  ).toBeLessThanOrEqual(baseline);
});

test("[AC-FPOD-01] deshacer dentro de la ventana devuelve a la parada, y no cuesta ninguna acción seguir", async ({
  page,
}) => {
  const { entregas } = await rutaDeTresEntregas("la ruta del arrepentido");
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${entregas[0]!.id}`);
  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();
  await expect(page.getByTestId("parada-actual")).toContainText(entregas[1]!.destino);

  await page.getByTestId("deshacer").click();

  // Vuelve a la parada que deshizo, y con «Llegué» ya dado: es donde estaba parado cuando se
  // equivocó de botón, no dos pasos atrás.
  await expect(page.getByTestId("parada-actual")).toContainText(entregas[0]!.destino);
  await expect(page.getByTestId("entrega-en-curso")).toBeVisible();
  await expect(page.getByTestId("banda-undo")).toHaveCount(0);
  expect(await page.locator('[role="dialog"], dialog').count()).toBe(0);
});

test("[AC-FPOD-01] vencida la ventana de 8 s la banda se va sola y la entrega queda hecha", async ({
  page,
}) => {
  const { entregas } = await rutaDeTresEntregas("la ruta que no se deshace");
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${entregas[0]!.id}`);
  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();
  await expect(page.getByTestId("banda-undo")).toBeVisible();

  // El plazo sale de la familia canónica del §0, no de una cifra escrita acá.
  await expect(page.getByTestId("banda-undo")).toHaveCount(0, { timeout: UNDO.ventana_ms * 2 });
  // Y el chofer sigue donde el avance automático lo dejó: la ventana que vence no lo mueve.
  await expect(page.getByTestId("parada-actual")).toContainText(entregas[1]!.destino);
});

test("[AC-FPOD-01] entregadas las tres paradas, el bucle termina y no ofrece una cuarta", async ({
  page,
}) => {
  const { entregas } = await rutaDeTresEntregas("la ruta completa");
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${entregas[0]!.id}`);
  for (const entrega of entregas) {
    await expect(page.getByTestId("parada-actual")).toContainText(entrega.destino);
    await page.getByTestId("llegue").click();
    await page.getByTestId("entregado").click();
  }

  await expect(page.getByTestId("ruta-terminada")).toBeVisible();
  await expect(page.getByTestId("parada-actual")).toHaveCount(0);
  await expect(page.getByTestId("llegue")).toHaveCount(0);
});
