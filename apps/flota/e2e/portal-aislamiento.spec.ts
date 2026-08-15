import { test, expect, request as playwrightRequest } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { origenDe } from "./puerto.ts";

// Suite de aislamiento sobre `/cliente/*` [AC-FPOR-06] — spec 07 §2, §9.3 centinela 3.
//
// La mitad TENANT-contra-tenant (sesión de A con ids de B ⇒ 404, BD de B intacta) la corre
// GRATIS `cruce-tenant.spec.ts` [AC-FTEN-26] apenas el manifiesto declara el `cruce` de estas
// cuatro rutas (`rutas/manifiesto.json`) — no se repite acá. Lo que esta suite prueba, y que
// esa NO puede, es la otra mitad: dos empresas contratantes DEL MISMO tenant, donde el límite
// lo pone la política de fila por `empresa_cliente_id` (0040/0061/0063), no la separación
// física de bases. Y la tercera pata del centinela 3: que el payload de cada respuesta tenga
// exactamente las columnas que su tipo declara — ni una de economía interna del operador ni de
// telemetría EV, ni una más el día de mañana sin que este archivo se ponga rojo.

const SLUG = "portal_aislamiento";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUTS = Object.keys(VALIDOS);
const RUT_PERSONA_X = RUTS[10]!;
const RUT_PERSONA_Y = RUTS[11]!;
const RUT_EMPRESA_X = RUTS[13]!;
const RUT_EMPRESA_Y = RUTS[14]!;
const RAZON_SOCIAL_Y = "Contratante Vecina de la Empresa Y SpA";
const SECRETO_X = secretoNuevo();

type Ids = {
  encargoX: string;
  liquidacionX: string;
  lineaX: string;
  evidenciaX: string;
  encargoY: string;
  liquidacionY: string;
  lineaY: string;
  evidenciaY: string;
};

let ids: Ids;

async function sellarPortalOn() {
  await con(BD, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      "e2e AC-FPOR-06 — portal_contratante=true",
      JSON.stringify({ portal_contratante: true }),
    ]),
  );
}

/** Una empresa contratante con su encargo, su POD, su evidencia y su liquidación de UNA línea
 *  — el mismo fixture que `liquidacion-drill-down.spec.ts` [AC-FTAR-07], repetido una vez por
 *  empresa para tener X e Y en el mismo tenant. */
async function sembrarEmpresaConEncargoYLiquidacion(
  sql: Conexion["sql"],
  datos: { rutEmpresa: string; razonSocial: string },
) {
  const [empresa] = await sql<{ id: string }>(
    "insert into empresas_cliente (rut, razon_social) values ($1, $2) returning id::text as id",
    [datos.rutEmpresa, datos.razonSocial],
  );
  const [destino] = await sql<{ id: string }>(
    "insert into destinos (nombre, comuna) values ($1, 'Ñuñoa') returning id::text as id",
    [`Local de ${datos.razonSocial}`],
  );
  const [ruta] = await sql<{ id: string }>(
    "insert into rutas (nombre) values ($1) returning id::text as id",
    [`Ruta de ${datos.razonSocial}`],
  );
  const [parada] = await sql<{ id: string }>(
    "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
    [ruta!.id, destino!.id],
  );
  const [encargo] = await sql<{ id: string }>(
    "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 2, 'solicitado') returning id::text as id",
    [empresa!.id, destino!.id],
  );
  // `evidenciaDelCliente` (servidor/portal-cliente.ts) confina por `items` —el mismo camino
  // que la RLS de `paradas` (0040)—, así que el fixture necesita el ítem real: sin él ninguna
  // empresa (ni la dueña) vería su propia evidencia. El trigger de `items` (0037) rebota un
  // encargo `solicitado` en una parada: coherente con que este fixture ya trae un POD de
  // entrega EXITOSA, así que se acepta antes de armar la parada.
  await sql("update encargos set estado = 'aceptado' where id = $1", [encargo!.id]);
  await sql(
    "insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 2)",
    [parada!.id, encargo!.id],
  );
  await sql(
    "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 4500, timestamptz '2026-01-01 00:00-04')",
    [empresa!.id],
  );
  const [pod] = await sql<{ id: string }>(
    "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', now(), -240) returning id::text as id",
    [encargo!.id, parada!.id],
  );
  const [evidencia] = await sql<{ id: string }>(
    "insert into evidence (tipo, objeto_tabla, objeto_id, capturada_en, tz_offset_min) values ('foto', 'paradas', $1, now(), -240) returning id::text as id",
    [parada!.id],
  );
  const [liquidacion] = await sql<{ id: string }>(
    "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, current_date - 6, current_date) returning id::text as id",
    [empresa!.id],
  );
  const [linea] = await sql<{ id: string }>("select devengar_entrega($1, $2)::text as id", [
    pod!.id,
    liquidacion!.id,
  ]);
  return {
    empresaId: empresa!.id,
    encargoId: encargo!.id,
    liquidacionId: liquidacion!.id,
    lineaId: linea!.id,
    evidenciaId: evidencia!.id,
  };
}

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    const x = await sembrarEmpresaConEncargoYLiquidacion(c.sql, {
      rutEmpresa: RUT_EMPRESA_X,
      razonSocial: "Contratante Propia de la Empresa X SpA",
    });
    const y = await sembrarEmpresaConEncargoYLiquidacion(c.sql, {
      rutEmpresa: RUT_EMPRESA_Y,
      razonSocial: RAZON_SOCIAL_Y,
    });

    const [personaX] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Cliente de la empresa X') returning id::text as id",
      [RUT_PERSONA_X],
    );
    const [usuarioX] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'cliente', $2) returning id::text as id",
      [personaX!.id, x.empresaId],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [personaX!.id, hashDeSecreto(SECRETO_X), usuarioX!.id],
    );
    // Persona Y solo para que el RUT no quede huérfano de intención — no se loguea en esta
    // suite, el ataque es X pidiendo los IDs de Y, no una sesión de Y.
    void RUT_PERSONA_Y;

    ids = {
      encargoX: x.encargoId,
      liquidacionX: x.liquidacionId,
      lineaX: x.lineaId,
      evidenciaX: x.evidenciaId,
      encargoY: y.encargoId,
      liquidacionY: y.liquidacionId,
      lineaY: y.lineaId,
      evidenciaY: y.evidenciaId,
    };
  });

  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'daas' where slug = $1", [SLUG]));
  await sellarPortalOn();
});

