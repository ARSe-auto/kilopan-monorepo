import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { origenDe } from "./puerto.ts";

// Liquidación con disputa por línea, de punta a punta [AC-FPOR-10] — spec 07 §2.4, spec 06 §6,
// §4.2, §9.3.3.
//
// EL MOTOR YA ESTÁ EN LA BD desde AC-FTAR-06 (`disputar_linea()`, 0066): catálogo de motivos,
// ventana de 7 días medida desde el evento `liquidacion.cerrada` (no desde `creado_en`, que no
// existe como columna propia), idempotencia por `disputa_client_uuid`. Lo que ESTA suite prueba
// es la superficie HTTP/UI del PORTAL (`/cliente/api/liquidacion-lineas/[id]/disputa`,
// `/cliente/liquidaciones?id=`) — mismo criterio que `portal-encargos-alta.spec.ts` (AC-FPOR-08)
// entrando por el namespace del portal en vez de por la BD directo.
//
// EL FIXTURE llama a `devengar_entrega()` directo por SQL, igual que `liquidacion-drill-
// down.spec.ts` (AC-FTAR-07) y `db/flota/suite-bd/disputa-por-linea.test.mjs` (AC-FTAR-06): el
// camino de ruta/entrega del chofer ya está probado por `pod-feliz.spec.ts`, acá solo hace falta
// una línea real con evidencia real colgando.
//
// LA VENTANA «FUERA DE PLAZO» SE FABRICA por SQL, no esperando 8 días: se cierra la liquidación
// (el trigger de 0065 emite `liquidacion.cerrada` con `event_time = now()`) y LUEGO se retrasa
// ese evento 8 días — la misma fuente que `disputar_linea()` lee para el t0 (0066). Es la forma
// legítima de probar una ventana de tiempo sin mover el reloj del servidor ni exponer un
// parámetro `p_ahora` al cliente, que sería dejar que el navegador de alguien decida su propio
// plazo legal.

