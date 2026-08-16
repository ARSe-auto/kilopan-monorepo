import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { origenDe } from "./puerto.ts";

// Import CSV del portal del contratante [AC-FPOR-09] — spec 07 §3.E1.10, §4.2, §5.7.
//
// Lo que este AC pide como gate (la cláusula del lote MIXTO es PROVISIONAL, excluida hasta la
// pregunta 4 — solo se ejerce lo invariante bajo cualquier semántica): ningún registro inválido
// crea encargos, un import íntegramente inválido rebota 422 tipado con 0 filas, todo lo creado
// nace `solicitado`, y sin conexión la acción se deshabilita mostrando el estado obligatorio del
// §5.7. Mismo patrón de fixture y de sesión real que `portal-encargos-alta.spec.ts` (AC-FPOR-08).

const SLUG = "portal_importar_csv";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUTS = Object.keys(VALIDOS);
const RUT_PERSONA = RUTS[21]!;
const RUT_EMPRESA = RUTS[22]!;
const RUT_EMPRESA_VECINA = RUTS[23]!;
const SECRETO = secretoNuevo();

let empresaId: string;
let destinoId: string;

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Contratante del import CSV SpA') returning id::text as id",
      [RUT_EMPRESA],
    );
    // Una empresa vecina del MISMO tenant: sirve para que `porDestino`/RLS no confundan «no hay
    // datos» con «el confinamiento funciona» — ver el test de aislamiento más abajo.
    await c.sql("insert into empresas_cliente (rut, razon_social) values ($1, 'Vecina del import CSV SpA')", [
      RUT_EMPRESA_VECINA,
    ]);
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local del import CSV', 'Providencia') returning id::text as id",
    );
    empresaId = empresa!.id;
    destinoId = destino!.id;

    const [persona] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Cliente del import CSV') returning id::text as id",
      [RUT_PERSONA],
    );
    const [usuario] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'cliente', $2) returning id::text as id",
      [persona!.id, empresaId],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [persona!.id, hashDeSecreto(SECRETO), usuario!.id],
    );
  });

  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'daas' where slug = $1", [SLUG]));
  await con(BD, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      "e2e AC-FPOR-09 — portal_contratante=true",
      JSON.stringify({ portal_contratante: true }),
    ]),
  );
});

async function cabecerasDelCliente() {
  return { Authorization: `Portador ${SECRETO}`, "content-type": "text/csv" };
}

const contarEncargos = () =>
  con(BD, (c: Conexion) => c.sql<{ n: string }>("select count(*)::text as n from encargos")).then((r) =>
    Number(r[0]!.n),
  );

// ─── El gate del AC: cero filas espurias, 422 tipado, nace `solicitado` ────────────────────