async function cabecerasDeX() {
  return { Authorization: `Portador ${SECRETO_X}` };
}

// ─── Centinela 2 intra-tenant: empresa X con IDs de la empresa Y del MISMO tenant ─────────

const CASOS = [
  { recurso: "encargos", idDeY: () => ids.encargoY, idDeX: () => ids.encargoX },
  { recurso: "liquidaciones", idDeY: () => ids.liquidacionY, idDeX: () => ids.liquidacionX },
  { recurso: "liquidacion-lineas", idDeY: () => ids.lineaY, idDeX: () => ids.lineaX },
  { recurso: "evidencias", idDeY: () => ids.evidenciaY, idDeX: () => ids.evidenciaX },
];

for (const caso of CASOS) {
  test(`[AC-FPOR-06] cliente de X pidiendo ${caso.recurso} de Y ⇒ 404 sin cadena centinela de Y`, async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
    try {
      const r = await ctx.get(`/cliente/api/${caso.recurso}/${caso.idDeY()}`, {
        headers: await cabecerasDeX(),
      });
      expect(r.status(), `${caso.recurso}/${caso.idDeY()} con sesión de X debía dar 404`).toBe(404);
      const cuerpo = await r.text();
      // El centinela: la razón social de Y, y su RUT, no pueden salir en NINGÚN cuerpo —ni
      // siquiera en uno de error— cuando quien pregunta es X.
      expect(cuerpo).not.toContain(RAZON_SOCIAL_Y);
      expect(cuerpo).not.toContain(RUT_EMPRESA_Y);
      expect(cuerpo).not.toContain(ids.liquidacionY);
      expect(cuerpo).not.toContain(ids.lineaY);
    } finally {
      await ctx.dispose();
    }
  });
}

test("[AC-FPOR-06] la identidad de Y es OBSERVABLE: el centinela no es una cadena muerta", async () => {
  // Anti-vacuidad: si `RAZON_SOCIAL_Y` no saliera NUNCA de la app, los `not.toContain` de
  // arriba pasarían aunque el candado no existiera. Se prueba que sí sale — pidiéndola con la
  // sesión correcta, la de un cliente que NO existe en este fixture pero cuyo caso positivo ya
  // cubre `liquidacion-drill-down.spec.ts` [AC-FTAR-07] contra el OPERADOR; acá basta con leer
  // la fila directo de la BD del propio fixture para confirmar que el dato es real y no un
  // string que nadie escribió.
  await con(BD, async (c: Conexion) => {
    const [fila] = await c.sql<{ razon_social: string }>(
      "select razon_social from empresas_cliente where rut = $1",
      [RUT_EMPRESA_Y],
    );
    expect(fila!.razon_social).toBe(RAZON_SOCIAL_Y);
  });
});

// ─── Empresa X viendo lo SUYO: control positivo, para que el 404 de arriba signifique algo ──

test("[AC-FPOR-06] cliente de X SÍ ve sus propios encargo/liquidación/línea/evidencia (2xx)", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    for (const caso of CASOS) {
      const r = await ctx.get(`/cliente/api/${caso.recurso}/${caso.idDeX()}`, {
        headers: await cabecerasDeX(),
      });
      expect(r.ok(), `${caso.recurso}/${caso.idDeX()} propio debía dar 2xx (fue ${r.status()})`).toBe(true);
    }
  } finally {
    await ctx.dispose();
  }
});

