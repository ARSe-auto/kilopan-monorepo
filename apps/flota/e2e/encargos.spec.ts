import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { registrarBaseline } from "./baseline-acciones.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El alta de encargo de la bandeja [AC-FRUT-01] — §3.E1.5, §4.5, §4.2, §4.9.
//
// ES PLANIFICACIÓN, y por eso este archivo se parece POCO a los del módulo 02: acá los rebotes
// son la conducta correcta. Un encargo lo tipea alguien sentado con red antes de que exista el
// camión — rebotar no pierde ningún hecho del mundo, y dejar entrar 600 bultos sí produce una
// ruta que no se puede cargar.
//
// LOS DOS REBOTES DEL AC van con 0 filas y con mensajes DISTINTOS: el de bultos se arregla
// cambiando un número, el de `attrs` mirando la definición del vertical. Un «datos inválidos»
// para los dos dejaría a quien tipea probando a ciegas.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_OPERADOR = Object.keys(VALIDOS)[1]!;
const SECRETO = secretoNuevo();
const comoOperador = { Authorization: `Portador ${SECRETO}` };

let empresaId = "";
let destinoId = "";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
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

    // El RUT de la empresa sale de la lista congelada de fixtures (§7.8, AC-FIDN-21).
    const [e] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del barrio') returning id::text as id",
      [Object.keys(VALIDOS)[4]!],
    );
    empresaId = e!.id;
    const [d] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local del centro', 'Santiago') returning id::text as id",
    );
    destinoId = d!.id;
  });
});

const alta = (
  request: import("@playwright/test").APIRequestContext,
  datos: Record<string, unknown>,
) =>
  request.post("/api/encargos", {
    headers: comoOperador,
    data: { empresa_cliente_id: empresaId, destino_id: destinoId, ...datos },
  });

const cuantosEncargos = () =>
  con(BD_A, (c: Conexion) => c.sql<{ n: string }>("select count(*)::text as n from encargos")).then(
    (r) => Number(r[0]!.n),
  );

test("[AC-FRUT-01] el alta con empresa, destino y bultos deja el encargo listo para armar ruta", async ({
  request,
}) => {
  const r = await alta(request, { bultos: 12, client_uuid: randomUUID() });
  expect(r.status()).toBe(201);
  const { encargo } = (await r.json()) as {
    encargo: { bultos: number; fecha_servicio: string; estado: string };
  };
  expect(encargo.bultos).toBe(12);
  // `fecha_servicio` default HOY (§3.E1.5): sin ese default, el alta de tres datos serían
  // cuatro, y el §3.E1.5 pide menos de diez segundos.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
  expect(encargo.fecha_servicio).toBe(hoy);
  // El que crea el OPERADOR nace aceptado: la aceptación es suya (§3.E1.10). El del contratante
  // nace `solicitado`, y esa mitad la cierra el módulo 07 con su portal.
  expect(encargo.estado).toBe("aceptado");
});

test("[AC-FRUT-01] bultos fuera de 1–500 rebota 422 con 0 filas, y lo dice con el rango", async ({
  request,
}) => {
  const antes = await cuantosEncargos();
  for (const bultos of [0, 501, -3]) {
    const r = await alta(request, { bultos, client_uuid: randomUUID() });
    expect(r.status(), `bultos ${bultos}`).toBe(422);
    const cuerpo = (await r.json()) as { error: string; mensaje: string };
    expect(cuerpo.error).toBe("bultos_fuera_de_rango");
    // El mensaje trae el rango: quien tipea arregla un número y no tiene que adivinar cuál.
    expect(cuerpo.mensaje).toContain("500");
  }
  expect(await cuantosEncargos(), "un rebote dejó fila").toBe(antes);

  // Y los BORDES entran, sin los cuales «rebota fuera de rango» lo cumpliría un guard que
  // rechaza todo.
  for (const bultos of [1, 500]) {
    const r = await alta(request, { bultos, client_uuid: randomUUID() });
    expect(r.status(), `el borde ${bultos} tiene que entrar`).toBe(201);
  }
});

