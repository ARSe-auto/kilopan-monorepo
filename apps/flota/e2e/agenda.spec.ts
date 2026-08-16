import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { fechaEsCl, lunesDeLaSemana } from "../../../packages/nucleo-comun/src/fechas.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { limpiarFixture } from "./limpiar.mjs";

// La agenda por vehículo, de punta a punta [AC-FVEH-07] — §3.E1.4, §5.2-F1, §0.
//
// LAS TRES COSAS QUE ESTE AC PIDE Y ACÁ SE VERIFICAN:
//
//   1. Un bloque solapado rebota 422 con 0 filas (PLANIFICACIÓN §4.2, centinela 5 §9.3).
//   2. «Duplicar semana» clona los bloques REALES de siete días atrás, no una plantilla — y se
//      verifica sobre una semana destino SIN colisiones, como el AC acota.
//   3. Las fechas visibles van en es-CL `dd-mm-aaaa` y no hay strings en inglés.
//
// CLÁUSULA BLOQUEADA, declarada: qué hacer cuando la semana destino YA tiene bloques que
// chocan —todo-o-nada o bloque a bloque con reporte— es la pregunta 12 de la spec 02. El
// servidor no elige: contesta que no procedió y por qué. Este archivo verifica ESA conducta,
// no una de las dos políticas, para que el día que el dueño responda el cambio se note.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_OPERADOR = Object.keys(VALIDOS)[1]!;
const SECRETO = secretoNuevo();
const comoOperador = { Authorization: `Portador ${SECRETO}` };
const PATENTE = "AGD0001";

let vehiculoId = "";
/** El lunes de ESTA semana y el de la anterior, calculados con el mismo módulo que la app. */
const lunes = lunesDeLaSemana(new Date());
const lunesAnterior = new Date(lunes.getTime() - 7 * 24 * 60 * 60 * 1000);
const enSemanaAnterior = (dia: number, hora: number) =>
  new Date(lunesAnterior.getTime() + dia * 24 * 60 * 60 * 1000 + hora * 60 * 60 * 1000);

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien planifica') returning id::text as id",
      [RUT_OPERADOR],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'operador') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );
    const [v] = await c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ($1, 'furgón') returning id::text as id",
      [PATENTE],
    );
    vehiculoId = v!.id;
  });
});

const cuantosBloques = () =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from bloques_agenda"),
  ).then((r) => Number(r[0]!.n));

/** Lo que este archivo lee de `bloques_agenda`. `conectar.mjs` es JavaScript y no exporta
 *  tipos, así que la forma se declara acá en vez de dejar que `any` se cuele en las aserciones. */
type Fila = { tipo: string; empieza_en: string };

const agendar = (request: import("@playwright/test").APIRequestContext, datos: Record<string, unknown>) =>
  request.post("/api/agenda", { headers: comoOperador, data: datos });

test("[AC-FVEH-07] los cuatro tipos de bloque entran, y el solapado rebota 422 con 0 filas", async ({
  request,
}) => {
  // La semana ANTERIOR, que después va a ser la que se clona. Cuatro bloques, uno por tipo:
  // los cuatro son del enum cerrado del §4.5 y ninguno se pisa con otro.
  const plan = [
    { tipo: "ruta", dia: 0, hora: 8, largo: 4 },
    { tipo: "recarga", dia: 0, hora: 22, largo: 6 },
    { tipo: "mantencion", dia: 2, hora: 9, largo: 3 },
    { tipo: "descanso", dia: 4, hora: 13, largo: 1 },
  ];
  for (const b of plan) {
    const r = await agendar(request, {
      vehiculo_id: vehiculoId,
      tipo: b.tipo,
      empieza_en: enSemanaAnterior(b.dia, b.hora).toISOString(),
      termina_en: enSemanaAnterior(b.dia, b.hora + b.largo).toISOString(),
    });
    expect(r.status(), `el bloque de ${b.tipo} no entró`).toBe(201);
  }
  expect(await cuantosBloques()).toBe(plan.length);

  // Y ahora uno que PISA a la ruta del lunes por una hora. El centinela 5: rebota y no deja
  // fila. Un camión con dos cosas agendadas a la misma hora es un chofer esperando y una
  // entrega que no salió.
  const antes = await cuantosBloques();
  const choque = await agendar(request, {
    vehiculo_id: vehiculoId,
    tipo: "mantencion",
    empieza_en: enSemanaAnterior(0, 11).toISOString(),
    termina_en: enSemanaAnterior(0, 14).toISOString(),
  });
  expect(choque.status()).toBe(422);
  expect((await choque.json()).error).toBe("bloque_solapado");
  expect(await cuantosBloques(), "el rebote dejó una fila: el 422 tiene que ser de 0 filas").toBe(antes);
});

