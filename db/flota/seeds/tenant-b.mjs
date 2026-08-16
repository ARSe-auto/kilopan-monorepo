#!/usr/bin/env node
// Seed del tenant B «Rutapan» [AC-FMIG-18] — specs/flota/08-diseno-miga-onboarding.md §7,
// §10 del maestro (docs/PROMPT_MAESTRO_FLOTA.md): «modo daas, rutas maestras, terminología
// renombrada al máximo largo permitido, tema propio: 2 EV48, 4 panaderías cliente...».
//
// ALCANCE DE ESTE ARCHIVO (primera entrega de AC-FMIG-18, parcial — ver AC-ABIERTO del commit
// que lo introduce): identidad del tenant + vertical (reusa `pasoUnoEmpresaYVertical`, AC-FMIG-14)
// + tema propio (AC-FMIG-02) + terminología al máximo largo permitido (AC-FMIG-04/06) + los 2
// EV48 con su capacidad/batería reales + las 4 panaderías cliente con RUT sintético de la lista
// congelada (AC-FIDN-21) y un centinela ÚNICO por tenant en `razon_social` (§10, §7.8: cero
// datos personales reales). QUEDA FUERA de este archivo — declarado, no escondido — todo lo que
// exige un flujo de negocio completo que este AC no alcanzó a construir en la misma sesión: las
// 2 rutas de madrugada (12 y 9 paradas), los manifiestos firmados con DTE, el encargo creado en
// andén, el reintento y el cierre con ecuación cuadrada.
import { con } from "../conectar.mjs";
import { pasoUnoEmpresaYVertical } from "../wizard-onboarding.mjs";
import { CENTINELAS, poolDelTenant, sesionDe, sembrarActorAdmin } from "./comun.mjs";
import { crearVehiculo, editarVehiculo } from "../../../apps/flota/src/servidor/vehiculos.ts";
import { guardarTema } from "../../../apps/flota/src/servidor/tema.ts";
import { guardarTermino } from "../../../apps/flota/src/servidor/terminologia.ts";

/** RUTs de la lista congelada (`db/flota/ruts-sinteticos.mjs`, AC-FIDN-21) — reusados entre
 *  tenants a propósito: cada tenant vive en su PROPIA base física, así que repetir un RUT entre
 *  `t_rutapan_demo` y otro tenant no colisiona con ningún UNIQUE (que es siempre `(tenant_id, ...)`
 *  dentro de una sola base) y evita declarar identidades sintéticas nuevas para roles genéricos
 *  que ya tienen una razón de existir en la lista. */
const RUT_ACTOR_ADMIN = "11.111.111-1";
const RUT_CHOFER_1 = "12.345.678-5";
const RUT_CHOFER_2 = "7.654.321-6";
const RUTS_PANADERIAS = ["76.111.111-6", "77.222.222-K", "76.543.219-7", "78.333.333-3"];

/** Centinela ÚNICO por tenant (§10, §9.3.2): cadena que NO aparece en ningún otro tenant, así
 *  que si un e2e cross-tenant la ve en la respuesta de otro, el rebote lo delata. Vive en el
 *  registro de `seeds/comun.mjs`, que además VERIFICA que los tres centinelas sean disjuntos —
 *  si el de un tenant fuera subcadena del de otro, el barrido de huella daría cruce siempre. */
export const CENTINELA_B = CENTINELAS.b;

export const EV48 = { capacidad_bultos: 90, bateria_wh: 41860 };

/** Los 7 `term_key` de `TERMINOLOGIA_BASE_ES_CL` (packages/miga/src/terminologia.ts), llevados
 *  al LARGO MÁXIMO que el CHECK `tenant_terminology_largo_por_tipo` acepta por tipo
 *  (navegación ≤12, título ≤24 — `db/migraciones-flota/tenant/0010_tema_y_terminologia.sql`),
 *  con un fragmento del centinela de este tenant metido adentro para que un e2e cross-tenant
 *  que lea el término resuelto de B lo pueda detectar en la respuesta de otro tenant. Cero
 *  caracteres de la lista prohibida `# $ % ; < = >` (todos los valores de abajo son solo
 *  letras, espacios y guiones).
 */