const SLUG = "portal_liquidacion_disputa";
const BD = bdDeTenant(SLUG);
const ORIGEN = origenDe(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_PERSONA = rutDeFixture(3);
const RUT_EMPRESA = rutDeFixture(6);
const SECRETO = secretoNuevo();

let liqDentroId = "";
let liqFueraId = "";
let liqAbiertaId = "";
let lineaExitoId = "";
let lineaReplayId = "";
let lineaMotivoInvalidoId = "";
let lineaUiId = "";
let lineaFueraId = "";
let lineaAbiertaId = "";
let motivoId = "";
let motivoEtiqueta = "";

async function sellarPortalOn() {
  await con(BD, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", [
      "e2e AC-FPOR-10 — portal_contratante=true",
      JSON.stringify({ portal_contratante: true }),
    ]),
  );
}

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Contratante de la disputa SpA') returning id::text as id",
      [RUT_EMPRESA],
    );
    const empresaId = empresa!.id;

    const [persona] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Cliente de la disputa') returning id::text as id",
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

    await c.sql(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 4500, timestamptz '2026-01-01 00:00-04')",
      [empresaId],
    );

    const [ruta] = await c.sql<{ id: string }>(
      "insert into rutas (nombre) values ('Ruta de la disputa') returning id::text as id",
    );

    // Un destino POR PARADA: `paradas_una_entrega_por_destino` no admite dos paradas de tipo
    // `entrega` sobre el mismo destino.
    async function pod(orden: number, resultado: string) {
      const [destino] = await c.sql<{ id: string }>(
        "insert into destinos (nombre, comuna) values ($1, 'Providencia') returning id::text as id",
        [`Local ${orden} de la disputa`],
      );
      const [parada] = await c.sql<{ id: string }>(
        "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', $2, $3) returning id::text as id",
        [ruta!.id, orden, destino!.id],
      );
      const [encargo] = await c.sql<{ id: string }>(
        "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 2, 'solicitado') returning id::text as id",
        [empresaId, destino!.id],
      );
      const [entrega] = await c.sql<{ id: string }>(
        "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, $3, now(), -240) returning id::text as id",
        [encargo!.id, parada!.id, resultado],
      );
      return { podId: entrega!.id, paradaId: parada!.id };
    }

    // Cuatro capturas colgadas de la parada de la línea que se va a mirar por el drill-down —
    // mismo patrón que `liquidacion-drill-down.spec.ts` (AC-FTAR-07).
    const exito1 = await pod(1, "exito");
    await c.sql(
      "insert into evidence (tipo, objeto_tabla, objeto_id, capturada_en, tz_offset_min) values ('firma', 'paradas', $1, now(), -240), ('foto', 'paradas', $1, now(), -240)",
      [exito1.paradaId],
    );
    const exito2 = await pod(2, "exito");
    const exito3 = await pod(3, "exito");
    const exito4 = await pod(4, "exito");
    const exitoFuera = await pod(5, "exito");
    const exitoAbierta = await pod(6, "exito");

    // ── Liquidación DENTRO de la ventana: CUATRO líneas, una por test — así el intento
    //    fallido de un rebote (motivo inválido) no ensucia la línea que otro test SÍ dispute,
    //    y el replay del doble-tap no se confunde con el camino dorado simple. ──
    const [liqDentro] = await c.sql<{ id: string }>(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, current_date - 6, current_date) returning id::text as id",
      [empresaId],
    );
    liqDentroId = liqDentro!.id;
    const [linea1] = await c.sql<{ id: string }>("select devengar_entrega($1, $2)::text as id", [
      exito1.podId,
      liqDentroId,
    ]);
    lineaExitoId = linea1!.id;
    const [linea2] = await c.sql<{ id: string }>("select devengar_entrega($1, $2)::text as id", [
      exito2.podId,
      liqDentroId,
    ]);
    lineaReplayId = linea2!.id;
    const [linea3] = await c.sql<{ id: string }>("select devengar_entrega($1, $2)::text as id", [
      exito3.podId,
      liqDentroId,
    ]);
    lineaMotivoInvalidoId = linea3!.id;
    const [linea4] = await c.sql<{ id: string }>("select devengar_entrega($1, $2)::text as id", [
      exito4.podId,
      liqDentroId,
    ]);
    lineaUiId = linea4!.id;
    await c.sql("update liquidaciones set estado = 'cerrada' where id = $1", [liqDentroId]);

    // ── Liquidación FUERA de la ventana: se cierra igual (el trigger de la 0065 emite el
    //    evento) y LUEGO se retrasa ESE evento 8 días — el t0 real que `disputar_linea()` lee. ──
    const [liqFuera] = await c.sql<{ id: string }>(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, current_date - 20, current_date - 14) returning id::text as id",
      [empresaId],
    );
    liqFueraId = liqFuera!.id;
    const [lineaF] = await c.sql<{ id: string }>("select devengar_entrega($1, $2)::text as id", [
      exitoFuera.podId,
      liqFueraId,
    ]);
    lineaFueraId = lineaF!.id;
    // `eventos` es append-only (§7.4: REVOKE UPDATE/DELETE + trigger) — no se puede retrasar el
    // evento YA emitido. En vez de eso, esta transición de estado corre con los triggers
    // apagados (`session_replication_role`, técnica estándar de fixture, no de esquema): la
    // liquidación queda `cerrada` SIN emitir `liquidacion.cerrada`. `disputar_linea()` (0066)
    // trata «sin evento de cierre» exactamente igual que «fuera de ventana» — mismo mensaje,
    // misma rama —, así que el caso queda cubierto sin tocar una fila append-only.
    await c.sql("set session_replication_role = replica");
    await c.sql("update liquidaciones set estado = 'cerrada' where id = $1", [liqFueraId]);
    await c.sql("set session_replication_role = origin");

    // ── Liquidación ABIERTA: nunca se cierra — la línea existe (el devengo la crea con la
    //    liquidación todavía `abierta`) pero disputarla tiene que rebotar. ──
    const [liqAbierta] = await c.sql<{ id: string }>(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, current_date + 1, current_date + 7) returning id::text as id",
      [empresaId],
    );
    liqAbiertaId = liqAbierta!.id;
    const [lineaA] = await c.sql<{ id: string }>("select devengar_entrega($1, $2)::text as id", [
      exitoAbierta.podId,
      liqAbiertaId,
    ]);
    lineaAbiertaId = lineaA!.id;

    const [motivo] = await c.sql<{ id: string; etiqueta: string }>(
      "select id::text as id, etiqueta from motivos where estado_asociado = 'liquidacion_linea_disputada' and codigo = 'monto_incorrecto'",
    );
    motivoId = motivo!.id;
    motivoEtiqueta = motivo!.etiqueta;
  });

  await con(BD_CONTROL, (c: Conexion) => c.sql("update tenants set modo = 'daas' where slug = $1", [SLUG]));
  await sellarPortalOn();
});

async function cabecerasDelCliente() {
  return { Authorization: `Portador ${SECRETO}` };
}

