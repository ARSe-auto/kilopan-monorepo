import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { origenDe } from "./puerto.ts";

// El detalle de un encargo propio, con su resultado y su evidencia [AC-FPOR-11] — spec 07 §2.2,
// §4.6.
//
// La superficie HTTP (`GET /cliente/api/encargos/[id]`, ya abierta por AC-FPOR-06) gana un campo
// `resultado`, armado por `resultadoDelEncargoCliente` (`servidor/portal-cliente.ts`) leyendo la
// fila VIGENTE de `entregas_pod` (cerrada, sin supersede) y la evidencia colgada de su parada.
// Esta suite prueba lo que AC-FPOR-06 no podía probar todavía porque el campo no existía: sin
// entrega cerrada el resultado es `null`; con ella, trae `resultado ∈ {exito,fallo,parcial}` y la
// evidencia con su sha256; y ninguno de los dos trae el orden de la ruta ni el nombre de una
// parada ajena, aunque comparta la MISMA ruta que el encargo propio.
//
// La UI (`/cliente/encargos?id=`) es el mismo criterio de `?id=` que `/cliente/liquidaciones`
// (AC-FPOR-10): esta página no abre BD por su cuenta, solo pide `pedir()`.

const SLUG = "portal_encargo_detalle";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_PERSONA = rutDeFixture(38);
const RUT_EMPRESA = rutDeFixture(39);
const SECRETO = secretoNuevo();

const DESTINO_AJENO = "Local del tercero en la misma ruta";

let encargoSinEntregaId = "";
let encargoConEntregaId = "";
let encargoConMotivoId = "";
let evidenciaFotoSha256Hex = "";

async function sellarPortalOn() {
  await con(BD, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      "e2e AC-FPOR-11 — portal_contratante=true",
      JSON.stringify({ portal_contratante: true }),
    ]),
  );
}

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Contratante del detalle SpA') returning id::text as id",
      [RUT_EMPRESA],
    );
    const empresaId = empresa!.id;

    const [persona] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Cliente del detalle') returning id::text as id",
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

    const [ruta] = await c.sql<{ id: string }>(
      "insert into rutas (nombre) values ('Ruta del detalle') returning id::text as id",
    );

    // ── Encargo SIN entrega todavía: resultado tiene que salir `null`, no un objeto vacío ──
    const [destinoSinEntrega] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local sin entrega del detalle', 'Providencia') returning id::text as id",
    );
    const [encargoSinEntrega] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 3, 'solicitado') returning id::text as id",
      [empresaId, destinoSinEntrega!.id],
    );
    encargoSinEntregaId = encargoSinEntrega!.id;

    // ── Un TERCERO en la MISMA ruta, con `orden` propio — nunca puede aparecer en el detalle
    //    del encargo propio, ni su nombre ni el número de su `orden` (§3.E1.10). ──
    const [destinoAjeno] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ($1, 'Providencia') returning id::text as id",
      [DESTINO_AJENO],
    );
    await c.sql("insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2)", [
      ruta!.id,
      destinoAjeno!.id,
    ]);

    // ── Encargo CON entrega exitosa, dos evidencias (una con sha256, una sin binario) ──
    const [destinoConEntrega] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local con entrega del detalle', 'Providencia') returning id::text as id",
    );
    const [paradaConEntrega] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2) returning id::text as id",
      [ruta!.id, destinoConEntrega!.id],
    );
    const [encargoConEntrega] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 5, 'aceptado') returning id::text as id",
      [empresaId, destinoConEntrega!.id],
    );
    encargoConEntregaId = encargoConEntrega!.id;
    await c.sql(
      "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', now(), -240)",
      [encargoConEntregaId, paradaConEntrega!.id],
    );
    evidenciaFotoSha256Hex = "a".repeat(64);
    await c.sql(
      `insert into evidence (tipo, objeto_tabla, objeto_id, sha256, capturada_en, tz_offset_min)
       values ('foto', 'paradas', $1, decode($2, 'hex'), now(), -240)`,
      [paradaConEntrega!.id, evidenciaFotoSha256Hex],
    );
    await c.sql(
      "insert into evidence (tipo, objeto_tabla, objeto_id, capturada_en, tz_offset_min) values ('firma', 'paradas', $1, now(), -240)",
      [paradaConEntrega!.id],
    );

    // ── Encargo con entrega FALLIDA y motivo, para probar `motivo_etiqueta` ──
    const [motivo] = await c.sql<{ id: string }>(
      "insert into motivos (codigo, etiqueta, estado_asociado) values ('nadie_recibio_detalle', 'Nadie recibió', 'entrega_no_entregada') returning id::text as id",
    );
    const [destinoConMotivo] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local con motivo del detalle', 'Providencia') returning id::text as id",
    );
    const [paradaConMotivo] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 3, $2) returning id::text as id",
      [ruta!.id, destinoConMotivo!.id],
    );
    const [encargoConMotivo] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 1, 'aceptado') returning id::text as id",
      [empresaId, destinoConMotivo!.id],
    );
    encargoConMotivoId = encargoConMotivo!.id;
    await c.sql(
      "insert into entregas_pod (encargo_id, parada_id, resultado, motivo_id, event_time, tz_offset_min) values ($1, $2, 'fallo', $3, now(), -240)",
      [encargoConMotivoId, paradaConMotivo!.id, motivo!.id],
    );
  });

  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'daas' where slug = $1", [SLUG]));
  await sellarPortalOn();
});

