import { test, expect, request as playwrightRequest } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { origenDe } from "./puerto.ts";

// El gate HTTP del portal del contratante [AC-FPOR-04] — spec 07 §1, §0 HTTP.modulo_apagado.
//
// ─── POR QUÉ SE SELLA `config_version` DIRECTO, Y NO SE CONMUTA `modo` ───────────────────
//
// El §4.4 es explícito: el runtime NUNCA vuelve a consultar `control` — el entitlement que
// rige es el CONGELADO en `config_version`, y solo se re-sella al SELLAR una versión nueva
// (§5.5). Sembrar ese sellado real hoy exigiría `plan_features`/overrides del panel «Funciones»
// (hito g, todavía no construido — mismo motivo por el que `dominio/manifest.ts` resuelve sus
// entitlements por fixture y no contra `control`). Por eso acá se llama a
// `crear_config_version()` —la MISMA función que usa `servidor/config.ts` para el primer
// sellado, y la misma que usa `sembrarIdentidadDelVecino` para fijar el turno del vecino— con
// el entitlement puesto a mano: es la vía real del sistema, con el sembrado del hito (g)
// adelantado por fixture, no un atajo que se salte el gate.
//
// Base PROPIA (`portal_cliente`, en `preparar-tenants.mjs`) porque `config_version` es
// APPEND-ONLY: esta suite necesita demostrar OFF y DESPUÉS ON en la misma corrida, y
// compartiendo la base del primer activo la versión que otra suite ya selló seguiría vigente.

const SLUG = "portal_cliente";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

async function sellarEntitlement(portalContratante: boolean) {
  await con(BD, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      `e2e AC-FPOR-04 — portal_contratante=${portalContratante}`,
      JSON.stringify({ portal_contratante: portalContratante }),
    ]),
  );
}

/** Todas del §5.7-independiente: rutas reales o inventadas, todas bajo el prefijo del portal —
 *  el AC pide que el 403 sea del NAMESPACE, no de una pantalla en particular. */
const RUTAS_DEL_NAMESPACE = ["/cliente", "/cliente/", "/cliente/hoy", "/cliente/lo-que-sea/123"];

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);
  });
  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'mi_flota' where slug = $1", [SLUG]));
});

test("[AC-FPOR-04] portal apagado (mi_flota): TODA ruta /cliente/*, real o no, responde 403 — sin sesión", async () => {
  await sellarEntitlement(false);
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    for (const ruta of RUTAS_DEL_NAMESPACE) {
      const r = await ctx.get(ruta);
      expect(r.status(), `«${ruta}» debía responder 403 con el portal apagado`).toBe(403);
      expect((await r.text()).toLowerCase()).toContain("no disponible");
    }
    // Un nombre parecido, FUERA del namespace, no cae en el candado: sigue su camino normal
    // (404, porque la ruta no existe) — si el gate confundiera prefijo con substring, esto
    // también daría 403 y el test de arriba no probaría nada sobre el corte por segmento.
    const ajena = await ctx.get("/clientela");
    expect(ajena.status()).not.toBe(403);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-04] portal apagado: tampoco entra con una sesión válida del tenant", async () => {
  await sellarEntitlement(false);
  const secreto = secretoNuevo();
  await con(BD, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Dueña del tenant') returning id::text as id",
      [Object.keys(VALIDOS)[1]!],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(secreto), u!.id],
    );
  });

  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get("/cliente", { headers: { Authorization: `Portador ${secreto}` } });
    expect(r.status(), "una sesión de la casa no debería rodear el módulo apagado").toBe(403);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-04] portal encendido en daas: las mismas rutas responden 2xx para el rol cliente", async () => {
  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'daas' where slug = $1", [SLUG]));
  await sellarEntitlement(true);

  const secreto = secretoNuevo();
  await con(BD, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería contratante') returning id::text as id",
      [Object.keys(VALIDOS)[2]!],
    );
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'El contratante') returning id::text as id",
      [Object.keys(VALIDOS)[3]!],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'cliente', $2) returning id::text as id",
      [p!.id, empresa!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(secreto), u!.id],
    );
  });

  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get("/cliente", { headers: { Authorization: `Portador ${secreto}` } });
    expect(r.ok(), `el portal encendido en daas debía responder 2xx para el rol cliente (status ${r.status()})`).toBe(
      true,
    );
  } finally {
    await ctx.dispose();
  }
});