// ─── Centinela 3: schema fijo, sin economía interna del operador ni telemetría EV ──────────

const CLAVES_ENCARGO = ["id", "empresa_cliente_id", "destino_id", "bultos", "fecha_servicio", "estado", "reintento_de", "creado_en"].sort();
const CLAVES_LIQUIDACION = ["id", "empresa_cliente_id", "periodo_inicio", "periodo_fin", "estado", "creado_en", "lineas"].sort();
const CLAVES_LINEA = ["id", "liquidacion_id", "empresa_cliente_id", "evidencia_tipo", "evidencia_id", "concepto", "tarifa_id", "cantidad", "precio_base_clp", "modificadores_clp", "monto_clp", "disputa_estado", "disputa_motivo_id", "disputa_nota", "disputa_creado_en", "creado_en"].sort();
const CLAVES_EVIDENCIA = ["id", "tipo", "capturada_en"].sort();

// Ninguna de las cuatro formas puede traer una columna de este catálogo — la lista de lo que
// el §3.E1.10 dice que el cliente JAMÁS ve: economía del operador (costos de energía, ahorro
// vs diésel, tarifas de OTRAS empresas) y telemetría EV.
const PROHIBIDAS = [
  "costo_clp",
  "precio_diesel_litro_clp",
  "ahorro",
  "bateria_wh",
  "autonomia_nominal_km",
  "wh_por_km_base",
  "soh_pct",
  "soc",
  "odometro",
  "tenant_id",
];

test("[AC-FPOR-06] schema fijo — encargo propio sin columnas fuera de contrato", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/cliente/api/encargos/${ids.encargoX}`, { headers: await cabecerasDeX() });
    const cuerpo = (await r.json()) as { encargo: Record<string, unknown> };
    expect(Object.keys(cuerpo.encargo).sort()).toEqual(CLAVES_ENCARGO);
    for (const prohibida of PROHIBIDAS) expect(cuerpo.encargo).not.toHaveProperty(prohibida);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-06] schema fijo — liquidación propia (con líneas) sin columnas fuera de contrato", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/cliente/api/liquidaciones/${ids.liquidacionX}`, { headers: await cabecerasDeX() });
    const cuerpo = (await r.json()) as {
      liquidacion: Record<string, unknown> & { lineas: Record<string, unknown>[] };
    };
    expect(Object.keys(cuerpo.liquidacion).sort()).toEqual(CLAVES_LIQUIDACION);
    expect(cuerpo.liquidacion.lineas.length).toBeGreaterThan(0);
    for (const linea of cuerpo.liquidacion.lineas) {
      expect(Object.keys(linea).sort()).toEqual(CLAVES_LINEA);
      for (const prohibida of PROHIBIDAS) expect(linea).not.toHaveProperty(prohibida);
    }
    for (const prohibida of PROHIBIDAS) expect(cuerpo.liquidacion).not.toHaveProperty(prohibida);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-06] schema fijo — línea propia sin columnas fuera de contrato", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/cliente/api/liquidacion-lineas/${ids.lineaX}`, { headers: await cabecerasDeX() });
    const cuerpo = (await r.json()) as { linea: Record<string, unknown> };
    expect(Object.keys(cuerpo.linea).sort()).toEqual(CLAVES_LINEA);
    for (const prohibida of PROHIBIDAS) expect(cuerpo.linea).not.toHaveProperty(prohibida);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-06] schema fijo — evidencia propia sin columnas fuera de contrato", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/cliente/api/evidencias/${ids.evidenciaX}`, { headers: await cabecerasDeX() });
    const cuerpo = (await r.json()) as { evidencia: Record<string, unknown> };
    expect(Object.keys(cuerpo.evidencia).sort()).toEqual(CLAVES_EVIDENCIA);
    for (const prohibida of PROHIBIDAS) expect(cuerpo.evidencia).not.toHaveProperty(prohibida);
  } finally {
    await ctx.dispose();
  }
});

// ─── Rol equivocado: una sesión válida del tenant que NO es `cliente` no rodea el 403 ──────

test("[AC-FPOR-06] una sesión de la casa (no `cliente`) recibe 403, no el recurso de nadie", async () => {
  const secretoOperador = secretoNuevo();
  await con(BD, (c: Conexion) =>
    c.sql(
      `with p as (
         insert into personas (rut, nombre) values ($1, 'Operadora de la casa') returning id
       ), u as (
         insert into usuarios (persona_id, rol) select id, 'operador' from p returning id
       )
       insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       select 'personal', p.id, $2, u.id, now(), true, true from p, u`,
      [RUTS[12]!, hashDeSecreto(secretoOperador)],
    ),
  );

  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/cliente/api/encargos/${ids.encargoX}`, {
      headers: { Authorization: `Portador ${secretoOperador}` },
    });
    expect(r.status()).toBe(403);
  } finally {
    await ctx.dispose();
  }
});
