import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { UNDO } from "../../../packages/nucleo-comun/src/constants.ts";
import { PUERTO_E2E } from "./puerto.ts";

// El undo de 8 s con semántica CERRADA, contra el aparato y el servidor reales [AC-FPOD-08] —
// §4.7, §0, §10, §7.4.
//
// Las dos mitades que el unitario (`dominio/outbox-undo.test.ts`) no puede probar:
//
//   (1) la app MUERE dentro de la ventana. Acá se mata de verdad —una recarga de la página, que
//       es lo que se lleva el temporizador de los 8 s y todo el estado de React— tres segundos
//       después del toque, y se exige que la entrega EXISTA en la base al reabrir. Sin el outbox
//       durable esa entrega no está en ninguna parte y el chofer la cree cerrada: es el hueco
//       exacto que el «INMEDIATAMENTE» del §4.7 tapa.
//   (2) el undo POST-replay aterriza como supersede: dos filas en `eventos` con la original
//       intacta (§7.4) y, sobre todo, EXCLUIDO del métrico de gaming del §10 — que acá se
//       consulta por su definición SQL (`pods_supersedidos_semanal`, migración 0053) y no
//       re-escribiendo el filtro en el test, que es lo que haría pasar la prueba de un métrico
//       que en producción cuenta mal.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
/** Chofer PROPIO de esta suite: el §4.3 admite un solo dispositivo personal activo por operario,
 *  así que compartir la persona con otra suite es que la segunda no pueda enrolar. */
const RUT_CHOFER = rutDeFixture(31);
const RUT_PANADERIA = rutDeFixture(32);

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien se arrepiente') returning id::text as id",
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

