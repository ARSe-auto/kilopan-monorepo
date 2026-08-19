import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { con, bdDeTenant, BD_CONTROL, ROL_MIGRADOR, destinoDelCluster } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { PUERTO_E2E } from "./puerto.ts";
import { tiposDeAccionPrimaria, type BotonVisible } from "../../../packages/miga/src/una-accion-primaria.ts";
import { FEATURES } from "../src/servidor/config.ts";

// "Una acción primaria por pantalla", asertada en las pantallas del hito g [AC-FMIG-21] — §5.1.
//
// AC-FMIG-01 publicó la regla como CONSTANTE; una constante publicada no puede fallar (§5
// encabezado), así que este AC es su oráculo conductual — la nota de cobertura del propio AC lo
// dice: "la aserción §5.1 es de unicidad, no de mera presencia". Eso es justo lo que
// `tiposDeAccionPrimaria` (`packages/miga/src/una-accion-primaria.ts`) computa: agrupa los
// botones `variante="acento"` visibles por TIPO de acción (el verbo del `data-testid`), no por
// instancia — repetir la MISMA acción una vez por fila de una lista (`encender-<lookupKey>` de
// `/panel/funciones`) es un tipo, no N. El caso que puede poner esto en rojo es que aparezcan DOS
// TIPOS a la vez; el mutante que lo demuestra vive en `packages/miga/src/una-accion-primaria.test.ts`
// (no hace falta un navegador para eso), acá se ejerce contra el DOM real.
//
// QUÉ PANTALLAS SON "las pantallas del hito": el mismo inventario que ya dejó escrito
// `panel-a11y-pwa-gate.spec.ts` (AC-FMIG-11) para "las pantallas del hito g" — `/panel/funciones`
// y `/panel/terminologia` existen; el wizard (AC-FMIG-14) todavía no tiene una sola pantalla
// construida (es un script, `db/flota/wizard-onboarding.mjs`), así que no hay DOM que
// snapshotear y queda fuera hasta que nazca (AC-FMIG-24). `/panel` (enrolamiento, F-A/F-C) es de
// AC-FIDN-02 — no es "panel white-label" ni "«Funciones»", los dos nombres literales del texto
// de este AC — así que tampoco entra acá.
//
// EL FIXTURE de `/panel/funciones` cubre un plan con TODAS las features de `FEATURES`
// (`config.ts`), CON un override explícito en OFF sobre cada una: `entitlement_efectivo` es
// `override ?? plan` (0002_entitlements_efectivos.sql), así que estar en el plan SIN override ya
// resuelve `habilitada=true` — el estado "apagada-y-en-plan" que ofrece "Encender" exige el
// override. Así la pantalla muestra un "Encender" por feature a la vez, y el chequeo se ejerce
// sobre más de una instancia real de la misma acción — no sobre un caso vacío que pasaría por
// accidente. El conteo esperado se DERIVA de lo que el propio fixture alcanzó a sembrar (el
// `rowCount` del insert en `plan_features`), no de un literal: el catálogo de `features` crece con
// el producto —la 0009 le sumó las cuatro claves del grupo DaaS, [AC-FTAR-18]— y un literal
// convertiría cada feature nueva en un rojo de AC-FMIG-21 que no dice nada sobre la regla de "una
// acción primaria por pantalla". Lo que este AC exige —y lo que se sigue asertando abajo,
// intacto— es que N instancias de la MISMA acción sean UN tipo, no N; para eso hace falta que
// sean varias, no que sean exactamente tres.
// `/panel/terminologia` no necesita fixture de plan: sus botones son `variante="neutro"` con los
// datos base (`TERMINOLOGIA_BASE_ES_CL`).
//
// BASE PROPIA (`pantalla_primaria`): un plan que cubre el catálogo entero no puede compartir
// tenant con `funciones.spec.ts` (AC-FMIG-08), que sella su propio plan parcial y muta
// `tenant_feature_overrides` a cada rato — mismo motivo que separó esa suite de `ruteo_activo`.

