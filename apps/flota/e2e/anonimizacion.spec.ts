import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { anonimizar } from "../src/servidor/anonimizacion.ts";
import { con, bdDeTenant, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { provisionar } from "../../../db/flota/provisionar.mjs";
import { borrarRolDeApp } from "../../../db/flota/rol-app.mjs";

// Supresión de la Ley 21.719 con el ledger INTACTO [AC-FIDN-19] — §4.3, §7.8.
//
// Se prueba contra una persona CON HISTORIAL: sin hechos previos, «el ledger quedó intacto»
// sería cierto por no haber ledger, que es el verde vacuo más fácil de escribir en este AC.
//
// ALCANCE DECLARADO: el historial se arma con `eventos` y `firmas`, que son las tablas de
// hechos que existen hoy. Los PODs que el AC también nombra nacen en el módulo de POD (hito
// e); cuando existan, se suman a este mismo conteo — el mecanismo no cambia, porque lo que
// hace intacto al ledger es que esta función ni siquiera lo nombra.

// BASE PROPIA, y no la del fixture de ruteo que usan las otras suites. Esta prueba escribe en
// `eventos` y `firmas`, que son APPEND-ONLY: una vez que hay hechos apuntando a una persona,
// ninguna otra suite puede volver a limpiar `personas` —el DELETE de las firmas rebota con
// 42501, que es exactamente lo que el §7.4 promete— y la base del fixture queda inservible
// para todos. Provisionar una propia cuesta trescientos milisegundos y evita que el aislamiento
// del ledger, que es lo que este AC celebra, se vuelva el problema de la suite siguiente.
const SLUG = "gate_anonimizacion";
const BD_A = bdDeTenant(SLUG);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

let pool: Pool;
let personaId: string;
let dispositivoId: string;

const contar = async (sql: string, params: unknown[] = []) => {
  const [f] = await con(BD_A, (c: Conexion) => c.sql<{ n: string }>(sql, params));
  return Number(f!.n);
};

/** El ledger completo de hoy, tabla por tabla. */
async function huellaDelLedger() {
  return {
    eventos: await contar("select count(*)::text as n from eventos"),
    firmas: await contar("select count(*)::text as n from firmas"),
    audit: await contar("select count(*)::text as n from audit_trail"),
  };
}

test.beforeAll(async () => {
  await provisionar(SLUG, { recrear: true });
  pool = new Pool({
    host: CLUSTER_LOCAL.host,
    port: CLUSTER_LOCAL.puerto,
    database: BD_A,
    user: ROL_MIGRADOR,
  });

  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre, contacto) values ('12.345.678-5', 'Con Historial', '+56 9 0000 0000') returning id::text as id",
    );
    personaId = p!.id;
    await c.sql("insert into usuarios (persona_id, rol) values ($1, 'chofer')", [personaId]);
    const [d] = await c.sql<{ id: string }>(
      "insert into dispositivos (tipo, persona_id) values ('personal', $1) returning id::text as id",
      [personaId],
    );
    dispositivoId = d!.id;

    // El historial: hechos de verdad en las dos tablas append-only que existen hoy.
    const [tipo] = await c.sql<{ id: string }>(
      "insert into evento_tipo (codigo, descripcion) values ('turno_abierto', 'Turno abierto') returning id::text as id",
    );
    for (let i = 0; i < 3; i++) {
      await c.sql(
        `insert into eventos (tipo_id, objeto_tabla, objeto_id, actor_id, dispositivo_id, event_time, tz_offset_min)
         values ($1, 'turnos', uuidv7(), $2, $3, now(), -240)`,
        [tipo!.id, personaId, dispositivoId],
      );
    }
    for (let i = 0; i < 2; i++) {
      await c.sql(
        `insert into firmas (persona_id, dispositivo_id, objeto_tabla, objeto_id, significado)
         values ($1, $2, 'encargos', uuidv7(), 'recibio_conforme')`,
        [personaId, dispositivoId],
      );
    }
  });
});

test.afterAll(async () => {
  await pool?.end();
  await con("postgres", ({ sql }: { sql: (t: string) => Promise<unknown> }) =>
    sql(`drop database if exists ${BD_A} with (force)`),
  );
  await borrarRolDeApp(SLUG);
});

