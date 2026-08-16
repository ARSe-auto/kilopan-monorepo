#!/usr/bin/env node
// Provisión de tenants desde `tenant_template` [AC-FTEN-02].
//
// El §4.1 pide que el alta de un tenant sea `CREATE DATABASE t_<slug> TEMPLATE tenant_template`
// —segundos, dentro del wizard— y que la plantilla sea un artefacto VERSIONADO del repo: la
// cuarta vida de todo cambio de esquema. Acá viven las tres operaciones que eso implica:
//
//   plantilla  — crear/refrescar `tenant_template` aplicándole las migraciones de `tenant/`
//   tenant     — crear `t_<slug>` desde la plantilla y SEMBRAR su identidad
//   auditar    — el caso de rebote del AC: si una migración llegó a las BD de tenant pero no
//                a la plantilla, todo tenant nuevo nacería desactualizado ⇒ exit ≠ 0
//
// La siembra no es una fila más: `tenant_info` dice QUÉ tenant es esta base, y `tenant_actual()`
// —la constante contra la que cada tabla de dominio verifica su `tenant_id`— se reemplaza con
// ese uuid HORNEADO como literal (ver `db/migraciones-flota/LEEME.md` para el porqué). Mientras
// las dos no coincidan, los CHECK de la base estarían validando contra otro tenant: la fuga de
// aislamiento más silenciosa posible. Por eso la provisión no termina sin `tenant_coherente()`.
import { pathToFileURL } from "node:url";
import { con, BD_CONTROL, BD_PLANTILLA, ROL_MIGRADOR, bdDeTenant, slugDeBd } from "./conectar.mjs";
import { aplicar, aplicadasEn, migracionesDe, DIR_MIGRACIONES } from "./aplicar.mjs";
import { provisionarRolDeApp } from "./rol-app.mjs";
import { CONTRASTE } from "../../packages/nucleo-comun/src/constants.ts";
import { MODOS, esModo } from "../../apps/flota/src/servidor/modo.ts";

/** El uuid que `tenant_actual()` devuelve en la plantilla: la plantilla no es un tenant. */
export const UUID_CENTINELA_PLANTILLA = "00000000-0000-7000-8000-000000000000";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Un nombre de base o de rol no se puede pasar como parámetro de consulta: va interpolado.
 * Esta es la única puerta por la que se interpola, y solo deja pasar lo que ya validó
 * `bdDeTenant`/la familia de constantes. Nada que venga de afuera llega crudo a un DDL.
 */
function ident(nombre) {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(nombre)) {
    throw new Error(`nombre de base no citable: «${nombre}»`);
  }
  return nombre;
}

async function existe(sql, bd) {
  return (await sql("select 1 from pg_database where datname = $1", [bd])).length > 0;
}

/** Conexiones ajenas contra `bd`. `CREATE DATABASE … TEMPLATE` falla si hay alguna. */
async function conexionesA(sql, bd) {
  const [{ n }] = await sql(
    "select count(*)::int as n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
    [bd],
  );
  return n;
}

/**
 * Crea el rol que corre las migraciones y es dueño de las bases [AC-FTEN-07].
 *
 * Idempotente: el deploy lo llama siempre, y en un cluster recién hecho tiene que quedar
 * igual que en uno que ya lo tiene. NOSUPERUSER y NOBYPASSRLS son la mitad del punto: un
 * `migrator` con superusuario no estaría separado de nada.
 */
export async function asegurarRolMigrador() {
  return con("postgres", async ({ sql }) => {
    const [rol] = await sql(
      "select rolsuper, rolbypassrls, rolcreatedb, rolcanlogin from pg_roles where rolname = $1",
      [ROL_MIGRADOR],
    );
    if (!rol) {
      await sql(
        `create role ${ident(ROL_MIGRADOR)} login nosuperuser nocreatedb nocreaterole nobypassrls`,
      );
      return { creado: true };
    }
    // Si alguien se lo subió a superusuario a mano, el deploy no sigue como si nada.
    if (rol.rolsuper || rol.rolbypassrls) {
      throw new Error(
        `el rol ${ROL_MIGRADOR} tiene ${rol.rolsuper ? "SUPERUSER" : "BYPASSRLS"}: dejaría de ` +
          "ser un rol separado y el §4.1 lo prohíbe.",
      );
    }
    return { creado: false };
  });
}