test("[AC-FRUT-01] un `attrs` que no cumple su definición rebota, y con OTRO mensaje", async ({
  request,
}) => {
  // El §4.9: `attrs` es un registro TIPADO, no jsonb libre. Y el error se distingue del de
  // bultos porque se arregla de otra forma — uno es un número, el otro un campo del vertical.
  await con(BD_A, (c: Conexion) =>
    c.sql(
      `insert into attribute_definition (entidad, clave, tipo, obligatorio)
       values ('encargos', 'temperatura_objetivo', 'entero', false)`,
    ),
  );
  const antes = await cuantosEncargos();

  const delTipoEquivocado = await alta(request, {
    bultos: 5,
    attrs: { temperatura_objetivo: "frio" },
    client_uuid: randomUUID(),
  });
  expect(delTipoEquivocado.status()).toBe(422);
  expect((await delTipoEquivocado.json()).error).toBe("attrs_invalidos");

  const sinDefinir = await alta(request, {
    bultos: 5,
    attrs: { inventado: 1 },
    client_uuid: randomUUID(),
  });
  expect(sinDefinir.status()).toBe(422);
  expect((await sinDefinir.json()).error).toBe("attrs_invalidos");

  expect(await cuantosEncargos(), "un attrs inválido dejó fila").toBe(antes);

  // Y el positivo: un atributo que SÍ cumple entra. Sin esto, todo lo anterior lo cumpliría un
  // trigger que rechaza siempre y el vertical no podría cargar un solo dato.
  const bueno = await alta(request, {
    bultos: 5,
    attrs: { temperatura_objetivo: 4 },
    client_uuid: randomUUID(),
  });
  expect(bueno.status()).toBe(201);
});

test("[AC-FRUT-01] la misma alta reintentada no crea un segundo encargo (centinela 1)", async ({
  request,
}) => {
  const clientUuid = randomUUID();
  const primera = await alta(request, { bultos: 20, client_uuid: clientUuid });
  expect(primera.status()).toBe(201);
  const id = (await primera.json()).encargo.id;

  const antes = await cuantosEncargos();
  const segunda = await alta(request, { bultos: 20, client_uuid: clientUuid });
  // 200 y no 201: el reintento no creó nada. Es la misma regla que la importación CSV va a
  // necesitar en AC-FRUT-02, y por eso vive en el alta y no en el importador.
  expect(segunda.status()).toBe(200);
  expect((await segunda.json()).encargo.id).toBe(id);
  expect(await cuantosEncargos(), "el reintento duplicó el encargo").toBe(antes);
});

// ─── El presupuesto de la bandeja: ≤4 acciones (§5.3) ───────────────────────────────
//
// El §3.E1.5 pide el alta en menos de diez segundos y el §5.3 lo convierte en un contrato que
// se cuenta: empresa, destino, bultos, guardar. El «<10 s» es el RACIONAL del presupuesto y no
// una aserción del test —el AC lo dice con esas palabras—, así que lo que se mide son los
// TOQUES, con la convención cerrada del §5.3: un campo de teclado propio = 1 acción.

/** Cuenta ACCIONES con la convención del §5.3. */
function contador(page: import("@playwright/test").Page) {
  let acciones = 0;
  return {
    get acciones() {
      return acciones;
    },
    async tocar(testid: string) {
      acciones++;
      await page.getByTestId(testid).click();
    },
    async teclear(caracteres: string, dentroDe: string) {
      acciones++;
      const alcance = page.getByTestId(dentroDe);
      for (const c of caracteres) await alcance.getByRole("button", { name: c, exact: true }).click();
    },
  };
}

