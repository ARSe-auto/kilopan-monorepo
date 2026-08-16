import { test, expect } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { origenDe } from "./puerto.ts";
import { LABELS } from "../../../packages/nucleo-comun/src/constants.ts";

// AC-FMIG-06 — edición de terminología con CHECKs de BD (largos por tipo, caracteres, sistema
// no editable) ⇒ 422 es-CL; degradación por turno congelado (§0, §4.4, §5.1).
//
// Base PROPIA `config_congelada` (ver el comentario de `preparar-tenants.mjs`): esta suite hace
// PUT REAL sobre `tenant_terminology` —no un INSERT directo, como `terminologia.spec.ts`
// (AC-FMIG-04)— y sella `config_version` nuevas cada vez que un edit entra, así que necesita su
// propio tenant para no interferir con la invariante «nadie más toca `tenant_terminology`» ni
// con el turno que abra cualquier otra suite mientras esta corre.
//
// LO QUE ESTE ARCHIVO PRUEBA Y EL pgTAP NO PUEDE: que el rebote de cada CHECK llegue al cliente
// como un 422 TIPADO en es-CL (no un 500 con el nombre del constraint) y, sobre todo, que la
// DEGRADACIÓN del §4.4 sea real: un turno YA abierto sigue sirviendo su terminología vieja
// aunque el panel admin edite a mitad de la jornada, y un turno NUEVO —abierto después del
// edit— ya sirve la que quedó guardada. Eso solo se puede probar con un turno de verdad, HTTP
// de verdad, y una BD de verdad — un pgTAP no abre turnos ni pega al bootstrap.

const TENANT = TENANTS.find((t) => t.slug === "config_congelada")!;
const BD = bdDeTenant(TENANT.slug);
const ORIGEN = origenDe(TENANT.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_DUENA = Object.keys(VALIDOS)[0]!;
const SECRETO = secretoNuevo();
const AUTH = { Authorization: `Portador ${SECRETO}` };

let vehiculoId = "";

test.beforeAll(async () => {
  await con(BD, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Dueña de config_congelada') returning id::text as id",
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
      "insert into vehiculos (patente, tipo) values ('CNG0001', 'furgón') returning id::text as id",
    );
    vehiculoId = v!.id;
  });
});

const filaDeChofer = () =>
  con(BD, (c: Conexion) =>
    c.sql<{ singular: string }>("select singular from tenant_terminology where term_key = 'chofer'"),
  ).then((r) => r[0]?.singular ?? null);

test("un término de navegación que pasa su largo rebota con 422 es-CL y la fila no cambia [AC-FMIG-06]", async ({
  request,
}) => {
  const antes = await filaDeChofer();
  const r = await request.put(`${ORIGEN}/api/terminologia`, {
    headers: AUTH,
    data: { term_key: "chofer", singular: "Conductor demasiado largo", plural: "Conductores" },
  });
  expect(r.status()).toBe(422);
  const cuerpo = (await r.json()) as { error: string; mensaje: string };
  expect(cuerpo.error).toBe("largo_excedido");
  expect(cuerpo.mensaje).toMatch(new RegExp(`${LABELS.largo_max.navegacion}`));
  expect(await filaDeChofer()).toBe(antes);
});

test("un carácter prohibido rebota con 422 es-CL y la fila no cambia [AC-FMIG-06]", async ({ request }) => {
  const antes = await filaDeChofer();
  const r = await request.put(`${ORIGEN}/api/terminologia`, {
    headers: AUTH,
    data: { term_key: "chofer", singular: "Chofer #1", plural: "Choferes" },
  });
  expect(r.status()).toBe(422);
  const cuerpo = (await r.json()) as { error: string };
  expect(cuerpo.error).toBe("caracter_prohibido");
  expect(await filaDeChofer()).toBe(antes);
});

test("singular o plural vacío rebota con 422 es-CL [AC-FMIG-06]", async ({ request }) => {
  const antes = await filaDeChofer();
  const r = await request.put(`${ORIGEN}/api/terminologia`, {
    headers: AUTH,
    data: { term_key: "chofer", singular: "", plural: "Choferes" },
  });
  expect(r.status()).toBe(422);
  const cuerpo = (await r.json()) as { error: string };
  expect(cuerpo.error).toBe("vacio");
  expect(await filaDeChofer()).toBe(antes);
});

