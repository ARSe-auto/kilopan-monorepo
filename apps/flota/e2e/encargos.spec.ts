import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture } from "./limpiar.mjs";
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
    await c.sql("delete from encargos");
    await c.sql("delete from destinos");
    await c.sql("delete from empresas_cliente");
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
