import { test, expect } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Contracción sin residuos del semáforo [AC-FSEM-13] — spec 05 §2.7, centinela 11 (§9.3.11).
//
// «Conmutar mi_flota → daas → mi_flota conserva todas las filas de `signal_rule` y
// `review_queue`» (§2.7). Mismo patrón que `[AC-FRUT-14]` en `modo.spec.ts` —contar cada cosa
// relevante antes y después de un viaje de ida y vuelta, no solo mirar si «hay una»— aplicado
// a las dos tablas que este módulo posee. `signal_rule` la siembra AC-FSEM-03 (6 filas por
// tenant, una por dominio) y no se toca acá; `review_queue` se prueba con una fila propia,
// insertada y verificada, porque una tabla vacía no delataría un DELETE en el camino.
//
// La mitad «sus `signal_rule` dejan de evaluar en el próximo bootstrap» es del gate SQL
// (`dominio_semaforo_activo`/`signal_rule_activas`, tenant/0060, pgTAP 0025) y de su espejo TS
// puro (`dominioSemaforoActivo`, `semaforo.test.ts`) — acá se ejerce la mitad que SÍ es
// observable de punta a punta hoy: que conmutar el modo del tenant no pierde ni una fila.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

async function conmutarDirecto(modo: "mi_flota" | "daas") {
  await con(BD_CONTROL, (c: Conexion) =>
    c.sql("update tenants set modo = $2::tenant_modo where slug = $1", [A.slug, modo]),
  );
  await con(BD_A, (c: Conexion) => c.sql("update tenant_info set modo = $1", [modo]));
}

async function elInventario() {
  return con(BD_A, async (c: Conexion) => {
    const [n] = await c.sql<{ senales: string; excepciones: string; ids_senales: string }>(
      `select (select count(*) from signal_rule)::text  as senales,
              (select count(*) from review_queue)::text as excepciones,
              (select string_agg(id::text, ',' order by id) from signal_rule) as ids_senales`,
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

test("[AC-FSEM-13] conmutar mi_flota → daas → mi_flota no pierde una sola fila de signal_rule ni de review_queue (centinela 11)", async () => {
  // Una excepción propia, de origen `caja_custodia_liquidacion` — exactamente el dominio que
  // §2.7 dice que se contrae por feature: es la fila que se perdería si «contraer» se
  // implementara borrando en vez de filtrando la lectura.
  const idExcepcion = await con(BD_A, async (c: Conexion) => {
    const [fila] = await c.sql<{ id: string }>(
      `insert into review_queue (origen, severidad) values ('caja_custodia_liquidacion', 'amarillo')
       returning id::text as id`,
    );
    return fila!.id;
  });

  const antes = await elInventario();
  expect(Number(antes.senales), "el tenant debería nacer con las 6 filas del seed del Anexo B").toBeGreaterThanOrEqual(6);
  expect(Number(antes.excepciones)).toBeGreaterThan(0);

  await conmutarDirecto("daas");
  const enDaas = await elInventario();
  expect(enDaas.ids_senales, "pasar a daas perdió o recreó filas de signal_rule").toBe(antes.ids_senales);
  expect(enDaas.excepciones, "pasar a daas perdió filas de review_queue").toBe(antes.excepciones);

  await conmutarDirecto("mi_flota");
  const despues = await elInventario();
  expect(despues.ids_senales, "volver a mi_flota perdió o recreó filas de signal_rule").toBe(antes.ids_senales);
  expect(despues.excepciones, "volver a mi_flota perdió filas de review_queue").toBe(antes.excepciones);

  // Y la excepción concreta que se sembró arriba sigue siendo LA MISMA fila, no una repuesta.
  await con(BD_A, async (c: Conexion) => {
    const [fila] = await c.sql<{ origen: string }>("select origen from review_queue where id = $1", [
      idExcepcion,
    ]);
    expect(fila?.origen).toBe("caja_custodia_liquidacion");
  });
});
