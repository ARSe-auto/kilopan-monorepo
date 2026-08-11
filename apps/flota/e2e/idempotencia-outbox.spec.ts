import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Idempotencia del outbox [AC-FPOD-04] — §0, §4.2, §4.6, §4.7, §9.3 centinela 1.
//
// DOS CONTRATOS DISTINTOS, Y CADA UNO CON SU MECANISMO:
//
// (1) CUALQUIER mutación de captura viaja con `client_uuid` y `UNIQUE(tenant_id, client_uuid)`
//     + `ON CONFLICT DO NOTHING` la protege (§0). El outbox manda la MISMA captura dos veces por
//     diseño —replay-on-startup al arrancar la app con lo que quedó pendiente, y replay-on-online
//     al volver la señal (§4.7)— y el servidor tiene que verse como si hubiera pasado una sola
//     vez: centinela 1 del §9.3, «replay doble de CUALQUIER mutación ⇒ count(*)=1 por
//     client_uuid». Acá se ejerce contra el endpoint de sync del POD (`/api/sync/capturas`).
//
// (2) Al aterrizar en `reading` rige ADEMÁS la idempotencia DOBLE del §4.6: `client_uuid` Y
//     (instrumento, sensor, ts_dispositivo). La segunda llave existe para el caso donde no hay
//     `client_uuid` que comparar —el archivo de un logger reimportado— o donde dos reintentos del
//     MISMO instrumento llegan con client_uuid distinto. La tabla `instrument` es VIVA en E1
//     (§4.9) y este AC la ejerce con un instrumento sintético.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = rutDeFixture(11);
const SECRETO = secretoNuevo();
const comoChofer = { Authorization: `Portador ${SECRETO}` };

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien manda la cola dos veces') returning id::text as id",
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

/** Cuántos eventos aterrizaron con este `client_uuid`. Es el conteo del centinela 1: la fila,
 *  no la impresión de la pantalla. */
async function eventosPorClientUuid(clientUuid: string): Promise<number> {
  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from eventos where client_uuid = $1", [clientUuid]),
  );
  return Number(fila!.n);
}

/** Filas de `reading` para un (instrumento, sensor) dado, contadas en la BD. */
async function filasDeInstrumento(instrumentoId: string, sensor: string): Promise<number> {
  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      "select count(*)::text as n from reading where instrumento_id = $1 and sensor = $2",
      [instrumentoId, sensor],
    ),
  );
  return Number(fila!.n);
}

test("[AC-FPOD-04] centinela 1: replay DOBLE de la MISMA captura del POD ⇒ exactamente 1 fila", async ({
  request,
}) => {
  const clientUuid = randomUUID();
  // El objeto físico de la captura —la parada— no hace falta que exista: `eventos.objeto_id` no
  // lleva FK (§4.6, el mundo físico ya ocurrió) y lo único que este test mide es la idempotencia
  // de la LLAVE, no el contenido de la variante.
  const captura = {
    client_uuid: clientUuid,
    parada_id: randomUUID(),
    ts_dispositivo: new Date().toISOString(),
    tz_offset_min: -240,
    resultado: "exito",
    metodo_entrega: "receptor",
    motivo_id: null,
    items: null,
    evidencias: [],
  };

  // replay-on-startup: la app arranca con esto pendiente de la sesión anterior y lo manda.
  const primera = await request.post("/api/sync/capturas", {
    headers: comoChofer,
    data: { capturas: [captura] },
  });
  expect(primera.status()).toBe(200);
  const primeraAcuse = (await primera.json()).acuses[0];
  expect(primeraAcuse.aceptada).toBe(true);
  expect(primeraAcuse.repetida, "la primera vez tiene que ser nueva, o el test no prueba nada").toBe(
    false,
  );
  expect(await eventosPorClientUuid(clientUuid)).toBe(1);

  // replay-on-online: vuelve la señal y el MISMO lote —el outbox del cliente todavía no la sacó
  // de la cola, porque el acuse del primer viaje se pudo perder en el camino— se manda de nuevo.
  const segunda = await request.post("/api/sync/capturas", {
    headers: comoChofer,
    data: { capturas: [captura] },
  });
  expect(segunda.status()).toBe(200);
  const segundaAcuse = (await segunda.json()).acuses[0];
  expect(segundaAcuse.aceptada).toBe(true);
  expect(segundaAcuse.repetida, "el replay-on-online tiene que ver «ya estaba», no crear de nuevo").toBe(
    true,
  );

  // Centinela 1 (§9.3): replay doble de CUALQUIER mutación ⇒ count(*)=1 por client_uuid.
  expect(await eventosPorClientUuid(clientUuid), "centinela 1: el replay doble duplicó el hecho").toBe(1);
});

test("[AC-FPOD-04] idempotencia DOBLE de `reading`: dos client_uuid distintos y el MISMO (instrumento, sensor, ts_dispositivo) ⇒ exactamente 1 fila", async ({
  request,
}) => {
  const [instrumento] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "insert into instrument (codigo, descripcion) values ($1, $2) returning id::text as id",
      [`sonda-ac-fpod-04-${randomUUID()}`, "Instrumento sintético de AC-FPOD-04"],
    ),
  );
  const sensor = "temperatura-1";
  const tsDispositivo = new Date().toISOString();

  const cuerpo = (clientUuid: string) => ({
    magnitud: "odometro",
    valor: 88_888,
    turno_id: null,
    client_uuid: clientUuid,
    ts_dispositivo: tsDispositivo,
    tz_offset_min: -240,
    instrumento_id: instrumento!.id,
    sensor,
  });

  const primera = await request.post("/api/lecturas", {
    headers: comoChofer,
    data: cuerpo(randomUUID()),
  });
  expect(primera.status()).toBe(201);
  const idPrimera = (await primera.json()).lectura.id;
  expect(await filasDeInstrumento(instrumento!.id, sensor)).toBe(1);

  // OTRO client_uuid a propósito: el §4.6 dice que la segunda llave cubre justo el caso donde no
  // hay un client_uuid en común —el archivo de un logger reimportado, o dos reintentos del mismo
  // instrumento con identificadores de outbox distintos.
  const segunda = await request.post("/api/lecturas", {
    headers: comoChofer,
    data: cuerpo(randomUUID()),
  });
  // 200 y no 201: el client_uuid es nuevo, pero la tripleta (instrumento, sensor, ts_dispositivo)
  // ya estaba, y es ELLA la que manda acá — no el client_uuid del outbox.
  expect(segunda.status()).toBe(200);
  const repetida = (await segunda.json()).lectura;
  expect(repetida.id, "la tripleta no evitó la segunda fila").toBe(idPrimera);
  expect(repetida.repetida).toBe(true);

  expect(
    await filasDeInstrumento(instrumento!.id, sensor),
    "idempotencia DOBLE: dos client_uuid distintos con la misma tripleta dejaron 2 filas",
  ).toBe(1);
});