const T = TENANTS.find((t) => t.slug === "pantalla_primaria")!;
const BD = bdDeTenant(T.slug);
const EN = `http://${T.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <F = Record<string, string>>(t: string, p?: unknown[]) => Promise<F[]> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) =>
  con(BD, (c: Conexion) => c.sql<F>(texto, params));

const SECRETO = secretoNuevo();
/** Cuántos "Encender" tiene que pintar `/panel/funciones`: exactamente uno por fila que el
 *  fixture ALCANZÓ a meter en el plan. No es `Object.values(FEATURES).length`: el insert es
 *  `select … from features where lookup_key = any(…)`, así que una clave que `config.ts` nombra
 *  pero que ninguna migración sembró todavía en el catálogo de `control` (hoy, `modulo_encargos`)
 *  no produce fila ni botón. Se llena en el `beforeAll` con el `rowCount` real. */
let ESPERADOS = 0;
let control: Pool;
let tenantId = "";
let planId = "";

test.beforeAll(async () => {
  await limpiarFixture(sql);
  const [p] = await sql<{ id: string }>(
    "insert into personas (rut, nombre) values ($1, 'Quien mira las pantallas del hito') returning id::text as id",
    [rutDeFixture(0)],
  );
  const [u] = await sql<{ id: string }>(
    "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
    [p!.id],
  );
  await sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
     values ('personal', $1, $2, $3, now(), true, true)`,
    [p!.id, hashDeSecreto(SECRETO), u!.id],
  );

  control = new Pool({
    host: destinoDelCluster().host,
    port: Number(destinoDelCluster().puerto),
    database: BD_CONTROL,
    user: ROL_MIGRADOR,
  });
  const { rows: t } = await control.query<{ id: string }>("select id::text as id from tenants where slug = $1", [
    T.slug,
  ]);
  tenantId = t[0]!.id;

  // Un plan que cubre TODAS las features de `FEATURES` (config.ts) — por LOOKUP_KEY explícito,
  // no "todo lo que haya hoy en `features`": esa tabla es COMPARTIDA entre todas las bases del
  // cluster de e2e, y otra suite puede dejar filas propias ahí (p. ej. `gate.*` de
  // `db/flota/suite-bd/control.test.mjs`) — un `select … from features` sin filtro las
  // arrastraría al plan de este fixture y el conteo de "Encender" dejaría de ser determinista.
  // Todas nacen apagadas (AC-FVEH-03, AC-FVEH-14, AC-FMIG-09, AC-FPOR-04, AC-FTAR-18), así que
  // estando todas EN el plan quedan "apagada-y-en-plan" — el estado que pinta "Encender" en acento.
  const { rows: plan } = await control.query<{ id: string }>(
    `insert into planes (lookup_key, nombre) values ('plan-del-fixture-primaria', 'Plan del fixture')
     returning id::text as id`,
  );
  planId = plan[0]!.id;
  const sembradas = await control.query(
    `insert into plan_features (plan_id, feature_id) select $1, id from features where lookup_key = any($2::text[])`,
    [planId, Object.values(FEATURES)],
  );
  ESPERADOS = sembradas.rowCount ?? 0;
  await control.query("update tenants set plan_id = $2 where id = $1", [tenantId, planId]);

  // `entitlement_efectivo` es LITERAL (`override ?? plan`, 0002_entitlements_efectivos.sql): estar
  // EN el plan y sin override ya resuelve `habilitada=true` — no alcanza con el plan para que la
  // pantalla ofrezca "Encender". El estado "apagada-y-en-plan" que este fixture necesita exige un
  // override explícito en OFF sobre todas, encima del plan.
  await control.query(
    `insert into tenant_feature_overrides (tenant_id, feature_id, enabled, motivo)
     select $1, id, false, 'apagada a propósito por el fixture de AC-FMIG-21: sin este override, override ?? plan resuelve habilitada=true por estar en el plan, y la pantalla no ofrecería Encender'
       from features where lookup_key = any($2::text[])`,
    [tenantId, Object.values(FEATURES)],
  );
});

test.afterAll(async () => {
  await control.query("update tenants set plan_id = null where id = $1", [tenantId]);
  await control.query("delete from tenant_feature_overrides where tenant_id = $1", [tenantId]);
  await control.query("delete from plan_features where plan_id = $1", [planId]);
  await control.query("delete from planes where id = $1", [planId]);
  await control?.end();
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

async function irYCargar(page: Page, ruta: string, testid: string) {
  await page.goto(`${EN}${ruta}`);
  await expect(page.getByTestId(testid)).toBeVisible();
  await page.getByRole("status", { name: "Cargando" }).waitFor({ state: "hidden", timeout: 5_000 });
}

/** Los `BotonPrimario` visibles y HABILITADOS del DOM, con su `variante` real —
 *  `data-variante` [AC-FMIG-21] la expone porque el estilo computado no es una estructura
 *  testeable, y el AC pide una. */
async function botonesVisibles(page: Page): Promise<BotonVisible[]> {
  return page.locator("[data-testid][data-variante]:enabled").evaluateAll((nodos) =>
    nodos
      .filter((n) => (n as HTMLElement).offsetParent !== null)
      .map((n) => ({
        testid: n.getAttribute("data-testid")!,
        variante: n.getAttribute("data-variante") as "acento" | "neutro",
      })),
  );
}

test("[AC-FMIG-21] /panel/funciones: varios 'Encender' simultáneos son UN tipo de acción, no N", async ({
  page,
}) => {
  await sesionDe(page);
  await irYCargar(page, "/panel/funciones", "panel-funciones");

  const botones = await botonesVisibles(page);
  const encender = botones.filter((b) => b.testid.startsWith("encender-"));
  // Varias, o el caso no se ejerce: con un solo "Encender" la unicidad pasaría por accidente.
  expect(ESPERADOS, "el fixture tiene que sembrar MÁS DE UNA feature o no hay caso").toBeGreaterThan(1);
  expect(
    encender.length,
    `el fixture cubre las ${ESPERADOS} features de FEATURES: tienen que estar sus ${ESPERADOS} 'Encender'`,
  ).toBe(ESPERADOS);

  const tipos = tiposDeAccionPrimaria(botones);
  expect(tipos, `tipos de acción primaria en /panel/funciones: ${tipos.join(", ")}`).toEqual(["encender"]);
});

test("[AC-FMIG-21] /panel/terminologia: cero acciones acento es válido — unicidad, no mera presencia", async ({
  page,
}) => {
  await sesionDe(page);
  await irYCargar(page, "/panel/terminologia", "panel-terminologia");

  const botones = await botonesVisibles(page);
  const tipos = tiposDeAccionPrimaria(botones);
  expect(
    tipos.length,
    `/panel/terminologia no tiene una acción de énfasis por diseño (cada fila se guarda sola); tipos: ${tipos.join(", ")}`,
  ).toBeLessThanOrEqual(1);
});
