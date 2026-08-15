import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { UNDO } from "../../../packages/nucleo-comun/src/constants.ts";
import { PUERTO_E2E } from "./puerto.ts";

// Outbox particionado por (tenant, usuario) y JAMÁS purgado [AC-FPOD-09] — §4.7, centinela 9
// (§9.3), §4.6.
//
// EL CASO, TAL COMO EL §4.7 LO ESCRIBE: A captura 3 mutaciones sin señal → otra identidad se
// autentica en el MISMO dispositivo → vuelve la red → las 3 filas de A existen (count=3),
// firmadas por el enrolamiento.
//
// Lo que el unitario (`cliente/outbox-multiusuario.test.ts`) NO puede probar y por eso este
// archivo existe:
//
//   (a) que el aparato de verdad guarde las capturas de A bajo una llave que el `setItem` de B no
//       pise. En el unitario el almacén es un `Map` de tres líneas; acá es el `localStorage` real
//       del navegador, con la app entera escribiendo encima.
//   (b) que las 3 filas ATERRICEN en `eventos` —el orden autoritativo del §4.6— y no que «el
//       cliente las mandó». La diferencia entre vaciar la cola y borrarla es la que se cuenta en
//       la BD (mismo criterio que AC-FPOD-03).
//   (c) que lo purgado sea SOLO el snapshot: B abre su ruta re-descargada y no ve ni una parada
//       de A en su contador, mientras las capturas de A siguen en el disco hasta que salen.
//   (d) que las 3 queden FIRMADAS POR EL ENROLAMIENTO de A (§4.7) y no por el de B, que fue quien
//       las transmitió. Sin esa aserción, «las 3 filas existen» se cumpliría con las tres entregas
//       de A anotadas a nombre de B — y la liquidación del §3.E1.9, que nace de la evidencia, le
//       pagaría al que solo prestó el teléfono.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

/** Dos choferes PROPIOS de esta suite: el §4.3 admite un dispositivo personal activo por
 *  operario, así que compartir persona con otra suite es que la segunda no pueda enrolar. */
const RUT_CHOFER_A = rutDeFixture(16);
const RUT_CHOFER_B = rutDeFixture(17);
const RUT_PANADERIA = rutDeFixture(6);

const SECRETO_A = secretoNuevo();
const SECRETO_B = secretoNuevo();

/** Los dos aparatos son EL MISMO teléfono: mismo contexto de navegador, mismo `localStorage`.
 *  Lo que cambia entre A y B es la credencial guardada en IndexedDB, que es exactamente lo que
 *  «autenticarse otra identidad en el mismo dispositivo» significa (§4.7). */
const aparatoDe = new Map<string, { usuarioId: string; dispositivoId: string }>();

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    for (const [rut, nombre, secreto] of [
      [RUT_CHOFER_A, "Quien capturó y ya no vuelve", SECRETO_A],
      [RUT_CHOFER_B, "Quien se autentica después en el mismo teléfono", SECRETO_B],
    ] as const) {
      const [p] = await c.sql<{ id: string }>(
        "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
        [rut, nombre],
      );
      const [u] = await c.sql<{ id: string }>(
        "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
        [p!.id],
      );
      const [d] = await c.sql<{ id: string }>(
        `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
         values ('personal', $1, $2, $3, now(), true, true)
         returning id::text as id`,
        [p!.id, hashDeSecreto(secreto), u!.id],
      );
      aparatoDe.set(secreto, { usuarioId: u!.id, dispositivoId: d!.id });
    }
  });
});

/**
 * El enrolamiento inicial del teléfono: escribe el secreto UNA vez, como `guardarSecreto`
 * (`cliente/aparato.ts`) el día que se aprueba el aparato. «Una vez» importa: este script corre
 * en cada navegación, y sobrescribir siempre haría que la recarga con la que B empieza su turno
 * resucitara la credencial de A y el caso no probara nada.
 */
