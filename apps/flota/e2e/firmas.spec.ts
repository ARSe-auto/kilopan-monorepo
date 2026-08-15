import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { REVOCACION } from "../../../packages/nucleo-comun/src/constants.ts";
import { firmarConPin } from "../src/servidor/firmas.ts";
import { resolverSesion, revocarDispositivo } from "../src/servidor/sesion.ts";
import { fijarPin } from "../src/servidor/pin.ts";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { con, bdDeTenant, ROL_MIGRADOR, destinoDelCluster } from "../../../db/flota/conectar.mjs";
import { provisionar } from "../../../db/flota/provisionar.mjs";
import { borrarRolDeApp } from "../../../db/flota/rol-app.mjs";

// Centinela 12: la firma en aparato ajeno NO abre sesión ni desplaza la del titular
// [AC-FIDN-10] — §4.3, §9.3.12.
//
// El caso es de la parada: el chofer tiene que firmar «recibí conforme» y el aparato que hay a
// mano es el del responsable de carga. Lo que este centinela protege es lo que pasa DESPUÉS —
// que el responsable siga siendo el responsable en su propio teléfono, y que lo que firme a
// continuación siga siendo suyo. Sin eso, el sistema creería que es otro y sus capturas
// posteriores quedarían atribuidas a la persona equivocada.
//
// Base propia: escribe en `firmas`, que es append-only, y una vez que hay firmas apuntando a
// una persona ninguna otra suite puede volver a limpiar `personas` (ver anonimizacion.spec.ts).

const SLUG = "gate_firmas";
const BD = bdDeTenant(SLUG);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const PIN_CHOFER = "4090";
const PIN_RESPONSABLE = "8172";

let pool: Pool;
const chofer = { personaId: "", usuarioId: "" };
const responsable = { personaId: "", usuarioId: "", dispositivoId: "", secreto: "" };

async function crear(rut: string, nombre: string, rol: string) {
  return await con(BD, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
      [rut, nombre],
    );
    const [u] = await c.sql<{ id: string }>(
      `insert into usuarios (persona_id, rol) values ($1, $2::rol_usuario) returning id::text as id`,
      [p!.id, rol],
    );
    return { personaId: p!.id, usuarioId: u!.id };
  });
}

test.beforeAll(async () => {
  await provisionar(SLUG, { recrear: true });
  pool = new Pool({ host: destinoDelCluster().host, port: Number(destinoDelCluster().puerto), database: BD, user: ROL_MIGRADOR });

  Object.assign(chofer, await crear("12.345.678-5", "Chofer", "chofer"));
  Object.assign(responsable, await crear("7.654.321-6", "Responsable", "responsable_carga"));
  await fijarPin(pool, chofer.usuarioId, PIN_CHOFER);
  await fijarPin(pool, responsable.usuarioId, PIN_RESPONSABLE);

  // El aparato es del RESPONSABLE, con su sesión abierta. El chofer no tiene ninguno: firma
  // en el ajeno, que es todo el caso.
  responsable.secreto = secretoNuevo();
  const [d] = await con(BD, (c: Conexion) =>
    c.sql<{ id: string }>(
      "insert into dispositivos (tipo, persona_id, secreto_hash) values ('personal', $1, $2) returning id::text as id",
      [responsable.personaId, hashDeSecreto(responsable.secreto)],
    ),
  );
  responsable.dispositivoId = d!.id;
});

test.afterAll(async () => {
  await pool?.end();
  await con("postgres", ({ sql }: { sql: (t: string) => Promise<unknown> }) =>
    sql(`drop database if exists ${BD} with (force)`),
  );
  await borrarRolDeApp(SLUG);
});

test("[AC-FIDN-10] el chofer firma en el aparato del responsable, y la firma es suya", async () => {
  const r = await firmarConPin(pool, {
    usuarioId: chofer.usuarioId,
    pin: PIN_CHOFER,
    personaId: chofer.personaId,
    dispositivoId: responsable.dispositivoId,
    objetoTabla: "paradas",
    objetoId: "0192f0a0-0000-7000-8000-000000000010",
    significado: "recibio_conforme",
  });
  expect(r.tipo).toBe("firmada");

  const [f] = await con(BD, (c: Conexion) =>
    c.sql<{ persona: string; dispositivo: string; significado: string }>(
      "select persona_id::text as persona, dispositivo_id::text as dispositivo, significado::text as significado from firmas where id = $1",
      [r.tipo === "firmada" ? r.firmaId : ""],
    ),
  );
  // La firma la hizo el CHOFER en el aparato del RESPONSABLE: dos personas distintas en la
  // misma fila, que es exactamente lo que el flujo de la parada necesita.
  expect(f!.persona).toBe(chofer.personaId);
  expect(f!.dispositivo).toBe(responsable.dispositivoId);
  expect(f!.significado).toBe("recibio_conforme");
});

test("[AC-FIDN-10] CENTINELA 12: la sesión del titular sigue intacta", async () => {
  // Lo que el centinela existe para atrapar. Si firmar abriera sesión o desplazara la del
  // titular, el responsable quedaría afuera de su propio teléfono a mitad de un turno.
  const sesion = await resolverSesion(pool, `Portador ${responsable.secreto}`);
  expect(sesion.tipo).toBe("valida");
  expect(sesion.tipo === "valida" && sesion.sesion.usuarioId).toBe(responsable.usuarioId);
  expect(sesion.tipo === "valida" && sesion.sesion.rol).toBe("responsable_carga");
});

