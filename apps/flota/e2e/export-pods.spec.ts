import { test, expect } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { origenDe } from "./puerto.ts";

// `page.request` es networking NATIVO de Playwright: no pasa por el `fetch` de la app, así
// que el `Authorization: Portador <secreto>` que arma `cliente/aparato.ts` en cada request
// real del navegador acá hay que ponerlo a mano — mismo formato exacto que lee
// `servidor/sesion.ts::secretoDeCabecera`.
function conSesion(secreto: string) {
  return { headers: { authorization: `Portador ${secreto}` } };
}

// Export de PODs por rango [AC-FTEL-07] — §11 punto 4: rango + empresa ⇒ CSV es-CL con el
// resultado por ítem (parciales y devoluciones) y referencia de evidencia. El generador en sí
// (`filasACsv`/`resultadoDeItem`) ya lo prueba `dominio/export-pods.test.ts`; esta suite es el
// camino completo BD → `/api/export-pods` → CSV, con conteos contra la BD.
const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
const EN_A = origenDe(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_GESTORA = "19.654.321-K";
const SECRETO = secretoNuevo();
const RUT_EMPRESA = "76.678.234-5";
const RUT_EMPRESA_VECINA = "77.345.612-7";
const RAZON_SOCIAL = "Export PODs SpA";

const DESDE = "2026-05-04";
const HASTA = "2026-05-08";
const FECHA_EN_RANGO = "2026-05-05";
const FECHA_FUERA_DE_RANGO = "2026-06-01";
// 32 bytes exactos (64 hex): `evidence_sha256_de_32_bytes` (0002) rebota cualquier hash corto.
const SHA256_FOTO = "97a452f16151923f8329088f3d9acf40ca451b158e074206a2122fefb9d3bda4";

let empresaId = "";
let esperadas = 0;

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Gestora del export de PODs') returning id::text as id",
      [RUT_GESTORA],
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

    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, $2) returning id::text as id",
      [RUT_EMPRESA, RAZON_SOCIAL],
    );
    empresaId = empresa!.id;
    const [empresaVecina] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Vecina del export SpA') returning id::text as id",
      [RUT_EMPRESA_VECINA],
    );
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Bodega del export de PODs', 'Ñuñoa') returning id::text as id",
    );

    const [ruta] = await c.sql<{ id: string }>(
      "insert into rutas (nombre, fecha_servicio) values ('Ruta del export de PODs', $1) returning id::text as id",
      [FECHA_EN_RANGO],
    );
    const [parada] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [ruta!.id, destino!.id],
    );

    // Los tres resultados por ítem que el AC pide distinguir: éxito, parcial y devolución
    // completa (0037: `qty_entregada`/`qty_rechazada` los escribe el módulo 04 al capturar el
    // POD; para este AC de aguas abajo se fixturean directo, mismo criterio que
    // `toques-flujo.spec.ts` y `cierre-ruta.spec.ts`).
    for (const [entregados, rechazados] of [
      [6, 0],
      [2, 4],
      [0, 6],
    ] as const) {
      const [encargo] = await c.sql<{ id: string }>(
        "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 6, 'aceptado') returning id::text as id",
        [empresaId, destino!.id],
      );
      await c.sql(
        "insert into items (parada_id, encargo_id, qty_planificada, qty_entregada, qty_rechazada) values ($1, $2, 6, $3, $4)",
        [parada!.id, encargo!.id, entregados, rechazados],
      );
    }
    esperadas = 3;

    // La evidencia de ESA parada: una firma sin binario y una foto con sha256 — el CSV toma la
    // MÁS RECIENTE (la foto), y el caso "sin binario" ya lo cubre el unit de dominio.
    // El hash va con los 32 bytes exactos que exige `evidence_sha256_de_32_bytes` (0002): un
    // sha256 real, no un valor corto de relleno.
    await c.sql(
      `insert into evidence (tipo, objeto_tabla, objeto_id, sha256, capturada_en, tz_offset_min)
       values ('firma', 'paradas', $1, null, timestamptz '2026-05-05 10:00:00-04', -240),
              ('foto', 'paradas', $1, decode($2, 'hex'), timestamptz '2026-05-05 10:05:00-04', -240)`,
      [parada!.id, SHA256_FOTO],
    );

    // Un ítem de la empresa VECINA en la MISMA parada: no puede colarse cuando el filtro es
    // por `empresaId` (§7.2: el desglose por empresa vive en `items.empresa_cliente_id`).
    const [encargoVecino] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 4, 'aceptado') returning id::text as id",
      [empresaVecina!.id, destino!.id],
    );
    await c.sql(
      "insert into items (parada_id, encargo_id, qty_planificada, qty_entregada) values ($1, $2, 4, 4)",
      [parada!.id, encargoVecino!.id],
    );

    // Un ítem de LA MISMA empresa pero fuera del rango de fechas: tampoco puede aparecer.
    const [rutaFuera] = await c.sql<{ id: string }>(
      "insert into rutas (nombre, fecha_servicio) values ('Ruta fuera del rango del export', $1) returning id::text as id",
      [FECHA_FUERA_DE_RANGO],
    );
    const [paradaFuera] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [rutaFuera!.id, destino!.id],
    );
    const [encargoFuera] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 3, 'aceptado') returning id::text as id",
      [empresaId, destino!.id],
    );
    await c.sql(
      "insert into items (parada_id, encargo_id, qty_planificada, qty_entregada) values ($1, $2, 3, 3)",
      [paradaFuera!.id, encargoFuera!.id],
    );
  });
});

