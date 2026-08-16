import { test, expect, request as playwrightRequest } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { origenDe } from "./puerto.ts";

// Contracción por modo/entitlement del módulo 06 [AC-FTAR-18] — spec 06 §3 selector, §5.5, §0.
//
// Es la MITAD de mutación que AC-FTAR-12 dejó partida: aquella probó que conmutar el modo es
// aditivo sobre las 5 tablas del módulo; esta prueba lo otro que el §3 promete —«quedan OFF y
// ocultos»— del lado de la puerta HTTP. El manifest ya lo cumple desde AC-FPOR-03
// (`dominio/manifest.ts`: un módulo del grupo DaaS sin entitlement no entra en la navegación), y
// sin este 403 esa contracción sería decorativa: el enlace no estaría, y la API contestaría igual
// a cualquiera que tipeara la URL o guardara el marcador de ayer.
//
// ─── POR QUÉ EL ENTITLEMENT SE SELLA A MANO ──────────────────────────────────────────────
//
// La resolución real (recorte del modo → override → plan, `entitlement_efectivo` en `control`)
// necesita que el plan del tenant TRAIGA la feature, y el sembrado de planes es del hito (g). La
// 0009 puso las cuatro `lookup_key` del grupo DaaS en el catálogo de `features` —sin ella este
// gate era imposible de construir sin dejar `daas` tan bloqueado como `mi_flota`— pero ninguna
// `plan_features` las enciende todavía. Así que la suite sella `config_version` DIRECTO con el
// snapshot que ese bootstrap entregará el día que exista, exactamente como `portal-cliente`,
// `contraccion` (AC-FMIG-09) y `cruce-tenant` hacen con sus propias features.
//
// Base PROPIA (`liquidacion_contraccion`) y no `ruteo_activo`: `config_version` es append-only,
// así que el sellado en OFF quedaría como versión vigente para `liquidacion-drill-down.spec.ts`,
// que corre después sobre la misma base y necesita el módulo encendido.

const SLUG = "liquidacion_contraccion";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_ADMIN = "9.111.222-1";
const SECRETO_ADMIN = secretoNuevo();
const RUT_EMPRESA = "76.303.404-6";
const RAZON_SOCIAL = "Contratante de la Contracción SpA";

let liquidacionId = "";
let lineaId = "";

/** Sella la config vigente con el grupo DaaS en el estado pedido. Es lo que el bootstrap del
 *  hito (g) congelará solo; acá se escribe el mismo snapshot a mano. */
async function sellarModulo(encendido: boolean) {
  await con(BD, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      `e2e AC-FTAR-18 — liquidacion_por_cliente=${encendido}`,
      JSON.stringify({
        tarifas: encendido,
        liquidacion_por_cliente: encendido,
        portal_contratante: encendido,
        facturacion: encendido,
      }),
    ]),
  );
}

const cabeceras = { Authorization: `Portador ${SECRETO_ADMIN}` };

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Dueña de la contracción') returning id::text as id",
      [RUT_ADMIN],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO_ADMIN), u!.id],
    );

    // Una liquidación REAL con una línea devengada por la MISMA puerta que usa la app
    // (`devengar_entrega()`, SECURITY DEFINER, AC-FTAR-03): con datos de verdad, un 403 prueba
    // que la puerta cerró, y no que no había nada que devolver.
    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, $2) returning id::text as id",
      [RUT_EMPRESA, RAZON_SOCIAL],
    );
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local de la contracción', 'Providencia') returning id::text as id",
    );
    const [ruta] = await c.sql<{ id: string }>(
      "insert into rutas (nombre) values ('Ruta de la contracción') returning id::text as id",
    );
    const [parada] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [ruta!.id, destino!.id],
    );
    const [encargo] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 4, 'solicitado') returning id::text as id",
      [empresa!.id, destino!.id],
    );
    await c.sql(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 5100, timestamptz '2026-01-01 00:00-04')",
      [empresa!.id],
    );
    const [pod] = await c.sql<{ id: string }>(
      "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', timestamptz '2026-04-10 15:30-04', -240) returning id::text as id",
      [encargo!.id, parada!.id],
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
  });
});

test("[AC-FTAR-18] con el módulo apagado, las dos puertas de lectura contestan 403 y no dejan salir un peso", async () => {
  await sellarModulo(false);

  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    for (const ruta of [
      `/api/liquidaciones/${liquidacionId}`,
      `/api/liquidacion-lineas/${lineaId}/evidencia`,
    ]) {
      const r = await ctx.get(ruta, { headers: cabeceras });
      expect(r.status(), `${ruta} con el módulo apagado debía dar 403`).toBe(403);
      const cuerpo = await r.text();
      expect(JSON.parse(cuerpo).error).toBe("modulo_apagado");
      // El 403 no puede ser una filtración con otro nombre: ni la razón social del contratante,
      // ni su RUT, ni un CLP pueden viajar en el cuerpo del rebote (§8, §4.8).
      expect(cuerpo).not.toContain(RAZON_SOCIAL);
      expect(cuerpo).not.toContain(RUT_EMPRESA);
      expect(cuerpo).not.toContain("5100");
    }

    // Y el 403 es del MÓDULO, no del id: contra un uuid que no existe en esta base contesta lo
    // mismo. Si contestara 404 acá y 403 allá, la puerta cerrada estaría diciendo qué ids existen.
    const inventado = await ctx.get("/api/liquidaciones/00000000-0000-4000-8000-000000000000", {
      headers: cabeceras,
    });
    expect(inventado.status()).toBe(403);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FTAR-18] encendido de nuevo, las mismas puertas vuelven a contestar 200 con los mismos ids", async () => {
  // La contracción es ADITIVA, jamás destructiva (centinela 11, la mitad que ya cerró AC-FTAR-12):
  // apagar el módulo no borró la liquidación ni su línea, así que volver a encenderlo las devuelve
  // enteras — sin restaurar nada y con los MISMOS identificadores.
  await sellarModulo(true);

  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/api/liquidaciones/${liquidacionId}`, { headers: cabeceras });
    expect(r.status(), "con el módulo encendido la liquidación propia debía abrirse").toBe(200);
    const { liquidacion } = (await r.json()) as {
      liquidacion: { id: string; empresa_razon_social: string; lineas: { id: string }[] };
    };
    expect(liquidacion.id).toBe(liquidacionId);
    expect(liquidacion.empresa_razon_social).toBe(RAZON_SOCIAL);
    expect(liquidacion.lineas.map((l) => l.id)).toContain(lineaId);

    const e = await ctx.get(`/api/liquidacion-lineas/${lineaId}/evidencia`, { headers: cabeceras });
    expect(e.status(), "con el módulo encendido el drill-down debía abrirse").toBe(200);
  } finally {
    await ctx.dispose();
  }
});