const TERMINOS_EXTREMOS_B = [
  // navegación, ≤12
  { termKey: "ruta", tipo: "navegacion", singular: "Recorrido-B7", plural: "Recorridos-B" },
  { termKey: "parada", tipo: "navegacion", singular: "Reparto-B7f2", plural: "Repartos-B7f" },
  { termKey: "chofer", tipo: "navegacion", singular: "Panadero-B7f", plural: "Panaderos-B7" },
  { termKey: "vehiculo", tipo: "navegacion", singular: "Furgon-B7f2x", plural: "Furgones-B7f" },
  // título, ≤24
  { termKey: "encargo", tipo: "titulo", singular: "Pedido de panadería B7f2", plural: "Pedidos de panadería B7f" },
  { termKey: "entrega", tipo: "titulo", singular: "Reparto de horneado B7f2", plural: "Repartos de horneado B7" },
  { termKey: "excepcion", tipo: "titulo", singular: "Incidencia reparto B7f2", plural: "Incidencias reparto B7f2" },
];

/**
 * Siembra el tenant B «Rutapan» [AC-FMIG-18]: identidad + vertical + tema propio +
 * terminología extrema + los 2 EV48 + las 4 panaderías cliente con centinela.
 *
 * NO siembra rutas, manifiestos, DTEs, reintento ni cierre cuadrado — ver el comentario de
 * cabecera de este archivo. Idempotente en el sentido de `provisionar()`: `recrear:true` la
 * vuelve a crear desde cero.
 */
export async function sembrarTenantB(slug = "rutapan_demo", { recrear = false } = {}) {
  const tenant = await pasoUnoEmpresaYVertical(slug, { vertical: "panaderia", modo: "daas", recrear });
  const actorAdmin = await sembrarActorAdmin(tenant.bd, RUT_ACTOR_ADMIN, CENTINELA_B);
  const sesionAdmin = sesionDe(actorAdmin, "admin_tenant");
  const pool = poolDelTenant(tenant);

  try {
    const tema = await guardarTema(pool, "#1B5E20", null);
    if (tema.tipo !== "ok") {
      throw new Error(`seed tenant B: el tema propio rebotó (${tema.tipo}) — probar otro accent_color.`);
    }

    const terminos = [];
    for (const t of TERMINOS_EXTREMOS_B) {
      const r = await guardarTermino(pool, t.termKey, t.singular, t.plural);
      if (r.tipo !== "ok") {
        throw new Error(
          `seed tenant B: el término «${t.termKey}» (${t.singular}, ${t.singular.length} chars, ` +
            `tipo ${t.tipo}) rebotó: ${r.tipo}.`,
        );
      }
      terminos.push(r.termino);
    }

    const patentesEv48 = ["RUTB0001", "RUTB0002"];
    const vehiculos = [];
    for (const patente of patentesEv48) {
      const alta = await crearVehiculo(pool, sesionAdmin, { patente, tipo: "furgón" });
      if (alta.tipo !== "ok") throw new Error(`seed tenant B: alta de ${patente} rebotó (${alta.tipo}).`);
      const edicion = await editarVehiculo(pool, sesionAdmin, alta.vehiculo.id, {
        capacidad_bultos: EV48.capacidad_bultos,
        bateria_wh: EV48.bateria_wh,
      });
      if (edicion.tipo !== "ok") {
        throw new Error(`seed tenant B: cargar specs EV48 de ${patente} rebotó (${edicion.tipo}).`);
      }
      vehiculos.push(edicion.vehiculo);
    }

    const empresas = [];
    for (const [i, rut] of RUTS_PANADERIAS.entries()) {
      const [fila] = await con(tenant.bd, ({ sql }) =>
        sql(
          `insert into empresas_cliente (rut, razon_social)
           values ($1, $2)
           returning id::text as id, rut, razon_social`,
          [rut, `Panadería ${CENTINELA_B}-${String(i + 1).padStart(2, "0")}`],
        ),
      );
      empresas.push(fila);
    }

    return { ...tenant, actorAdmin, tema: tema.tema, terminos, vehiculos, empresas, centinela: CENTINELA_B };
  } finally {
    await pool.end();
  }
}

// --- CLI ---------------------------------------------------------------------------------
async function principal(argv) {
  const [orden, ...resto] = argv;
  const recrear = resto.includes("--recrear");
  const libres = resto.filter((a) => !a.startsWith("--"));
  if (orden !== "sembrar") {
    console.error("tenant-b.mjs: uso: sembrar [slug=rutapan_demo] [--recrear]");
    return 2;
  }
  const r = await sembrarTenantB(libres[0] ?? "rutapan_demo", { recrear });
  console.log(
    `tenant-b: ${r.bd} lista · ${r.vehiculos.length} EV48 · ${r.empresas.length} panaderías · ` +
      `tema ${r.tema.accentColor} · centinela ${r.centinela}`,
  );
  return 0;
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
      console.error(`tenant-b: ${e.message}`);
      process.exit(1);
    });
}
