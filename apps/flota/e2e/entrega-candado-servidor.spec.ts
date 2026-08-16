import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS, rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// El candado del SERVIDOR y el camino feliz completo [AC-FRUT-23] — KR-29 (decisión del dueño
// 08-ago-2026, D1), §4.2, §5.2 F4, §7.3 (art. 55 DL 825), §9.3.4, §4.5.
//
// ─── LO QUE ESTE ARCHIVO PROTEGE ──────────────────────────────────────────────────
//
//   (a) el camino feliz de DOS acciones («Llegué»→«Entregado») deja la captura PERSISTIDA como
//       el hecho write-once del §4.5: una fila de `entregas_pod` por encargo, con el resultado y
//       el método de entrega de la máquina, no solo un evento;
//   (b) un POD que llega por el motor de sync SIN el manifiesto de su carga confirmado entra
//       igual —2xx, rechazos = 0 (§9.3.4)— con el flag `sin_manifiesto_confirmado`, su evento y
//       su fila en «Por revisar» de severidad ALTA;
//   (c) con el manifiesto confirmado no hay flag, ni evento, ni fila de revisión: el candado no
//       ensucia la bandeja del camino normal.
//
// El candado BLOQUEANTE del cliente es AC-FRUT-22 y vive en `entrega.spec.ts`: acá se ejerce la
// otra mitad, la que el §4.2 deja del lado del servidor —dejar dicho, jamás rechazar—, que es la
// única que sigue de pie cuando quien pega al endpoint no es la pantalla.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien cierra la parada') returning id::text as id",
      [rutDeFixture(26)],
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

async function empresa(rut: string, razonSocial: string) {
  return con(BD_A, async (c: Conexion) => {
    const [row] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, $2)
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [rut, razonSocial],
    );
    return row!.id;
  });
}

/** Una ruta con su carga y su entrega, e ítems de N empresas en la entrega (§3.E1.5). */
async function rutaConEntrega(nombre: string, empresas: { id: string; bultos: number }[]) {
  return con(BD_A, async (c: Conexion) => {
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ($1) returning id::text as id",
      [`Sucursal de ${nombre}`],
    );
    const [origen] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ($1) returning id::text as id",
      [`Andén de ${nombre}`],
    );
    const [r] = await c.sql<{ id: string }>(
      "insert into rutas (nombre, publicada_en, version) values ($1, now(), 1) returning id::text as id",
      [nombre],
    );
    const [carga] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, origen!.id],
    );
    const [entrega] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2) returning id::text as id",
      [r!.id, destino!.id],
    );
    const encargos: string[] = [];
    for (const { id: empresaId, bultos } of empresas) {
      const [e] = await c.sql<{ id: string }>(
        "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
        [empresaId, destino!.id, bultos],
      );
      await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)", [
        entrega!.id,
        e!.id,
        bultos,
      ]);
      encargos.push(e!.id);
    }
    return { cargaId: carga!.id, entregaId: entrega!.id, encargos };
  });
}

/** El sub-manifiesto YA confirmado en el andén: es el ESTADO previo del caso, no lo que este AC
 *  ejerce (eso es AC-FRUT-07). */
async function confirmarEnElAnden(paradaId: string, empresaId: string) {
  await con(BD_A, (c: Conexion) =>
    c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [paradaId, empresaId],
    ),
  );
}

async function podsDeLaParada(paradaId: string) {
  return con(BD_A, (c: Conexion) =>
    c.sql<{ encargo_id: string; resultado: string; metodo_entrega: string | null; cerrada: string }>(
      `select encargo_id::text as encargo_id, resultado::text as resultado,
              metodo_entrega, cerrada::text as cerrada
         from entregas_pod where parada_id = $1 order by encargo_id`,
      [paradaId],
    ),
  );
}

async function eventosDeLaParada(paradaId: string, codigo: string) {
  return con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      `select e.id::text as id from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = $2 and e.objeto_id = $1::uuid`,
      [paradaId, codigo],
    ),
  );
}

async function revisionesPorOrigen(origen: string, nota: string) {
  return con(BD_A, (c: Conexion) =>
    c.sql<{ severidad: string }>(
      "select severidad::text as severidad from review_queue where origen = $1 and nota like $2",
      [origen, `%${nota}%`],
    ),
  );
}

function capturaDe(paradaId: string, clientUuid: string) {
  return {
    client_uuid: clientUuid,
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
  };
}