/** El dueño de una base, o `null` si la base no existe. */
export async function duenoDe(bd) {
  return con("postgres", async ({ sql }) => {
    const [fila] = await sql(
      "select pg_get_userbyid(datdba) as dueno from pg_database where datname = $1",
      [bd],
    );
    return fila?.dueno ?? null;
  });
}

async function crearBase(sql, bd, plantilla) {
  if (plantilla) {
    // ESPERAR, NO RENDIRSE AL PRIMER CONTEO (15-ago-2026). Los pools de `pg` retienen la
    // conexión OCIOSA hasta 10 s después del release (`idleTimeoutMillis` por defecto): la
    // suite anterior ya terminó, su conexión a la plantilla sigue viva unos segundos, y esta
    // provisión llegaba dentro de esa ventana y abortaba — en serie y sin que nadie tuviera
    // la plantilla abierta de verdad. Se vio provisionando el cluster del TERCER motor: la
    // misma suite pasaba sola y fallaba dentro del gate, según la suerte del reloj.
    // Se espera hasta ~12 s (cubre ese timeout) y recién entonces se rinde con el mensaje
    // humano de siempre. NO se usa pg_terminate_backend a propósito: matar la conexión de un
    // psql ajeno es decidir por quien lo tiene abierto, y este mensaje existe para avisarle.
    let abiertas = await conexionesA(sql, plantilla);
    for (let intento = 0; abiertas > 0 && intento < 24; intento++) {
      await new Promise((r) => setTimeout(r, 500));
      abiertas = await conexionesA(sql, plantilla);
    }
    if (abiertas > 0) {
      throw new Error(
        `no puedo crear ${bd}: hay ${abiertas} conexión(es) abierta(s) contra ${plantilla} ` +
          "(esperé 12 s por si era una conexión ociosa de un pool). PostgreSQL exige que nadie " +
          "esté conectado a la plantilla mientras se la copia (cerrá el psql que la esté mirando).",
      );
    }
  }
  // Dueña `migrator` desde el nacimiento, no por un ALTER posterior: desde PostgreSQL 15 el
  // esquema `public` pertenece a `pg_database_owner`, así que fijar el dueño de la base ya
  // le da al migrador el permiso de crear tablas ahí — y a nadie más (§4.1).
  await sql(
    `create database ${ident(bd)} owner ${ident(ROL_MIGRADOR)}` +
      (plantilla ? ` template ${ident(plantilla)}` : ""),
  );
}

/** Las versiones aplicadas en una base, ordenadas. Base sin `schema_migrations` ⇒ vacío. */
export async function versionesDe(bd) {
  return con(bd, async (c) => [...(await aplicadasEn(c)).keys()].sort());
}

/** Las BD de tenant vivas en el cluster: las que se llaman `t_<slug>` (§0 naming de tenancy). */
export async function basesDeTenant() {
  return con("postgres", async ({ sql }) =>
    (
      await sql(
        "select datname from pg_database where datname like $1 and not datistemplate order by 1",
        ["t\\_%"],
      )
    ).map((f) => f.datname),
  );
}

/**
 * Crea `tenant_template` si falta y le aplica lo pendiente de `tenant/`.
 *
 * Se cierra la conexión antes de devolver (lo hace `con`) porque el paso siguiente de la
 * vida de la plantilla es que alguien la COPIE, y una conexión abierta lo impide.
 */
/** La BD `control`: una sola en el cluster, dueña `migrator` como todas (§4.1). [AC-FTEN-04] */
export async function crearBaseDeControlSiFalta() {
  await asegurarRolMigrador();
  return con("postgres", async ({ sql }) => {
    if (await existe(sql, BD_CONTROL)) return false;
    await crearBase(sql, BD_CONTROL, null);
    return true;
  });
}

export async function crearPlantillaSiFalta() {
  await asegurarRolMigrador();
  return con("postgres", async ({ sql }) => {
    if (await existe(sql, BD_PLANTILLA)) return false;
    await crearBase(sql, BD_PLANTILLA, null);
    return true;
  });
}

export async function refrescarPlantilla({ dir = DIR_MIGRACIONES, usuario = ROL_MIGRADOR } = {}) {
  const creada = await crearPlantillaSiFalta();
  const { aplicadas, yaEstaban } = await con(BD_PLANTILLA, (c) => aplicar(c, "tenant", { dir }), {
    usuario,
  });
  return { creada, aplicadas, yaEstaban };
}