test("[AC-FPOR-09] un CSV bueno crea sus encargos, todos `solicitado`", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const antes = await contarEncargos();
    const r = await ctx.post("/cliente/api/encargos/importar", {
      headers: await cabecerasDelCliente(),
      data: `destino,bultos\nLocal del import CSV,30\nLocal del import CSV,45\n`,
    });
    expect(r.status()).toBe(201);
    const cuerpo = (await r.json()) as { creados: number; repetidos: number };
    expect(cuerpo.creados).toBe(2);
    expect(await contarEncargos()).toBe(antes + 2);

    const filas: { estado: string; empresa_cliente_id: string }[] = await con(BD, (c: Conexion) =>
      c.sql<{ estado: string; empresa_cliente_id: string }>(
        "select estado::text as estado, empresa_cliente_id::text as empresa_cliente_id from encargos where bultos in (30, 45)",
      ),
    );
    expect(
      filas.every((f: { estado: string }) => f.estado === "solicitado"),
      "una fila del import nació distinta de `solicitado`",
    ).toBe(true);
    expect(
      filas.every((f: { empresa_cliente_id: string }) => f.empresa_cliente_id === empresaId),
      "una fila nació con otra empresa",
    ).toBe(true);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-09] el replay de la MISMA importación no crea una segunda copia", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const csv = `destino,bultos\nLocal del import CSV,12\n`;
    await ctx.post("/cliente/api/encargos/importar", { headers: await cabecerasDelCliente(), data: csv });
    const antes = await contarEncargos();
    const r = await ctx.post("/cliente/api/encargos/importar", { headers: await cabecerasDelCliente(), data: csv });
    expect(r.status()).toBe(201);
    const cuerpo = (await r.json()) as { creados: number; repetidos: number };
    expect(cuerpo.creados).toBe(0);
    expect(cuerpo.repetidos).toBe(1);
    expect(await contarEncargos(), "el replay duplicó la importación").toBe(antes);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-09] un import íntegramente inválido ⇒ 422 tipado y 0 filas (cero espurias)", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const antes = await contarEncargos();
    const malo =
      "destino,bultos\n" +
      "Local del import CSV,700\n" + // línea 2: fuera de rango
      "Destino que no existe,10\n"; // línea 3: destino desconocido

    const r = await ctx.post("/cliente/api/encargos/importar", { headers: await cabecerasDelCliente(), data: malo });
    expect(r.status()).toBe(422);
    const cuerpo = (await r.json()) as { error: string; filas: { linea: number; error: string }[] };
    expect(cuerpo.error).toBe("filas_invalidas");
    expect(cuerpo.filas.length).toBe(2);
    expect(cuerpo.filas.map((f) => f.linea).sort()).toEqual([2, 3]);
    expect(cuerpo.filas.map((f) => f.error).sort()).toEqual(["bultos_fuera_de_rango", "destino_no_existe"]);
    expect(await contarEncargos(), "un import íntegramente inválido dejó filas").toBe(antes);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-09] en un lote MIXTO, la fila inválida no entra (invariante bajo cualquier semántica de la pregunta 4)", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const mixto =
      "destino,bultos\n" +
      "Local del import CSV,900\n" + // inválida
      "Local del import CSV,22\n"; // válida

    const r = await ctx.post("/cliente/api/encargos/importar", {
      headers: await cabecerasDelCliente(),
      data: mixto,
    });
    expect(r.status()).toBe(422);
    const malas = await con(BD, (c: Conexion) =>
      c.sql<{ n: string }>("select count(*)::text as n from encargos where bultos = 900"),
    );
    expect(Number(malas[0]!.n), "la fila inválida del lote mixto entró igual").toBe(0);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-09] un archivo sin las columnas necesarias lo dice, con los nombres", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.post("/cliente/api/encargos/importar", {
      headers: await cabecerasDelCliente(),
      data: "destino\nLocal del import CSV\n",
    });
    expect(r.status()).toBe(422);
    const cuerpo = (await r.json()) as { error: string; mensaje: string };
    expect(cuerpo.error).toBe("faltan_columnas");
    expect(cuerpo.mensaje).toContain("bultos");
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-09] un archivo vacío (solo encabezado) rebota `archivo_vacio`, distinto de «se importaron cero»", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.post("/cliente/api/encargos/importar", {
      headers: await cabecerasDelCliente(),
      data: "destino,bultos\n",
    });
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toBe("archivo_vacio");
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-09] la empresa SIEMPRE sale de la sesión: el CSV no trae columna `empresa` y no puede filtrarse a la vecina", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.post("/cliente/api/encargos/importar", {
      headers: await cabecerasDelCliente(),
      data: `destino,bultos\nLocal del import CSV,5\n`,
    });
    expect(r.status()).toBe(201);
    const { creados } = (await r.json()) as { creados: number };
    expect(creados).toBe(1);

    const filas = await con(BD, (c: Conexion) =>
      c.sql<{ n: string }>("select count(*)::text as n from encargos where bultos = 5 and empresa_cliente_id <> $1", [
        empresaId,
      ]),
    );
    expect(Number(filas[0]!.n), "una fila del import nació con la empresa vecina").toBe(0);
  } finally {
    await ctx.dispose();
  }
});

// ─── §5.7: sin conexión, la acción se deshabilita en la UI real ────────────────────────────

async function sesionDe(page: Page) {
  await page.addInitScript((s) => {
    const guardar = () =>
      new Promise<void>((res) => {
        const r = indexedDB.open("flota-aparato", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("claves");
        r.onsuccess = () => {
          const tx = r.result.transaction("claves", "readwrite").objectStore("claves").put(s, "secreto-de-sesion");
          tx.onsuccess = () => res();
          tx.onerror = () => res();
        };
      });
    void guardar();
  }, SECRETO);
}

test("[AC-FPOR-09] sin conexión, el control de importar se deshabilita mostrando el estado obligatorio", async ({
  page,
}) => {
  await sesionDe(page);
  await page.goto(`${ORIGEN}/cliente/nuevo`);
  await expect(page.getByTestId("importar-csv")).toBeVisible();

  // Conectado: el input NO está deshabilitado por conexión (sigue exigiendo un archivo elegido).
  await expect(page.getByTestId("csv-sin-conexion")).toHaveCount(0);
  await expect(page.getByTestId("csv-archivo")).toBeEnabled();

  // `context.setOffline` emula la condición de red del NAVEGADOR (CDP), y eso es lo que dispara
  // los eventos `online`/`offline` reales y actualiza `navigator.onLine` — el mismo mecanismo
  // que ya ejerce `hoy-aa-estados.spec.ts` [AC-FSEM-06] contra `navigator.onLine === false`.
  await page.context().setOffline(true);
  await expect(page.getByTestId("csv-sin-conexion")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("csv-archivo")).toBeDisabled();
  await expect(page.getByTestId("importar-csv-boton")).toBeDisabled();

  await page.context().setOffline(false);
  await expect(page.getByTestId("csv-sin-conexion")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("csv-archivo")).toBeEnabled();
});
