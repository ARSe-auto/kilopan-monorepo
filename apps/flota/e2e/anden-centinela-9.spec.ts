import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { con, bdDeTenant, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { fijarPin } from "../src/servidor/pin.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { UNDO } from "../../../packages/nucleo-comun/src/constants.ts";

// El centinela 9 del §9.3 (§4.7), ejercido sobre el dispositivo de ANDÉN [AC-FIDN-07] — §4.3,
// §5.4 F-D.
//
// ─── EN QUÉ SE DIFERENCIA DEL CENTINELA 9 DEL TELÉFONO PERSONAL ───────────────────────
//
// `pod-outbox-multiusuario.spec.ts` (AC-FPOD-09) prueba la MISMA frase del §4.7 con DOS
// aparatos —cada uno con su propio `dispositivos.id` y su propio secreto— narrados como «el
// mismo teléfono» porque comparten `localStorage`. Acá hay un solo aparato de verdad: UN
// `dispositivos.id`, UN secreto, tipo `anden`, sin persona dueña. Lo que rota no es el
// aparato: es la identidad HUMANA sobre él, por RUT+PIN, contra el endpoint real
// `POST /api/anden/identidad`. La partición del outbox no puede salir del secreto —sería la
// MISMA partición para todos los que pasen por la mesa— así que sale de la huella que ese
// endpoint emite (`sesiones_anden.huella`, `cliente/identidad.ts::identidadDelAparato`).
//
// ─── POR QUÉ B ROTA CON `fetch` DIRECTO Y NO CON `page.request` ───────────────────────
//
// La rotación es PLANIFICACIÓN (§4.2): valida online contra el PIN, y no hay nada que
// degradar sin red. El caso entero es que A sigue con la página offline —tres capturas en su
// outbox local— mientras B, en el mismo galpón, ya tiene señal y usa el mismo aparato.
// `page.context().setOffline` solo corta la red DE LA PÁGINA emulada; el servidor real sigue
// arriba y respondiéndole a cualquiera que le hable por fuera de ese `page`, que es
// exactamente lo que el `fetch` de este archivo hace.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_OPERARIO_A = rutDeFixture(24);
const RUT_OPERARIO_B = rutDeFixture(25);
const RUT_PANADERIA = rutDeFixture(6);

const PIN_A = "2468";
const PIN_B = "1357";
const SECRETO_APARATO = secretoNuevo();

let pool: Pool;
let dispositivoId: string;
const usuarios: Record<string, string> = {};

test.beforeAll(async () => {
  pool = new Pool({
    host: CLUSTER_LOCAL.host,
    port: CLUSTER_LOCAL.puerto,
    database: BD_A,
    user: ROL_MIGRADOR,
  });

  const ids = await con(BD_A, async (c: Conexion) => {
    const salida: Record<string, string> = {};
    for (const [clave, rut, nombre] of [
      ["a", RUT_OPERARIO_A, "Quien captura en el andén y se queda sin señal"],
      ["b", RUT_OPERARIO_B, "Quien rota por PIN en el MISMO aparato"],
    ] as const) {
      const [p] = await c.sql<{ id: string }>(
        "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
        [rut, nombre],
      );
      const [u] = await c.sql<{ id: string }>(
        "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
        [p!.id],
      );
      salida[clave] = u!.id;
    }
    const [d] = await c.sql<{ id: string }>(
      `insert into dispositivos (tipo, persona_id, secreto_hash, is_standalone, storage_persisted)
       values ('anden', null, $1, true, true)
       returning id::text as id`,
      [hashDeSecreto(SECRETO_APARATO)],
    );
    salida.dispositivo = d!.id;
    return salida;
  });
  usuarios.a = ids.a!;
  usuarios.b = ids.b!;
  dispositivoId = ids.dispositivo!;

  await fijarPin(pool, usuarios.a!, PIN_A);
  await fijarPin(pool, usuarios.b!, PIN_B);
});

test.afterAll(async () => {
  await pool?.end();
});

/** Una ruta con su carga y tres entregas, todas con el sub-manifiesto ya confirmado. Igual que
 *  en `pod-outbox-multiusuario.spec.ts`: dos rutas propias por corrida, para que A y B tengan
 *  cada uno la suya y el contador de B no arrastre nada de A. */
async function rutaDeTresEntregas(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del andén compartido')
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

/** Las capturas que de verdad aterrizaron, con el actor al que quedaron firmadas (§4.6). */
async function capturasAterrizadas(paradaIds: string[]) {
  return con(BD_A, (c: Conexion) =>
    c.sql<{ parada: string; dispositivo: string; actor: string }>(
      `select e.objeto_id::text      as parada,
              e.dispositivo_id::text as dispositivo,
              e.actor_id::text       as actor
         from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = 'entrega.pod_capturada' and e.objeto_id = any($1::uuid[])
        order by e.secuencia`,
      [paradaIds],
    ),
  );
}

/** Lo que hay en el disco del andén para el outbox del POD: una llave por identidad
 *  (`cliente/outbox-local.ts`). */
async function outboxEnElDisco(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const salida: Record<string, number> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const llave = localStorage.key(i)!;
      if (!llave.startsWith("flota.outbox.pod.")) continue;
      const leido: unknown = JSON.parse(localStorage.getItem(llave) ?? "[]");
      salida[llave] = Array.isArray(leido) ? leido.length : -1;
    }
    return salida;
  });
}

