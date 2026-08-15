import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Drill-down línea→evidencia en 1 clic, formatos es-CL, cero inglés [AC-FTAR-07] — spec 06 §9,
// §3.E1.9.
//
// EL FIXTURE llama a `devengar_entrega()` directo por SQL —la MISMA función que la app invoca,
// SECURITY DEFINER, única puerta de escritura de `liquidacion_lineas` (AC-FTAR-03)— en vez de
// recorrer el flujo completo de ruta/entrega del chofer: ese camino ya está probado por
// `pod-feliz.spec.ts` y por acá lo único que hace falta es UNA línea real con evidencia real
// colgando, mismo criterio que `db/flota/suite-bd/disputa-por-linea.test.mjs` (AC-FTAR-06).
const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_DUENA = Object.keys(VALIDOS)[7]!;
const SECRETO_DUENA = secretoNuevo();
const RUT_EMPRESA = "76.543.210-1";
const RAZON_SOCIAL = "Farmacia Drill-Down SpA";

let liquidacionId = "";
let lineaId = "";
let montoClp = 0;

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Dueña drill-down') returning id::text as id",
      [RUT_DUENA],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO_DUENA), u!.id],
    );

    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, $2) returning id::text as id",
      [RUT_EMPRESA, RAZON_SOCIAL],
    );
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local del drill-down', 'Providencia') returning id::text as id",
    );
    const [ruta] = await c.sql<{ id: string }>(
      "insert into rutas (nombre) values ('Ruta del drill-down') returning id::text as id",
    );
    const [parada] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [ruta!.id, destino!.id],
    );
    const [encargo] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 3, 'solicitado') returning id::text as id",
      [empresa!.id, destino!.id],
    );
    await c.sql(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 4200, timestamptz '2026-01-01 00:00-04')",
      [empresa!.id],
    );
    const [pod] = await c.sql<{ id: string }>(
      "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', timestamptz '2026-04-10 15:30-04', -240) returning id::text as id",
      [encargo!.id, parada!.id],
    );
    // Dos capturas colgadas de la parada, mismo `objeto_tabla`/`objeto_id` que usa
    // `registrarBinarioDeEvidencia` (AC-FPOD-19): la firma de recepción y la foto del bulto.
    await c.sql(
      "insert into evidence (tipo, objeto_tabla, objeto_id, capturada_en, tz_offset_min) values ('firma', 'paradas', $1, timestamptz '2026-04-10 15:31-04', -240), ('foto', 'paradas', $1, timestamptz '2026-04-10 15:31-04', -240)",
      [parada!.id],
    );
    const [liq] = await c.sql<{ id: string }>(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, date '2026-04-06', date '2026-04-12') returning id::text as id",
      [empresa!.id],
    );
    liquidacionId = liq!.id;
    const [linea] = await c.sql<{ id: string }>("select devengar_entrega($1, $2)::text as id", [
      pod!.id,
      liq!.id,
    ]);
    lineaId = linea!.id;
    const [montoFila] = await c.sql<{ monto_clp: string }>(
      "select monto_clp::text as monto_clp from liquidacion_lineas where id = $1",
      [lineaId],
    );
    montoClp = Number(montoFila!.monto_clp);
  });
});

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

test("[AC-FTAR-07] un clic sobre la línea abre su evidencia completa, en es-CL", async ({ page }) => {
  await sesionDe(page, SECRETO_DUENA);
  await page.goto(`/liquidaciones?id=${liquidacionId}`);

  await expect(page.getByTestId("liquidacion")).toBeVisible();
  await expect(page.getByTestId("cabecera-liquidacion")).toContainText(RAZON_SOCIAL);
  // RUT es-CL: `12.345.678-5` (§0) — el punto de miles y el guión antes del dígito verificador.
  await expect(page.getByTestId("empresa-rut")).toHaveText("RUT 76.543.210-1");
  // Fecha es-CL dd-mm-aaaa (§0), no mm-dd-aaaa.
  await expect(page.getByTestId("cabecera-liquidacion")).toContainText("06-04-2026 a 12-04-2026");

  const linea = page.getByTestId("linea-liquidacion").first();
  await expect(linea).toBeVisible();
  // CLP es-CL: punto de miles, signo peso, sin decimales (§0).
  const clpEsperado = `$${montoClp.toLocaleString("es-CL")}`;
  await expect(linea.getByTestId("monto-linea")).toHaveText(clpEsperado);

  // ── LA UNA INTERACCIÓN [AC-FTAR-07]: UN clic, y la evidencia completa queda visible ──
  await expect(page.getByTestId(`evidencia-linea-${lineaId}`)).toHaveCount(0);
  await page.getByTestId(`abrir-evidencia-${lineaId}`).click();

  const evidencia = page.getByTestId(`evidencia-linea-${lineaId}`);
  await expect(evidencia).toBeVisible();
  await expect(evidencia.getByTestId("evidencia-resultado")).toHaveText("Entregado");
  await expect(evidencia.getByTestId("evidencia-capturas").getByTestId("evidencia-captura")).toHaveCount(2);
  await expect(evidencia.getByTestId("evidencia-capturas")).toContainText("Firma");
  await expect(evidencia.getByTestId("evidencia-capturas")).toContainText("Foto");
  // La hora de captura también en es-CL: `dd-mm-aaaa hh:mm`, jamás `4/10/2026`.
  await expect(evidencia.getByTestId("evidencia-capturas")).toContainText("10-04-2026");
});

test("[AC-FTAR-07] sin sesión, la liquidación de otro tenant no existe: 404 pelado", async ({ request }) => {
  const r = await request.get(`/api/liquidaciones/${liquidacionId}`);
  expect(r.status()).toBe(404);
});
