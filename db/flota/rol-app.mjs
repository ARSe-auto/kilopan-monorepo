#!/usr/bin/env node
// Credenciales de aplicación por tenant [AC-FTEN-03].
//
// El §4.1 no pide un rol por tenant por prolijidad: pide que un bug de routing NO PUEDA
// cruzar datos, porque la conexión del tenant A físicamente no alcanza la BD de B. Eso son
// tres cosas juntas, y las tres viven acá:
//
//   1. `app_t_<slug>` con LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE.
//   2. `CONNECT` revocado a PUBLIC en cada base —Postgres se lo regala a todo el mundo por
//      omisión, así que sin este REVOKE «CONNECT solo a su BD» sería falso— y otorgado
//      explícitamente a un solo rol.
//   3. Cero ownership: el rol de app no es dueño de nada. Del esquema es dueño `migrator`
//      (AC-FTEN-07), así que la app no puede cambiarlo ni aunque alguien se lo pida.
//
// La contraseña se genera al provisionar y NO se persiste en el repo: se devuelve a quien
// llame. Dónde vive en producción es del registro de `control` (AC-FTEN-04) y del §7.1
// (secretos solo en `.env.local`); acá jamás se escribe a disco.
import { randomBytes } from "node:crypto";
import { con, ROL_MIGRADOR, bdDeTenant, rolDeTenant } from "./conectar.mjs";

/** Una clave sin comillas ni barras: entra literal a un `CREATE ROLE … PASSWORD '…'`. */
export function claveNueva() {
  return randomBytes(24).toString("base64url");
}

function ident(nombre) {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(nombre)) throw new Error(`identificador no citable: «${nombre}»`);
  return nombre;
}

/**
 * `CREATE ROLE … PASSWORD` no admite parámetro: la clave va interpolada. Esta es la única
 * puerta, y solo deja pasar el alfabeto de `claveNueva()` — una comilla acá sería una
 * inyección en un DDL que crea credenciales.
 */
export function claveCitable(clave) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(clave)) {
    throw new Error(
      "la clave del rol de app tiene caracteres que no puedo poner en un DDL: solo letras, " +
        "dígitos, guion y guion bajo, entre 16 y 128.",
    );
  }
  return clave;
}

/** Crea o actualiza `app_t_<slug>`. Idempotente: el alta se puede repetir sin romper nada. */
export async function asegurarRolDeApp(slug, { clave = claveNueva() } = {}) {
  const rol = rolDeTenant(slug);
  claveCitable(clave);
  await con("postgres", async ({ sql }) => {
    const [existente] = await sql("select rolsuper, rolbypassrls from pg_roles where rolname = $1", [
      rol,
    ]);
    const atributos = "login nosuperuser nocreatedb nocreaterole nobypassrls";
    if (existente) {
      await sql(`alter role ${ident(rol)} with ${atributos} password '${claveCitable(clave)}'`);
    } else {
      await sql(`create role ${ident(rol)} with ${atributos} password '${claveCitable(clave)}'`);
    }
  });
  return { rol, clave };
}

/**
 * Deja al rol con CONNECT SOLO a su base y con los permisos de datos, nunca de esquema.
 *
 * `ALTER DEFAULT PRIVILEGES FOR ROLE migrator` es la mitad que se olvida: sin ella, la tabla
 * que el runner cree mañana nacería invisible para la app y alguien «arreglaría» eso dándole
 * ownership al rol de app, que es exactamente lo que el §4.1 prohíbe.
 */
