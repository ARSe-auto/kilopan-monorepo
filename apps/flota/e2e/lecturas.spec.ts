import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { SOC, RELOJ } from "../../../packages/nucleo-comun/src/constants.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { limpiarFixture } from "./limpiar.mjs";

// La captura de odómetro y SOC, por HTTP [AC-FVEH-05] — §4.2, §4.6, §0, §9.3 centinela 4.
//
// LO QUE ESTE ARCHIVO MIDE Y NINGÚN OTRO: **rechazos = 0**. El centinela 4 no se conforma con
// «las cosas raras se marcan»: pide que TODA captura degradada entre con 2xx, deje su fila, su
// flag, su evento y su fila en «Por revisar». Un 422 acá no le devuelve el dato al chofer, se
// lo borra — la persona ya miró el tablero y ya tecleó lo que vio.
//
// El invariante de base —que la proyección la mueva el trigger y nadie más, y que el acotado
// del SOC ocurra en la proyección y no en la serie— vive en
// `db/flota/pgtap/0012_proyeccion_de_lecturas.sql`.
//
// `reading`, `eventos` y `audit_trail` son append-only (§7.4): no se pueden vaciar, así que
// todo lo que este archivo cuenta se mide por DIFERENCIA.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = Object.keys(VALIDOS)[3]!;
const SECRETO = secretoNuevo();
const comoChofer = { Authorization: `Portador ${SECRETO}` };

/** Un desfase de reloj que se pasa con holgura del tolerado por el §0. Se deriva de la familia
 *  canónica: escrito literal, este archivo sería él mismo una copia del umbral. */
const fueraDeTolerancia = (RELOJ.drift_max_minutos + 10) * 60 * 1000;

let turnoId = "";
const patente = "LEC0001";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien maneja') returning id::text as id",
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

    const [v] = await c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ($1, 'furgón') returning id::text as id",
      [patente],
    );
    const [cv] = await c.sql<{ id: string }>("select crear_config_version($1)::text as id", [
      "fixture de lecturas",
    ]);
    const [t] = await c.sql<{ id: string }>(
      "insert into turnos (vehiculo_id, config_version_id) values ($1, $2) returning id::text as id",
      [v!.id, cv!.id],
    );
    turnoId = t!.id;
  });
});

/** Lo que el vehículo tiene proyectado ahora mismo, leído de la base y no de la respuesta. */
const proyeccion = () =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ odometro: string | null; soc: string | null }>(
      "select odometro::text as odometro, soc::text as soc from vehiculos where patente = $1",
      [patente],
    ),
  ).then((r) => r[0]!);

/** Filas de `reading`, eventos de lectura y filas de revisión abiertas por lecturas. */
const rastro = () =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ lecturas: string; eventos: string; revisiones: string }>(
      `select (select count(*)::text from reading) as lecturas,
              (select count(*)::text from eventos e join evento_tipo t on t.id = e.tipo_id
                where t.codigo like 'lectura.%') as eventos,
              (select count(*)::text from review_queue where origen like 'lectura.%') as revisiones`,
    ),
  ).then((r) => r[0]!);

const cuerpoBase = (extra: Record<string, unknown>) => ({
  turno_id: turnoId,
  client_uuid: randomUUID(),
  ts_dispositivo: new Date().toISOString(),
  ...extra,
});

test("[AC-FVEH-05] una lectura sana entra, proyecta y no abre revisión", async ({ request }) => {
  const antes = await rastro();
  const r = await request.post("/api/lecturas", {
    headers: comoChofer,
    data: cuerpoBase({ magnitud: "odometro", valor: 120_000 }),
  });
  expect(r.status()).toBe(201);
  const { lectura } = (await r.json()) as { lectura: { flags: string[]; proyeccion: { odometro: number } } };
  expect(lectura.flags).toEqual([]);
  // La respuesta trae la proyección para que el aparato la muestre sin volver a preguntar.
  expect(lectura.proyeccion.odometro).toBe(120_000);
  expect((await proyeccion()).odometro).toBe("120000");

  const despues = await rastro();
  expect(Number(despues.lecturas) - Number(antes.lecturas)).toBe(1);
  // Una lectura sana deja su evento y NADA en la bandeja: si cada captura abriera una fila de
  // revisión, «Por revisar» sería la lista de todo lo que pasó y nadie la miraría (§5.6).
  expect(Number(despues.eventos) - Number(antes.eventos)).toBe(1);
  expect(Number(despues.revisiones) - Number(antes.revisiones)).toBe(0);
});