/**
 * El alta en `control.tenants`: registra slug, bd y el modo elegido [AC-FPOR-01].
 *
 * Hasta acá la provisión solo creaba la BD del tenant; `control.tenants` —la AUTORIDAD que
 * lee el ruteo y de la que se resuelve el preset de entitlements (§4.4)— se quedaba sin fila
 * (deuda documentada en `tenantIdEnControl`, `apps/flota/src/servidor/gobierno.ts`). El
 * wizard de AC-FMIG-14 va a invocar `provisionar()` como su servicio de alta; esta es la
 * mitad que persiste el modo que el botón del wizard elija.
 *
 * `on conflict (slug)` en vez de un INSERT liso: con `recrear` la BD física se dropea y se
 * rehace, pero el registro de `control` no tiene por qué perder su `id` —y con él, los
 * `grants_soporte` que ya lo referencian— solo porque el gate volvió a provisionar el mismo
 * tenant de prueba.
 */
async function altaEnControl(slug, bd, modo) {
  await con(BD_CONTROL, ({ sql }) =>
    sql(
      `insert into tenants (slug, bd, modo) values ($1, $2, $3::tenant_modo)
         on conflict (slug) do update set bd = excluded.bd, modo = excluded.modo`,
      [slug, bd, modo],
    ),
  );
}

/**
 * El complemento del alta: retira el registro de `control.tenants` [AC-FPOR-01].
 *
 * Los fixtures del gate dropean la BD física del tenant de prueba al terminar, pero desde que
 * `provisionar()` también da de alta en `control` esa fila sobrevive al DROP DATABASE si nadie
 * la borra — y el job exportador (AC-FTEN-20) la reporta como «registrado en control pero su
 * base no existe» en cada corrida siguiente. `on delete cascade` no alcanza para todo: úsese
 * junto con el DROP DATABASE del fixture, no en su reemplazo.
 */
export async function desalta(slug) {
  await con(BD_CONTROL, ({ sql }) => sql("delete from tenants where slug = $1", [slug]));
}

/**
 * Crea `t_<slug>` desde la plantilla, siembra su identidad y da de alta el tenant en
 * `control.tenants` con el modo elegido. Devuelve `{ slug, bd, id, modo, rol, clave }`.
 *
 * `recrear` existe para el gate: la suite provisiona los mismos dos tenants en CADA corrida
 * (lo exige el AC) y una corrida no puede depender de que la anterior haya limpiado.
 *
 * `modo` es SOLO `mi_flota|daas` (§3, §4.4): el dominio cerrado se rechaza ACÁ, antes de
 * tocar la base, para que un valor fuera de dominio quede en 0 filas — jamás una CREATE
 * DATABASE a medio camino por un typo en el modo. `esModo`/`MODOS` son los mismos que valida
 * la conmutación (`servidor/modo.ts`, AC-FRUT-14): una sola definición del dominio.
 *
 * `rutDeLaEmpresa`/`razonSocial` son la identidad de la EMPRESA dueña de la cuenta — el primer
 * dato que pide el wizard del alta (§3, «un botón al crear la operación»). Van a `tenant_info`
 * en el mismo acto que el modo, y ahí el trigger del módulo 03
 * (`crear_empresa_implicita()`, 0039) hace lo suyo: en `mi_flota` la base queda con EXACTAMENTE
 * UNA `empresa_cliente`, la propia (§4.5). [AC-FPOR-17]
 *
 * Van juntas o no van: con una sola de las dos el trigger no crea nada y no rebota (a
 * propósito — ver 0039), así que el alta parecería completa y la empresa implícita no existiría.
 * Un alta SIN identidad es legítima —el tenant existe antes de que el wizard termine de
 * llenarlo— y su empresa implícita aparece sola en cuanto los datos lleguen, porque el trigger
 * también corre en UPDATE.
 */
