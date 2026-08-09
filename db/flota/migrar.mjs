#!/usr/bin/env node
// Runner de migraciones ×N [AC-FTEN-07].
//
// Con una BD por tenant (§4.1) no existe «correr la migración»: existe correrla N veces, y
// que el deploy sea verde SOLO si las N quedaron al día (§9.3 centinela 13). Este script es
// esa iteración, y su orden no es cosmético:
//
//   1. `t_canary` — tenant sintético, sin datos de nadie. Es el primero a propósito: una
//      migración que va a fallar falla acá, contra una base que no le importa a ningún
//      cliente, y no a mitad de camino sobre datos reales.
//   2. `tenant_template` — la 4ª vida del cambio de esquema. Si la plantilla quedara atrás,
//      cada tenant nuevo nacería desactualizado (ese rezago lo audita AC-FTEN-02).
//   3. cada `t_<slug>` viva en el cluster.
//
// Y corre como `migrator`, no como superusuario ni como la app: el rol de aplicación NO tiene
// ownership, así que un bug del producto no puede cambiar el esquema (§4.1).
//
// `verificar` es el modo que consume el deploy: no aplica NADA, solo responde si alguna base
// quedó rezagada. `scripts/deploy.sh` lo llama ANTES de sustituir la versión servida (§9.1).
import { pathToFileURL } from "node:url";
import { con, BD_PLANTILLA, ROL_MIGRADOR, TENANT_CANARIO, bdDeTenant } from "./conectar.mjs";
import { aplicar, DIR_MIGRACIONES, versionEsperada } from "./aplicar.mjs";
import {
  asegurarRolMigrador,
  basesDeTenant,
  crearPlantillaSiFalta,
  refrescarPlantilla,
  duenoDe,
  provisionar,
  versionesDe,
} from "./provisionar.mjs";

/**
 * El orden en que el runner recorre las bases. PURA para poder probar el orden sin cluster:
 * que el canario vaya primero es una regla, no un efecto secundario del `order by` de una
 * consulta, y una regla se prueba.
 */
export function ordenDeMigracion(basesDeTenantVivas) {
  const canario = bdDeTenant(TENANT_CANARIO);
  const resto = basesDeTenantVivas.filter((b) => b !== canario).sort();
  return [canario, BD_PLANTILLA, ...resto];
}

/**
 * Las bases que no llegaron a `esperada`. PURA: es el centinela 13 y tiene que poder
 * ejercerse con una sola base rezagada entre muchas al día, que es el caso que de verdad
 * se escapa.
 */
export function basesRezagadas({ esperada, bases = [] }) {
  if (esperada === null) return [];
  return bases
    .filter((b) => b.version !== esperada)
    .map(
      (b) =>
        `${b.bd} está en ${b.version ?? "(sin migrar)"} y la última migración es ${esperada}: ` +
        "el deploy NO es verde con una BD rezagada",
    );
}

/** Migra una base como `migrator` y devuelve con qué usuario lo hizo (el aserto del AC). */
async function migrarUna(bd, { dir, usuario }) {
  const dueno = await duenoDe(bd);
  if (dueno !== ROL_MIGRADOR) {
    throw new Error(
      `la base ${bd} pertenece a «${dueno}» y no a ${ROL_MIGRADOR}: el migrador no puede ` +
        "cambiarle el esquema. Recreala con `provisionar.mjs` (las bases nacen con dueño).",
    );
  }
  return con(
    bd,
    async (conexion) => {
      const [{ quien }] = await conexion.sql("select current_user as quien");
      const r = await aplicar(conexion, "tenant", { dir });
      return { bd, usuario: quien, ...r };
    },
    { usuario },
  );
}

/**
 * El runner. Deja existiendo lo que tiene que existir (rol, plantilla, canario) y aplica en
 * orden. Devuelve `{ orden, resultados }`.
 */
export async function migrar({ dir = DIR_MIGRACIONES, usuario = ROL_MIGRADOR } = {}) {
  await asegurarRolMigrador();
  await crearPlantillaSiFalta();

  // ARRANQUE EN FRÍO. El canario nace de la plantilla igual que cualquier tenant —si fuera
  // una base especial probaría algo distinto de lo que le va a pasar a los tenants de
  // verdad—, y para nacer necesita que la plantilla ya tenga al menos su identidad. Así que
  // la primera vez, y solo la primera, la plantilla se adelanta al canario. No se pierde
  // nada: en un cluster vacío no hay estado previo que una migración pueda romper. De la
  // segunda corrida en adelante el canario existe y va primero, que es cuando importa.
  const canario = bdDeTenant(TENANT_CANARIO);
  if (!(await basesDeTenant()).includes(canario)) {
    await refrescarPlantilla({ dir, usuario });
    await provisionar(TENANT_CANARIO);
  }

  const orden = ordenDeMigracion(await basesDeTenant());
  const resultados = [];
  for (const bd of orden) resultados.push(await migrarUna(bd, { dir, usuario }));
  return { orden, resultados };
}

/** El modo que consume el deploy: mira y no toca. */
export async function verificar({ dir = DIR_MIGRACIONES } = {}) {
  const esperada = versionEsperada("tenant", dir);
  // Se verifica el MISMO recorrido que se aplica, canario y plantilla incluidos: una base que
  // falta cuenta como «sin migrar», no como una base menos que revisar.
  const bases = [];
  for (const bd of ordenDeMigracion(await basesDeTenant())) {
    if ((await duenoDe(bd)) === null) {
      bases.push({ bd, version: null });
      continue;
    }
    bases.push({ bd, version: (await versionesDe(bd)).at(-1) ?? null });
  }
  return { esperada, bases, motivos: basesRezagadas({ esperada, bases }) };
}

// --- CLI -------------------------------------------------------------------------------
function dirDe(argv) {
  const arg = argv.find((a) => a.startsWith("--dir="));
  return arg ? arg.slice("--dir=".length) : DIR_MIGRACIONES;
}

async function principal(argv) {
  const dir = dirDe(argv);
  const orden = argv.find((a) => !a.startsWith("--")) ?? "aplicar";

  if (orden === "aplicar") {
    const { resultados } = await migrar({ dir });
    for (const r of resultados) {
      console.log(
        `migrar: ${r.bd} · ${r.aplicadas.length} aplicada(s) · ${r.yaEstaban.length} ya estaban ` +
          `· como ${r.usuario}`,
      );
    }
    console.log(`migrar: ${resultados.length} base(s) recorridas, canario primero`);
  }

  if (orden === "aplicar" || orden === "verificar") {
    const { esperada, bases, motivos } = await verificar({ dir });
    console.log(
      `migrar verificar: última migración ${esperada ?? "(ninguna)"} · ${bases.length} base(s)`,
    );
    for (const m of motivos) console.error(`GATE: ${m}`);
    if (motivos.length > 0) {
      console.error("migrar verificar: ROJO — el deploy no se declara verde");
      return 1;
    }
    console.log("migrar verificar: VERDE");
    return 0;
  }

  console.error("migrar.mjs: uso: {aplicar | verificar} [--dir=<ruta>]");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
      console.error(`migrar: ${e.message}`);
      process.exit(1);
    });
}
