import { test, expect, type Page } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { Pool } from "pg";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { con, bdDeTenant, BD_CONTROL, ROL_MIGRADOR, destinoDelCluster } from "../../../db/flota/conectar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// La pantalla «Funciones» del panel admin [AC-FMIG-08] — §5.5, §5.4.
//
// LAS DOS COSAS QUE ESTE AC PIDE Y QUE NINGÚN OTRO ORÁCULO YA CUBRE:
//
//   (a) mutación DIRECTA por API de override ON sobre una feature FUERA del plan ⇒ 422
//       tipado es-CL, y CERO filas nuevas — ni en `control.tenant_feature_overrides` ni en
//       `audit_trail` del tenant. El barrido genérico de AC-FIDN-12 (`gobierno.spec.ts`)
//       prueba el 403 de rol y el 404 sin sesión sobre ESTA MISMA ruta —la recoge sola del
//       manifiesto—, pero solo cuenta filas de la base del TENANT: `tenant_feature_overrides`
//       vive en `control`, así que el «0 filas» de (a) y el de (b) hay que verificarlos acá.
//   (b) toggle (ON u OFF) con rol distinto de `admin_tenant` ⇒ 403 y 0 filas, con la misma
//       cobertura cross-base que (a) —el barrido ya prueba el 403, esto agrega el conteo de
//       `control.tenant_feature_overrides`—.
//
// Y lo que la spec pide de más: OFF siempre se deja escribir aunque la feature esté fuera de
// plan, y ON con la feature EN el plan aplica al «próximo bootstrap» —sella una
// `config_version` nueva, que es lo único que el runtime del §4.4 vuelve a leer—.
//
// BASE PROPIA (`funciones`, en `preparar-tenants.mjs`): cada toggle sella una config_version
// del tenant Y escribe en `control.tenant_feature_overrides`, que es compartida entre TODAS
// las bases. Compartir `ruteo_activo` —que ya usa `documentos.spec.ts` (AC-FVEH-03) para lo
// mismo, sobre otra feature— arriesgaría un resellado a mitad de esa suite.

const PUERTO = PUERTO_E2E;
const DOMINIO = "localhost";
const T = TENANTS.find((t) => t.slug === "funciones")!;
const BD = bdDeTenant(T.slug);
const HOST = `${T.slug}.${DOMINIO}:${PUERTO}`;

type Conexion = { sql: <F = Record<string, string>>(t: string, p?: unknown[]) => Promise<F[]> };
type Respuesta = { status: number; texto: string; json: Record<string, unknown> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) =>
  con(BD, (c: Conexion) => c.sql<F>(texto, params));

/** Un request con Host propio, igual que `gobierno.spec.ts`: esta suite vive en su propio
 *  subdominio (`funciones`) y no en el de la baseURL por defecto (`ruteo_activo`). */
function pedirA(
  ruta: string,
  metodo: string,
  opciones: { secreto?: string; cuerpo?: unknown } = {},
): Promise<Respuesta> {
  const llevaCuerpo = opciones.cuerpo !== undefined && metodo !== "GET";
  const cuerpo = llevaCuerpo ? JSON.stringify(opciones.cuerpo) : null;
  const cabeceras: Record<string, string> = { Host: HOST };
  if (opciones.secreto) cabeceras.Authorization = `Portador ${opciones.secreto}`;
  if (cuerpo !== null) {
    cabeceras["content-type"] = "application/json";
    cabeceras["content-length"] = String(Buffer.byteLength(cuerpo));
  }
  return new Promise((resolver, rechazar) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PUERTO, path: ruta, method: metodo, headers: cabeceras },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (t) => (texto += t));
        res.on("end", () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(texto) as Record<string, unknown>;
          } catch {
            json = {};
          }
          resolver({ status: res.statusCode ?? 0, texto, json });
        });
      },
    );
    req.on("error", rechazar);
    if (cuerpo !== null) req.write(cuerpo);
    req.end();
  });
}

const FEATURE_EN_PLAN = "documentos_vencidos_bloquean";
const FEATURE_FUERA_DE_PLAN = "certificaciones_vencidas_bloquean";

let control: Pool;
let tenantId = "";
let planId = "";
let duena = { usuarioId: "", secreto: "" };
let operario = { secreto: "" };