export async function provisionar(
  slug,
  { recrear = false, modo = "mi_flota", rutDeLaEmpresa = null, razonSocial = null } = {},
) {
  if (!esModo(modo)) {
    throw new Error(
      `modo inválido: «${modo}». control.tenants.modo acepta SOLO ${MODOS.join("|")} (AC-FPOR-01).`,
    );
  }
  if ((rutDeLaEmpresa === null) !== (razonSocial === null)) {
    throw new Error(
      "identidad incompleta: `rutDeLaEmpresa` y `razonSocial` van juntas o no van (AC-FPOR-17). " +
        "Con una sola, el trigger de la empresa implícita no crea nada y no se queja.",
    );
  }
  const bd = bdDeTenant(slug);
  await asegurarRolMigrador();

  await con("postgres", async ({ sql }) => {
    if (await existe(sql, bd)) {
      if (!recrear) {
        throw new Error(`la base ${bd} ya existe: el alta de un tenant no pisa a otro.`);
      }
      await sql(`drop database ${ident(bd)} with (force)`);
    }
    await crearBase(sql, bd, BD_PLANTILLA);
  });

  // Desde acá la base EXISTE pero todavía no es de nadie. Si la siembra falla, se borra: una
  // base a medio provisionar es peor que ninguna, porque parece provisionada y `tenant_actual()`
  // devuelve el centinela de la plantilla — todo lo que se escriba ahí queda atado a un tenant
  // que no existe. Lo destapó `t_canary`, que quedó así tras un arranque en frío fallido.
  const sembrar = async () => con(bd, async ({ sql }) => {
    // El uuid lo genera el SERVIDOR (§0: UUIDv7 server-side, jamás en el cliente).
    const [fila] = await sql(
      "insert into tenant_info (id, slug) values (uuidv7(), $1) returning id::text as id",
      [slug],
    );
    if (!RE_UUID.test(fila.id)) throw new Error(`uuid inesperado del servidor: «${fila.id}»`);

    await sql(`create or replace function tenant_actual() returns uuid
      language sql immutable parallel safe
      as $$ select '${fila.id}'::uuid $$`);
    await sql(
      `comment on function tenant_actual() is 'Constante de esta base: el tenant ${slug} ` +
        `(${fila.id}), horneado al provisionar (AC-FTEN-02).'`,
    );

    // MODO E IDENTIDAD DE LA EMPRESA DUEÑA, en ese orden y RECIÉN ACÁ. [AC-FPOR-17]
    //
    // `tenant_info.modo` es la RÉPLICA de `control.tenants.modo` (0039): la autoridad vive en
    // `control` y el §7.2 prohíbe que una consulta del tenant la cruce, así que un trigger que
    // necesita el modo lo lee de esta copia. Hasta acá el alta escribía el modo SOLO en
    // `control` y la réplica se quedaba en su default `mi_flota`: un tenant dado de alta en
    // `daas` nacía con la copia diciendo `mi_flota` y el trigger de la empresa implícita se
    // disparaba igual. La réplica la escribe quien conmuta — y el alta ES la primera
    // conmutación.
    //
    // Y va DESPUÉS del `create or replace tenant_actual()` de arriba porque el trigger inserta
    // en `empresas_cliente`, que lleva `check (tenant_id = tenant_actual())`: disparado antes,
    // la empresa implícita nacería atada al centinela de la plantilla.
    await sql(
      "update tenant_info set modo = $1, rut_de_la_empresa = $2, razon_social = $3",
      [modo, rutDeLaEmpresa, razonSocial],
    );

    // ADOPCIÓN DE LO QUE VENÍA EN LA PLANTILLA. Una migración puede sembrar catálogos —el
    // registro de `ProveedorTelemetria` del §4.9, por ejemplo—, y esas filas nacieron en la
    // plantilla con el `tenant_id` CENTINELA, porque ahí `tenant_actual()` devuelve el
    // centinela. Al copiarse a la base del tenant quedan atadas a un tenant que no existe: el
    // CHECK no las revalida (PostgreSQL no reevalúa constraints al reemplazar la función) y
    // pasan desapercibidas hasta que alguien hace un `pg_dump` y un restore — que es
    // exactamente como se descubrió, con la suite de offboarding de AC-FTEN-17.
    const conTenantId = await sql(
      `select c.relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    for (const { relname } of conTenantId) {
      await sql(
        `update ${ident(relname)} set tenant_id = $1::uuid where tenant_id = $2::uuid`,
        [fila.id, UUID_CENTINELA_PLANTILLA],
      );
    }

    // Y se verifica que no quedó ninguna. Adoptar en silencio sería tapar el mismo agujero
    // con otra manta: si una tabla append-only trajera filas de la plantilla, el UPDATE de
    // arriba rebota y hay que enterarse acá, no en producción.
    for (const { relname } of conTenantId) {
      const [{ n }] = await sql(
        `select count(*)::int as n from ${ident(relname)} where tenant_id <> $1::uuid`,
        [fila.id],
      );
      if (n > 0) {
        throw new Error(
          `${relname} quedó con ${n} fila(s) de otro tenant tras provisionar ${slug}: ` +
            "algo sembrado en la plantilla no se pudo adoptar",
        );
      }
    }

    const [{ ok }] = await sql("select tenant_coherente() as ok");
    if (!ok) {
      throw new Error(
        `${bd} quedó incoherente: tenant_actual() no devuelve el id de tenant_info. ` +
          "La base NO se puede usar así — cada CHECK de tenant_id estaría validando contra " +
          "un tenant distinto del que la base dice ser.",
      );
    }
    return fila.id;
  });

  let id;
  let rol;
  let clave;
  try {
    id = await sembrar();
    // Credenciales propias del tenant, en el mismo acto que la base: una BD de tenant sin su
    // `app_t_<slug>` sería una base a la que solo llega el migrador o el superusuario, y el
    // primero que la necesitara la abriría con el rol equivocado (§4.1). [AC-FTEN-03]
    ({ rol, clave } = await provisionarRolDeApp(slug));
    await asegurarConstantesDePlataforma(bd);
    await altaEnControl(slug, bd, modo);
  } catch (e) {
    await con("postgres", ({ sql }) => sql(`drop database if exists ${ident(bd)} with (force)`));
    throw new Error(`el alta de ${slug} falló y se deshizo (${bd} borrada): ${e.message}`);
  }

  return { slug, bd, id, modo, rol, clave };
}

/**
 * La regla del caso de rebote, PURA para poder probarla sin cluster.
 *
 * Una versión que está en disco o ya aplicada en algún tenant, pero NO en la plantilla, deja
 * la plantilla rezagada: el próximo `CREATE DATABASE … TEMPLATE` copiaría un esquema viejo y
 * el tenant nuevo nacería desactualizado sin que nada se queje. Devuelve los motivos; lista
 * vacía = al día.
 */
export function rezagosDeLaPlantilla({ enDisco = [], plantilla = [], tenants = [] } = {}) {
  const enPlantilla = new Set(plantilla);
  const faltantes = new Map();
  const anotar = (version, donde) => {
    if (enPlantilla.has(version)) return;
    if (!faltantes.has(version)) faltantes.set(version, new Set());
    faltantes.get(version).add(donde);
  };

  for (const version of enDisco) anotar(version, "el disco");
  for (const t of tenants) for (const version of t.versiones) anotar(version, t.bd);

  return [...faltantes]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([version, donde]) =>
        `tenant_template no tiene ${version}, que sí está en ${[...donde].sort().join(", ")}: ` +
        "un tenant nuevo nacería desactualizado",
    );
}

/**
 * Siembra en una base las constantes de PLATAFORMA que el DDL no puede hornear sin duplicar
 * la familia del §0 (grep-gate de AC-FTEN-01). Idempotente. [AC-FTEN-10]
 *
 * La corre la provisión Y el runner después de migrar: una base provisionada ANTES de la
 * migración que agrega una constante se quedaría sin ella para siempre, y el rebote llegaría
 * el día que alguien guarda un tema. Pasó exactamente así con `t_canary`.
 */
export async function asegurarConstantesDePlataforma(bd) {
  return con(bd, async ({ sql }) => {
    const [{ existe: hayTabla }] = await sql(
      "select to_regclass('plataforma') is not null as existe",
    );
    if (!hayTabla) return false;
    await sql(
      "insert into plataforma (contraste_minimo) values ($1) " +
        "on conflict (unica) do update set contraste_minimo = excluded.contraste_minimo",
      [CONTRASTE.texto],
    );
    return true;
  });
}

/**
 * Identidades rotas en el cluster: bases de tenant sin fila en `tenant_info`, con un slug que
 * no es el suyo, o con `tenant_actual()` divergiendo de la fila. [AC-FTEN-02]
 *
 * Es la comprobación más barata contra el peor de los errores callados: una base cuyo
 * `tenant_actual()` todavía devuelve el centinela de la plantilla acepta filas de dominio sin
 * quejarse —el CHECK compara contra el centinela y pasa— y esas filas quedan atadas a un
 * tenant que no existe. Se descubrió con `t_canary` así, tras un arranque en frío fallido.
 */
export async function identidadesRotas() {
  const motivos = [];
  for (const bd of await basesDeTenant()) {
    const slug = slugDeBd(bd);
    try {
      const [{ filas, coherente, slugEnBase }] = await con(bd, ({ sql }) =>
        sql(
          `select (select count(*)::int from tenant_info)  as filas,
                  tenant_coherente()                       as coherente,
                  (select slug from tenant_info)           as "slugEnBase"`,
        ),
      );
      if (filas !== 1) {
        motivos.push(
          `${bd} tiene ${filas} filas en tenant_info: sin identidad, tenant_actual() devuelve ` +
            "el centinela de la plantilla y todo lo que se escriba ahí queda atado a un tenant " +
            "que no existe",
        );
        continue;
      }
      if (!coherente) motivos.push(`${bd}: tenant_actual() no concuerda con tenant_info.id`);
      if (slugEnBase !== slug) {
        motivos.push(`${bd} dice ser el tenant «${slugEnBase}» y no «${slug}»`);
      }
    } catch (e) {
      motivos.push(`${bd} no se pudo revisar: ${e.message}`);
    }
  }
  return motivos;
}

/** `rezagosDeLaPlantilla` leyendo el cluster real. */
export async function auditarPlantilla({ dir = DIR_MIGRACIONES } = {}) {
  const hayPlantilla = await con("postgres", ({ sql }) => existe(sql, BD_PLANTILLA));
  const plantilla = hayPlantilla ? await versionesDe(BD_PLANTILLA) : [];
  const tenants = [];
  for (const bd of await basesDeTenant()) tenants.push({ bd, versiones: await versionesDe(bd) });

  const motivos = rezagosDeLaPlantilla({
    enDisco: migracionesDe("tenant", dir).map((m) => m.version),
    plantilla,
    tenants,
  });
  if (!hayPlantilla && motivos.length === 0) {
    motivos.push(`${BD_PLANTILLA} no existe: no hay plantilla desde la cual provisionar`);
  }
  return { hayPlantilla, plantilla, tenants, motivos };
}

// --- CLI -------------------------------------------------------------------------------
async function principal(argv) {
  const [orden, ...resto] = argv;
  const recrear = resto.includes("--recrear");
  const modoArg = resto.find((a) => a.startsWith("--modo="))?.slice("--modo=".length);
  // La identidad de la empresa dueña, la que hace nacer la empresa implícita [AC-FPOR-17].
  const rutArg = resto.find((a) => a.startsWith("--rut="))?.slice("--rut=".length);
  const razonArg = resto.find((a) => a.startsWith("--razon-social="))?.slice("--razon-social=".length);
  const libres = resto.filter((a) => !a.startsWith("--"));

  if (orden === "plantilla") {
    const r = await refrescarPlantilla();
    console.log(
      `provisionar: ${BD_PLANTILLA} ${r.creada ? "creada" : "ya existía"} · ` +
        `${r.aplicadas.length} migración(es) aplicada(s) · ${r.yaEstaban.length} ya estaban`,
    );
    return 0;
  }

  if (orden === "tenant") {
    if (libres.length === 0) {
      console.error(
        "provisionar: falta el slug (uso: provisionar.mjs tenant <slug> [--recrear] " +
          "[--modo=mi_flota|daas] [--rut=<rut de la empresa> --razon-social=<razón social>])",
      );
      return 2;
    }
    for (const slug of libres) {
      const t = await provisionar(slug, {
        recrear,
        ...(modoArg ? { modo: modoArg } : {}),
        ...(rutArg === undefined ? {} : { rutDeLaEmpresa: rutArg }),
        ...(razonArg === undefined ? {} : { razonSocial: razonArg }),
      });
      console.log(`provisionar: ${t.bd} lista · tenant_info.id = ${t.id} · modo = ${t.modo}`);
    }
    return 0;
  }

  if (orden === "auditar") {
    const { plantilla, tenants, motivos } = await auditarPlantilla();
    console.log(
      `provisionar auditar: ${BD_PLANTILLA} en ${plantilla.at(-1) ?? "(vacía)"} · ` +
        `${tenants.length} BD de tenant · ${motivos.length} rezago(s)`,
    );
    for (const m of motivos) console.error(`GATE: ${m}`);
    if (motivos.length > 0) {
      console.error("provisionar auditar: ROJO");
      return 1;
    }
    console.log("provisionar auditar: VERDE");
    return 0;
  }

  console.error("provisionar.mjs: uso: {plantilla | tenant <slug> [--recrear] | auditar}");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
      console.error(`provisionar: ${e.message}`);
      process.exit(1);
    });
}
