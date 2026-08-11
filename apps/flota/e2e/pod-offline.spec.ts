import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { UNDO } from "../../../packages/nucleo-comun/src/constants.ts";

// 100% offline: el POD sin red, y la cola que se vacía sola [AC-FPOD-03] — §3.E1.7, §5.2 F4,
// §5.7, §4.2, §4.6, §4.7.
//
// Lo que este archivo protege:
//   (a) con la red cortada ANTES de llegar a la parada, el POD se captura igual —el candado sale
//       del snapshot que vino con la pantalla, no de un viaje que sin señal no vuelve—;
//   (b) la UI dice «Entregada — por sincronizar» con el contador REAL de la cola, y JAMÁS un
//       rechazo (§5.7);
//   (c) al volver la señal el replay vacía la cola SIN que el chofer toque nada, y lo que la
//       vacía es que el hecho quedó escrito en `eventos` — se cuenta en la BD, no en la pantalla.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
/** Chofer PROPIO de esta suite: el §4.3 admite un dispositivo personal activo por operario, y
 *  compartir la persona con otra suite es que la segunda en correr no pueda enrolar. */
const RUT_CHOFER = rutDeFixture(10);
const RUT_PANADERIA = rutDeFixture(6);

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien reparte sin señal') returning id::text as id",
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

/** Una ruta con su carga y tres entregas, todas con el sub-manifiesto ya confirmado. */
async function rutaDeTresEntregas(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería sin señal')
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

    await c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [carga!.id, empresa!.id],
    );

    return { entregas };
  });
}

/** Los hechos que de verdad aterrizaron, contados en la BD y no en la pantalla: es la diferencia
 *  entre «la cola se vació» y «la cola se borró» (§4.6). */
async function capturasEnLaBase(paradaIds: string[]): Promise<number> {
  return con(BD_A, async (c: Conexion) => {
    const [fila] = await c.sql<{ n: string }>(
      `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = 'entrega.pod_capturada' and e.objeto_id = any($1::uuid[])`,
      [paradaIds],
    );
    return Number(fila!.n);
  });
}

test("[AC-FPOD-03] con la red cortada el POD se captura igual, dice «por sincronizar» y al volver la señal la cola se vacía sola", async ({
  page,
}) => {
  const { entregas } = await rutaDeTresEntregas("la ruta del subterráneo");
  await sesionDe(page);

  // La pantalla se carga CON señal —el chofer sale del depósito con la ruta en la mano— y la red
  // se corta ANTES de llegar a la primera parada (§3.E1.7).
  await page.goto(`${EN_A}/entrega?parada=${entregas[0]!.id}`);
  await expect(page.getByTestId("parada-actual")).toContainText(entregas[0]!.destino);
  await page.context().setOffline(true);

  // Dos entregas completas sin una sola llamada que vuelva: el candado viene en el snapshot.
  for (const entrega of [entregas[0]!, entregas[1]!]) {
    await expect(page.getByTestId("parada-actual")).toContainText(entrega.destino);
    await page.getByTestId("llegue").click();
    await page.getByTestId("entregado").click();
  }
  await expect(page.getByTestId("parada-actual")).toContainText(entregas[2]!.destino);

  // Vencidas las ventanas de undo, las dos capturas están en la cola y el contador es REAL.
  await expect(page.getByTestId("por-sincronizar")).toBeVisible({ timeout: UNDO.ventana_ms * 3 });
  await expect(page.getByTestId("por-sincronizar")).toContainText("Entregada — por sincronizar");
  await expect(page.getByTestId("contador-cola")).toHaveText("2", { timeout: UNDO.ventana_ms * 3 });

  // Ni un rechazo a la vista, y ni una modal (§5.7, §7.6): el chofer no tiene nada que decidir.
  const pantalla = await page.getByTestId("tarjeta-de-entrega").innerText();
  expect(pantalla.toLowerCase()).not.toContain("rechaz");
  expect(pantalla.toLowerCase()).not.toContain("no se pudo");
  expect(pantalla.toLowerCase()).not.toContain("reintent");
  expect(await page.locator('[role="dialog"], dialog').count()).toBe(0);

  const ids: string[] = entregas.map((e: { id: string }) => e.id);
  expect(await capturasEnLaBase(ids), "sin señal no aterrizó nada, que es el punto").toBe(0);

  // Vuelve la señal. NADIE toca la pantalla: el replay-on-online del §4.7 es el camino principal.
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByTestId("por-sincronizar")).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(() => capturasEnLaBase(ids), { timeout: 15_000 })
    .toBe(2);
});

test("[AC-FPOD-03] la cola se vacía porque el hecho quedó escrito, con su doble reloj y su llave de idempotencia", async ({
  page,
}) => {
  const { entregas } = await rutaDeTresEntregas("la ruta que sí aterriza");
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${entregas[0]!.id}`);
  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();

  const ids: string[] = entregas.map((e: { id: string }) => e.id);
  await expect.poll(() => capturasEnLaBase(ids), { timeout: 15_000 }).toBe(1);

  const [evento] = await con(BD_A, (c: Conexion) =>
    c.sql<{ client_uuid: string | null; resultado: string; desfase: string }>(
      `select e.client_uuid::text as client_uuid,
              e.payload->>'resultado' as resultado,
              (e.record_time >= e.event_time)::text as desfase
         from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = 'entrega.pod_capturada' and e.objeto_id = any($1::uuid[])`,
      [ids],
    ),
  );
  // La llave de idempotencia del §0 viajó y quedó escrita: sin ella el replay doble del outbox
  // escribiría el mismo hecho dos veces (lo prueba AC-FPOD-04; acá se asegura que existe).
  expect(evento!.client_uuid).not.toBeNull();
  expect(evento!.resultado).toBe("exito");
  // Doble reloj del §4.6: el servidor supo del hecho después de que el aparato lo capturó.
  expect(evento!.desfase).toBe("true");

  // Y el replay del MISMO lote no escribe un segundo hecho: el acuse dice «ya estaba».
  const respuesta = await page.request.post(`${EN_A}/api/sync/capturas`, {
    headers: { authorization: `Portador ${SECRETO}` },
    data: {
      capturas: [
        {
          client_uuid: evento!.client_uuid,
          parada_id: entregas[0]!.id,
          ts_dispositivo: new Date().toISOString(),
          tz_offset_min: -240,
          resultado: "exito",
          metodo_entrega: "receptor",
          motivo_id: null,
          items: null,
          evidencias: [],
        },
      ],
    },
  });
  expect(respuesta.status()).toBe(200);
  expect(await capturasEnLaBase(ids)).toBe(1);
});