test("[AC-FVEH-07] pegado no es solapado: un bloque que empieza donde termina el otro entra", async ({
  request,
}) => {
  // La mitad sin la cual «el solape rebota» se cumpliría con una regla que prohíbe cualquier
  // segundo bloque del día, y la agenda de un vehículo real sería imposible de armar.
  const r = await agendar(request, {
    vehiculo_id: vehiculoId,
    tipo: "descanso",
    empieza_en: enSemanaAnterior(0, 12).toISOString(),
    termina_en: enSemanaAnterior(0, 13).toISOString(),
  });
  expect(r.status(), "un bloque pegado al anterior no se pisa con él").toBe(201);
});

test("[AC-FVEH-07] «duplicar semana» clona los bloques REALES de 7 días atrás", async ({ request }) => {
  const deLaAnterior: Fila[] = await con(BD_A, (c: Conexion) =>
    c.sql<{ tipo: string; empieza_en: string }>(
      "select tipo::text as tipo, empieza_en::text as empieza_en from bloques_agenda order by empieza_en",
    ),
  );
  expect(deLaAnterior.length, "el fixture de la semana anterior quedó vacío").toBeGreaterThan(0);

  const r = await request.post("/api/agenda/duplicar-semana", {
    headers: comoOperador,
    data: { vehiculo_id: vehiculoId, desde: lunes.toISOString() },
  });
  expect(r.status()).toBe(201);
  expect((await r.json()).clonados).toBe(deLaAnterior.length);

  // Lo clonado es lo que la semana pasada de verdad tuvo —con los arreglos que se le hicieron
  // el martes—, no una plantilla: mismos tipos, mismas horas, corridos exactamente 7 días.
  const nuevos: Fila[] = await con(BD_A, (c: Conexion) =>
    c.sql<{ tipo: string; empieza_en: string }>(
      "select tipo::text as tipo, empieza_en::text as empieza_en from bloques_agenda where empieza_en >= $1 order by empieza_en",
      [lunes.toISOString()],
    ),
  );
  expect(nuevos.map((n) => n.tipo)).toEqual(deLaAnterior.map((v) => v.tipo));
  for (const [i, nuevo] of nuevos.entries()) {
    const original = new Date(deLaAnterior[i]!.empieza_en).getTime();
    expect(new Date(nuevo.empieza_en).getTime() - original).toBe(7 * 24 * 60 * 60 * 1000);
  }
});

test("[AC-FVEH-07] con la semana destino ya ocupada, el servidor NO decide: lo dice", async ({ request }) => {
  // CLÁUSULA BLOQUEADA por la pregunta 12. Lo que se verifica no es una política —todo-o-nada
  // o bloque a bloque— sino que la app no haya elegido una por accidente.
  const antes = await cuantosBloques();
  const r = await request.post("/api/agenda/duplicar-semana", {
    headers: comoOperador,
    data: { vehiculo_id: vehiculoId, desde: lunes.toISOString() },
  });
  expect(r.status()).toBe(422);
  const cuerpo = (await r.json()) as { error: string; mensaje: string };
  expect(cuerpo.error).toBe("colision_no_resuelta");
  expect(cuerpo.mensaje, "el mensaje tiene que decir que la decisión está pendiente").toContain(
    "no está decidido",
  );
  expect(await cuantosBloques(), "no copió nada, como dijo").toBe(antes);
});

/** Deja la sesión del operador en el aparato antes de que cargue la página. */
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

test("[AC-FVEH-07] la pantalla muestra las fechas en es-CL y cero strings en inglés", async ({ page }) => {
  await sesionDe(page, SECRETO);
  await page.goto("/agenda");
  await expect(page.getByTestId("agenda")).toBeVisible();

  // El rango de la semana, comparado contra el formateador canónico y no contra una cadena
  // escrita a mano: si el §0 cambiara el formato, este test se entera.
  await expect(page.getByTestId("rango-semana")).toContainText(fechaEsCl(lunes));

  const bloques = page.getByTestId("bloque-cuando");
  await expect(bloques.first()).toBeVisible();
  const textos = await bloques.allTextContents();
  for (const texto of textos) {
    // `dd-mm-aaaa`: día primero y con guiones. En un país que escribe el día primero, un
    // `mm-dd` colado no lo nota nadie hasta que un camión sale un mes tarde.
    expect(texto, `«${texto}» no trae una fecha dd-mm-aaaa`).toMatch(/\b\d{2}-\d{2}-\d{4}\b/);
    expect(texto, `«${texto}» trae una fecha con barras`).not.toMatch(/\d\/\d/);
  }

  // Cero strings en inglés en la pantalla entera (§0). Se mira el DOM pintado, no el código.
  const visible = (await page.locator("main").innerText()).toLowerCase();
  for (const palabra of ["monday", "tuesday", "week", "vehicle", "schedule", "am", "pm", "loading"]) {
    expect(visible.split(/\b/), `la pantalla dice «${palabra}» en inglés`).not.toContain(palabra);
  }
});
