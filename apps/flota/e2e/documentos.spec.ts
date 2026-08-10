import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { con, bdDeTenant, BD_CONTROL, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Documentos con vencimiento y el rebote que SOLO ocurre con el feature encendido
// [AC-FVEH-03] — §3.E1.3, §4.5, §4.9, §5.1, §9.3 centinela 5.
//
// LAS TRES COSAS QUE ESTE AC PIDE:
//
//   1. Con feature ON, planificar un vehículo con documento vencido rebota 422 con 0 filas.
//   2. Con feature OFF **no rebota nada** — y esta es la mitad que se olvida: un guard que
//      siempre rebota pasaría el primer test y dejaría fuera de servicio a todo tenant que no
//      compró la feature.
//   3. El estado vencido se comunica con TEXTO, jamás solo por color (§5.1).
//
// CÓMO SE ENCIENDE LA FEATURE, y por qué el test tiene que sellar una versión de config: el
// §4.4 congela los entitlements en el snapshot del tenant y el runtime NO vuelve a consultar
// `control`. Un override recién creado no cambia nada hasta que se sella una versión nueva —
// que es la conducta del §5.5, «cada toggle aplica en el próximo bootstrap; los turnos
// abiertos terminan con su config congelada». La pantalla «Funciones» que sella es del hito
// (g); acá se sella a mano, que es lo mismo que ella va a hacer.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_DUENA = Object.keys(VALIDOS)[0]!;
const SECRETO = secretoNuevo();
const comoDuena = { Authorization: `Portador ${SECRETO}` };
const PATENTE = "DOC1234";
const FEATURE = "documentos_vencidos_bloquean";

let vehiculoId = "";
let control: Pool;

/** Ayer y mañana en Chile, como cadenas `aaaa-mm-dd` que es lo que el endpoint recibe. */
const enDias = (dias: number) => {
  const d = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(d);
};

test.beforeAll(async () => {
  control = new Pool({
    host: CLUSTER_LOCAL.host,
    port: CLUSTER_LOCAL.puerto,
    database: BD_CONTROL,
    user: ROL_MIGRADOR,
  });

  await con(BD_A, async (c: Conexion) => {
    await limpiarFixture(c.sql);
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Dueña') returning id::text as id",
      [RUT_DUENA],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
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

test.afterAll(async () => {
  // La feature queda APAGADA al salir: es un override de este fixture y dejarlo encendido le
  // cambiaría la conducta a la suite que corra después sobre la misma base.
  await apagarFeature();
  await control?.end();
});

/** El id de este tenant en `control`. Se resuelve por slug, igual que el servidor (§4.1). */
async function tenantEnControl(): Promise<string> {
  const { rows } = await control.query<{ id: string }>("select id::text as id from tenants where slug = $1", [
    A.slug,
  ]);
  return rows[0]!.id;
}

/** Enciende el override en `control` Y sella una versión nueva de config, que es lo que hace
 *  que el toggle exista para el runtime (§4.4, §5.5). */
async function encenderFeature() {
  const tenantId = await tenantEnControl();
  await control.query(
    `insert into tenant_feature_overrides (tenant_id, feature_id, enabled, motivo)
     select $1, f.id, true, 'fixture del e2e de AC-FVEH-03' from features f where f.lookup_key = $2
     on conflict (tenant_id, feature_id) do update set enabled = true`,
    [tenantId, FEATURE],
  );
  await sellarVersion(tenantId);
}

async function apagarFeature() {
  const tenantId = await tenantEnControl();
  await control.query(
    `update tenant_feature_overrides set enabled = false
      where tenant_id = $1 and feature_id = (select id from features where lookup_key = $2)`,
    [tenantId, FEATURE],
  );
  await sellarVersion(tenantId);
}

/** Sella una versión de config con los entitlements efectivos de ahora. Es exactamente lo que
 *  va a hacer la pantalla «Funciones» del hito (g) cuando alguien mueva un toggle. */
async function sellarVersion(tenantId: string) {
  const { rows } = await control.query<{ lookup_key: string; habilitada: boolean }>(
    "select lookup_key, habilitada from entitlements_efectivos where tenant_id = $1",
    [tenantId],
  );
  const entitlements = Object.fromEntries(rows.map((f) => [f.lookup_key, f.habilitada]));
  await con(BD_A, (c: Conexion) =>
    c.sql("select crear_config_version($1, $2::jsonb)", ["toggle del fixture", JSON.stringify(entitlements)]),
  );
}

const cargarDocumento = (
  request: import("@playwright/test").APIRequestContext,
  datos: Record<string, unknown>,
) => request.post(`/api/gobierno/vehiculos/${vehiculoId}/documentos`, { headers: comoDuena, data: datos });

const cuantosBloques = () =>
  con(BD_A, (c: Conexion) => c.sql<{ n: string }>("select count(*)::text as n from bloques_agenda")).then(
    (r) => Number(r[0]!.n),
  );

const enUnaHora = (offset: number) => new Date(Date.now() + offset * 60 * 60 * 1000).toISOString();

test("[AC-FVEH-03] el dueño carga un documento con su vencimiento", async ({ request }) => {
  const r = await cargarDocumento(request, { tipo: "revisión técnica", vence_el: enDias(30) });
  expect(r.status()).toBe(201);
  const { documento } = (await r.json()) as { documento: { estado: string; sha256: string | null } };
  expect(documento.estado).toBe("vigente");
  // El hash viaja ANTES del binario (§4.6): el alta del vencimiento puede ocurrir sin archivo.
  expect(documento.sha256).toBeNull();
});

test("[AC-FVEH-03] con el feature APAGADO, un documento vencido NO rebota nada", async ({ request }) => {
  // La mitad que se olvida. Un guard que siempre rebota pasaría el test de más abajo y dejaría
  // fuera de servicio a todo tenant que no compró la feature — que hoy son todos, porque
  // `plan_features` no la trae (la decisión comercial es del hito g).
  const vencido = await cargarDocumento(request, { tipo: "permiso de circulación", vence_el: enDias(-1) });
  expect(vencido.status()).toBe(201);

  const turno = await request.post("/api/turnos", { headers: comoDuena, data: { vehiculo_id: vehiculoId } });
  expect(turno.status(), "con el feature apagado, abrir la jornada tiene que funcionar").toBe(201);

  const bloque = await request.post("/api/agenda", {
    headers: comoDuena,
    data: {
      vehiculo_id: vehiculoId,
      tipo: "ruta",
      empieza_en: enUnaHora(48),
      termina_en: enUnaHora(52),
    },
  });
  expect(bloque.status(), "con el feature apagado, agendar tiene que funcionar").toBe(201);
});

test("[AC-FVEH-03] con el feature ENCENDIDO, planificar rebota 422 y no deja ni una fila", async ({
  request,
}) => {
  await encenderFeature();
  const antes = await cuantosBloques();

  const bloque = await request.post("/api/agenda", {
    headers: comoDuena,
    data: {
      vehiculo_id: vehiculoId,
      tipo: "ruta",
      empieza_en: enUnaHora(72),
      termina_en: enUnaHora(76),
    },
  });
  expect(bloque.status()).toBe(422);
  const cuerpo = (await bloque.json()) as { error: string; mensaje: string };
  expect(cuerpo.error).toBe("documento_vencido");
  // El mensaje nombra la CAUSA. Quien lo lee está armando la semana y «no se pudo agendar» lo
  // dejaría probando horarios distintos contra un problema que no es de horario.
  expect(cuerpo.mensaje).toContain("documento vencido");
  expect(await cuantosBloques(), "el rebote dejó una fila: el 422 tiene que ser de 0 filas").toBe(antes);

  // Y la otra puerta de planificación: abrir la jornada. Se cierra el turno que quedó abierto
  // del test anterior para que el rebote no pueda confundirse con el del solape.
  await con(BD_A, (c: Conexion) =>
    c.sql("update turnos set estado = 'cerrado', cerrado_en = now() where estado = 'abierto'"),
  );
  const turno = await request.post("/api/turnos", { headers: comoDuena, data: { vehiculo_id: vehiculoId } });
  expect(turno.status()).toBe(422);
  expect((await turno.json()).error).toBe("documento_vencido");
});

test("[AC-FVEH-03] con el feature encendido, un vehículo AL DÍA sigue pudiendo planificar", async ({
  request,
}) => {
  // Sin esta mitad, el rebote podría estar disparando para cualquier vehículo y la flota entera
  // quedaría detenida el día que alguien enciende la feature.
  const [v] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ('DOC5678', 'furgón') returning id::text as id",
    ),
  );
  const r = await request.post("/api/turnos", { headers: comoDuena, data: { vehiculo_id: v!.id } });
  expect(r.status(), "un vehículo sin documentos vencidos tiene que poder abrir jornada").toBe(201);
});

/** Deja la sesión de la dueña en el aparato antes de que cargue la página. */
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

test("[AC-FVEH-03] el estado vencido se dice con TEXTO, jamás solo con color", async ({ page }) => {
  await sesionDe(page, SECRETO);
  await page.goto("/vehiculos");
  await expect(page.getByTestId("vehiculos")).toBeVisible();

  const aviso = page.getByTestId("documentos-vencidos");
  await expect(aviso).toBeVisible();
  // El §5.1 con sujeto: la palabra tiene que estar escrita. Un punto rojo no lo ve quien no
  // distingue rojo de verde, y tampoco lo entiende quien nunca vio esta pantalla antes.
  await expect(aviso).toContainText("vencido");

  // Y el aviso NO aparece en el vehículo que está al día: si apareciera en todos, el texto
  // dejaría de significar algo el primer día.
  expect(await page.getByTestId("vehiculo").count()).toBeGreaterThan(1);
  expect(await aviso.count(), "el aviso de vencido salió en un vehículo que está al día").toBe(1);
});

// ─── El recordatorio del §3.E1.3 [AC-FVEH-17] ────────────────────────────────────────
//
// «Documentos con vencimiento con RECORDATORIOS» es conducta OBLIGADA de E1. La superficie
// mínima que la cierra es que el vehículo diga, en texto, que un documento está por vencer
// ANTES de que venza: un aviso el día después no es un recordatorio, es la noticia de que ya
// es tarde.
//
// LO QUE SIGUE ABIERTO Y NO SE INVENTA: el VALOR del seed de anticipación y el canal adicional
// (pregunta 1 de la spec 02). El NOMBRE de la fila ya estaba cerrado por la P5 de la spec 00
// —`parametros.anticipacion_vencimiento_dias`— y es el que se consume. Sin fila configurada no
// existe «por vencer», y eso también se verifica: un default inventado acá quedaría fabricado
// sin que nadie lo note.

/** Deja configurada la anticipación del tenant, o la borra. Es lo que va a hacer la pantalla
 *  de configuración del hito (g); acá se escribe directo porque el fixture es la base. */
async function anticipacionDe(dias: number | null) {
  await con(BD_A, (c: Conexion) =>
    c.sql(
      `insert into parametros (anticipacion_vencimiento_dias) values ($1)
       on conflict (unica) do update set anticipacion_vencimiento_dias = excluded.anticipacion_vencimiento_dias`,
      [dias],
    ),
  );
}

test("[AC-FVEH-17] sin anticipación configurada no existe «por vencer»", async ({ request }) => {
  await anticipacionDe(null);
  const r = await cargarDocumento(request, { tipo: "SOAP", vence_el: enDias(3) });
  expect(r.status()).toBe(201);
  // El estado que devuelve el servidor es `vigente`, no `por_vencer`: sin el parámetro del
  // tenant no hay umbral, y fabricar uno acá dejaría respondida la pregunta 1 sin que nadie
  // recordara de dónde salió el número.
  expect((await r.json()).documento.estado).toBe("vigente");
});

test("[AC-FVEH-17] con la anticipación configurada, el vehículo lo dice con TEXTO", async ({ page }) => {
  await anticipacionDe(10);
  await sesionDe(page, SECRETO);
  await page.goto("/vehiculos");

  const aviso = page.getByTestId("documentos-por-vencer");
  await expect(aviso.first()).toBeVisible();
  // §5.1: la palabra escrita, no un color. Y «por vencer» tiene que decir algo DISTINTO de
  // «vencido»: son dos situaciones y quien mira la lista actúa distinto en cada una.
  await expect(aviso.first()).toContainText("por vencer");

  const vencidos = await page.getByTestId("documentos-vencidos").allTextContents();
  for (const texto of vencidos) {
    expect(texto, "«vencido» y «por vencer» se están diciendo con la misma frase").not.toContain(
      "por vencer",
    );
  }
});

test("[AC-FVEH-17] un documento fuera de la anticipación NO avisa", async ({ request }) => {
  // La mitad sin la cual el aviso saldría siempre, y quien mira la lista dejaría de mirarlo la
  // primera semana.
  await anticipacionDe(10);
  const [v] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ('DOC9999', 'furgón') returning id::text as id",
    ),
  );
  const r = await request.post(`/api/gobierno/vehiculos/${v!.id}/documentos`, {
    headers: comoDuena,
    data: { tipo: "permiso de circulación", vence_el: enDias(40) },
  });
  expect(r.status()).toBe(201);
  expect((await r.json()).documento.estado).toBe("vigente");
});
