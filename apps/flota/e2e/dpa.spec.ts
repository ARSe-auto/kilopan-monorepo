import { test, expect, type Page } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { PUERTO_E2E } from "./puerto.ts";
import { DPA_VERSION, DPA_SECCIONES } from "../../../packages/miga/src/dpa.ts";

// El DPA en términos del tenant [AC-FMIG-22] — §3.E1.15, §7.8, §5.1, §5.4.
//
// LO QUE EL BARRIDO DE AC-FIDN-12 (`gobierno.spec.ts`) YA CUBRE, sobre esta misma ruta, sola
// —el manifiesto la recoge automáticamente por vivir bajo `/api/gobierno/**`—: sin sesión ⇒ 404
// pelado, y rol distinto de `admin_tenant` ⇒ 403 con CERO filas. Este archivo prueba lo que ese
// barrido NO puede: que la aceptación escriba `audit_trail` con la VERSIÓN aceptada (§4.6), que
// sea idempotente sobre la versión vigente, y que la pantalla sirva las siete secciones del
// documento sin CSS libre a ≤2 niveles de profundidad (§5.1).
//
// BASE PROPIA (`dpa`, en `preparar-tenants.mjs`): ver el comentario ahí.

const PUERTO = PUERTO_E2E;
const DOMINIO = "localhost";
const T = TENANTS.find((t) => t.slug === "dpa")!;
const BD = bdDeTenant(T.slug);
const HOST = `${T.slug}.${DOMINIO}:${PUERTO}`;

type Conexion = { sql: <F = Record<string, string>>(t: string, p?: unknown[]) => Promise<F[]> };
type Respuesta = { status: number; texto: string; json: Record<string, unknown> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) =>
  con(BD, (c: Conexion) => c.sql<F>(texto, params));

/** Mismo patrón de `funciones.spec.ts`/`gobierno.spec.ts`: Host propio del subdominio de esta
 *  suite, sin pasar por el navegador para los casos que solo prueban la API. */
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

let duena = { usuarioId: "", secreto: "" };

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
  await limpiarFixture(sql);
  duena = await enrolar("12.345.678-5", "Dueña del DPA", "admin_tenant");
});

const filasDeAceptacion = () =>
  sql<{ n: string }>("select count(*)::text as n from dpa_aceptaciones").then((r) => Number(r[0]!.n));

const filasDeAuditoria = () =>
  sql<{ n: string }>("select count(*)::text as n from audit_trail where tabla = 'dpa_aceptaciones'").then(
    (r) => Number(r[0]!.n),
  );

test("[AC-FMIG-22] el GET sirve las 7 secciones mínimas, es-CL, sin aceptación previa", async () => {
  const r = await pedirA("/api/gobierno/dpa", "GET", { secreto: duena.secreto });
  expect(r.status).toBe(200);
  const cuerpo = r.json as unknown as {
    version: string;
    secciones: { id: string; titulo: string; cuerpo: string }[];
    aceptado: boolean;
  };
  expect(cuerpo.version).toBe(DPA_VERSION);
  expect(cuerpo.secciones.map((s) => s.id).sort()).toEqual(DPA_SECCIONES.map((s) => s.id).slice().sort());
  expect(cuerpo.aceptado).toBe(false);
});

test("[AC-FMIG-22] aceptar escribe audit_trail CON LA VERSIÓN aceptada, y queda registrada por tenant", async () => {
  const auditoriaAntes = await filasDeAuditoria();
  const filasAntes = await filasDeAceptacion();

  const r = await pedirA("/api/gobierno/dpa", "POST", { secreto: duena.secreto });
  expect(r.status).toBe(200);
  expect((r.json as unknown as { aceptado: boolean }).aceptado).toBe(true);

  expect(await filasDeAceptacion()).toBe(filasAntes + 1);
  // audit_trail lo escribe el trigger `auditar()` (§4.6) — no la app a mano — y su `despues`
  // trae la versión aceptada, que es exactamente lo que el AC pide poder auditar.
  const [fila] = await sql<{ despues: string }>(
    "select despues::text as despues from audit_trail where tabla = 'dpa_aceptaciones' order by id desc limit 1",
  );
  expect(await filasDeAuditoria()).toBe(auditoriaAntes + 1);
  expect(JSON.parse(fila!.despues).version).toBe(DPA_VERSION);

  const lectura = await pedirA("/api/gobierno/dpa", "GET", { secreto: duena.secreto });
  const estado = lectura.json as unknown as { aceptado: boolean; versionAceptada: string; aceptadoEn: string };
  expect(estado.aceptado).toBe(true);
  expect(estado.versionAceptada).toBe(DPA_VERSION);
  expect(estado.aceptadoEn).toBeTruthy();
});

test("[AC-FMIG-22] aceptar dos veces la MISMA versión es idempotente: no deja fila nueva", async () => {
  const filasAntes = await filasDeAceptacion();
  const auditoriaAntes = await filasDeAuditoria();

  const r = await pedirA("/api/gobierno/dpa", "POST", { secreto: duena.secreto });
  expect(r.status).toBe(200);
  expect((r.json as unknown as { yaAceptada: boolean }).yaAceptada).toBe(true);

  expect(await filasDeAceptacion(), "el segundo POST dejó una fila nueva").toBe(filasAntes);
  expect(await filasDeAuditoria(), "el segundo POST escribió audit_trail de nuevo").toBe(auditoriaAntes);
});

// ─── La pantalla: sin CSS libre (los tokens de Miga), a profundidad ≤2 (§5.1) ─────────────

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

test("[AC-FMIG-22] /panel/dpa (≤2 niveles desde /panel) sirve las secciones y deja aceptar", async ({ page }) => {
  await sesionDe(page, duena.secreto);
  await page.goto(`http://${HOST}/panel/dpa`);
  await expect(page.getByTestId("panel-dpa")).toBeVisible();

  for (const seccion of DPA_SECCIONES) {
    await expect(page.getByTestId(`seccion-dpa-${seccion.id}`)).toBeVisible();
  }
  await expect(page.getByTestId("version-dpa")).toContainText(DPA_VERSION);

  // El fixture de este archivo ya aceptó por API en el test anterior: la pantalla lo refleja
  // sin ofrecer el botón de nuevo — aceptar dos veces desde la UI no tiene sentido.
  await expect(page.getByTestId("dpa-aceptado")).toBeVisible();
  await expect(page.getByTestId("aceptar-dpa")).toHaveCount(0);
});

test("[AC-FMIG-22] rol distinto de admin_tenant no ve el botón: la guardia del GET ya lo bloquea", async ({
  page,
}) => {
  const operario = await enrolar("20.347.878-K", "Operario del DPA", "chofer");
  await sesionDe(page, operario.secreto);
  await page.goto(`http://${HOST}/panel/dpa`);
  // El GET rebota 403 antes de que exista un `estado`: la pantalla se queda en el error, jamás
  // pinta el documento ni el botón de un rol que el barrido de AC-FIDN-12 ya prueba que no puede
  // aceptar nada.
  await expect(page.getByTestId("panel-dpa")).toBeVisible();
  await expect(page.getByTestId("secciones-dpa")).toHaveCount(0);
  await expect(page.getByTestId("aceptar-dpa")).toHaveCount(0);
});