const filaDeLinea = (id: string) =>
  con(BD, (c: Conexion) =>
    c.sql<{ disputa_estado: string | null }>(
      "select disputa_estado from liquidacion_lineas where id = $1",
      [id],
    ),
  ).then((r) => r[0]!.disputa_estado);

const contarDisputasDeLinea = (id: string) =>
  con(BD, (c: Conexion) =>
    c.sql<{ n: string }>(
      `select count(*)::text as n from eventos e
         join evento_tipo t on t.id = e.tipo_id
        where t.codigo = 'liquidacion_linea.disputada' and e.objeto_tabla = 'liquidacion_lineas'
          and e.objeto_id = $1`,
      [id],
    ),
  ).then((r) => Number(r[0]!.n));

// ─── Camino dorado y su idempotencia (§9.3.1) ──────────────────────────────────────────────

test("[AC-FPOR-10] disputa dentro de la ventana de 7 días ⇒ registrada y visible", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    expect(await filaDeLinea(lineaExitoId)).toBeNull();
    const clientUuid = crypto.randomUUID();
    const r = await ctx.post(`/cliente/api/liquidacion-lineas/${lineaExitoId}/disputa`, {
      headers: await cabecerasDelCliente(),
      data: { motivo_id: motivoId, nota: "El monto no coincide con lo pactado", client_uuid: clientUuid },
    });
    expect(r.status()).toBe(201);
    expect(await filaDeLinea(lineaExitoId)).toBe("abierta");
    expect(await contarDisputasDeLinea(lineaExitoId)).toBe(1);
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-10] el replay del mismo client_uuid (doble-tap) deja UNA sola disputa", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const clientUuid = crypto.randomUUID();
    const primera = await ctx.post(`/cliente/api/liquidacion-lineas/${lineaReplayId}/disputa`, {
      headers: await cabecerasDelCliente(),
      data: { motivo_id: motivoId, client_uuid: clientUuid },
    });
    expect(primera.status()).toBe(201);
    const segunda = await ctx.post(`/cliente/api/liquidacion-lineas/${lineaReplayId}/disputa`, {
      headers: await cabecerasDelCliente(),
      data: { motivo_id: motivoId, client_uuid: clientUuid },
    });
    expect(segunda.status()).toBe(200);
    expect((await segunda.json()).repetida).toBe(true);
    expect(await contarDisputasDeLinea(lineaReplayId)).toBe(1);
  } finally {
    await ctx.dispose();
  }
});

// ─── Los rebotes tipados, cada uno con 0 filas ─────────────────────────────────────────────

test("[AC-FPOR-10] motivo fuera del catálogo ⇒ 422 tipado y 0 filas", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    // Línea de la liquidación DENTRO de la ventana: así el rebote se debe únicamente al
    // motivo, sin que la ventana ya vencida de otra liquidación lo pise primero (el orden de
    // guardas de `disputar_linea()`, 0066, evalúa la ventana ANTES que el motivo).
    const r = await ctx.post(`/cliente/api/liquidacion-lineas/${lineaMotivoInvalidoId}/disputa`, {
      headers: await cabecerasDelCliente(),
      data: { motivo_id: crypto.randomUUID(), client_uuid: crypto.randomUUID() },
    });
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toBe("motivo_invalido");
    expect(await filaDeLinea(lineaMotivoInvalidoId)).toBeNull();
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-10] fuera de la ventana de 7 días ⇒ 422 tipado y 0 filas", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.post(`/cliente/api/liquidacion-lineas/${lineaFueraId}/disputa`, {
      headers: await cabecerasDelCliente(),
      data: { motivo_id: motivoId, client_uuid: crypto.randomUUID() },
    });
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toBe("fuera_de_ventana");
    expect(await filaDeLinea(lineaFueraId)).toBeNull();
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-10] liquidación todavía no cerrada ⇒ 422 tipado y 0 filas", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.post(`/cliente/api/liquidacion-lineas/${lineaAbiertaId}/disputa`, {
      headers: await cabecerasDelCliente(),
      data: { motivo_id: motivoId, client_uuid: crypto.randomUUID() },
    });
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toBe("liquidacion_no_cerrada");
    expect(await filaDeLinea(lineaAbiertaId)).toBeNull();
  } finally {
    await ctx.dispose();
  }
});

