// Núcleo compartido de los seeds de tenant del hito (g) [AC-FMIG-18] —
// specs/flota/08-diseno-miga-onboarding.md §7, §10 del maestro (docs/PROMPT_MAESTRO_FLOTA.md).
//
// El registro de centinelas y la propiedad que los hace servibles como oráculo de cruce viven
// en `seeds/centinelas.mjs`, sin imports, para que su test corra en el gate rápido; acá se
// reexportan para que el resto del árbol tenga un solo lugar del que tomarlos.
import pg from "pg";
import { con, urlDe } from "../conectar.mjs";
import { emitirInvitacion } from "../../../apps/flota/src/servidor/gobierno.ts";
import { aprobar } from "../../../apps/flota/src/servidor/aprobacion.ts";

export { CENTINELAS, centinelasNoDisjuntos } from "./centinelas.mjs";

/** El `Pool` con el rol de APP del tenant (`app_t_<slug>`), no el migrador: es el rol con el que
 *  corre la app de verdad, y `enActo`/`enLectura` declaran `app.current_role` sobre él. */
export function poolDelTenant(tenant) {
  return new pg.Pool({ connectionString: urlDe(tenant.bd, { usuario: tenant.rol, clave: tenant.clave }) });
}

export function sesionDe(actor, rol, empresaClienteId = null) {
  return {
    dispositivoId: actor.dispositivoId,
    personaId: actor.personaId,
    usuarioId: actor.usuarioId,
    rol,
    isStandalone: true,
    storagePersisted: true,
    empresaClienteId,
  };
}

/**
 * El actor `admin_tenant` que EJECUTA la siembra. No es una decisión de producto: la Pregunta al
 * dueño 1 de la spec 08 deja abierto cómo nace la credencial del primer admin real, y este
 * `secreto_hash` no abre nada. Lleva el centinela del tenant en el nombre para que el barrido de
 * huella lo encuentre también del lado de las personas, no solo de las empresas.
 */
export async function sembrarActorAdmin(bd, rut, centinela) {
  return con(bd, async ({ sql }) => {
    const [persona] = await sql(
      "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
      [rut, `Dueña de la operación (seed ${centinela})`],
    );
    const [usuario] = await sql(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [persona.id],
    );
    const [dispositivo] = await sql(
      `insert into dispositivos
         (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)
       returning id::text as id`,
      [persona.id, `hash-del-actor-admin-${centinela}`, usuario.id],
    );
    return { personaId: persona.id, usuarioId: usuario.id, dispositivoId: dispositivo.id };
  });
}

/** Un par ECDH P-256 REAL: `aprobar()` sella el secreto del chofer contra esta clave con el
 *  MISMO `sellar()` que usa el aparato de verdad — un string cualquiera ahí no simularía la
 *  aprobación, la rompería (`subtle.importKey` rechaza una SPKI inválida). */
async function clavePublicaDeAparato() {
  const par = await globalThis.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const spki = await globalThis.crypto.subtle.exportKey("spki", par.publicKey);
  return Buffer.from(spki).toString("base64");
}

/**
 * Un chofer REAL del tenant: invitación por rol + solicitud + aprobación en 1 toque (§5.4), con
 * los servicios de servidor de AC-FIDN-03/04 — nada reimplementado.
 *
 * La SOLICITUD es la única pieza sin servicio puro que invocar (el endpoint público
 * `/api/solicitudes` está atado a `headers()` de Next), así que se inserta la misma fila
 * `pendiente` que ese handler escribiría, igual que hace el paso 2 del wizard (AC-FMIG-14).
 */
export async function sembrarChofer(tenant, pool, sesionAdmin, { rut, nombre }) {
  const invitacion = await emitirInvitacion(pool, sesionAdmin, "chofer");
  const clavePublica = await clavePublicaDeAparato();
  const [solicitud] = await con(tenant.bd, ({ sql }) =>
    sql(
      `insert into solicitudes_acceso
         (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
       values ($1, $2, $3, '$argon2id$demo-chofer-de-seed', $4, $5)
       returning id::text as id`,
      [invitacion.id, rut, nombre, clavePublica, `huella-del-telefono-de-${rut}`],
    ),
  );

  const aprobacion = await aprobar(pool, solicitud.id, sesionAdmin.usuarioId);
  if (aprobacion.tipo !== "aprobada") {
    throw new Error(`seed: la aprobación del chofer ${rut} rebotó (${aprobacion.motivo}).`);
  }
  const [persona] = await con(tenant.bd, ({ sql }) =>
    sql("select persona_id::text as persona_id from usuarios where id = $1", [aprobacion.usuarioId]),
  );
  return {
    usuarioId: aprobacion.usuarioId,
    dispositivoId: aprobacion.dispositivoId,
    personaId: persona.persona_id,
  };
}

/** Identificador SQL citado. Los nombres vienen del catálogo de la propia base, pero se citan
 *  igual: un barrido que interpola sin citar se rompe con la primera tabla en mayúsculas. */
const ident = (nombre) => `"${String(nombre).replaceAll('"', '""')}"`;

/**
 * La HUELLA de un centinela dentro de una base: en qué `tabla.columna` aparece y cuántas veces.
 *
 * Barre TODAS las columnas de texto de todas las tablas de `public` — no una lista escrita a
 * mano. Esa es la diferencia entre este oráculo y un 404: el §9.3.2 pide mirar la huella de la
 * BD del vecino, y una lista curada se queda vieja el día que alguien agrega una tabla, sin que
 * nada avise. Devuelve `[]` si el centinela no está en ninguna parte.
 */
export async function huellaDeCentinela(bd, centinela) {
  return con(bd, async ({ sql }) => {
    const columnas = await sql(
      `select c.relname as tabla, a.attname as columna
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         join pg_type t on t.oid = a.atttypid
        where n.nspname = 'public' and c.relkind = 'r'
          and t.typname in ('text', 'varchar', 'bpchar', 'citext')
        order by c.relname, a.attname`,
    );
    const hallazgos = [];
    for (const { tabla, columna } of columnas) {
      const [fila] = await sql(
        `select count(*)::int as n from ${ident(tabla)} where ${ident(columna)} like $1`,
        [`%${centinela}%`],
      );
      if (fila.n > 0) hallazgos.push({ tabla, columna, filas: fila.n });
    }
    return hallazgos;
  });
}
