import { test, expect } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Contracción sin residuos del módulo de tarifas y liquidación [AC-FTAR-12] — spec 06 §3
// selector, §9.3.11. Mismo patrón que `semaforo-contraccion.spec.ts` (AC-FSEM-13) y
// `modo.spec.ts` (AC-FRUT-14): contar CADA tabla propia del módulo antes y después del viaje
// `mi_flota → daas → mi_flota`, comparando `string_agg(id::text)` y no solo el conteo, para que
// un DELETE+recreate con la misma cantidad de filas no pase por «no perdió nada».
//
// La mitad «el manifest de navegación no incluye tarifas/liquidación/facturación cuando el modo
// o el feature están OFF, y sus endpoints ⇒ 403» queda partida al AC-FTAR-18 (BLOQUEADO): las 4
// `lookup_key` que `modo_recorte` ya recorta (tenant/0003) nunca se insertaron en la tabla
// `features` de `control`, así que el snapshot congelado de entitlements jamás las incluye para
// NINGÚN modo — construir el gate hoy dejaría `daas` tan bloqueado como `mi_flota` y rompería el
// camino dorado de AC-FTAR-07. Esta suite solo ejerce la mitad que SÍ es observable hoy: que
// conmutar el modo del tenant es aditivo, jamás destructivo, sobre las 5 tablas del módulo.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_EMPRESA = "76.222.333-3";
const RAZON_SOCIAL = "Contracción Tarifas SpA";

async function conmutarDirecto(modo: "mi_flota" | "daas") {
  await con(BD_CONTROL, (c: Conexion) =>
    c.sql("update tenants set modo = $2::tenant_modo where slug = $1", [A.slug, modo]),
  );
  await con(BD_A, (c: Conexion) => c.sql("update tenant_info set modo = $1", [modo]));
}

/** Las 5 tablas propias del módulo 06 (§4.5, §4.6): conteo + identidad de fila. */
async function elInventario() {
  return con(BD_A, async (c: Conexion) => {
    const [n] = await c.sql<{
      tarifas: string;
      zonas: string;
      recargos: string;
      liquidaciones: string;
      lineas: string;
      ids_tarifas: string;
      ids_liquidaciones: string;
      ids_lineas: string;
    }>(
      `select (select count(*) from tarifas)::text                as tarifas,
              (select count(*) from tarifa_zonas)::text            as zonas,
              (select count(*) from tarifa_recargo_horario)::text  as recargos,
              (select count(*) from liquidaciones)::text           as liquidaciones,
              (select count(*) from liquidacion_lineas)::text      as lineas,
              (select string_agg(id::text, ',' order by id) from tarifas)          as ids_tarifas,
              (select string_agg(id::text, ',' order by id) from liquidaciones)    as ids_liquidaciones,
              (select string_agg(id::text, ',' order by id) from liquidacion_lineas) as ids_lineas`,
    );
    return n!;
  });
}

test.beforeAll(async () => {
  await conmutarDirecto("mi_flota");
});

test.afterAll(async () => {
  await conmutarDirecto("mi_flota");
});

test("[AC-FTAR-12] conmutar mi_flota → daas → mi_flota no pierde ni una fila de tarifas ni de liquidaciones (centinela 11)", async () => {
  // Fixture real: una empresa cliente propia con tarifa, zona y recargo horario vigentes, más
  // una liquidación con UNA línea devengada de verdad — vía `devengar_entrega()`, la misma
  // función SECURITY DEFINER que la app usa (AC-FTAR-03): un INSERT directo a
  // `liquidacion_lineas` rebota 42501, así que la única forma legítima de sembrar la línea es
  // esa misma puerta.
  const idExcepcion = await con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, $2) returning id::text as id",
      [RUT_EMPRESA, RAZON_SOCIAL],
    );
    await c.sql(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 3500, timestamptz '2026-01-01 00:00-04')",
      [empresa!.id],
    );
    await c.sql(
      "insert into tarifa_zonas (empresa_cliente_id, nombre, comunas, monto_clp) values ($1, 'Centro', array['Providencia'], 700)",
      [empresa!.id],
    );
    await c.sql(
      "insert into tarifa_recargo_horario (empresa_cliente_id, hora_inicio, hora_fin, monto_clp) values ($1, '20:00', '23:00', 500)",
      [empresa!.id],
    );

    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local de contracción', 'Providencia') returning id::text as id",
    );
    const [ruta] = await c.sql<{ id: string }>(
      "insert into rutas (nombre) values ('Ruta de contracción') returning id::text as id",
    );
    const [parada] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [ruta!.id, destino!.id],
    );
    const [encargo] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 2, 'solicitado') returning id::text as id",
      [empresa!.id, destino!.id],
    );
    const [pod] = await c.sql<{ id: string }>(
      "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', timestamptz '2026-04-10 15:30-04', -240) returning id::text as id",
      [encargo!.id, parada!.id],
    );
    const [liq] = await c.sql<{ id: string }>(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, date '2026-04-06', date '2026-04-12') returning id::text as id",
      [empresa!.id],
    );
    await c.sql("select devengar_entrega($1, $2)", [pod!.id, liq!.id]);
    return liq!.id;
  });

  const antes = await elInventario();
  expect(Number(antes.tarifas)).toBeGreaterThan(0);
  expect(Number(antes.zonas)).toBeGreaterThan(0);
  expect(Number(antes.recargos)).toBeGreaterThan(0);
  expect(Number(antes.liquidaciones)).toBeGreaterThan(0);
  expect(Number(antes.lineas)).toBeGreaterThan(0);

  await conmutarDirecto("daas");
  const enDaas = await elInventario();
  expect(enDaas.ids_tarifas, "pasar a daas perdió o recreó filas de tarifas").toBe(antes.ids_tarifas);
  expect(enDaas.ids_liquidaciones, "pasar a daas perdió o recreó filas de liquidaciones").toBe(
    antes.ids_liquidaciones,
  );
  expect(enDaas.ids_lineas, "pasar a daas perdió o recreó filas de liquidacion_lineas").toBe(
    antes.ids_lineas,
  );
  expect(enDaas.zonas).toBe(antes.zonas);
  expect(enDaas.recargos).toBe(antes.recargos);

  await conmutarDirecto("mi_flota");
  const despues = await elInventario();
  expect(despues.ids_tarifas, "volver a mi_flota perdió o recreó filas de tarifas").toBe(
    antes.ids_tarifas,
  );
  expect(despues.ids_liquidaciones, "volver a mi_flota perdió o recreó filas de liquidaciones").toBe(
    antes.ids_liquidaciones,
  );
  expect(despues.ids_lineas, "volver a mi_flota perdió o recreó filas de liquidacion_lineas").toBe(
    antes.ids_lineas,
  );
  expect(despues.zonas).toBe(antes.zonas);
  expect(despues.recargos).toBe(antes.recargos);

  // Y la liquidación sembrada sigue siendo LA MISMA fila, con su empresa intacta.
  await con(BD_A, async (c: Conexion) => {
    const [fila] = await c.sql<{ empresa_id: string }>(
      "select empresa_cliente_id::text as empresa_id from liquidaciones where id = $1",
      [idExcepcion],
    );
    expect(fila?.empresa_id).toBeTruthy();
  });
});