async function sesionDe(page: import("@playwright/test").Page, secreto: string) {
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

test("[AC-FRUT-01] el alta desde la bandeja entra en 4 acciones, con teclado propio", async ({ page }) => {
  await sesionDe(page, SECRETO);
  const c = contador(page);
  await page.goto("/bandeja");
  await expect(page.getByTestId("bandeja")).toBeVisible();
  // Se espera a que el conteo sea un NÚMERO: mientras carga muestra «…», y leerlo ahí daba un
  // `NaN` que convertía la aserción de más abajo en una comparación contra nada.
  const conteo = page.getByTestId("conteo-bandeja");
  await expect(conteo).toHaveText(/^\d+$/);
  const antes = Number((await conteo.textContent())!.trim());

  await c.tocar("empresa-Panadería del barrio"); // 1
  await c.tocar("destino-Local del centro"); // 2
  await c.teclear("30", "teclado-bultos"); // 3 · campo de teclado propio = 1 acción (§5.3)
  await c.tocar("guardar-encargo"); // 4

  await expect(page.getByTestId("conteo-bandeja")).toHaveText(String(antes + 1));
  expect(c.acciones, "el alta se pasó del presupuesto de 4 acciones del §5.3").toBeLessThanOrEqual(4);

  const { baseline, acciones } = registrarBaseline({
    flujo: "alta-de-encargo",
    ac: "AC-FRUT-01",
    acciones: c.acciones,
  });
  expect(acciones).toBeGreaterThan(0);
  expect(
    acciones,
    `el alta pasó de ${baseline} a ${acciones} acciones: una regresión no se mergea (§5.3)`,
  ).toBeLessThanOrEqual(baseline);

  // El teclado del sistema JAMÁS aparece (§5.7): ni un `<input>` en la pantalla.
  const inputs = await page.evaluate(() => document.querySelectorAll("input, textarea").length);
  expect(inputs, "la bandeja tiene un campo del sistema").toBe(0);
});

test("[AC-FRUT-01] el rebote de bultos se muestra con su rango, no como «datos inválidos»", async ({
  page,
}) => {
  await sesionDe(page, SECRETO);
  await page.goto("/bandeja");
  await page.getByTestId("empresa-Panadería del barrio").click();
  await page.getByTestId("destino-Local del centro").click();
  const teclado = page.getByTestId("teclado-bultos");
  for (const d of "501") await teclado.getByRole("button", { name: d, exact: true }).click();
  await page.getByTestId("guardar-encargo").click();

  const rebote = page.getByTestId("rebote-encargo");
  await expect(rebote).toBeVisible();
  // Quien tipea arregla un número y no tiene que adivinar cuál: el mensaje trae el límite.
  await expect(rebote).toContainText("500");
});

// ─── Importación CSV [AC-FRUT-02] — §5.2-F1, §4.2, §9.3.1 ───────────────────────────
//
// LO INVARIANTE BAJO LAS DOS SEMÁNTICAS de la pregunta 6 —archivo completo o por fila— es lo
// único que este archivo asierta, con esas palabras del AC: que la fila inválida NO entre y que
// la respuesta sea 422 tipado. La política que hoy se aplica (todo-o-nada) se declara en el
// cuerpo de la respuesta, y el test la mira sin depender de ella.

const CSV_BUENO = (empresa: string, destino: string) =>
  `empresa,destino,bultos\n${empresa},${destino},30\n${empresa},${destino},45\n`;

test("[AC-FRUT-02] un CSV bueno crea sus encargos, con id de servidor y fecha de hoy", async ({
  request,
}) => {
  const antes = await cuantosEncargos();
  const r = await request.post("/api/encargos/importar", {
    headers: { ...comoOperador, "content-type": "text/csv" },
    data: CSV_BUENO("Panadería del barrio", "Local del centro"),
  });
  expect(r.status()).toBe(201);
  expect((await r.json()).creados).toBe(2);
  expect(await cuantosEncargos()).toBe(antes + 2);

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      "select count(*)::text as n from encargos where fecha_servicio <> $1::date",
      [hoy],
    ),
  );
  expect(Number(f!.n), "un encargo importado quedó con fecha distinta de hoy").toBe(0);
});

