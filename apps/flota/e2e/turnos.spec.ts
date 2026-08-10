import { test, expect } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { limpiarFixture } from "./limpiar.mjs";

// La apertura del vehículo-día, por HTTP [AC-FVEH-06] — §4.5, §5.2-F3, §9.3 centinela 5.
//
// LO QUE ESTE ARCHIVO PRUEBA Y EL pgTAP NO PUEDE: que el rebote del EXCLUDE llegue al cliente
// como un 422 TIPADO con mensaje en es-CL —y no como un 500 con «restricción violada», que a
// quien está de pie al lado del camión no le dice qué hacer— y que después del rebote no haya
// quedado ni una fila. El invariante de base (que el solape lo decida una restricción y no un
// `select` del servidor) vive en `db/flota/pgtap/0011_turnos.sql`.
//
// LÍMITE DECLARADO: solo la vía ONLINE. La pregunta 6 de la spec 02 sigue abierta —si la
// apertura pudiera ocurrir offline, un solape detectado recién al sincronizar tendría que
// elegir entre rebotar y entrar con flag— y nada de acá la prejuzga.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_DUENA = Object.keys(VALIDOS)[0]!;
const RUT_CONTRATANTE = Object.keys(VALIDOS)[5]!;
const SECRETO_DUENA = secretoNuevo();
const SECRETO_CONTRATANTE = secretoNuevo();

let vehiculoA = "";
let vehiculoB = "";
let vehiculoApagado = "";

async function enrolar(c: Conexion, rut: string, nombre: string, rol: string, secreto: string) {
  const [p] = await c.sql<{ id: string }>(
    "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
    [rut, nombre],
  );
  const [u] = await c.sql<{ id: string }>(
    `insert into usuarios (persona_id, rol, empresa_cliente_id)
     values ($1, $2::rol_usuario, case when $2 = 'cliente' then gen_random_uuid() end)
     returning id::text as id`,
    [p!.id, rol],
  );
  await c.sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
     values ('personal', $1, $2, $3, now(), true, true)`,
    [p!.id, hashDeSecreto(secreto), u!.id],
  );
}

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    // El orden lo dictan las FK, no el gusto, y vive en `limpiar.mjs`: acá se pedía a mano y
    // la suite se ponía roja cada vez que el módulo estrenaba una tabla.
    await limpiarFixture(c.sql);

    await enrolar(c, RUT_DUENA, "Dueña", "admin_tenant", SECRETO_DUENA);
    await enrolar(c, RUT_CONTRATANTE, "Empresa contratante", "cliente", SECRETO_CONTRATANTE);

    const filas = await c.sql<{ id: string; patente: string }>(
      `insert into vehiculos (patente, tipo) values ('TRN0001', 'furgón'), ('TRN0002', 'furgón'),
                                                    ('TRN0003', 'furgón')
       returning id::text as id, patente`,
    );
    vehiculoA = filas.find((v) => v.patente === "TRN0001")!.id;
    vehiculoB = filas.find((v) => v.patente === "TRN0002")!.id;
    vehiculoApagado = filas.find((v) => v.patente === "TRN0003")!.id;
    await c.sql("update vehiculos set activo = false where id = $1", [vehiculoApagado]);
  });
});

const comoDuena = { Authorization: `Portador ${SECRETO_DUENA}` };
const comoContratante = { Authorization: `Portador ${SECRETO_CONTRATANTE}` };

const cuantosTurnos = () =>
  con(BD_A, (c: Conexion) => c.sql<{ n: string }>("select count(*)::text as n from turnos")).then(
    (r) => Number(r[0]!.n),
  );

/** Eventos de apertura acumulados. `eventos` es append-only (§7.4): no se puede vaciar y trae
 *  lo que dejaron las suites anteriores, así que la medición honesta es la DIFERENCIA. */
const aperturasRegistradas = () =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = 'turno.abierto'`,
    ),
  ).then((r) => Number(r[0]!.n));

test("[AC-FVEH-06] abrir la jornada deja el turno con su versión de config congelada", async ({ request }) => {
  const eventosAntes = await aperturasRegistradas();
  const r = await request.post("/api/turnos", { headers: comoDuena, data: { vehiculo_id: vehiculoA } });
  expect(r.status()).toBe(201);
  const { turno } = (await r.json()) as { turno: { id: string; estado: string; config_version_id: string } };
  expect(turno.estado).toBe("abierto");
  // El §4.4 con sujeto: el turno APUNTA a una versión, y esa versión existe en la base.
  expect(turno.config_version_id).toBeTruthy();

  const [v] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string; snapshot: string }>(
      "select count(*)::text as n, min(snapshot::text) as snapshot from config_version where id = $1",
      [turno.config_version_id],
    ),
  );
  expect(v!.n, "el turno apunta a una versión de config que no existe").toBe("1");
  // Y el snapshot NO nació vacío: trae los entitlements leídos del plano de control. Un `{}`
  // se ve igual que «todas las features apagadas», y mañana alguien leería que este turno
  // corrió sin un módulo que sí tenía.
  expect(JSON.parse(v!.snapshot).entitlements, "el snapshot se selló sin entitlements").toBeTruthy();

  expect(
    (await aperturasRegistradas()) - eventosAntes,
    "la apertura no dejó su evento",
  ).toBe(1);
});

