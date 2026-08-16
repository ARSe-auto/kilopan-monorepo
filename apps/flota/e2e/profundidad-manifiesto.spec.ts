import { test, expect } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { ROLES } from "../../../packages/nucleo-comun/src/constants.ts";
import {
  profundidadDeManifiesto,
  PROFUNDIDAD_MAXIMA,
  type NodoDeNavegacion,
} from "../src/dominio/manifiesto-profundidad.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Chequeo mecánico de profundidad ≤2 sobre el manifest de navegación, para el covering array
// entitlements × rol [AC-FMIG-21] — §5.1, §5.5, §9.2.
//
// AC-FMIG-01 publicó "máx 2 niveles de profundidad" como CONSTANTE; una constante publicada no
// puede fallar (§5 encabezado), así que este AC es su oráculo conductual. La estructura de
// datos ya lo dice ella misma: `servidor/manifiesto.ts` (AC-FMIG-09) dejó escrito que el
// manifest es "entitlements × rol... estructura de datos testeable" para ESTE chequeo.
//
// EL COVERING ARRAY: 1 entitlement booleano (`modulo_vehiculos` ON/OFF) × 6 roles de
// `rol_usuario` = 12 combinaciones. Con un factor tan chico, la cobertura 2-way ES el cartesiano
// completo — no hace falta el generador PICT de `db/flota/generar-covering-array.mjs` (que
// además apunta hardcodeado a `covering-array-parada.pict`, un dominio distinto): 12 combos
// exhaustivos, sin aproximar nada.
//
// `manifiesto.ts` no puede producir HOY una profundidad > 1 (el catálogo es plano) — la
// aserción de acá igual corre sobre las 12 combinaciones reales, y queda como guardia: el día
// que un ítem agregue `subitems` que a su vez tengan `subitems`, esto se pone rojo. El mutante
// que prueba que el CÁLCULO puede fallar vive en `dominio/manifiesto-profundidad.test.ts` (no
// hace falta un navegador para eso).
//
// BASE PROPIA (`manifiesto_profundidad`): sella `config_version` directamente, igual que
// `contraccion-manifest.spec.ts` (AC-FMIG-09) y por el mismo motivo — compartir `contraccion`
// resellaría su config a mitad de esa suite.

const PUERTO = PUERTO_E2E;
const DOMINIO = "localhost";
const T = TENANTS.find((t) => t.slug === "manifiesto_profundidad")!;
const BD = bdDeTenant(T.slug);
const HOST = `${T.slug}.${DOMINIO}:${PUERTO}`;

type Conexion = { sql: <F = Record<string, string>>(t: string, p?: unknown[]) => Promise<F[]> };
type Respuesta = { status: number; json: Record<string, unknown> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) =>
  con(BD, (c: Conexion) => c.sql<F>(texto, params));

function pedir(ruta: string, secreto: string): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { Host: HOST, Authorization: `Portador ${secreto}` };
  return new Promise((resolver, rechazar) => {
    const req = httpRequest({ host: "127.0.0.1", port: PUERTO, path: ruta, method: "GET", headers: cabeceras }, (res) => {
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
        resolver({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("error", rechazar);
    req.end();
  });
}

/** Sella una config_version del tenant con el entitlement dado — igual patrón que `sellar()` de
 *  `contraccion-manifest.spec.ts` (AC-FMIG-09). */
async function sellar(entitlements: Record<string, boolean>) {
  await sql("select crear_config_version($1, $2::jsonb)", [
    "fixture del e2e de AC-FMIG-21",
    JSON.stringify(entitlements),
  ]);
}

let empresaClienteFixtureId = "";

/** Un usuario POR ROL de `rol_usuario`, para recorrer la dimensión "rol" del covering array.
 *  `cliente` exige `empresa_cliente_id` con FK real (0040_confinamiento_del_cliente.sql) —
 *  una `empresas_cliente` propia del fixture, sembrada una sola vez en `beforeAll`. */
async function enrolarPorRol(rol: string, indice: number): Promise<{ rol: string; secreto: string }> {
  const secreto = secretoNuevo();
  const [p] = await sql<{ id: string }>(
    "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
    [rutDeFixture(indice), `Sesión de rol ${rol}`],
  );
  const empresaClienteId = rol === "cliente" ? empresaClienteFixtureId : null;
  const [u] = await sql<{ id: string }>(
    "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, $2::rol_usuario, $3) returning id::text as id",
    [p!.id, rol, empresaClienteId],
  );
  await sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
     values ('personal', $1, $2, $3, now(), true, true)`,
    [p!.id, hashDeSecreto(secreto), u!.id],
  );
  return { rol, secreto };
}

let sesionesPorRol: { rol: string; secreto: string }[] = [];

test.beforeAll(async () => {
  await limpiarFixture(sql);
  const [empresa] = await sql<{ id: string }>(
    "insert into empresas_cliente (rut, razon_social) values ('76.543.210-9', 'Empresa del fixture de AC-FMIG-21') returning id::text as id",
  );
  empresaClienteFixtureId = empresa!.id;
  sesionesPorRol = await Promise.all(ROLES.map((rol, indice) => enrolarPorRol(rol, indice)));
});

test.describe("[AC-FMIG-21] profundidad ≤2 del manifest — covering array entitlements × rol", () => {
  for (const moduloEncendido of [true, false]) {
    for (const rol of ROLES) {
      test(`modulo_vehiculos=${moduloEncendido} · rol=${rol}`, async () => {
        await sellar({ modulo_vehiculos: moduloEncendido });
        const sesion = sesionesPorRol.find((s) => s.rol === rol)!;
        const r = await pedir("/api/manifiesto", sesion.secreto);
        expect(r.status).toBe(200);
        const items = r.json.items as unknown as NodoDeNavegacion[];
        const profundidad = profundidadDeManifiesto(items);
        expect(
          profundidad,
          `manifest con profundidad ${profundidad} (máx ${PROFUNDIDAD_MAXIMA}) para modulo_vehiculos=${moduloEncendido}, rol=${rol}`,
        ).toBeLessThanOrEqual(PROFUNDIDAD_MAXIMA);
      });
    }
  }
});