test("[AC-FRUT-02] el replay de la MISMA importación no crea una segunda copia (centinela 1)", async ({
  request,
}) => {
  const antes = await cuantosEncargos();
  const r = await request.post("/api/encargos/importar", {
    headers: { ...comoOperador, "content-type": "text/csv" },
    data: CSV_BUENO("Panadería del barrio", "Local del centro"),
  });
  expect(r.status()).toBe(201);
  const cuerpo = (await r.json()) as { creados: number; repetidos: number };
  // El `client_uuid` se DERIVA del contenido de cada fila, así que el mismo archivo produce los
  // mismos identificadores: el segundo intento no crea nada y lo dice.
  expect(cuerpo.creados).toBe(0);
  expect(cuerpo.repetidos).toBe(2);
  expect(await cuantosEncargos(), "el replay duplicó la importación").toBe(antes);
});

test("[AC-FRUT-02] las filas inválidas NO entran, y se reportan TODAS con su línea", async ({
  request,
}) => {
  const antes = await cuantosEncargos();
  const malo =
    "empresa,destino,bultos\n" +
    "Panadería del barrio,Local del centro,700\n" + // línea 2: fuera de rango
    "Empresa que no existe,Local del centro,10\n" + // línea 3: empresa desconocida
    "Panadería del barrio,Local del centro,25\n"; // línea 4: buena

  const r = await request.post("/api/encargos/importar", {
    headers: { ...comoOperador, "content-type": "text/csv" },
    data: malo,
  });
  expect(r.status()).toBe(422);
  const cuerpo = (await r.json()) as { error: string; filas: { linea: number; error: string }[] };
  expect(cuerpo.error).toBe("filas_invalidas");
  // TODAS, no la primera: quien arma el archivo lo corrige de una vez.
  expect(cuerpo.filas.length).toBe(2);
  // El número de línea es el que la persona ve en Excel — el encabezado cuenta.
  expect(cuerpo.filas.map((f) => f.linea).sort()).toEqual([2, 3]);
  expect(cuerpo.filas.map((f) => f.error).sort()).toEqual(["bultos_fuera_de_rango", "empresa_no_existe"]);

  // LO INVARIANTE BAJO LAS DOS SEMÁNTICAS: las filas inválidas no dejaron fila. (Que además no
  // haya entrado la buena es la política de hoy, que la pregunta 6 puede cambiar.)
  const [malas] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from encargos where bultos = 700"),
  );
  expect(Number(malas!.n), "una fila inválida entró igual").toBe(0);
  expect(await cuantosEncargos()).toBe(antes);
});

test("[AC-FRUT-02] un archivo sin las columnas necesarias lo dice, con los nombres", async ({
  request,
}) => {
  const r = await request.post("/api/encargos/importar", {
    headers: { ...comoOperador, "content-type": "text/csv" },
    data: "empresa\nPanadería del barrio\n",
  });
  expect(r.status()).toBe(422);
  const cuerpo = (await r.json()) as { error: string; mensaje: string };
  expect(cuerpo.error).toBe("faltan_columnas");
  expect(cuerpo.mensaje).toContain("destino");
  expect(cuerpo.mensaje).toContain("bultos");
});

// ─── «Duplicar encargos de ayer» [AC-FRUT-17] — §5.2-F1, §3.E1.5, §9.3.1 ────────────
//
// Vía masiva SEPARADA de la CSV. La panadería que reparte a las mismas doce sucursales todos los
// días no tiene un Excel: tiene el día de ayer.
//
// Lo que este bloque protege es el segundo clic. La pantalla tarda, alguien insiste, y con un
// identificador al azar por intento el día entero se duplicaría — veinte encargos fantasma que
// alguien tiene que borrar a mano antes de armar las rutas.