test("[AC-FVEH-06] el segundo turno del MISMO vehículo rebota 422 y no deja ni una fila", async ({ request }) => {
  const antes = await cuantosTurnos();
  const r = await request.post("/api/turnos", { headers: comoDuena, data: { vehiculo_id: vehiculoA } });
  expect(r.status(), "el solape tiene que rebotar, no crear una segunda jornada").toBe(422);
  const cuerpo = (await r.json()) as { error: string; mensaje: string };
  expect(cuerpo.error).toBe("turno_solapado");
  // El mensaje dice QUÉ HACER. Quien lo lee está de pie al lado del camión a las cinco de la
  // mañana: «restricción violada» lo deja parado.
  expect(cuerpo.mensaje).toContain("cerrarla");
  expect(await cuantosTurnos(), "el rebote dejó una fila: el 422 tiene que ser de 0 filas").toBe(antes);
});

test("[AC-FVEH-06] otro vehículo abre su jornada a la misma hora sin estorbar", async ({ request }) => {
  // La mitad sin la cual «el solape rebota» se cumpliría con una regla que prohíbe cualquier
  // segundo turno, y la flota entera trabajaría de a un camión por día.
  const r = await request.post("/api/turnos", { headers: comoDuena, data: { vehiculo_id: vehiculoB } });
  expect(r.status()).toBe(201);
  expect(await cuantosTurnos()).toBe(2);
});

test("[AC-FVEH-06] un vehículo desactivado no abre jornada", async ({ request }) => {
  const antes = await cuantosTurnos();
  const r = await request.post("/api/turnos", {
    headers: comoDuena,
    data: { vehiculo_id: vehiculoApagado },
  });
  expect(r.status()).toBe(422);
  // La desactivación del §5.4 saca al vehículo de la operación; dejarlo abrir turnos igual
  // vaciaría ese acto del dueño de todo contenido.
  expect((await r.json()).error).toBe("vehiculo_inactivo");
  expect(await cuantosTurnos()).toBe(antes);
});

test("[AC-FVEH-06] la empresa contratante no abre turnos: 403 y CERO filas", async ({ request }) => {
  const antes = await cuantosTurnos();
  const r = await request.post("/api/turnos", {
    headers: comoContratante,
    data: { vehiculo_id: vehiculoB },
  });
  // `cliente` es la empresa CONTRATANTE (§4.3): mira su portal y no opera vehículos. Un turno
  // suyo le sumaría al denominador de la EEVD (§2) una jornada que nadie trabajó.
  expect(r.status()).toBe(403);
  expect((await r.json()).error).toBe("rol_sin_turno");
  expect(await cuantosTurnos()).toBe(antes);
});

// ─── Cierre forzado del turno que quedó abierto [AC-FVEH-22] — KR-41, §5.6 ──────────
//
// Hasta este AC el semáforo detectaba el turno sin cerrar sin que existiera acción alguna que
// lo resolviera: un rojo sin salida, contra el contrato del §5.6 de que la cola tiende a cero
// cada día.
//
// LO QUE SE VERIFICA, y el orden importa porque cada caso deja el terreno para el siguiente:
// el rebote sin motivo y con motivo desconocido, el cierre que SÍ ocurre y deja su rastro, que
// NO alimente la proyección del vehículo (KR-41 literal: «sin alimentar monotonicidad»), que
// resuelva la fila de «Por revisar», que el segundo intento rebote, y que los roles del terreno
// no puedan hacerlo.

const MOTIVO = "olvido_de_cierre";

/** Un turno abierto propio, para no depender del que dejaron los tests de arriba. */
async function turnoAbiertoPropio(patente: string) {
  return con(BD_A, async (c: Conexion) => {
    const [v] = await c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ($1, 'furgón') returning id::text as id",
      [patente],
    );
    const [cv] = await c.sql<{ id: string }>(
      "select id::text as id from config_version order by id desc limit 1",
    );
    const [t] = await c.sql<{ id: string }>(
      "insert into turnos (vehiculo_id, config_version_id) values ($1, $2) returning id::text as id",
      [v!.id, cv!.id],
    );
    return { vehiculoId: v!.id, turnoId: t!.id };
  });
}

test("[AC-FVEH-22] sin motivo, o con un motivo que no está en el catálogo, rebota 422", async ({
  request,
}) => {
  const { turnoId } = await turnoAbiertoPropio("KR410001");

  const sinMotivo = await request.post(`/api/turnos/${turnoId}/cierre-forzado`, {
    headers: comoDuena,
    data: {},
  });
  expect(sinMotivo.status()).toBe(422);
  expect((await sinMotivo.json()).error).toBe("sin_motivo");

  // El motivo es TIPADO, del catálogo del tenant (§4.5): un texto libre llenaría la bandeja de
  // explicaciones que no se pueden agrupar ni contar.
  const inventado = await request.post(`/api/turnos/${turnoId}/cierre-forzado`, {
    headers: comoDuena,
    data: { motivo: "porque si" },
  });
  expect(inventado.status()).toBe(422);
  expect((await inventado.json()).error).toBe("motivo_desconocido");

  // Y el turno sigue abierto: 422 con 0 filas.
  const [t] = await con(BD_A, (c: Conexion) =>
    c.sql<{ estado: string }>("select estado::text as estado from turnos where id = $1", [turnoId]),
  );
  expect(t!.estado).toBe("abierto");
});