test("[AC-FVEH-05] un SOC fuera de rango entra 2xx, la serie lo guarda y la proyección queda acotada", async ({
  request,
}) => {
  const antes = await rastro();
  const declarado = SOC.maximo + 50;
  const r = await request.post("/api/lecturas", {
    headers: comoChofer,
    data: cuerpoBase({ magnitud: "soc", valor: declarado }),
  });
  // El centinela 4, con número: rechazos = 0. Un 422 acá le borraría al chofer el único
  // registro que existe de lo que vio en el tablero.
  expect(r.status(), "una captura fuera de rango NO puede rebotar (§4.2)").toBe(201);
  const { lectura } = (await r.json()) as { lectura: { flags: string[]; proyeccion: { soc: number } } };
  expect(lectura.flags).toContain("soc_fuera_de_rango");
  expect(lectura.proyeccion.soc).toBe(SOC.maximo);

  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ valor: string }>(
      `select valor_int::text as valor from reading r join magnitud m on m.id = r.magnitud_id
        where m.codigo = 'soc' order by r.id desc limit 1`,
    ),
  );
  expect(fila!.valor, "la serie tiene que guardar lo DECLARADO, sin acotar").toBe(String(declarado));
  expect((await proyeccion()).soc, "la proyección tiene que quedar acotada").toBe(String(SOC.maximo));

  const despues = await rastro();
  expect(Number(despues.revisiones) - Number(antes.revisiones), "no abrió su fila «Por revisar»").toBe(1);
  // Dos eventos: la lectura y su flag. El flag por separado es lo que permite contar
  // incidentes de un tipo sin leer el payload de todas las lecturas.
  expect(Number(despues.eventos) - Number(antes.eventos)).toBe(2);
});

test("[AC-FVEH-05] un odómetro menor entra 2xx y la proyección no lo sigue", async ({ request }) => {
  const antes = await rastro();
  const r = await request.post("/api/lecturas", {
    headers: comoChofer,
    data: cuerpoBase({ magnitud: "odometro", valor: 12_000 }),
  });
  expect(r.status()).toBe(201);
  const { lectura } = (await r.json()) as { lectura: { flags: string[] } };
  expect(lectura.flags).toContain("odometro_retrocedido");
  // Monotonicidad SUAVE (§4.6): la fila entra, la proyección no retrocede. Un odómetro físico
  // no baja, así que un valor menor es casi siempre un dígito de menos tipeado en movimiento.
  expect((await proyeccion()).odometro).toBe("120000");
  expect(Number((await rastro()).revisiones) - Number(antes.revisiones)).toBe(1);
});

test("[AC-FVEH-05] un reloj corrido entra 2xx con su bandera", async ({ request }) => {
  const corrido = new Date(Date.now() - fueraDeTolerancia);
  const r = await request.post("/api/lecturas", {
    headers: comoChofer,
    data: cuerpoBase({ magnitud: "odometro", valor: 120_600, ts_dispositivo: corrido.toISOString() }),
  });
  expect(r.status()).toBe(201);
  const { lectura } = (await r.json()) as { lectura: { flags: string[] } };
  expect(lectura.flags).toContain("reloj_desfasado");
  // Y la lectura sirve igual: el teléfono puede tener la hora mal y el kilometraje bien.
  expect((await proyeccion()).odometro).toBe("120600");
});

test("[AC-FVEH-05] el replay del outbox devuelve la MISMA fila, sin duplicar nada", async ({ request }) => {
  const cuerpo = cuerpoBase({ magnitud: "soc", valor: 55 });
  const primera = await request.post("/api/lecturas", { headers: comoChofer, data: cuerpo });
  expect(primera.status()).toBe(201);
  const idPrimera = (await primera.json()).lectura.id;

  const antes = await rastro();
  const segunda = await request.post("/api/lecturas", { headers: comoChofer, data: cuerpo });
  // 200 y no 201: el reintento no creó nada, y decir 201 le haría creer al aparato que produjo
  // una segunda lectura. La idempotencia por `client_uuid` es la del outbox (§4.6).
  expect(segunda.status()).toBe(200);
  const repetida = (await segunda.json()).lectura;
  expect(repetida.id, "el replay devolvió otra fila").toBe(idPrimera);
  expect(repetida.repetida).toBe(true);

  const despues = await rastro();
  expect(Number(despues.lecturas) - Number(antes.lecturas), "el replay duplicó la lectura").toBe(0);
  // Y no repitió el aviso: una bandeja que cuenta tres veces un incidente que ocurrió una vez
  // deja de servir para priorizar.
  expect(Number(despues.eventos) - Number(antes.eventos)).toBe(0);
  expect(Number(despues.revisiones) - Number(antes.revisiones)).toBe(0);
});

