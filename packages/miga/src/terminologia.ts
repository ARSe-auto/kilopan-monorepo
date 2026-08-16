// Capa de copy con resolución `term_key`: tenant → vertical → base es-CL [AC-FMIG-04] — §5.1.
//
// «El tenant personaliza terminología» (§5.1) es UNA cadena de resolución, no dos lugares
// distintos que un componente decide a mano: `tenant_terminology` (0010_tema_y_terminologia.sql,
// AC-FTEN-10) es el nivel TENANT — la BD es la autoridad de esas filas, este archivo nunca las
// inventa — y gana si existe. Si no hay fila de tenant, el nivel VERTICAL decide; si tampoco hay
// override de vertical, gana la BASE es-CL de acá abajo, que es la única que nunca falta.
//
// POR QUÉ EL NIVEL VERTICAL VIVE EN CÓDIGO Y NO EN UNA TABLA: `vertical_template` (§4.4, §4.9)
// todavía no tiene migración — activarlo es AC-FMIG-15, no construido — así que hoy no hay fila
// de la que leer ese nivel. Es la MISMA decisión que ya tomó AC-FSEM-12 con la terminología
// «extrema» del tenant B mientras esperaba este AC (`apps/flota/src/dominio/hoy-terminologia.ts`):
// dejar el nivel vacío en código en vez de inventar una tabla que el maestro no exige todavía.
// El día que `vertical_template` exista, `OVERRIDES_VERTICAL` deja de ser un objeto estático y
// pasa a leerse de esa tabla — sin que la firma de `resolverTermino` cambie.
//
// EL CANÓNICO QUE VE EL ADMIN (§5.1) ES SIEMPRE LA BASE, JAMÁS EL EFECTIVO: si el admin viera
// entre paréntesis lo que su propio tenant ya escribió, el paréntesis no diría nada — la
// propiedad que el AC pide es poder volver al término de fábrica aunque el tenant ya lo haya
// renombrado tres veces.

export type TerminoTipo = "navegacion" | "titulo" | "descripcion";

export type DiccionarioTermino = { tipo: TerminoTipo; singular: string; plural: string };

/** Overrides de UN nivel de la cadena: solo singular/plural — el `tipo` lo fija la base y
 *  `tenant_terminology` lo repite por fila (mismo CHECK, dos lugares que nunca se leen cruzados
 *  acá: este archivo no valida largos, eso es de la BD, AC-FTEN-10). */
export type OverrideTermino = { singular: string; plural: string };

/**
 * La base es-CL — el nivel que nunca falta. Cada `term_key` es RENOMBRABLE (§5.1): un
 * selector de e2e que lea su texto en vez de su `data-testid`/`term_key` se rompe el día que
 * un tenant lo cambia, y ese es exactamente el caso que `db/flota/gate-getbytext-renombrable.mjs`
 * vigila contra este mismo diccionario.
 */
export const TERMINOLOGIA_BASE_ES_CL: Readonly<Record<string, DiccionarioTermino>> = {
  ruta: { tipo: "navegacion", singular: "ruta", plural: "rutas" },
  parada: { tipo: "navegacion", singular: "parada", plural: "paradas" },
  encargo: { tipo: "titulo", singular: "encargo", plural: "encargos" },
  entrega: { tipo: "titulo", singular: "entrega", plural: "entregas" },
  chofer: { tipo: "navegacion", singular: "chofer", plural: "choferes" },
  vehiculo: { tipo: "navegacion", singular: "vehículo", plural: "vehículos" },
  excepcion: { tipo: "titulo", singular: "excepción", plural: "excepciones" },
} as const;

/** Nivel VERTICAL — vacío hasta que `vertical_template` exista (ver comentario de cabecera). */
export const OVERRIDES_VERTICAL: Readonly<Record<string, Readonly<Record<string, OverrideTermino>>>> = {};

export type TerminoResuelto = {
  termKey: string;
  tipo: TerminoTipo;
  singular: string;
  plural: string;
  /** El término de fábrica, SIEMPRE de la base — nunca del nivel que ganó (§5.1: «el admin ve
   *  el término canónico entre paréntesis»). */
  canonico: string;
};

export type ResolverTerminoParams = {
  termKey: string;
  /** Filas de `tenant_terminology` del tenant actual, ya leídas por el servidor — este archivo
   *  no toca la BD (packages/miga no tiene acceso a `pg`, §4.1). */
  overridesTenant?: Readonly<Record<string, OverrideTermino>>;
  /** Vertical del tenant (`vertical_template.slug` cuando exista) — opcional: sin vertical, la
   *  cadena salta directo de tenant a base. */
  vertical?: string;
};

/**
 * Resuelve UN `term_key` por la cadena tenant → vertical → base es-CL. Lanza si el `term_key`
 * no existe en la base — un `term_key` inventado no es un override legítimo de nada, es un
 * error de quien llama (§5.1: la base es el catálogo cerrado de renombrables).
 */
export function resolverTermino({ termKey, overridesTenant, vertical }: ResolverTerminoParams): TerminoResuelto {
  const base = TERMINOLOGIA_BASE_ES_CL[termKey];
  if (!base) {
    throw new Error(`term_key desconocido: «${termKey}» — no está en TERMINOLOGIA_BASE_ES_CL`);
  }
  const porVertical = vertical ? OVERRIDES_VERTICAL[vertical]?.[termKey] : undefined;
  const porTenant = overridesTenant?.[termKey];
  const efectivo = porTenant ?? porVertical ?? base;
  return { termKey, tipo: base.tipo, singular: efectivo.singular, plural: efectivo.plural, canonico: base.singular };
}

/** Resuelve TODOS los `term_key` del catálogo — lo que sirve `/api/terminologia` (§5.1). */
export function resolverTerminologiaCompleta(
  params: Omit<ResolverTerminoParams, "termKey">,
): Record<string, TerminoResuelto> {
  const resultado: Record<string, TerminoResuelto> = {};
  for (const termKey of Object.keys(TERMINOLOGIA_BASE_ES_CL)) {
    resultado[termKey] = resolverTermino({ ...params, termKey });
  }
  return resultado;
}