test("[AC-FVEH-22] con motivo del catálogo cierra, deja rastro y NO toca la proyección", async ({
  request,
}) => {
  const { vehiculoId, turnoId } = await turnoAbiertoPropio("KR410002");
  await con(BD_A, async (c: Conexion) => {
    await c.sql(
      `insert into motivos (codigo, etiqueta, estado_asociado) values ($1, 'Se olvidó de cerrar', 'turno_cerrado_forzado')
       on conflict (tenant_id, codigo) do nothing`,
      [MOTIVO],
    );
    // La fila de «Por revisar» que el semáforo habría abierto por el turno sin cerrar (§5.6).
    await c.sql(
      "insert into review_queue (origen, severidad, nota) values ('turno_sin_cerrar', 'media', 'turno abierto cruzando medianoche')",
    );
  });

  const r = await request.post(`/api/turnos/${turnoId}/cierre-forzado`, {
    headers: comoDuena,
    data: { motivo: MOTIVO, nota: "el chofer entregó el vehículo y se fue" },
  });
  expect(r.status()).toBe(200);
  expect((await r.json()).estado).toBe("cerrado_forzado");

  const [t] = await con(BD_A, (c: Conexion) =>
    c.sql<{ estado: string; motivo: string | null; odometro: string | null; soc: string | null }>(
      `select t.estado::text as estado, t.cierre_motivo_id::text as motivo,
              v.odometro::text as odometro, v.soc::text as soc
         from turnos t join vehiculos v on v.id = t.vehiculo_id where t.id = $1`,
      [turnoId],
    ),
  );
  // Estado PROPIO, distinguible de un cierre real: el módulo de liquidación cobra sobre esto.
  expect(t!.estado).toBe("cerrado_forzado");
  expect(t!.motivo, "el cierre forzado quedó sin motivo").toBeTruthy();
  // KR-41 literal: «sin alimentar monotonicidad». Inventarle un kilometraje a un turno que
  // nadie cerró sería exactamente el dato falso que la proyección existe para no tener.
  expect(t!.odometro, "el cierre forzado movió el odómetro").toBeNull();
  expect(t!.soc, "el cierre forzado movió la carga").toBeNull();

  // Y no escribió NINGUNA lectura para ese vehículo.
  const [l] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      `select count(*)::text as n from reading r join turnos t on t.id = r.turno_id
        where t.vehiculo_id = $1`,
      [vehiculoId],
    ),
  );
  expect(Number(l!.n), "el cierre forzado escribió una lectura").toBe(0);

  // Resuelve la fila de «Por revisar» que originó la señal (§5.6): sin esto, el rojo seguiría
  // ahí después de haberlo arreglado y la cola dejaría de tender a cero.
  const [rq] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      "select count(*)::text as n from review_queue where origen = 'turno_sin_cerrar' and estado <> 'resuelta'",
    ),
  );
  expect(Number(rq!.n), "el rojo del semáforo quedó sin resolver").toBe(0);

  // Y su evento append-only, distinguible de una apertura.
  const [e] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = 'turno.cerrado_forzado'`,
    ),
  );
  expect(Number(e!.n)).toBeGreaterThan(0);

  // El SEGUNDO cierre forzado sobre el mismo turno rebota con 0 filas: no es idempotencia
  // amable, es planificación — repetirla significaría que alguien creyó que el primero no
  // había ocurrido.
  const otra = await request.post(`/api/turnos/${turnoId}/cierre-forzado`, {
    headers: comoDuena,
    data: { motivo: MOTIVO },
  });
  expect(otra.status()).toBe(422);
  expect((await otra.json()).error).toBe("ya_no_esta_abierto");
});

test("[AC-FVEH-22] los roles del terreno no cierran por la fuerza: 403 y CERO filas", async ({
  request,
}) => {
  const { turnoId } = await turnoAbiertoPropio("KR410003");
  const antes = await cuantosTurnos();

  // `cliente` es el único rol del enum con sesión propia que este fixture tiene además del
  // dueño; los otros del terreno rebotan por la misma guardia y el mismo camino.
  const r = await request.post(`/api/turnos/${turnoId}/cierre-forzado`, {
    headers: comoContratante,
    data: { motivo: MOTIVO },
  });
  expect(r.status()).toBe(403);
  expect((await r.json()).error).toBe("rol_sin_cierre_forzado");

  const [t] = await con(BD_A, (c: Conexion) =>
    c.sql<{ estado: string }>("select estado::text as estado from turnos where id = $1", [turnoId]),
  );
  expect(t!.estado, "el rebote por rol igual cerró el turno").toBe("abierto");
  expect(await cuantosTurnos()).toBe(antes);
});