async function cabecerasDelCliente() {
  return { Authorization: `Portador ${SECRETO}` };
}

// ─── La API: `resultado` null sin entrega, poblado con entrega, jamás con orden/paradas ajenas ─

test("[AC-FPOR-11] encargo sin entrega todavía ⇒ resultado null", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/cliente/api/encargos/${encargoSinEntregaId}`, {
      headers: await cabecerasDelCliente(),
    });
    expect(r.status()).toBe(200);
    const cuerpo = (await r.json()) as { resultado: unknown };
    expect(cuerpo.resultado).toBeNull();
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-11] encargo con entrega exitosa trae resultado y evidencia con sha256", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/cliente/api/encargos/${encargoConEntregaId}`, {
      headers: await cabecerasDelCliente(),
    });
    expect(r.status()).toBe(200);
    const cuerpo = (await r.json()) as {
      resultado: {
        resultado: string;
        metodo_entrega: string | null;
        motivo_etiqueta: string | null;
        event_time: string;
        evidencias: { tipo: string; capturada_en: string; sha256: string | null }[];
      };
    };
    expect(cuerpo.resultado.resultado).toBe("exito");
    expect(cuerpo.resultado.motivo_etiqueta).toBeNull();
    expect(Object.keys(cuerpo.resultado).sort()).toEqual(
      ["resultado", "metodo_entrega", "motivo_etiqueta", "event_time", "evidencias"].sort(),
    );

    expect(cuerpo.resultado.evidencias).toHaveLength(2);
    const foto = cuerpo.resultado.evidencias.find((e) => e.tipo === "foto");
    const firma = cuerpo.resultado.evidencias.find((e) => e.tipo === "firma");
    expect(foto?.sha256).toBe(evidenciaFotoSha256Hex);
    expect(firma?.sha256).toBeNull();
    for (const ev of cuerpo.resultado.evidencias) {
      expect(Object.keys(ev).sort()).toEqual(["tipo", "capturada_en", "sha256"].sort());
    }
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-11] entrega fallida trae el motivo, y ningún cuerpo expone orden de ruta ni la parada del tercero", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/cliente/api/encargos/${encargoConMotivoId}`, {
      headers: await cabecerasDelCliente(),
    });
    expect(r.status()).toBe(200);
    const cuerpo = (await r.json()) as { resultado: { resultado: string; motivo_etiqueta: string | null } };
    expect(cuerpo.resultado.resultado).toBe("fallo");
    expect(cuerpo.resultado.motivo_etiqueta).toBe("Nadie recibió");

    const texto = await r.text();
    // La parada del tercero comparte la MISMA ruta que los tres encargos de este fixture — el
    // §3.E1.10 prohíbe su nombre y el `orden` de la ruta con esas palabras, así que ninguno de
    // los tres cuerpos de esta suite puede mencionarlos.
    expect(texto).not.toContain(DESTINO_AJENO);
    expect(texto).not.toContain(`"orden"`);
    expect(texto).not.toContain(`"ruta_id"`);
    expect(texto).not.toContain(`"parada_id"`);
    expect(texto).not.toContain(`"soc"`);
  } finally {
    await ctx.dispose();
  }
});

// ─── La UI: el detalle real, con sesión de navegador ───────────────────────────────────────

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

test("[AC-FPOR-11] la lista enlaza al detalle, y el detalle real muestra estado, resultado y evidencia", async ({
  page,
}) => {
  await sesionDe(page);
  await page.goto(`${ORIGEN}/cliente/encargos`);
  await expect(page.getByTestId("lista-encargos")).toBeVisible();

  const fila = page.locator(`[data-testid="encargo-item"][data-id="${encargoConEntregaId}"]`);
  await fila.getByTestId("detalle-encargo").click();

  await expect(page).toHaveURL(new RegExp(`\\?id=${encargoConEntregaId}$`));
  await expect(page.getByTestId("portal-encargo-detalle")).toBeVisible();
  await expect(page.getByTestId("estado-encargo-cliente")).toHaveText("Aceptado");
  await expect(page.getByTestId("encargo-resultado")).toContainText("Entregado");
  await expect(page.getByTestId("evidencia-encargo-cliente")).toHaveCount(2);
});

test("[AC-FPOR-11] el detalle de un encargo sin entrega muestra el estado vacío, no un error", async ({ page }) => {
  await sesionDe(page);
  await page.goto(`${ORIGEN}/cliente/encargos?id=${encargoSinEntregaId}`);
  await expect(page.getByTestId("portal-encargo-detalle")).toBeVisible();
  await expect(page.getByTestId("estado-encargo-cliente")).toHaveText("Solicitado");
  await expect(page.getByTestId("resultado-encargo-cliente")).toContainText(
    "Todavía no hay resultado de entrega para este encargo.",
  );
});