/** El aparato de andén recién instalado en la mesa: guarda su secreto UNA vez, como
 *  `guardarSecreto` (`cliente/aparato.ts`) el día que el dueño lo enrola. Todavía sin
 *  identidad humana — eso lo pone la rotación por PIN. */
async function guardarSecretoDelAparato(page: Page, secreto: string) {
  await page.addInitScript((s) => {
    void new Promise<void>((res) => {
      const r = indexedDB.open("flota-aparato", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("claves");
      r.onsuccess = () => {
        const claves = r.result.transaction("claves", "readwrite").objectStore("claves");
        const leer = claves.get("secreto-de-sesion");
        leer.onsuccess = () => {
          if (leer.result !== undefined) return res();
          const guardar = claves.put(s, "secreto-de-sesion");
          guardar.onsuccess = () => res();
          guardar.onerror = () => res();
        };
        leer.onerror = () => res();
      };
    });
  }, secreto);
}

/** Escribe en el disco la huella que el endpoint de rotación devolvió — lo que
 *  `guardarIdentidadAnden` (`cliente/aparato.ts`) hace al recibir la respuesta de
 *  `POST /api/anden/identidad`. Sin tocar la red: es la otra mitad de «B rota por fuera de la
 *  página», la escritura local que el aparato haría al recibir esa respuesta. */
async function rotarEnElDisco(page: Page, huella: string) {
  await page.evaluate(
    (h) =>
      new Promise<void>((res) => {
        const r = indexedDB.open("flota-aparato", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("claves");
        r.onsuccess = () => {
          const tx = r.result
            .transaction("claves", "readwrite")
            .objectStore("claves")
            .put(h, "identidad-de-anden");
          tx.onsuccess = () => res();
          tx.onerror = () => res();
        };
      }),
    huella,
  );
}

/** Rota la identidad del aparato por RUT+PIN contra el endpoint REAL — desde el proceso de
 *  Playwright y no desde el `page`, para que el offline emulado de la página no le pese. */
async function rotarPorApi(rut: string, pin: string): Promise<{ huella: string; nombre: string; rol: string }> {
  const respuesta = await fetch(`${EN_A}/api/anden/identidad`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Portador ${SECRETO_APARATO}` },
    body: JSON.stringify({ rut, pin }),
  });
  expect(respuesta.status, "RUT+PIN correctos contra el aparato de andén tienen que rotar en verde").toBe(200);
  return (await respuesta.json()) as { huella: string; nombre: string; rol: string };
}

test("[AC-FIDN-07] centinela 9 en el andén: A captura 3 sin señal, B rota por PIN en el MISMO aparato y las 3 de A aterrizan a su nombre", async ({
  page,
}) => {
  const deA = await rutaDeTresEntregas("la ruta de quien estaba en el andén");
  const deB = await rutaDeTresEntregas("la ruta de quien rotó después");
  const idsDeA: string[] = deA.entregas.map((e: { id: string }) => e.id);
  const idsDeB: string[] = deB.entregas.map((e: { id: string }) => e.id);

  // ── El aparato guarda su secreto y A rota por PIN — CON red ────────────────────────
  await guardarSecretoDelAparato(page, SECRETO_APARATO);
  const rotacionA = await rotarPorApi(RUT_OPERARIO_A, PIN_A);
  await page.goto(`${EN_A}/entrega?parada=${deA.entregas[0]!.id}`);
  await rotarEnElDisco(page, rotacionA.huella);
  await page.reload();
  await expect(page.getByTestId("parada-actual")).toContainText(deA.entregas[0]!.destino);
  await page.context().setOffline(true);

  // Las 3 mutaciones del centinela 9, sin una sola llamada que vuelva.
  for (const entrega of deA.entregas) {
    await expect(page.getByTestId("parada-actual")).toContainText(entrega.destino);
    await page.getByTestId("llegue").click();
    await page.getByTestId("entregado").click();
  }
  await expect(page.getByTestId("contador-cola")).toHaveText("3", { timeout: UNDO.ventana_ms * 3 });
  expect(
    (await capturasAterrizadas(idsDeA)).length,
    "sin señal no aterrizó ninguna, que es el punto de partida del caso",
  ).toBe(0);

  const soloA = await outboxEnElDisco(page);
  expect(Object.values(soloA), "las 3 de A viven en UNA partición del disco").toEqual([3]);
  const llaveDeA = Object.keys(soloA)[0]!;

  // ── B rota por PIN en el MISMO aparato, EN EL SERVIDOR — la página sigue sin red ──
  const rotacionB = await rotarPorApi(RUT_OPERARIO_B, PIN_B);
  expect(rotacionB.huella, "cada pareja (aparato, operario) tiene su propia huella").not.toBe(rotacionA.huella);

  // La fila de A en `sesiones_anden` se cerró EN EL MISMO ACTO en que se abrió la de B
  // (`servidor/anden.ts::rotarIdentidad`) — la mitad servidor del §5.4 F-D.
  const [filaA] = await con(BD_A, (c: Conexion) =>
    c.sql<{ cerrada: string | null }>(
      "select cerrada_en::text as cerrada from sesiones_anden where huella = $1",
      [rotacionA.huella],
    ),
  );
  expect(filaA!.cerrada, "la identidad anterior se cierra al abrir la nueva").not.toBeNull();

  // El aparato, todavía offline, recibe la huella nueva: autenticarse otra identidad no purga
  // el outbox de A — el §4.7 con todas las letras.
  await rotarEnElDisco(page, rotacionB.huella);
  expect(
    (await outboxEnElDisco(page))[llaveDeA],
    "autenticarse otra identidad no purga el outbox: las 3 de A siguen enteras (§4.7)",
  ).toBe(3);

  // ── Vuelve la red y B empieza SU ruta: el snapshot es lo único que se re-descarga ──
  await page.context().setOffline(false);
  await page.goto(`${EN_A}/entrega?parada=${deB.entregas[0]!.id}`);
  await expect(page.getByTestId("parada-actual")).toContainText(deB.entregas[0]!.destino);

  // Nadie toca la pantalla: el replay de la partición ajena es del aparato, no del operario.
  await expect
    .poll(async () => (await capturasAterrizadas(idsDeA)).length, {
      message: "centinela 9: las 3 capturas de A tienen que existir en el servidor (§4.7)",
      timeout: 20_000,
    })
    .toBe(3);

  // Y B no heredó la ruta de A: lo purgado es SOLO el snapshot, y el contador que ve es el suyo.
  expect(
    await capturasAterrizadas(idsDeB),
    "las paradas de A no se le anotaron a la ruta que B está caminando",
  ).toEqual([]);
  await expect(page.getByTestId("contador-paradas")).toContainText("de 3");
  await expect(page.getByTestId("por-sincronizar")).toHaveCount(0);

  // ── Firmadas por el ENROLAMIENTO de A (§4.7): el mismo aparato para los dos, pero el
  // actor tiene que seguir siendo quien capturó y no quien hizo de cartero. ──────────
  const filas = await capturasAterrizadas(idsDeA);
  for (const fila of filas) {
    expect(fila.dispositivo, "andén: el aparato es EL MISMO para las dos identidades").toBe(dispositivoId);
    expect(fila.actor, "y el actor es quien capturó, no quien transmitió (§4.7)").toBe(usuarios.a);
    expect(fila.actor).not.toBe(usuarios.b);
  }

  // La partición de A queda vacía porque sus capturas están en el servidor —no borrada: la
  // llave sigue ahí, y sigue siendo suya (§4.7: jamás se purga).
  const alFinal = await outboxEnElDisco(page);
  expect(alFinal[llaveDeA], "la llave de A no desaparece del disco; se vacía porque aterrizó").toBe(0);
});