test("[AC-FRUT-23] camino feliz de DOS acciones: «Llegué»→«Entregado» deja la captura persistida", async ({
  page,
}) => {
  const panaderia = await empresa(Object.keys(VALIDOS)[6]!, "Panadería del camino feliz");
  const { cargaId, entregaId, encargos } = await rutaConEntrega("Ruta del camino feliz", [
    { id: panaderia, bultos: 12 },
  ]);
  await confirmarEnElAnden(cargaId, panaderia);

  await sesionDe(page);
  await page.goto(`${EN_A}/entrega?parada=${entregaId}`);

  // Las DOS acciones exactas del §5.2 F4. Cero modal en el medio (§7.6): la banda de deshacer no
  // pide un toque para seguir, y por eso no cuenta como acción.
  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();
  expect(await page.locator('[role="dialog"], dialog').count()).toBe(0);

  // Y la captura se PERSISTE: no alcanza con que la cola se vacíe (eso sería un borrado). La
  // fila write-once del §4.5 tiene que existir, por encargo, con la máquina de la parada.
  await expect
    .poll(async () => (await podsDeLaParada(entregaId)).length, {
      message: "el camino feliz deja su fila en `entregas_pod` (§4.5) — vaciar la cola no es guardar",
      timeout: 20_000,
    })
    .toBe(1);

  const [pod] = await podsDeLaParada(entregaId);
  expect(pod!.encargo_id).toBe(encargos[0]);
  expect(pod!.resultado).toBe("exito");
  expect(pod!.metodo_entrega).toBe("receptor");
  expect(pod!.cerrada).toBe("true");

  // El camino normal no ensucia la bandeja: manifiesto confirmado ⇒ ni flag ni revisión.
  expect((await eventosDeLaParada(entregaId, "entrega.sin_manifiesto_confirmado")).length).toBe(0);
  expect((await revisionesPorOrigen("entrega.sin_manifiesto_confirmado", entregaId)).length).toBe(0);
});

test("[AC-FRUT-23] POD por sync sin manifiesto confirmado: 2xx con flag, evento y revisión ALTA", async ({
  page,
}) => {
  const panaderia = await empresa(Object.keys(VALIDOS)[6]!, "Panadería del candado del servidor");
  const { entregaId, encargos } = await rutaConEntrega("Ruta sin confirmar", [
    { id: panaderia, bultos: 8 },
  ]);
  // El manifiesto de la carga NUNCA se confirmó: el ancla del art. 55 DL 825 (§7.3) no existe.

  await sesionDe(page);
  const respuesta = await page.request.post(`${EN_A}/api/sync/capturas`, {
    headers: { Authorization: `Portador ${SECRETO}` },
    data: { capturas: [capturaDe(entregaId, randomUUID())] },
  });

  // Rechazos = 0 (§9.3.4, §4.2): el pan ya se entregó y un rebote no devuelve la parada, la borra.
  expect(respuesta.status(), "la entrega es CAPTURA: 2xx siempre").toBe(200);
  const acuse = (await respuesta.json()).acuses[0];
  expect(acuse.aceptada).toBe(true);
  expect(acuse.flags).toContain("sin_manifiesto_confirmado");

  // Entró de verdad, no «entró» en el acuse: la fila write-once existe igual.
  const pods = await podsDeLaParada(entregaId);
  expect(pods.length).toBe(1);
  expect(pods[0]!.encargo_id).toBe(encargos[0]);

  // Y quedó DICHO, por los dos caminos que el §5.6 lee.
  expect((await eventosDeLaParada(entregaId, "entrega.sin_manifiesto_confirmado")).length).toBe(1);
  const revisiones = await revisionesPorOrigen("entrega.sin_manifiesto_confirmado", entregaId);
  expect(revisiones.length).toBe(1);
  expect(revisiones[0]!.severidad, "lo que falta es documental, no la hora de un teléfono").toBe(
    "alta",
  );
});

test("[AC-FRUT-23] entrega consolidada: falta UNA empresa y el POD igual entra, marcado, con su fila por encargo", async ({
  page,
}) => {
  const panaderia = await empresa(Object.keys(VALIDOS)[6]!, "Panadería consolidada");
  const pasteleria = await empresa(Object.keys(VALIDOS)[7]!, "Pastelería consolidada");
  const { cargaId, entregaId } = await rutaConEntrega("Ruta consolidada", [
    { id: panaderia, bultos: 10 },
    { id: pasteleria, bultos: 4 },
  ]);
  // Una sola de las dos confirmada (§3.E1.5): el candado sigue cerrado, y el POD que igual llega
  // por sync tiene que quedar marcado.
  await confirmarEnElAnden(cargaId, panaderia);

  await sesionDe(page);
  const respuesta = await page.request.post(`${EN_A}/api/sync/capturas`, {
    headers: { Authorization: `Portador ${SECRETO}` },
    data: { capturas: [capturaDe(entregaId, randomUUID())] },
  });

  expect(respuesta.status()).toBe(200);
  expect((await respuesta.json()).acuses[0].flags).toContain("sin_manifiesto_confirmado");

  // El write-once del §4.5 es por ENCARGO: la consolidada cierra los dos de una vez, y cada
  // empresa se queda con su propia declaración —de ahí cuelga la liquidación del §3.E1.9.
  const pods = await podsDeLaParada(entregaId);
  expect(pods.length, "una fila por encargo, no una por parada").toBe(2);
  expect(pods.every((p: { resultado: string }) => p.resultado === "exito")).toBe(true);

  expect((await revisionesPorOrigen("entrega.sin_manifiesto_confirmado", entregaId))[0]!.severidad).toBe(
    "alta",
  );
});
