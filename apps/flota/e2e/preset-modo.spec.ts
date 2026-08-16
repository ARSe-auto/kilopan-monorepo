import { test, expect, request as playwrightRequest } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { origenDe } from "./puerto.ts";

// La semántica del preset del selector de modo [AC-FPOR-16] — spec 07, §3, §4.4, §5.5.
//
// ─── LO QUE YA PRUEBA AC-FTEN-22, Y LO QUE FALTA ─────────────────────────────────────────
//
// `db/flota/suite-bd/control.test.mjs` [AC-FTEN-22] ya ejerce la FÓRMULA cruda de
// `entitlement_efectivo()` contra un `update tenants set modo = …` de mano: el recorte gana
// sobre el override, conmutar ida y vuelta no pierde filas, el mapeo es cerrado. Lo que ese
// archivo no toca es lo que este AC pide: que la conmutación hecha por el camino REAL de la
// aplicación —`conmutarModo`/`PATCH /api/gobierno/modo`, el mismo que ejerce AC-FPOR-15—
// quede acotada al PROPIO tenant (ni `plan_features`, fila compartida por el plan, ni un
// tenant vecino que comparte ese mismo plan se mueven) y que el efecto que de verdad ve el
// runtime del producto —el snapshot CONGELADO de `config_version` (servidor/config.ts)—
// SOLO cambie al sellarse una versión nueva, jamás en el instante de conmutar. El
// congelamiento POR TURNO es del módulo dueño de `turnos` (§5.5, §4.4); acá no se abre
// turno — se sella `config_version` directo, como ya hace `portal-modulo-apagado.spec.ts`
// para AC-FPOR-04.

const SLUG = "preset_modo";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const comoDuena = { Authorization: `Portador ${SECRETO}` };

/** Las cuatro cosas del contratante que `mi_flota` apaga, según el mapeo cerrado del §3
 *  (`db/migraciones-flota/control/0003_modo_como_preset.sql`, `modo_recorte`). */
const RECORTE_MI_FLOTA = ["tarifas", "liquidacion_por_cliente", "portal_contratante", "facturacion"];

let ctx: import("@playwright/test").APIRequestContext;

test.beforeAll(async () => {
  ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });

  await con(BD, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'La dueña del preset') returning id::text as id",
      [Object.keys(VALIDOS)[1]!],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );
  });
});

test.afterAll(async () => {
  await ctx.dispose();
});

const conmutar = (modo: string) => ctx.patch("/api/gobierno/modo", { headers: comoDuena, data: { modo } });

/**
 * Arma, DENTRO de `control`, un plan propio de la suite que trae las cuatro cosas del
 * contratante, lo asigna al tenant del fixture y le da un VECINO que comparte el mismo plan
 * —control-only, sin BD propia: alcanza para leer `entitlement_efectivo`, no hace falta
 * provisionarlo—. Se rehace en cada llamada (upsert + delete/insert) para que cada test sea
 * independiente del orden en que Playwright corra este archivo.
 */
async function escenarioDelGrupoDaas() {
  return con(BD_CONTROL, async (c: Conexion) => {
    const [plan] = await c.sql<{ id: string }>(
      "insert into planes (lookup_key, nombre) values ('preset_modo_plan', 'AC-FPOR-16') " +
        "on conflict (lookup_key) do update set nombre = excluded.nombre returning id::text as id",
    );
    const featureIds: Record<string, string> = {};
    for (const key of RECORTE_MI_FLOTA) {
      const [f] = await c.sql<{ id: string }>(
        "insert into features (lookup_key, module) values ($1, '00') " +
          "on conflict (lookup_key) do update set module = excluded.module returning id::text as id",
        [key],
      );
      featureIds[key] = f!.id;
    }
    await c.sql("delete from plan_features where plan_id = $1", [plan!.id]);
    for (const key of RECORTE_MI_FLOTA) {
      await c.sql("insert into plan_features (plan_id, feature_id) values ($1, $2)", [
        plan!.id,
        featureIds[key],
      ]);
    }
    await c.sql("update tenants set plan_id = $2, modo = 'daas' where slug = $1", [SLUG, plan!.id]);

    await c.sql("delete from tenants where slug = 'preset_modo_vecino'");
    // `estado = 'suspendido'`, no el default `activo`: esta fila es control-only —sin BD
    // propia, alcanza para leer `entitlement_efectivo`— y el job exportador (`db/flota/
    // exportar.mjs`) barre cada tenant `activo` esperando encontrarle una base real. Un
    // vecino activo sin base rompía esa barrida (y el conteo fijo de AC-FTEN-20) sin que
    // este AC lo necesitara: no probamos aislamiento del exportador, probamos el del preset.
    const [vecino] = await c.sql<{ id: string }>(
      "insert into tenants (slug, bd, plan_id, modo, estado) " +
        "values ('preset_modo_vecino', 't_preset_modo_vecino', $1, 'daas', 'suspendido') " +
        "returning id::text as id",
      [plan!.id],
    );
    const [propio] = await c.sql<{ id: string }>("select id::text as id from tenants where slug = $1", [SLUG]);

    return { planId: plan!.id as string, vecinoId: vecino!.id, propioId: propio!.id };
  });
}

const efectivo = async (tenantId: string, key: string) =>
  (
    await con(BD_CONTROL, (c: Conexion) =>
      c.sql<{ e: boolean }>("select entitlement_efectivo($1, $2) as e", [tenantId, key]),
    )
  )[0]!.e;

