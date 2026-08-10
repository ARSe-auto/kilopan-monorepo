import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El cierre de una sesión de recarga, y el dinero invisible [AC-FVEH-08] — §3.E1.4, §4.2,
// §4.8, §9.3 centinelas 1 y 10.
//
// LO QUE ESTE AC PIDE Y ACÁ SE VERIFICA:
//
//   1. El chofer cierra la recarga offline + replay ⇒ 2xx, exactamente UNA fila, costo NULL en
//      lo que él manda y CERO rebotes.
//   2. El costo lo completa el trigger desde la tarifa del tenant, sin pasar por el chofer.
//   3. Chofer y responsable_carga con SELECT sobre la tabla de montos ⇒ 0 filas (RLS
//      RESTRICTIVE FOR SELECT, centinela 10).
//
// La mitad PLAN de la recarga dual —el bloque que rebota por solape— es de AC-FVEH-07 y vive
// en `agenda.spec.ts`. La parte de catálogo (enum completo, tipos, la política declarada) vive
// en `db/flota/pgtap/0016_energy_entry.sql`.

// Base PROPIA: esta suite deja HECHOS append-only (§7.4) que no se pueden borrar, y con ellos
// quedan turnos y vehículos que tampoco. En la base compartida, la suite del alta de vehículos
// —que necesita la flota vacía— encontraría estos camiones y se pondría roja sin haber hecho
// nada. Mismo criterio que el tenant `gobierno`.
const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
/** El host del tenant propio. `baseURL` apunta al primer activo, así que las peticiones de esta
 *  suite van con URL absoluta: el ruteo por subdominio (AC-FTEN-05) es quien elige la base. */
const EN_HECHOS = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = Object.keys(VALIDOS)[3]!;
const SECRETO = secretoNuevo();
const comoChofer = { Authorization: `Portador ${SECRETO}` };
const TARIFA_DEL_FIXTURE = 150;

let vehiculoId = "";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarFixture(c.sql);
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien carga') returning id::text as id",
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
      "insert into vehiculos (patente, tipo) values ('NRG1234', 'furgón') returning id::text as id",
    );
    vehiculoId = v!.id;
    await c.sql(
      `insert into parametros (tarifa_kwh_clp) values ($1)
       on conflict (unica) do update set tarifa_kwh_clp = excluded.tarifa_kwh_clp`,
      [TARIFA_DEL_FIXTURE],
    );
  });
});

const cerrar = (
  request: import("@playwright/test").APIRequestContext,
  datos: Record<string, unknown>,
) =>
  request.post(`${EN_HECHOS}/api/recargas`, {
    headers: comoChofer,
    data: { vehiculo_id: vehiculoId, ts_dispositivo: new Date().toISOString(), ...datos },
  });

const cuantasRecargas = () =>
  con(BD_A, (c: Conexion) => c.sql<{ n: string }>("select count(*)::text as n from energy_entry")).then(
    (r) => Number(r[0]!.n),
  );

test("[AC-FVEH-08] el chofer cierra la recarga sin tocar un peso, y el trigger pone el costo", async ({
  request,
}) => {
  const r = await cerrar(request, { wh: 20_000, soc_inicial: 20, soc_final: 90, client_uuid: randomUUID() });
  expect(r.status()).toBe(201);
  const { recarga } = (await r.json()) as { recarga: Record<string, unknown> };
  // CERO campos monetarios en el flujo del chofer (§4.8): ni los manda ni le vuelven.
  expect(Object.keys(recarga), "la respuesta al chofer trae un monto").not.toContain("costo_clp");

  // Y el costo SÍ quedó escrito, calculado por la base: 20 kWh a la tarifa del tenant.
  const [fila] = await con(BD_A, (c: Conexion) =>
    c.sql<{ costo: string; tipo: string }>(
      "select costo_clp::text as costo, type::text as tipo from energy_entry order by record_time desc limit 1",
    ),
  );
  expect(fila!.tipo, "el cierre del chofer tiene que ser de tipo carga").toBe("charge");
  expect(Number(fila!.costo)).toBe((20_000 / 1000) * TARIFA_DEL_FIXTURE);
});

test("[AC-FVEH-08] el replay del outbox deja exactamente UNA fila y cero rebotes", async ({ request }) => {
  const cuerpo = { wh: 15_000, soc_inicial: 30, soc_final: 80, client_uuid: randomUUID() };
  const primera = await cerrar(request, cuerpo);
  expect(primera.status()).toBe(201);
  const idPrimera = (await primera.json()).recarga.id;

  const antes = await cuantasRecargas();
  const segunda = await cerrar(request, cuerpo);
  // 200 y no 201: el reintento no creó nada. Un segundo registro contaría la energía dos veces
  // y el ahorro vs diésel del Anexo A diría el doble.
  expect(segunda.status()).toBe(200);
  expect((await segunda.json()).recarga.id).toBe(idPrimera);
  expect(await cuantasRecargas(), "el replay duplicó la sesión de recarga").toBe(antes);
});

test("[AC-FVEH-08] rechazos = 0: ninguna sesión de recarga del terreno devolvió 4xx", async ({
  request,
}) => {
  const casos = [
    { wh: 1, soc_inicial: 0, soc_final: 100 },
    { wh: 60_000, soc_inicial: null, soc_final: null },
    { wh: 41_860, soc_inicial: 5, soc_final: 5 },
  ];
  let rechazos = 0;
  for (const caso of casos) {
    const r = await cerrar(request, { ...caso, client_uuid: randomUUID() });
    if (r.status() >= 400) rechazos++;
  }
  expect(rechazos, "el vehículo ya se cargó: negarle la fila no descarga la batería").toBe(0);
});

// El centinela 10 —chofer y responsable_carga con SELECT sobre montos ⇒ 0 filas— NO vive acá:
// necesita el rol `app_t_<slug>` con su `app.current_role`, y este archivo habla con el
// servidor, que usa el rol de app pero no puede fijar ese GUC a voluntad. Está en
// `db/flota/suite-bd/energia.test.mjs`, que provisiona su propio tenant para poder hacerlo.
