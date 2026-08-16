#!/usr/bin/env node
// Paso 1 del wizard de onboarding: «empresa + vertical» [AC-FMIG-14].
//
// specs/flota/08-diseno-miga-onboarding.md §6: «1. Empresa + vertical ⇒ siembra plantilla
// completa con demo tocable. Aquí ocurre la provisión física: CREATE DATABASE … TEMPLATE
// tenant_template — segundos, dentro del wizard — y la siembra de las filas del
// vertical_template elegido (terminología, motivos, checklists, cargo_types, config_ev,
// meta_eevd — §4.4)».
//
// `provisionar()` (AC-FTEN-02, db/flota/provisionar.mjs) YA hace la mitad física: crea
// `t_<slug>` desde la plantilla y siembra la identidad del tenant. Ese mismo archivo deja
// dicho, en su propio comentario, que «el wizard de AC-FMIG-14 va a invocar provisionar() como
// su servicio de alta» — esto es esa invocación, más la mitad que faltaba: la fila de
// `vertical_template` que el paso 1 promete.
//
// CATÁLOGO DE VERTICALES EN E1: la Pregunta al dueño 10 de la spec 08 deja abierto qué
// verticales ofrece el paso 1 más allá de que el maestro (§9.1) solo nombra
// `vertical-panaderia`. Por eso `VERTICALES_DEMO` tiene HOY un solo vertical — agregar otro es
// una entrada nueva acá, cero migraciones (§2 métrica 4: activar un vertical = INSERT de filas).
//
// LO QUE ESTE ARCHIVO NO HACE (deliberado, alcance de AC-FMIG-14 solamente): no crea vehículo
// ni chofer (paso 2), no importa paradas (paso 3) ni completa ninguna (paso 4), y no siembra
// datos de INSTANCIA (empresa cliente, destino, encargo) para una «primera ruta» navegable —
// distinguir esa clase de datos demo de los reales es la Pregunta al dueño 5, todavía abierta,
// y este archivo no la resuelve inventando una marca. Sembrar la CONFIGURACIÓN del vertical
// (que es lo que §4.4 define sin ambigüedad) es lo que sí se puede construir hoy sin adivinar
// esa respuesta.
import { con } from "./conectar.mjs";
import { provisionar } from "./provisionar.mjs";

/**
 * Un vertical es una FILA de `vertical_template`, jamás una migración (§4.9, §2 métrica 4).
 * Los valores de acá son el «demo tocable» del paso 1: suficientes para que el vertical no
 * nazca vacío (el CHECK `meta_eevd > 0` ya lo impediría) y con forma real de negocio, no
 * placeholders — `meta_eevd: 18` es la misma cifra de referencia que usan los fixtures de
 * pgTAP para «panaderia» (db/flota/pgtap/0002_verticales_grupos_y_parametros.sql).
 */
export const VERTICALES_DEMO = {
  panaderia: {
    // Forma pensada para el día que AC-FMIG-15 la conecte a `OVERRIDES_VERTICAL`
    // (packages/miga/src/terminologia.ts): `Record<term_key, {singular, plural}>`.
    terminologia: {
      parada: { singular: "reparto", plural: "repartos" },
      encargo: { singular: "pedido", plural: "pedidos" },
    },
    motivos: ["cliente_ausente", "direccion_incorrecta", "rechazo_de_carga", "local_cerrado"],
    checklists: [
      {
        titulo: "Chequeo de salida",
        items: [
          { texto: "Puertas del furgón cierran y sellan", obligatorio: true },
          { texto: "Carga asegurada, sin bultos sueltos", obligatorio: true },
          { texto: "Nivel de batería registrado", obligatorio: true },
        ],
      },
    ],
    cargo_types: ["pan_bandejas", "pan_bultos"],
    config_ev: { reserva_pct: 15 },
    meta_eevd: 18,
  },
};

export function verticalesDisponibles() {
  return Object.keys(VERTICALES_DEMO);
}

/**
 * Provisiona el tenant y siembra la fila de `vertical_template` del vertical elegido.
 *
 * Si la provisión física falla, `provisionar()` ya se deshace sola (§4.1: una base a medio
 * provisionar es peor que ninguna). Si lo que falla es la siembra del vertical, el tenant NO
 * se deshace: `provisionar()` ya lo dejó coherente y usable — le falta la fila de producto,
 * no la identidad — así que el error se reporta con el tenant vivo en vez de destruir una base
 * físicamente sana por un problema de una tabla de configuración.
 */
export async function pasoUnoEmpresaYVertical(slug, { vertical = "panaderia", modo = "mi_flota", recrear = false } = {}) {
  const plantilla = VERTICALES_DEMO[vertical];
  if (!plantilla) {
    throw new Error(
      `vertical inválido: «${vertical}». El paso 1 del wizard ofrece SOLO ` +
        `${verticalesDisponibles().join(", ")} en E1 (Pregunta al dueño 10 de ` +
        "specs/flota/08-diseno-miga-onboarding.md, todavía abierta).",
    );
  }

  const tenant = await provisionar(slug, { modo, recrear });

  try {
    await con(tenant.bd, ({ sql }) =>
      sql(
        `insert into vertical_template
           (vertical, terminologia, motivos, checklists, cargo_types, config_ev, meta_eevd)
         values ($1, $2::jsonb, $3, $4::jsonb, $5, $6::jsonb, $7)`,
        [
          vertical,
          JSON.stringify(plantilla.terminologia),
          plantilla.motivos,
          JSON.stringify(plantilla.checklists),
          plantilla.cargo_types,
          JSON.stringify(plantilla.config_ev),
          plantilla.meta_eevd,
        ],
      ),
    );
  } catch (e) {
    throw new Error(
      `${tenant.bd} quedó provisionada pero el paso 1 no pudo sembrar el vertical «${vertical}»: ` +
        `${e.message}. El tenant SIGUE VIVO (§4.1 no lo exige deshecho por esto) — reintentar la ` +
        "siembra del vertical, no volver a provisionar.",
    );
  }

  return { ...tenant, vertical };
}

// --- CLI -------------------------------------------------------------------------------
async function principal(argv) {
  const [orden, ...resto] = argv;
  const recrear = resto.includes("--recrear");
  const verticalArg = resto.find((a) => a.startsWith("--vertical="))?.slice("--vertical=".length);
  const modoArg = resto.find((a) => a.startsWith("--modo="))?.slice("--modo=".length);
  const libres = resto.filter((a) => !a.startsWith("--"));

  if (orden === "paso1") {
    if (libres.length === 0) {
      console.error(
        "wizard-onboarding: falta el slug (uso: wizard-onboarding.mjs paso1 <slug> " +
          "[--vertical=panaderia] [--modo=mi_flota|daas] [--recrear])",
      );
      return 2;
    }
    const inicio = process.hrtime.bigint();
    const r = await pasoUnoEmpresaYVertical(libres[0], {
      vertical: verticalArg ?? "panaderia",
      modo: modoArg ?? "mi_flota",
      recrear,
    });
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    console.log(
      `wizard-onboarding paso1: ${r.bd} lista · vertical = ${r.vertical} · modo = ${r.modo} · ` +
        `${ms.toFixed(0)} ms`,
    );
    return 0;
  }

  console.error("wizard-onboarding.mjs: uso: {paso1 <slug> [--vertical=] [--modo=] [--recrear]}");
  return 2;
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
      console.error(`wizard-onboarding: ${e.message}`);
      process.exit(1);
    });
}