test("[AC-FIDN-10] la firma del chofer NO le abrió sesión: no tiene aparato", async () => {
  // La otra mitad: firmar tampoco enrola. El chofer sigue sin dispositivo, así que no hay
  // credencial suya que pueda existir.
  const [{ n }] = await con(BD, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from dispositivos where persona_id = $1", [
      chofer.personaId,
    ]),
  );
  expect(Number(n)).toBe(0);
});

test("[AC-FIDN-10] lo que el responsable firma DESPUÉS sigue siendo suyo", async () => {
  // La consecuencia que le importa a la operación: el §9.3.12 pide «firma en dispositivo
  // ajeno + PODs posteriores válidos». Los PODs nacen en el hito (e); acá se ejerce con la
  // firma, que es la evidencia de este módulo y tiene la misma forma.
  const r = await firmarConPin(pool, {
    usuarioId: responsable.usuarioId,
    pin: PIN_RESPONSABLE,
    personaId: responsable.personaId,
    dispositivoId: responsable.dispositivoId,
    objetoTabla: "paradas",
    objetoId: "0192f0a0-0000-7000-8000-000000000011",
    significado: "libero",
  });
  expect(r.tipo).toBe("firmada");

  const [f] = await con(BD, (c: Conexion) =>
    c.sql<{ persona: string }>("select persona_id::text as persona from firmas where id = $1", [
      r.tipo === "firmada" ? r.firmaId : "",
    ]),
  );
  expect(f!.persona, "la firma posterior del titular quedó atribuida a otra persona").toBe(
    responsable.personaId,
  );
});

test("[AC-FIDN-10] el PIN equivocado no firma, y pasa por el MISMO lockout", async () => {
  // La única comprobación que puede impedir una firma: quién firma. Sin ella la firma no
  // significaría nada, y el §4.5 hace que el significado sea quién responde por la carga.
  const intento = (pin: string) =>
    firmarConPin(pool, {
      usuarioId: chofer.usuarioId,
      pin,
      personaId: chofer.personaId,
      dispositivoId: responsable.dispositivoId,
      objetoTabla: "paradas",
      objetoId: "0192f0a0-0000-7000-8000-000000000012",
      significado: "rechazo",
    });

  const malo = await intento("1357");
  expect(malo.tipo === "rebote" && malo.motivo).toBe("credenciales_invalidas");

  for (let i = 1; i < 5; i++) await intento("1357");
  const bloqueado = await intento(PIN_CHOFER);
  expect(bloqueado.tipo === "rebote" && bloqueado.motivo).toBe("bloqueado");

  await fijarPin(pool, chofer.usuarioId, PIN_CHOFER);
});

test("[AC-FIDN-10] el replay de la misma firma no crea una segunda fila", async () => {
  const [{ uuid }] = await con(BD, (c: Conexion) => c.sql<{ uuid: string }>("select uuidv7()::text as uuid"));
  const enviar = () =>
    firmarConPin(pool, {
      usuarioId: chofer.usuarioId,
      pin: PIN_CHOFER,
      personaId: chofer.personaId,
      dispositivoId: responsable.dispositivoId,
      objetoTabla: "paradas",
      objetoId: "0192f0a0-0000-7000-8000-000000000013",
      significado: "verifico",
      clientUuid: uuid,
    });

  const primera = await enviar();
  const segunda = await enviar();
  expect(primera.tipo).toBe("firmada");
  // El segundo envío devuelve LA MISMA firma, no «no pasó nada»: el aparato necesita saber
  // que su firma está, y un silencio lo haría reintentar para siempre.
  expect(segunda.tipo === "firmada" && segunda.firmaId).toBe(primera.tipo === "firmada" && primera.firmaId);

  const [{ n }] = await con(BD, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from firmas where client_uuid = $1", [uuid]),
  );
  expect(Number(n)).toBe(1);
});

test("[AC-FIDN-10] la firma de un aparato REVOCADO entra igual, con su flag (clase CAPTURA)", async () => {
  // §4.2: la captura del terreno jamás rebota. Una firma hecha cuando el aparato estaba
  // habilitado no deja de haber ocurrido porque después lo dieran de baja.
  await revocarDispositivo(pool, responsable.dispositivoId);

  const r = await firmarConPin(pool, {
    usuarioId: chofer.usuarioId,
    pin: PIN_CHOFER,
    personaId: chofer.personaId,
    dispositivoId: responsable.dispositivoId,
    objetoTabla: "paradas",
    objetoId: "0192f0a0-0000-7000-8000-000000000014",
    significado: "aprobo",
  });

  expect(r.tipo, "una firma post-revocación rebotó, y la captura no rebota").toBe("firmada");
  expect(r.tipo === "firmada" && r.flag).toBe(REVOCACION.flag_dentro);

  const [{ n }] = await con(BD, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from firmas where objeto_id = $1", [
      "0192f0a0-0000-7000-8000-000000000014",
    ]),
  );
  expect(Number(n)).toBe(1);
});