test("[AC-FTEL-07] CSV es-CL con el resultado por ítem, filtrado por rango y empresa, con conteo contra la BD", async ({
  request,
}) => {
  const r = await request.get(
    `${EN_A}/api/export-pods?desde=${DESDE}&hasta=${HASTA}&empresa_id=${empresaId}`,
    conSesion(SECRETO),
  );
  expect(r.ok()).toBeTruthy();
  expect(r.headers()["content-type"]).toContain("text/csv");
  expect(r.headers()["content-disposition"]).toContain("attachment");

  const cuerpo = await r.text();
  const lineas = cuerpo.split("\n");
  expect(lineas[0]).toBe(
    "fecha;empresa;encargo_id;destino;bultos_planificados;bultos_entregados;bultos_rechazados;resultado_item;evidencia_tipo;evidencia_sha256;temperatura",
  );

  // Conteo contra la BD: exactamente las 3 filas del rango+empresa, ni la vecina ni la de
  // fuera de rango.
  const filas = lineas.slice(1).filter((l) => l.length > 0);
  expect(filas).toHaveLength(esperadas);

  // Fecha es-CL dd-mm-aaaa (§0), separador `;`, resultado por ítem y evidencia de la parada
  // (la foto más reciente, con su hash) — cada fila la lleva porque comparten parada.
  for (const linea of filas) {
    expect(linea.startsWith("05-05-2026;Export PODs SpA;")).toBeTruthy();
    expect(linea).toContain(`;foto;${SHA256_FOTO};`);
    // Columna `temperatura` reservada y vacía: la línea termina en `;` (§11 punto 4).
    expect(linea.endsWith(";")).toBeTruthy();
  }
  expect(filas.some((l) => l.includes(";exito;"))).toBeTruthy();
  expect(filas.some((l) => l.includes(";parcial;"))).toBeTruthy();
  expect(filas.some((l) => l.includes(";fallo;"))).toBeTruthy();

  // Cero rastro de la empresa vecina.
  expect(cuerpo).not.toContain("Vecina del export SpA");
});

test("[AC-FTEL-07] sin rango o empresa válidos, 422 y ningún archivo", async ({ request }) => {
  const sinEmpresa = await request.get(`${EN_A}/api/export-pods?desde=${DESDE}&hasta=${HASTA}`, conSesion(SECRETO));
  expect(sinEmpresa.status()).toBe(422);

  const fechaMala = await request.get(
    `${EN_A}/api/export-pods?desde=05-05-2026&hasta=${HASTA}&empresa_id=${empresaId}`,
    conSesion(SECRETO),
  );
  expect(fechaMala.status()).toBe(422);

  const rangoInvertido = await request.get(
    `${EN_A}/api/export-pods?desde=${HASTA}&hasta=${DESDE}&empresa_id=${empresaId}`,
    conSesion(SECRETO),
  );
  expect(rangoInvertido.status()).toBe(422);
});

test("[AC-FTEL-07] sin Authorization, 404 pelado y no un 401 que confirme que la ruta existe", async ({
  request,
}) => {
  const r = await request.get(`${EN_A}/api/export-pods?desde=${DESDE}&hasta=${HASTA}&empresa_id=${empresaId}`);
  expect(r.status()).toBe(404);
});