test("[AC-FIDN-19] la persona queda sin identificadores y el LEDGER intacto", async () => {
  const antes = await huellaDelLedger();
  expect(antes.eventos, "sin historial este test no probaría nada").toBeGreaterThan(0);
  expect(antes.firmas).toBeGreaterThan(0);

  const r = await anonimizar(pool, personaId);
  expect(r.tipo).toBe("anonimizada");

  const [p] = await con(BD_A, (c: Conexion) =>
    c.sql<{ rut: string | null; nombre: string | null; contacto: string | null; cuando: string | null }>(
      "select rut, nombre, contacto, anonimizada_en::text as cuando from personas where id = $1",
      [personaId],
    ),
  );
  expect(p!.rut).toBeNull();
  expect(p!.nombre).toBeNull();
  expect(p!.contacto).toBeNull();
  expect(p!.cuando).not.toBeNull();

  // El ledger, tabla por tabla. `audit_trail` crece —la anonimización ES un cambio de la fila
  // y el trigger lo registra— pero NO pierde una línea: la retención de lo auditado es ≥ la
  // del registro auditado (§4.6), así que la comparación es «no se borró nada», no «no cambió».
  const despues = await huellaDelLedger();
  expect(despues.eventos).toBe(antes.eventos);
  expect(despues.firmas).toBe(antes.firmas);
  expect(despues.audit).toBeGreaterThanOrEqual(antes.audit);
});

test("[AC-FIDN-19] los hechos siguen apuntando al MISMO ID opaco", async () => {
  // La otra mitad, y la que hace útil a la primera: si la supresión hubiera cortado el
  // vínculo, el ledger estaría «intacto» y a la vez sería inservible — nadie podría reconstruir
  // qué pasó en una entrega, que es para lo que existe.
  expect(await contar("select count(*)::text as n from eventos where actor_id = $1", [personaId])).toBe(3);
  expect(await contar("select count(*)::text as n from firmas where persona_id = $1", [personaId])).toBe(2);

  // Y las firmas siguen siendo VÁLIDAS: su FK resuelve contra la persona anonimizada, que
  // sigue existiendo con su id. Suprimir no es borrar la fila.
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      "select count(*)::text as n from firmas f join personas p on p.id = f.persona_id where f.persona_id = $1",
      [personaId],
    ),
  );
  expect(Number(f!.n)).toBe(2);
});

test("[AC-FIDN-19] la supresión cierra los accesos: aparato revocado y usuario inactivo", async () => {
  // Consecuencia declarada. Un aparato que siguiera capturando en nombre de una identidad
  // suprimida escribiría hechos nuevos atribuidos a alguien que ya no se puede nombrar.
  const [d] = await con(BD_A, (c: Conexion) =>
    c.sql<{ revocado: string | null }>("select revocado_at::text as revocado from dispositivos where id = $1", [
      dispositivoId,
    ]),
  );
  expect(d!.revocado).not.toBeNull();
  expect(await contar("select count(*)::text as n from usuarios where persona_id = $1 and activo", [personaId])).toBe(0);
});

test("[AC-FIDN-19] el centinela 6 no se viola: el ledger sigue siendo inmutable", async () => {
  // No alcanza con que la anonimización no haya tocado los hechos: hay que probar que NO SE
  // PUEDEN tocar, porque si el append-only se hubiera relajado para que la supresión pasara,
  // todo lo anterior seguiría en verde y el ledger habría dejado de ser prueba de nada.
  const intentar = async (sql: string) => {
    try {
      await pool.query(sql, [personaId]);
      return null;
    } catch (e) {
      return (e as { code?: string }).code;
    }
  };
  expect(await intentar("update eventos set actor_id = null where actor_id = $1")).toBe("42501");
  expect(await intentar("delete from firmas where persona_id = $1")).toBe("42501");
});

test("[AC-FIDN-19] anonimizar dos veces no rompe nada y lo dice", async () => {
  const r = await anonimizar(pool, personaId);
  expect(r.tipo === "rebote" && r.motivo).toBe("ya_anonimizada");
});

test("[AC-FIDN-19] una persona que no existe rebota sin tocar nada", async () => {
  const antes = await huellaDelLedger();
  const r = await anonimizar(pool, "0192f0a0-0000-7000-8000-00000000dead");
  expect(r.tipo === "rebote" && r.motivo).toBe("persona_inexistente");
  expect(await huellaDelLedger()).toEqual(antes);
});

test("[AC-FIDN-19] el RUT suprimido vuelve a quedar disponible", async () => {
  // Consecuencia del UNIQUE por tenant: si la fila anonimizada retuviera el RUT, esa persona
  // no podría volver a darse de alta nunca — y la supresión habría dejado una marca permanente
  // en el sistema, que es justo lo que no debe.
  const [nueva] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ('12.345.678-5', 'Otra Persona') returning id::text as id",
    ),
  );
  expect(nueva!.id).not.toBe(personaId);
});