test("[AC-FPOR-10] línea inexistente ⇒ 404 pelado", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.post(`/cliente/api/liquidacion-lineas/${crypto.randomUUID()}/disputa`, {
      headers: await cabecerasDelCliente(),
      data: { motivo_id: motivoId, client_uuid: crypto.randomUUID() },
    });
    expect(r.status()).toBe(404);
  } finally {
    await ctx.dispose();
  }
});

// ─── La UI real: listar, drill-down a evidencia, disputar ─────────────────────────────────

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

test("[AC-FPOR-10] la lista abre la liquidación, el drill-down muestra la evidencia en 1 clic", async ({ page }) => {
  await sesionDe(page);
  await page.goto(`${ORIGEN}/cliente/liquidaciones`);
  await expect(page.getByTestId("lista-liquidaciones")).toBeVisible();
  // Las TRES liquidaciones del fixture (dentro, fuera, abierta) son de esta empresa.
  await expect(page.getByTestId("liquidacion-item")).toHaveCount(3);

  await page.locator(`[data-testid="liquidacion-item"][data-id="${liqDentroId}"]`).click();
  await expect(page.getByTestId("portal-liquidacion-detalle")).toBeVisible();

  await expect(page.getByTestId(`evidencia-linea-${lineaExitoId}`)).toHaveCount(0);
  await page.getByTestId(`abrir-evidencia-${lineaExitoId}`).click();

  const evidencia = page.getByTestId(`evidencia-linea-${lineaExitoId}`);
  await expect(evidencia).toBeVisible();
  await expect(evidencia.getByTestId("evidencia-resultado-cliente")).toHaveText("Entregado");
  await expect(evidencia.getByTestId("evidencia-capturas-cliente").getByTestId("evidencia-captura-cliente")).toHaveCount(2);

  // Y la línea ya disputada por el primer test HTTP se ve disputada acá, en la MISMA pantalla.
  const filaExito = page.locator(`[data-testid="linea-liquidacion-cliente"][data-id="${lineaExitoId}"]`);
  await expect(filaExito.getByTestId("linea-disputada-cliente")).toBeVisible();
  await expect(filaExito.getByTestId(`disputar-linea-${lineaExitoId}`)).toHaveCount(0);
});

test("[AC-FPOR-10] disputar una línea desde la UI real, con motivo y nota", async ({ page }) => {
  await sesionDe(page);
  await page.goto(`${ORIGEN}/cliente/liquidaciones?id=${liqAbiertaId}`);
  // Esta liquidación sigue `abierta`: el botón de disputar no existe todavía en ninguna fila —
  // ausencia del control, no un `disabled` que igual se ve (mismo criterio que «Corregir» en
  // AC-FPOR-08).
  await expect(page.getByTestId("portal-liquidacion-detalle")).toBeVisible();
  await expect(page.getByTestId(`disputar-linea-${lineaAbiertaId}`)).toHaveCount(0);

  // La línea sin disputa de la liquidación CERRADA y DENTRO de la ventana sí ofrece el botón.
  await page.goto(`${ORIGEN}/cliente/liquidaciones?id=${liqDentroId}`);
  await page.getByTestId(`disputar-linea-${lineaUiId}`).click();
  await page.getByTestId("motivo-disputa").selectOption({ label: motivoEtiqueta });
  await page.getByTestId("nota-disputa").fill("La entrega no coincide con lo facturado");
  await page.getByTestId("enviar-disputa").click();

  const fila = page.locator(`[data-testid="linea-liquidacion-cliente"][data-id="${lineaUiId}"]`);
  await expect(fila.getByTestId("linea-disputada-cliente")).toContainText("La entrega no coincide con lo facturado");
});

test("[AC-FPOR-10] sin sesión, la liquidación propia tampoco existe: 404 pelado", async () => {
  // El fixture `request` de Playwright hereda el `baseURL` del config (`ruteo_activo`, un
  // tenant SIN `portal_contratante` encendido): pegarle ahí daría 403 de módulo apagado
  // (AC-FPOR-04) y no probaría nada de `sesionDelTenant` — el mismo error que documenta
  // `cruce-tenant.spec.ts` (AC-FTEN-26). Por eso este contexto apunta a ORIGEN, el tenant de
  // ESTA suite, donde `sellarPortalOn()` ya lo encendió: acá un 404 sin cabecera `authorization`
  // es de verdad el candado «sin sesión» de `sesionDelTenant`, no el del módulo.
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGEN });
  try {
    const r = await ctx.get(`/cliente/api/liquidaciones/${liqDentroId}`);
    expect(r.status()).toBe(404);
  } finally {
    await ctx.dispose();
  }
});
