import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { origenDe } from "./puerto.ts";

// El ciclo del encargo solicitado, de punta a punta [AC-FPOR-08] — spec 07 §2.3, §3.E1.10,
// §4.5, §4.2.
//
// La MITAD del texto la ejerce `encargos.spec.ts` [AC-FRUT-03] contra `/api/encargos/*` del
// OPERADOR: que la ventana de edición cierre con la aceptación, y que «su creador» lo aplique
// la app, son invariantes de `crearEncargo`/`editarEncargo` (servidor/encargos.ts) y esa suite
// ya los prueba con ese llamador. Lo que ESTA suite prueba, y que la del operador no puede, es
// que el mismo invariante se sostiene entrando por el namespace del PORTAL
// (`/cliente/api/encargos*`, con sesión real de rol `cliente`, del mismo modo que
// `portal-aislamiento.spec.ts` AC-FPOR-06): alta que nace `solicitado`, 422 con 0 filas ante
// datos inválidos, corrección mientras sigue `solicitado`, y 422 con 0 cambios después de que
// el operador acepta — más la mitad visible: el botón de corregir desaparece de la UI real en
// cuanto el encargo deja de ser `solicitado`.

const SLUG = "portal_encargos_alta";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUTS = Object.keys(VALIDOS);
const RUT_PERSONA = RUTS[19]!;
const RUT_EMPRESA = RUTS[20]!;
const SECRETO = secretoNuevo();

let empresaId: string;
let destinoId: string;

async function sellarPortalOn() {
  await con(BD, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      "e2e AC-FPOR-08 — portal_contratante=true",
      JSON.stringify({ portal_contratante: true }),
    ]),
  );
}

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Contratante del ciclo de alta SpA') returning id::text as id",
      [RUT_EMPRESA],
    );
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local del ciclo de alta', 'Providencia') returning id::text as id",
    );
    empresaId = empresa!.id;
    destinoId = destino!.id;

    const [persona] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Cliente del ciclo de alta') returning id::text as id",
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
  await sellarPortalOn();
});

async function cabecerasDelCliente() {
  return { Authorization: `Portador ${SECRETO}` };
}

const contarEncargos = () =>
  con(BD, (c: Conexion) => c.sql<{ n: string }>("select count(*)::text as n from encargos")).then((r) =>
    Number(r[0]!.n),
  );

const filaDe = (id: string) =>
  con(BD, (c: Conexion) =>
    c.sql<{ estado: string; bultos: string }>(
      "select estado::text as estado, bultos::text as bultos from encargos where id = $1",
      [id],
    ),
  ).then((r) => ({ estado: r[0]!.estado, bultos: Number(r[0]!.bultos) }));

// ─── El alta: nace `solicitado`, y rebota 422 con 0 filas ante datos inválidos ─────────────

test("[AC-FPOR-08] POST sin destino ⇒ 422 tipado y 0 filas", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const antes = await contarEncargos();
    const r = await ctx.post("/cliente/api/encargos", {
      headers: await cabecerasDelCliente(),
      data: { bultos: 5 },
    });
    expect(r.status()).toBe(422);
    expect(await contarEncargos()).toBe(antes);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-08] POST con bultos fuera de 1-500 ⇒ 422 tipado y 0 filas", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const antes = await contarEncargos();
    const r = await ctx.post("/cliente/api/encargos", {
      headers: await cabecerasDelCliente(),
      data: { destino_id: destinoId, bultos: 501 },
    });
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toBe("bultos_fuera_de_rango");
    expect(await contarEncargos()).toBe(antes);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-08] POST válido nace `solicitado`, jamás `aceptado`", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.post("/cliente/api/encargos", {
      headers: await cabecerasDelCliente(),
      data: { destino_id: destinoId, bultos: 7 },
    });
    expect(r.status()).toBe(201);
    const { encargo } = (await r.json()) as { encargo: { id: string; estado: string } };
    expect(encargo.estado).toBe("solicitado");
    expect((await filaDe(encargo.id)).estado).toBe("solicitado");
  } finally {
    await ctx.dispose();
  }
});

// ─── La ventana de edición: abierta mientras `solicitado`, cerrada por la aceptación ───────

test("[AC-FPOR-08] el cliente corrige su encargo mientras sigue `solicitado`", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const alta = await ctx.post("/cliente/api/encargos", {
      headers: await cabecerasDelCliente(),
      data: { destino_id: destinoId, bultos: 3 },
    });
    const { encargo } = (await alta.json()) as { encargo: { id: string } };

    const corregir = await ctx.patch(`/cliente/api/encargos/${encargo.id}`, {
      headers: await cabecerasDelCliente(),
      data: { bultos: 18 },
    });
    expect(corregir.status()).toBe(200);
    expect((await filaDe(encargo.id)).bultos).toBe(18);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-08] tras la aceptación del operador, PATCH del cliente ⇒ 422 tipado y 0 cambios", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const alta = await ctx.post("/cliente/api/encargos", {
      headers: await cabecerasDelCliente(),
      data: { destino_id: destinoId, bultos: 4 },
    });
    const { encargo } = (await alta.json()) as { encargo: { id: string } };

    // La aceptación es un acto del OPERADOR (AC-FRUT-03) — acá se estampa directo por SQL
    // porque lo que se prueba es la ventana del CONTRATANTE, no la ruta del operador.
    await con(BD, (c: Conexion) =>
      c.sql("update encargos set estado = 'aceptado' where id = $1", [encargo.id]),
    );

    const tarde = await ctx.patch(`/cliente/api/encargos/${encargo.id}`, {
      headers: await cabecerasDelCliente(),
      data: { bultos: 99 },
    });
    expect(tarde.status()).toBe(422);
    expect((await tarde.json()).error).toBe("ya_aceptado");
    const fila = await filaDe(encargo.id);
    expect(fila.estado).toBe("aceptado");
    expect(fila.bultos, "el rebote de la edición dejó fila cambiada").toBe(4);
  } finally {
    await ctx.dispose();
  }
});

// ─── La UI: el botón de corregir SOLO existe en la fila `solicitado` ───────────────────────

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

test("[AC-FPOR-08] la UI ofrece «Corregir» solo en el encargo `solicitado`, nunca en el `aceptado`", async ({
  page,
}) => {
  const [solicitado, aceptado] = await con(BD, (c: Conexion) =>
    c.sql<{ id: string }>(
      `insert into encargos (empresa_cliente_id, destino_id, bultos, estado)
       values ($1, $2, 6, 'solicitado'), ($1, $2, 9, 'aceptado')
       returning id::text as id`,
      [empresaId, destinoId],
    ),
  );

  await sesionDe(page);
  await page.goto(`${ORIGEN}/cliente/encargos`);
  await expect(page.getByTestId("lista-encargos")).toBeVisible();

  // Filtrado por id: los tests anteriores de este archivo comparten la MISMA empresaId y ya
  // dejaron sus propios encargos `solicitado`, así que contar por `data-estado` a secas
  // arrastra esos ajenos — el AC exige la fila DE ESTE encargo, no «alguna solicitado».
  const filaSolicitada = page.locator(`[data-testid="encargo-item"][data-id="${solicitado!.id}"]`);
  const filaAceptada = page.locator(`[data-testid="encargo-item"][data-id="${aceptado!.id}"]`);
  await expect(filaSolicitada.getByTestId("corregir-encargo")).toHaveCount(1);
  await expect(filaAceptada.getByTestId("corregir-encargo")).toHaveCount(0);
});