test("[AC-FPOR-16] conmutar por la app cambia el grupo DaaS sin mutar plan_features ni al tenant vecino", async () => {
  const { planId, vecinoId, propioId } = await escenarioDelGrupoDaas();

  const antesPF = await con(BD_CONTROL, (c: Conexion) =>
    c.sql<{ plan_id: string; feature_id: string }>(
      "select plan_id, feature_id from plan_features where plan_id = $1 order by feature_id",
      [planId],
    ),
  );

  // En `daas` nada se recorta: el plan resuelve tal cual, para el propio Y para el vecino.
  for (const key of RECORTE_MI_FLOTA) {
    expect(await efectivo(propioId, key), `${key} debería estar ON en daas (propio)`).toBe(true);
    expect(await efectivo(vecinoId, key), `${key} debería estar ON en daas (vecino)`).toBe(true);
  }

  const aMiFlota = await conmutar("mi_flota");
  expect(aMiFlota.ok(), `PATCH /api/gobierno/modo → mi_flota falló: ${aMiFlota.status()}`).toBe(true);

  // El propio se recorta; el vecino —mismo plan, fila propia en `tenants`— no se mueve un bit.
  for (const key of RECORTE_MI_FLOTA) {
    expect(await efectivo(propioId, key), `${key} debería apagarse al conmutar a mi_flota`).toBe(false);
    expect(await efectivo(vecinoId, key), `conmutar el propio tocó al vecino en ${key}`).toBe(true);
  }

  // Y la fila COMPARTIDA del plan es exactamente la misma: el recorte vive en la resolución,
  // jamás borrando ni reescribiendo `plan_features` (§3, §4.4).
  const despuesPF = await con(BD_CONTROL, (c: Conexion) =>
    c.sql<{ plan_id: string; feature_id: string }>(
      "select plan_id, feature_id from plan_features where plan_id = $1 order by feature_id",
      [planId],
    ),
  );
  expect(despuesPF, "conmutar el modo mutó plan_features, la fila compartida por el plan").toEqual(antesPF);

  const aDaas = await conmutar("daas");
  expect(aDaas.ok()).toBe(true);
});

test("[AC-FPOR-16] el cambio rige recién en el próximo bootstrap: una config_version ya sellada queda congelada", async () => {
  await escenarioDelGrupoDaas();
  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'daas' where slug = $1", [SLUG]));

  const [{ id: tenantId }] = await con(BD_CONTROL, (c: Conexion) =>
    c.sql<{ id: string }>("select id::text as id from tenants where slug = $1", [SLUG]),
  );

  /** Lo que un bootstrap REAL congela: `entitlements_efectivos` de `control`, tal como lo lee
   *  `servidor/config.ts` (`versionVigente`) — nunca una lectura en caliente del runtime. */
  const entitlementsDeAhora = async () => {
    const filas = await con(BD_CONTROL, (c: Conexion) =>
      c.sql<{ lookup_key: string; habilitada: boolean }>(
        "select lookup_key, habilitada from entitlements_efectivos where tenant_id = $1",
        [tenantId],
      ),
    );
    return Object.fromEntries(filas.map((f: { lookup_key: string; habilitada: boolean }) => [f.lookup_key, f.habilitada]));
  };

  const estadoEn = async (versionId: string, key: string) =>
    (
      await con(BD, (c: Conexion) =>
        c.sql<{ e: boolean | null }>(
          "select (snapshot -> 'entitlements' ->> $2)::boolean as e from config_version where id = $1",
          [versionId, key],
        ),
      )
    )[0]!.e;

  const sellar = async (motivo: string) => {
    const entitlements = JSON.stringify(await entitlementsDeAhora());
    return (
      await con(BD, (c: Conexion) =>
        c.sql<{ id: string }>("select crear_config_version($1, $2::jsonb)::text as id", [motivo, entitlements]),
      )
    )[0]!.id;
  };

  // Modo daas, plan trae `portal_contratante`: el bootstrap de ANTES sella ON.
  const versionAntes = await sellar("e2e AC-FPOR-16 — bootstrap antes de conmutar");
  expect(await estadoEn(versionAntes, "portal_contratante")).toBe(true);

  const r = await conmutar("mi_flota");
  expect(r.ok()).toBe(true);

  // La versión YA sellada es append-only (§7.4): sigue viendo lo que regía cuando se selló,
  // aunque el tenant ya haya conmutado — es LITERALMENTE lo que dice «rige recién en el
  // próximo bootstrap».
  expect(
    await estadoEn(versionAntes, "portal_contratante"),
    "la conmutación movió una config_version ya sellada",
  ).toBe(true);

  // Lo VIVO en `control` ya cambió: es la resolución cruda, no lo que el runtime del tenant
  // usa (servidor/config.ts documenta por qué el runtime nunca vuelve a consultar `control`).
  expect(await efectivo(tenantId, "portal_contratante")).toBe(false);

  // El «próximo bootstrap» —sellar una versión nueva, que es lo único que vuelve a leer
  // `entitlements_efectivos`— es lo único que hace regir el cambio.
  const versionDespues = await sellar("e2e AC-FPOR-16 — bootstrap después de conmutar");
  expect(await estadoEn(versionDespues, "portal_contratante")).toBe(false);
  // Y la primera versión SIGUE sin moverse: dos snapshots, dos verdades distintas en el
  // tiempo, ninguna reescrita.
  expect(await estadoEn(versionAntes, "portal_contratante")).toBe(true);

  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'daas' where slug = $1", [SLUG]));
});