async function enrolar(rut: string, nombre: string, rol: string) {
  const secreto = secretoNuevo();
  const [p] = await sql<{ id: string }>(
    "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
    [rut, nombre],
  );
  const [u] = await sql<{ id: string }>(
    "insert into usuarios (persona_id, rol, pin_hash) values ($1, $2::rol_usuario, '$argon2id$fixture') returning id::text as id",
    [p!.id, rol],
  );
  await sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
     values ('personal', $1, $2, $3, now())`,
    [p!.id, hashDeSecreto(secreto), u!.id],
  );
  return { usuarioId: u!.id, secreto };
}

test.beforeAll(async () => {
  control = new Pool({
    host: destinoDelCluster().host,
    port: Number(destinoDelCluster().puerto),
    database: BD_CONTROL,
    user: ROL_MIGRADOR,
  });

  await limpiarFixture(sql);
  // RUTs de la lista congelada (`db/flota/ruts-sinteticos.mjs`, VALIDOS): esta base es
  // propia de la suite (ver comentario de cabecera), así que reusar RUTs que ya usan otras
  // suites en SU tenant no colisiona — la unicidad de `personas` es por tenant.
  duena = await enrolar("12.345.678-5", "Dueña de Funciones", "admin_tenant");
  operario = await enrolar("20.347.878-K", "Operario de Funciones", "chofer");

  const { rows: t } = await control.query<{ id: string }>("select id::text as id from tenants where slug = $1", [
    T.slug,
  ]);
  tenantId = t[0]!.id;

  // Un plan del fixture que trae SOLO `FEATURE_EN_PLAN`, para poder distinguir «encender algo
  // del plan» de «encender algo fuera de él» con dos features REALES del catálogo (ambas ya
  // sembradas por los módulos 02 y 08 — nace apagadas para todos, AC-FVEH-03/AC-FVEH-14).
  const { rows: plan } = await control.query<{ id: string }>(
    `insert into planes (lookup_key, nombre) values ('plan-del-fixture-funciones', 'Plan del fixture')
     returning id::text as id`,
  );
  planId = plan[0]!.id;
  await control.query(
    `insert into plan_features (plan_id, feature_id)
     select $1, id from features where lookup_key = $2`,
    [planId, FEATURE_EN_PLAN],
  );
  await control.query("update tenants set plan_id = $2 where id = $1", [tenantId, planId]);
});

test.afterAll(async () => {
  // Deja `control` como la encontró: sin plan, sin overrides y sin el plan del fixture.
  await control.query("update tenants set plan_id = null where id = $1", [tenantId]);
  await control.query("delete from tenant_feature_overrides where tenant_id = $1", [tenantId]);
  await control.query("delete from plan_features where plan_id = $1", [planId]);
  await control.query("delete from planes where id = $1", [planId]);
  await control?.end();
});

/** Filas de `control.tenant_feature_overrides` de ESTE tenant: el «0 filas» cross-base del AC. */
const filasDeOverrides = () =>
  control
    .query<{ n: string }>("select count(*)::text as n from tenant_feature_overrides where tenant_id = $1", [
      tenantId,
    ])
    .then((r) => Number(r.rows[0]!.n));

/** Filas de `audit_trail` sobre `tenant_feature_overrides`, del lado del tenant. Por
 *  DIFERENCIA: `audit_trail` es append-only (§7.4) y no se vacía entre tests. */
const filasDeAuditoria = () =>
  sql<{ n: string }>("select count(*)::text as n from audit_trail where tabla = 'tenant_feature_overrides'").then(
    (r) => Number(r[0]!.n),
  );

const conteoDeConfigVersions = () => sql<{ n: string }>("select count(*)::text as n from config_version").then((r) => Number(r[0]!.n));

test("[AC-FMIG-08] encender una función FUERA del plan ⇒ 422 fuera_de_plan, cero filas en control y en audit_trail", async () => {
  const overridesAntes = await filasDeOverrides();
  const auditoriaAntes = await filasDeAuditoria();
  const versionesAntes = await conteoDeConfigVersions();

  const r = await pedirA("/api/gobierno/funciones", "PATCH", {
    secreto: duena.secreto,
    cuerpo: { lookup_key: FEATURE_FUERA_DE_PLAN, enabled: true },
  });

  expect(r.status).toBe(422);
  expect(r.json.error).toBe("fuera_de_plan");
  expect(await filasDeOverrides(), "el 422 dejó una fila en control.tenant_feature_overrides").toBe(overridesAntes);
  expect(await filasDeAuditoria(), "el 422 dejó una fila en audit_trail").toBe(auditoriaAntes);
  expect(await conteoDeConfigVersions(), "el 422 selló una config_version igual").toBe(versionesAntes);
});

test("[AC-FMIG-08] apagar está SIEMPRE permitido, incluso una función fuera del plan", async () => {
  const overridesAntes = await filasDeOverrides();
  const auditoriaAntes = await filasDeAuditoria();

  const r = await pedirA("/api/gobierno/funciones", "PATCH", {
    secreto: duena.secreto,
    cuerpo: { lookup_key: FEATURE_FUERA_DE_PLAN, enabled: false },
  });

  expect(r.status).toBe(200);
  expect(r.json.habilitada).toBe(false);
  expect(await filasDeOverrides()).toBe(overridesAntes + 1);
  expect(await filasDeAuditoria(), "apagar tiene que dejar su fila en audit_trail").toBe(auditoriaAntes + 1);
});

test("[AC-FMIG-08] encender una función del plan aplica al PRÓXIMO bootstrap (config_version sellada)", async () => {
  const versionesAntes = await conteoDeConfigVersions();

  const r = await pedirA("/api/gobierno/funciones", "PATCH", {
    secreto: duena.secreto,
    cuerpo: { lookup_key: FEATURE_EN_PLAN, enabled: true },
  });

  expect(r.status).toBe(200);
  expect(r.json.habilitada).toBe(true);
  expect(await conteoDeConfigVersions(), "encender no selló una config_version nueva").toBe(versionesAntes + 1);

  // La versión sellada trae el entitlement encendido: es lo que el runtime del §4.4 lee, y
  // nunca vuelve a preguntarle a `control`.
  const [ultima] = await sql<{ habilitada: string | null }>(
    `select (snapshot -> 'entitlements' ->> $1)::text as habilitada
       from config_version order by id desc limit 1`,
    [FEATURE_EN_PLAN],
  );
  expect(ultima!.habilitada).toBe("true");

  const lectura = await pedirA("/api/gobierno/funciones", "GET", { secreto: duena.secreto });
  const fila = (lectura.json.funciones as { lookupKey: string; habilitada: boolean; enPlan: boolean }[]).find(
    (f) => f.lookupKey === FEATURE_EN_PLAN,
  );
  expect(fila?.habilitada).toBe(true);
  expect(fila?.enPlan).toBe(true);
});

test("[AC-FMIG-08] rol distinto de admin_tenant ⇒ 403 y CERO filas en control.tenant_feature_overrides", async () => {
  const overridesAntes = await filasDeOverrides();
  const auditoriaAntes = await filasDeAuditoria();

  for (const cuerpo of [
    { lookup_key: FEATURE_FUERA_DE_PLAN, enabled: false },
    { lookup_key: FEATURE_EN_PLAN, enabled: true },
  ]) {
    const r = await pedirA("/api/gobierno/funciones", "PATCH", { secreto: operario.secreto, cuerpo });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("solo_el_dueno");
  }
  expect(await filasDeOverrides()).toBe(overridesAntes);
  expect(await filasDeAuditoria()).toBe(auditoriaAntes);
});

// ─── La pantalla: OFF siempre disponible, ON fuera de plan en locked-state con upsell ──

/** Deja la sesión de la dueña en el aparato antes de que cargue la página, igual que
 *  `vehiculos.spec.ts`. */
async function sesionDe(page: Page, secreto: string) {
  await page.addInitScript((s) => {
    const guardar = () =>
      new Promise<void>((res) => {
        const p = indexedDB.open("flota-aparato", 1);
        p.onupgradeneeded = () => p.result.createObjectStore("claves");
        p.onsuccess = () => {
          const req = p.result.transaction("claves", "readwrite").objectStore("claves").put(s, "secreto-de-sesion");
          req.onsuccess = () => res();
          req.onerror = () => res();
        };
      });
    void guardar();
  }, secreto);
}

test("[AC-FMIG-08] la pantalla ofrece «Apagar» siempre y bloquea «Encender» fuera de plan, con upsell", async ({
  page,
}) => {
  await sesionDe(page, duena.secreto);
  await page.goto(`http://${HOST}/panel/funciones`);

  await expect(page.getByTestId("panel-funciones")).toBeVisible();

  // La función fuera de plan (apagada tras el test anterior): bloqueada, con upsell, y SIN
  // botón de encender que invite a chocar con el 422.
  const filaFueraDePlan = page.getByTestId(`fila-funcion-${FEATURE_FUERA_DE_PLAN}`);
  await expect(filaFueraDePlan).toBeVisible();
  await expect(page.getByTestId(`estado-${FEATURE_FUERA_DE_PLAN}`)).toContainText("Bloqueada");
  await expect(page.getByTestId(`upsell-${FEATURE_FUERA_DE_PLAN}`)).toBeVisible();
  await expect(filaFueraDePlan.getByTestId(`encender-${FEATURE_FUERA_DE_PLAN}`)).toBeDisabled();
  await expect(filaFueraDePlan.getByTestId(`apagar-${FEATURE_FUERA_DE_PLAN}`)).toHaveCount(0);

  // La función del plan quedó encendida por el test anterior: «Apagar» disponible y SIEMPRE
  // permitido, sin locked-state ni upsell.
  const filaEnPlan = page.getByTestId(`fila-funcion-${FEATURE_EN_PLAN}`);
  await expect(page.getByTestId(`estado-${FEATURE_EN_PLAN}`)).toHaveText("Encendida");
  await expect(filaEnPlan.getByTestId(`apagar-${FEATURE_EN_PLAN}`)).toBeEnabled();
  await expect(filaEnPlan.getByTestId(`upsell-${FEATURE_EN_PLAN}`)).toHaveCount(0);

  await filaEnPlan.getByTestId(`apagar-${FEATURE_EN_PLAN}`).click();
  await expect(page.getByTestId(`estado-${FEATURE_EN_PLAN}`)).toHaveText("Apagada");
});