export async function acotarConexion(slug) {
  const bd = bdDeTenant(slug);
  const rol = rolDeTenant(slug);

  await con("postgres", async ({ sql }) => {
    // El REVOKE va contra TODAS las bases del cluster, no solo contra la suya. Postgres le
    // regala CONNECT a PUBLIC en cada base que nace, así que acotar únicamente `t_<slug>`
    // dejaría al rol de A entrando a la BD de B, a la plantilla y a `postgres` — que es
    // exactamente el cruce que el centinela 3 dice que no puede pasar. El dueño (`migrator`)
    // y el superusuario conservan su acceso: los privilegios del dueño no salen de PUBLIC.
    const bases = await sql("select datname from pg_database where not datistemplate");
    for (const { datname } of bases) {
      await sql(`revoke connect on database ${ident(datname)} from public`);
    }
    await sql(`grant connect on database ${ident(bd)} to ${ident(rol)}`);
  });

  await con(bd, async ({ sql }) => {
    await sql(`grant usage on schema public to ${ident(rol)}`);
    await sql(`grant select, insert, update, delete on all tables in schema public to ${ident(rol)}`);
    await sql(
      `alter default privileges for role ${ident(ROL_MIGRADOR)} in schema public ` +
        `grant select, insert, update, delete on tables to ${ident(rol)}`,
    );

    // USAGE sobre las secuencias, o `nextval` rebota con 42501. La secuencia monotónica de
    // `eventos` (§4.6) se alimenta de un DEFAULT, así que sin esto la app no puede insertar
    // un hecho — y el rebote aparecería recién con el primer POD del hito (e).
    await sql(`grant usage on all sequences in schema public to ${ident(rol)}`);
    await sql(
      `alter default privileges for role ${ident(ROL_MIGRADOR)} in schema public ` +
        `grant usage on sequences to ${ident(rol)}`,
    );

    // Y se le quita UPDATE/DELETE en las tablas append-only del §7.4. Cuáles son NO se
    // escribe acá: se deriva del catálogo, preguntando qué tablas llevan el trigger de
    // rechazo. Una lista a mano en JavaScript se desincronizaría de la migración que agregue
    // la próxima tabla de hechos, y el REVOKE que falta no se ve hasta que alguien edita un
    // hecho en producción.
    const apendOnly = await sql(
      `select distinct c.relname from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc  p on p.oid = t.tgfoid
        where p.proname = 'rechazar_mutacion_de_hecho' and not t.tgisinternal`,
    );
    for (const { relname } of apendOnly) {
      await sql(`revoke update, delete on ${ident(relname)} from ${ident(rol)}`);
    }

    // Y se le quita el INSERT en las tablas cuyas filas SOLO puede crear una función
    // `SECURITY DEFINER` (§7.5: el devengo de `liquidacion_lineas`). Misma técnica que arriba
    // y por el mismo motivo: cuáles son se pregunta al catálogo, no se lista acá. El trigger
    // que las marca rebota también al migrador —lo que un REVOKE no puede hacer, porque el
    // dueño no se revoca a sí mismo—, y este REVOKE cierra la mitad que el trigger no cubre:
    // el rol de app no inserta una línea ni declarándose en curso de devengo. [AC-FTAR-03]
    const soloPorFuncion = await sql(
      `select distinct c.relname from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc  p on p.oid = t.tgfoid
        where p.proname = 'solo_el_devengo_crea_lineas' and not t.tgisinternal`,
    );
    for (const { relname } of soloPorFuncion) {
      await sql(`revoke insert on ${ident(relname)} from ${ident(rol)}`);
    }
  });

  return { bd, rol };
}

/** El alta completa de credenciales de un tenant. Devuelve la clave; no la guarda. */
export async function provisionarRolDeApp(slug, { clave = claveNueva() } = {}) {
  const { rol } = await asegurarRolDeApp(slug, { clave });
  await acotarConexion(slug);
  return { rol, clave, bd: bdDeTenant(slug) };
}

/** ¿Ya existe el rol de app de este tenant? */
export async function tieneRolDeApp(slug) {
  return con("postgres", async ({ sql }) =>
    (await sql("select 1 from pg_roles where rolname = $1", [rolDeTenant(slug)])).length > 0,
  );
}

/** Lo que el test de privilegios del AC mira: atributos, ownership y a qué bases alcanza. */
export async function auditarRolDeApp(slug) {
  const rol = rolDeTenant(slug);
  const bd = bdDeTenant(slug);

  const atributos = await con("postgres", async ({ sql }) => {
    const [fila] = await sql(
      "select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin " +
        "from pg_roles where rolname = $1",
      [rol],
    );
    return fila ?? null;
  });

  const alcanza = await con("postgres", async ({ sql }) =>
    (
      await sql(
        "select datname from pg_database where not datistemplate " +
          "and has_database_privilege($1, datname, 'CONNECT') order by 1",
        [rol],
      )
    ).map((f) => f.datname),
  );

  // `pg_shdepend` con deptype 'o' es «este rol es DUEÑO de este objeto», para cualquier clase
  // de objeto: tablas, funciones, esquemas, tipos. Contar solo `pg_class` dejaría pasar una
  // función propia del rol de app.
  const posee = await con(bd, async ({ sql }) => {
    const [{ n }] = await sql(
      "select count(*)::int as n from pg_shdepend s join pg_roles r on r.oid = s.refobjid " +
        "where r.rolname = $1 and s.deptype = 'o'",
      [rol],
    );
    return n;
  });

  return { rol, bd, atributos, alcanza, posee };
}

/** Para el harness de test: borrar el rol de un tenant efímero. */
export async function borrarRolDeApp(slug) {
  await con("postgres", ({ sql }) => sql(`drop role if exists ${ident(rolDeTenant(slug))}`));
}