/** Una ruta con dos entregas y su manifiesto ya confirmado: el estado previo del camino feliz. */
async function rutaConEntregas(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del arrepentido')
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
    for (const n of [1, 2]) {
      const destino = `Sucursal ${n} de ${nombre}`;
      const [d] = await c.sql<{ id: string }>(
        "insert into destinos (nombre) values ($1) returning id::text as id",
        [destino],
      );
      const [parada] = await c.sql<{ id: string }>(
        "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', $2, $3) returning id::text as id",
        [r!.id, n + 1, d!.id],
      );
      const [e] = await c.sql<{ id: string }>(
        "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
        [empresa!.id, d!.id, n * 2],
      );
      await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)", [
        parada!.id,
        e!.id,
        n * 2,
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

async function eventosDeLaParada(paradaId: string, codigo: string) {
  return con(BD_A, (c: Conexion) =>
    c.sql<{ client_uuid: string | null; motivo: string | null; supersede_de: string | null }>(
      `select e.client_uuid::text as client_uuid,
              e.payload ->> 'motivo' as motivo,
              e.payload ->> 'supersede_de' as supersede_de
         from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = $2 and e.objeto_id = $1::uuid
        order by e.secuencia`,
      [paradaId, codigo],
    ),
  );
}

test("[AC-FPOD-08] la app muere a los 3 s del toque: al reabrir, la entrega existe y se replayea sola", async ({
  page,
}) => {
  const { entregas } = await rutaConEntregas("la ruta que se apagó");
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${entregas[0]!.id}`);
  await expect(page.getByTestId("parada-actual")).toContainText(entregas[0]!.destino);
  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();
  // Dentro de la ventana: la banda de deshacer sigue abierta y la captura NO ha salido.
  await expect(page.getByTestId("banda-undo")).toBeVisible();
  expect(
    (await eventosDeLaParada(entregas[0]!.id, "entrega.pod_capturada")).length,
    "dentro de la ventana la mutación no sale del dispositivo (§4.7)",
  ).toBe(0);

  // 3 s: bien dentro de los 8 de `UNDO.ventana_ms`. Y acá se muere la app — la recarga se lleva
  // el temporizador y todo el estado de React, igual que un cierre del sistema.
  await page.waitForTimeout(3_000);
  expect(3_000).toBeLessThan(UNDO.ventana_ms);
  await page.reload();

  // Al reabrir, sin que el chofer toque nada: el replay-on-startup vacía la cola que el outbox
  // durable trajo del disco.
  await expect
    .poll(
      async () => (await eventosDeLaParada(entregas[0]!.id, "entrega.pod_capturada")).length,
      { message: "la captura tiene que EXISTIR al reabrir y replayarse sola (§4.7)" },
    )
    .toBe(1);
});

test("[AC-FPOD-08] undo post-replay: supersede motivo=undo, la original intacta y fuera del métrico de gaming", async ({
  page,
}) => {
  const { entregas } = await rutaConEntregas("la ruta del dedo tardío");
  const paradaId = entregas[0]!.id;
  const original = randomUUID();
  const correccion = randomUUID();
  // ANTES de que la original salga: el denominador del métrico tiene que subir con ella.
  const antes = await metrico();

  // La captura ya replicada: es el estado del que parte el undo POST-replay.
  const acuse = await page.request.post(`${EN_A}/api/sync/capturas`, {
    headers: { Authorization: `Portador ${SECRETO}` },
    data: {
      capturas: [
        {
          client_uuid: original,
          parada_id: paradaId,
          ts_dispositivo: new Date().toISOString(),
          tz_offset_min: -240,
          resultado: "exito",
          metodo_entrega: "receptor",
          motivo_id: null,
          items: null,
          evidencias: [],
          supersede_de: null,
          motivo: null,
        },
      ],
    },
  });
  expect(acuse.status()).toBe(200);

  // El dedo llegó tarde: la ventana ya venció y la captura salió. El undo es un supersede.
  const respuesta = await page.request.post(`${EN_A}/api/sync/capturas`, {
    headers: { Authorization: `Portador ${SECRETO}` },
    data: {
      capturas: [
        {
          client_uuid: correccion,
          parada_id: paradaId,
          ts_dispositivo: new Date().toISOString(),
          tz_offset_min: -240,
          resultado: "exito",
          metodo_entrega: "receptor",
          motivo_id: null,
          items: null,
          evidencias: [],
          supersede_de: original,
          motivo: UNDO.motivo_supersede,
        },
      ],
    },
  });
  expect(respuesta.status(), "un supersede sigue siendo CAPTURA: 2xx siempre (§4.2)").toBe(200);
  expect((await respuesta.json()).acuses[0].aceptada).toBe(true);

  const capturadas = await eventosDeLaParada(paradaId, "entrega.pod_capturada");
  const deshechas = await eventosDeLaParada(paradaId, "entrega.pod_deshecha");
  expect(capturadas.length, "la original queda INTACTA: jamás un UPDATE (§7.4)").toBe(1);
  expect(capturadas[0]!.client_uuid).toBe(original);
  expect(deshechas.length, "y el undo es una fila NUEVA: dos filas en total").toBe(1);
  expect(deshechas[0]!.supersede_de).toBe(original);
  expect(deshechas[0]!.motivo).toBe(UNDO.motivo_supersede);

  // El corazón del AC: el métrico de gaming del §10 NO se mueve con el undo del chofer. Se lee
  // de la vista, que es donde vive la definición — un filtro re-escrito acá probaría el test.
  const despues = await metrico();
  expect(
    despues.supersedidos - antes.supersedidos,
    "el undo de 8 s está EXCLUIDO por definición SQL del % de PODs supersedidos (§4.7, §10)",
  ).toBe(0);
  expect(
    despues.deshechos_por_undo - antes.deshechos_por_undo,
    "pero no se pierde: se cuenta aparte, como la señal de UX que es",
  ).toBe(1);
  // El denominador sí sube — con `>=` y no `=`: la base e2e la comparten varias suites que
  // capturan PODs en paralelo, y clavar el delta en 1 sería probar el calendario de Playwright.
  expect(despues.pods - antes.pods, "y la captura original sí suma como POD").toBeGreaterThanOrEqual(1);
});

/** El métrico del §10 leído por su DEFINICIÓN (`pods_supersedidos_semanal`, 0053), sumando todas
 *  las semanas: la base e2e la comparten varias suites y una semana sola puede venir vacía. */
async function metrico(): Promise<{ pods: number; supersedidos: number; deshechos_por_undo: number }> {
  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ pods: string; supersedidos: string; deshechos: string }>(
      `select coalesce(sum(pods), 0)::text as pods,
              coalesce(sum(supersedidos), 0)::text as supersedidos,
              coalesce(sum(deshechos_por_undo), 0)::text as deshechos
         from pods_supersedidos_semanal`,
    ),
  );
  return {
    pods: Number(fila!.pods),
    supersedidos: Number(fila!.supersedidos),
    deshechos_por_undo: Number(fila!.deshechos),
  };
}