async function enrolar(page: Page, secreto: string) {
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

/** Otra identidad se autentica en ESTE MISMO aparato (§4.7): su otorgamiento de sesión trae un
 *  secreto nuevo que sobrescribe el único registro que `cliente/aparato.ts` mantiene. Sin red:
 *  acá solo se ejerce lo que ese `guardarSecreto` deja en el disco. */
async function autenticarOtraIdentidad(page: Page, secreto: string) {
  await page.evaluate(
    (s) =>
      new Promise<void>((res) => {
        const r = indexedDB.open("flota-aparato", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("claves");
        r.onsuccess = () => {
          const tx = r.result
            .transaction("claves", "readwrite")
            .objectStore("claves")
            .put(s, "secreto-de-sesion");
          tx.onsuccess = () => res();
          tx.onerror = () => res();
        };
      }),
    secreto,
  );
}

/** Una ruta con su carga y tres entregas, todas con el sub-manifiesto ya confirmado. */
async function rutaDeTresEntregas(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del teléfono compartido')
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

/** Las capturas que de verdad aterrizaron, con el aparato al que quedaron firmadas (§4.6). */
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

/** Lo que hay en el disco del teléfono para el outbox del POD: una llave por identidad
 *  (`cliente/outbox-local.ts`), que es lo que hace imposible que un `setItem` pise al otro. */
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

test("[AC-FPOD-09] centinela 9: A captura 3 sin señal, B se autentica en el mismo aparato y las 3 de A aterrizan firmadas por el enrolamiento de A", async ({
  page,
}) => {
  const deA = await rutaDeTresEntregas("la ruta del que prestó el teléfono");
  const deB = await rutaDeTresEntregas("la ruta del que llegó después");
  const idsDeA: string[] = deA.entregas.map((e: { id: string }) => e.id);
  const idsDeB: string[] = deB.entregas.map((e: { id: string }) => e.id);

  // ── A sale a la calle con su ruta en la mano y se le corta la señal ────────────────
  await enrolar(page, SECRETO_A);
  await page.goto(`${EN_A}/entrega?parada=${deA.entregas[0]!.id}`);
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

  // ── Otra identidad se autentica en el MISMO teléfono, todavía sin red ──────────────
  await autenticarOtraIdentidad(page, SECRETO_B);
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

  // ── Firmadas por el enrolamiento (§4.7), no por quien hizo de cartero ──────────────
  const filas = await capturasAterrizadas(idsDeA);
  const aparatoA = aparatoDe.get(SECRETO_A)!;
  const aparatoB = aparatoDe.get(SECRETO_B)!;
  for (const fila of filas) {
    expect(fila.dispositivo, "el hecho se firma con el aparato que capturó (§4.7)").toBe(
      aparatoA.dispositivoId,
    );
    expect(fila.actor, "y con su operario: la entrega de A no es de B").toBe(aparatoA.usuarioId);
    expect(fila.dispositivo).not.toBe(aparatoB.dispositivoId);
  }

  // La partición de A queda vacía porque sus capturas están en el servidor —no borrada: la llave
  // sigue ahí, y sigue siendo suya (§4.7: jamás se purga).
  const alFinal = await outboxEnElDisco(page);
  expect(alFinal[llaveDeA], "la llave de A no desaparece del disco; se vacía porque aterrizó").toBe(0);
});

test("[AC-FPOD-09] las dos identidades capturan en el mismo teléfono y ninguna pisa a la otra: 3 de A + 1 de B", async ({
  page,
}) => {
  // La otra mitad de «particionado»: no alcanza con que lo de A sobreviva a B — lo de B tiene que
  // sobrevivir a que el aparato esté vaciando la cola de A al mismo tiempo, y cada hecho tiene
  // que aterrizar con SU dueño. Con una llave única por aparato (lo que había antes de este AC)
  // el segundo `setItem` se lleva puesto el primero y una de las dos colas no existe más.
  const deA = await rutaDeTresEntregas("la ruta de A en el teléfono compartido");
  const deB = await rutaDeTresEntregas("la ruta de B en el teléfono compartido");
  const idsDeA: string[] = deA.entregas.map((e: { id: string }) => e.id);

  await enrolar(page, SECRETO_A);
  await page.goto(`${EN_A}/entrega?parada=${deA.entregas[0]!.id}`);
  await expect(page.getByTestId("parada-actual")).toContainText(deA.entregas[0]!.destino);
  await page.context().setOffline(true);
  for (const entrega of deA.entregas) {
    await expect(page.getByTestId("parada-actual")).toContainText(entrega.destino);
    await page.getByTestId("llegue").click();
    await page.getByTestId("entregado").click();
  }
  await expect(page.getByTestId("contador-cola")).toHaveText("3", { timeout: UNDO.ventana_ms * 3 });

  // B se autentica y captura LO SUYO, todavía sin señal: dos colas vivas en el mismo disco.
  await autenticarOtraIdentidad(page, SECRETO_B);
  await page.context().setOffline(false);
  await page.goto(`${EN_A}/entrega?parada=${deB.entregas[0]!.id}`);
  await expect(page.getByTestId("parada-actual")).toContainText(deB.entregas[0]!.destino);

  await expect
    .poll(async () => (await capturasAterrizadas(idsDeA)).length, { timeout: 20_000 })
    .toBe(3);

  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();
  await expect
    .poll(async () => (await capturasAterrizadas([deB.entregas[0]!.id])).length, { timeout: 20_000 })
    .toBe(1);

  // Cada hecho con su dueño: 3 firmadas por el aparato de A y 1 por el de B.
  const aparatoA = aparatoDe.get(SECRETO_A)!;
  const aparatoB = aparatoDe.get(SECRETO_B)!;
  const deAEnLaBase = await capturasAterrizadas(idsDeA);
  const [deBEnLaBase] = await capturasAterrizadas([deB.entregas[0]!.id]);
  expect(deAEnLaBase.map((f: { dispositivo: string }) => f.dispositivo)).toEqual([
    aparatoA.dispositivoId,
    aparatoA.dispositivoId,
    aparatoA.dispositivoId,
  ]);
  expect(deBEnLaBase!.dispositivo, "y la de B es de B: la firma no se contagia del lote anterior").toBe(
    aparatoB.dispositivoId,
  );
});