test("un término de sistema/auditoría NO aparece como editable: 422 aunque se lo pida directo por API [AC-FMIG-06]", async ({
  request,
}) => {
  const r = await request.put(`${ORIGEN}/api/terminologia`, {
    headers: AUTH,
    data: { term_key: "audit_trail", singular: "Historial", plural: "Historiales" },
  });
  expect(r.status()).toBe(422);
  const cuerpo = (await r.json()) as { error: string };
  expect(cuerpo.error).toBe("termino_no_editable");
});

test("un turno YA abierto NO cambia de términos a mitad de turno; uno NUEVO ya sirve el edit [AC-FMIG-06]", async ({
  request,
}) => {
  // El turno 1 se abre con la terminología de fábrica todavía vigente — nadie la editó aún.
  const apertura1 = await request.post(`${ORIGEN}/api/turnos`, {
    headers: AUTH,
    data: { vehiculo_id: vehiculoId },
  });
  expect(apertura1.status()).toBe(201);
  const { turno: turno1 } = (await apertura1.json()) as { turno: { id: string } };

  const abierto1Antes = await request.get(`${ORIGEN}/api/turnos/abierto`, { headers: AUTH });
  const { turno: reportado1Antes, terminos: terminos1Antes } = (await abierto1Antes.json()) as {
    turno: { id: string };
    terminos: Record<string, { singular: string; plural: string }>;
  };
  expect(reportado1Antes.id).toBe(turno1.id);
  expect(terminos1Antes.chofer!.singular).toBe("chofer");

  // El panel admin edita a mitad de la jornada del turno 1 — §4.4: «aplica al próximo bootstrap».
  const put = await request.put(`${ORIGEN}/api/terminologia`, {
    headers: AUTH,
    data: { term_key: "chofer", singular: "Piloto", plural: "Pilotos" },
  });
  expect(put.status()).toBe(200);

  // El panel admin (siempre en vivo) YA ve el cambio.
  const enVivo = await request.get(`${ORIGEN}/api/terminologia`, { headers: AUTH });
  const { terminos: enVivoTerminos } = (await enVivo.json()) as {
    terminos: Record<string, { singular: string; plural: string }>;
  };
  expect(enVivoTerminos.chofer!.singular).toBe("Piloto");

  // Pero el turno 1, YA abierto, sigue sirviendo «chofer»: su config_version_id quedó
  // congelado ANTES del edit y no lo alcanza (§4.4) — el corazón de este AC.
  const abierto1Despues = await request.get(`${ORIGEN}/api/turnos/abierto`, { headers: AUTH });
  const { turno: reportado1Despues, terminos: terminos1Despues } = (await abierto1Despues.json()) as {
    turno: { id: string };
    terminos: Record<string, { singular: string; plural: string }>;
  };
  expect(reportado1Despues.id, "el turno 1 sigue siendo el abierto").toBe(turno1.id);
  expect(
    terminos1Despues.chofer!.singular,
    "un turno abierto no puede cambiar de términos a mitad de turno",
  ).toBe("chofer");

  // Se cierra el turno 1 y se abre uno NUEVO con el MISMO vehículo: el §4.4 dice que el cambio
  // aplica al «próximo bootstrap», y un turno nuevo es exactamente eso.
  const cierre = await request.post(`${ORIGEN}/api/turnos/${turno1.id}/cierre`, {
    headers: AUTH,
    data: { enchufado: true },
  });
  expect(cierre.status()).toBe(200);

  const apertura2 = await request.post(`${ORIGEN}/api/turnos`, {
    headers: AUTH,
    data: { vehiculo_id: vehiculoId },
  });
  expect(apertura2.status()).toBe(201);
  const { turno: turno2 } = (await apertura2.json()) as { turno: { id: string } };
  expect(turno2.id).not.toBe(turno1.id);

  const abierto2 = await request.get(`${ORIGEN}/api/turnos/abierto`, { headers: AUTH });
  const { turno: reportado2, terminos: terminos2 } = (await abierto2.json()) as {
    turno: { id: string };
    terminos: Record<string, { singular: string; plural: string }>;
  };
  expect(reportado2.id).toBe(turno2.id);
  expect(terminos2.chofer!.singular, "el turno NUEVO ya sirve el término editado").toBe("Piloto");
});