test("[AC-FVEH-05] una lectura sin turno entra igual, con su bandera y sin proyectar", async ({ request }) => {
  const antes = await proyeccion();
  const r = await request.post("/api/lecturas", {
    headers: comoChofer,
    data: { ...cuerpoBase({ magnitud: "odometro", valor: 999_999 }), turno_id: null },
  });
  expect(r.status()).toBe(201);
  const { lectura } = (await r.json()) as { lectura: { flags: string[]; proyeccion: unknown } };
  expect(lectura.flags).toContain("sin_turno");
  expect(lectura.proyeccion).toBeNull();
  expect(await proyeccion(), "una lectura sin turno movió una proyección").toEqual(antes);
});

test("[AC-FVEH-05] rechazos = 0: ninguna de las capturas degradadas devolvió 4xx", async ({ request }) => {
  // El centinela 4 pide un NÚMERO, no una impresión. Se vuelven a mandar las cuatro
  // degradaciones juntas y se cuenta: cero respuestas 4xx sobre contenido del terreno.
  const degradadas = [
    { magnitud: "soc", valor: SOC.maximo + 1 },
    { magnitud: "soc", valor: SOC.minimo - 1 },
    { magnitud: "odometro", valor: 1 },
    {
      magnitud: "odometro",
      valor: 120_700,
      ts_dispositivo: new Date(Date.now() + fueraDeTolerancia).toISOString(),
    },
  ];
  let rechazos = 0;
  for (const datos of degradadas) {
    const r = await request.post("/api/lecturas", { headers: comoChofer, data: cuerpoBase(datos) });
    if (r.status() >= 400) rechazos++;
  }
  expect(rechazos, "el centinela 4 exige rechazos = 0 (§9.3.4)").toBe(0);
});

// ─── Máximo de capturas de carga por turno [AC-FVEH-19] ──────────────────────────────
//
// El §0 lo fija y el §4.2 dice dónde se valida: en el CLIENTE, contra el snapshot. Lo que
// llega de más por sync entra igual —es captura— con su flag y su fila en «Por revisar».
//
// CLÁUSULA CONDICIONADA por la pregunta 9 de la spec 02: acá se cuentan TODAS las capturas de
// carga del turno, que es la lectura literal del §0. Si el dueño responde que son tres
// ADICIONALES en ruta —sin contar apertura y cierre—, cambian juntos el conteo y este test.

test("[AC-FVEH-19] la captura de carga que pasa el máximo entra 2xx, con flag y revisión", async ({
  request,
}) => {
  // Turno propio, para contar desde cero sin depender de lo que hicieron los tests de arriba.
  const [v] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ('LEC0002', 'furgón') returning id::text as id",
    ),
  );
  const [cv] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>("select id::text as id from config_version order by id desc limit 1"),
  );
  const [t] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "insert into turnos (vehiculo_id, config_version_id) values ($1, $2) returning id::text as id",
      [v!.id, cv!.id],
    ),
  );

  // Las tres que el §0 permite: ninguna marca.
  for (let i = 0; i < SOC.capturas_max_por_turno; i++) {
    const r = await request.post("/api/lecturas", {
      headers: comoChofer,
      data: { ...cuerpoBase({ magnitud: "soc", valor: 50 + i }), turno_id: t!.id },
    });
    expect(r.status(), `la captura ${i + 1} no entró`).toBe(201);
    expect((await r.json()).lectura.flags, `la captura ${i + 1} marcó de más`).not.toContain(
      "exceso_de_soc",
    );
  }

  const antes = await rastro();
  const excedida = await request.post("/api/lecturas", {
    headers: comoChofer,
    data: { ...cuerpoBase({ magnitud: "soc", valor: 44 }), turno_id: t!.id },
  });
  // JAMÁS rebota (centinela 4): la persona ya miró el tablero y ya tecleó lo que vio.
  expect(excedida.status(), "una captura de más NO puede rebotar (§4.2)").toBe(201);
  expect((await excedida.json()).lectura.flags).toContain("exceso_de_soc");
  const despues = await rastro();
  expect(Number(despues.lecturas) - Number(antes.lecturas), "la captura de más no se guardó").toBe(1);
  expect(
    Number(despues.revisiones) - Number(antes.revisiones),
    "el exceso no abrió su fila «Por revisar»",
  ).toBe(1);
});

test("[AC-FVEH-19] el máximo es de CARGA: el odómetro no lo consume ni lo dispara", async ({ request }) => {
  // Sin esta mitad, contar todas las lecturas del turno haría que el cuarto odómetro del día
  // marcara un exceso de carga, y la bandeja se llenaría de un flag que no describe nada.
  const [t] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      `select t.id::text as id from turnos t join vehiculos v on v.id = t.vehiculo_id
        where v.patente = 'LEC0002'`,
    ),
  );
  const r = await request.post("/api/lecturas", {
    headers: comoChofer,
    data: { ...cuerpoBase({ magnitud: "odometro", valor: 5_000 }), turno_id: t!.id },
  });
  expect(r.status()).toBe(201);
  expect((await r.json()).lectura.flags).not.toContain("exceso_de_soc");
});