/**
 * El día en CHILE, no en UTC.
 *
 * Bug real encontrado el 10-ago-2026 a las 21:20 de Chile: `toISOString()` da el día en UTC, y
 * desde las 20:00 de Chile eso YA es el día siguiente. La app fecha todo con
 * `America/Santiago` (§0), así que el test comparaba contra un día que la base nunca escribió y
 * fallaba CUATRO HORAS DE CADA VEINTICUATRO — justo la franja en que el motor construye de noche.
 */
const diaEnChile = (cuando: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(cuando);

const AYER = diaEnChile(new Date(Date.now() - 86_400_000));

const duplicar = (request: import("@playwright/test").APIRequestContext) =>
  request.post("/api/encargos/duplicar", { headers: comoOperador, data: { origen: AYER } });

test("[AC-FRUT-17] duplicar crea encargos NUEVOS de hoy, conservando lo del original", async ({
  request,
}) => {
  await con(BD_A, async (c: Conexion) => {
    await c.sql("delete from encargos");
    await c.sql(
      `insert into encargos (empresa_cliente_id, destino_id, bultos, fecha_servicio)
       values ($1, $2, 17, $3::date)`,
      [empresaId, destinoId, AYER],
    );
  });

  const respuesta = await duplicar(request);
  expect(respuesta.ok()).toBe(true);
  expect((await respuesta.json()) as { creados: number }).toMatchObject({ creados: 1 });

  await con(BD_A, async (c: Conexion) => {
    const filas = await c.sql<{ fecha: string; bultos: string; id: string }>(
      `select to_char(fecha_servicio, 'YYYY-MM-DD') as fecha, bultos::text as bultos,
              id::text as id
         from encargos order by fecha_servicio`,
      [],
    );
    // DOS encargos: el de ayer sigue donde estaba. Moverle la fecha le borraría el día a la
    // historia y dejaría su entrega firmada colgando de un encargo que dice ser de hoy.
    expect(filas).toHaveLength(2);
    expect(filas[0]!.fecha).toBe(AYER);
    expect(filas[1]!.fecha).toBe(diaEnChile(new Date()));
    // Y lo copiado se conservó.
    expect(filas[1]!.bultos).toBe("17");
    expect(filas[1]!.id).not.toBe(filas[0]!.id);
  });
});

test("[AC-FRUT-17] el segundo clic no duplica el día: 1 fila por client_uuid", async ({
  request,
}) => {
  await con(BD_A, async (c: Conexion) => {
    await c.sql("delete from encargos");
    await c.sql(
      `insert into encargos (empresa_cliente_id, destino_id, bultos, fecha_servicio)
       values ($1, $2, 5, $3::date), ($1, $2, 9, $3::date)`,
      [empresaId, destinoId, AYER],
    );
  });

  const primera = await duplicar(request);
  const segunda = await duplicar(request);

  expect((await primera.json()) as { creados: number; repetidos: number }).toMatchObject({
    creados: 2,
    repetidos: 0,
  });
  // El centinela 1: el replay deja exactamente una fila por `client_uuid` (§9.3.1).
  expect((await segunda.json()) as { creados: number; repetidos: number }).toMatchObject({
    creados: 0,
    repetidos: 2,
  });

  await con(BD_A, async (c: Conexion) => {
    const [n] = await c.sql<{ n: string }>(
      `select count(*)::text as n from encargos
        where fecha_servicio = (now() at time zone 'America/Santiago')::date`,
    );
    expect(n!.n).toBe("2");
  });
});

test("[AC-FRUT-17] un ayer vacío no crea nada y lo dice", async ({ request }) => {
  await con(BD_A, async (c: Conexion) => await c.sql("delete from encargos"));

  const respuesta = await duplicar(request);
  expect(respuesta.ok()).toBe(true);
  // No es un error: ayer no hubo reparto. Un 422 acá le enseñaría al operador a desconfiar del
  // botón (§5.7).
  expect((await respuesta.json()) as { creados: number }).toMatchObject({ creados: 0 });
});
