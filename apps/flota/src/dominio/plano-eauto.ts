import type { ColorSemaforo } from "./semaforo.ts";

// Plano B — vista cross-tenant de e-auto (spec 05, §3) [AC-FSEM-10].
//
// Este módulo NO abre ninguna conexión de base de datos: es la forma de dato que este plano
// consume, verificada acá a nivel de COMPONENTE/VISTA contra fixtures (`plano-eauto-fixtures.ts`).
// El montaje autenticado contra la BD `control` real queda para AC-FSEM-24 (pregunta 2, spec 05).
//
// CENTINELA 14 A NIVEL DE VISTA. La BD `control` ya prueba, contra el cluster real, que el
// payload del exportador es un schema FIJO sin dinero/tarifas/clientes
// (`db/flota/suite-bd/control.test.mjs`, AC-FTEN-04). Este archivo copia esa MISMA lista de
// columnas y ese MISMO vocabulario prohibido para que la vista rebote igual —en rojo, en CI, sin
// tocar el cluster— si algún día alguien arma un payload con una columna que la BD jamás
// entregaría. Las dos defensas viven en paralelo a propósito: la de BD es la autoridad sobre lo
// que EXISTE; esta es la autoridad sobre lo que el PLANO RENDERIZA.

/** Espeja el subconjunto de `COLUMNAS_DEL_AGREGADO` (db/flota/suite-bd/control.test.mjs,
 *  AC-FTEN-04) que este plano consume. Sumar un campo acá que esa lista no tenga es inventar
 *  una columna que la BD `control` no tiene — la BD manda (AGENTS.md). */
export const CAMPOS_AGREGADO_CONTROL_CRUDO = [
  "tenant_id",
  "ventana_inicio",
  "ventana_fin",
  "eventos_ultima_hora",
  "errores_sync_pct",
  "dispositivos_activos",
  "usuarios_activos",
  "pwa_version_min",
  "eevd_semanal",
  "backlog_sync_max_min",
] as const;

/** El mismo vocabulario prohibido que el centinela 14 de BD. */
const PALABRAS_PROHIBIDAS = /clp|monto|tarifa|precio|costo|factura|liquidacion|cliente|rut/i;

export type AgregadoControlCrudo = {
  tenant_id: string;
  ventana_inicio: Date;
  ventana_fin: Date;
  eventos_ultima_hora: number | null;
  errores_sync_pct: number | null;
  dispositivos_activos: number | null;
  usuarios_activos: number | null;
  pwa_version_min: string | null;
  eevd_semanal: number | null;
  backlog_sync_max_min: number | null;
};

/** CENTINELA 14, la mitad de vista: rebota si el payload trae una clave con olor a dato
 *  comercial, o una clave fuera del schema fijo. Ejercido en `plano-eauto.test.ts` inyectando
 *  de verdad una columna de dinero, igual que `control.test.mjs` lo ejerce contra el cluster. */
export function validarSchemaAgregadoControl(payload: Record<string, unknown>): void {
  for (const clave of Object.keys(payload)) {
    if (PALABRAS_PROHIBIDAS.test(clave)) {
      throw new Error(
        `«${clave}» huele a dato comercial del tenant: el plano cross-tenant de e-auto NUNCA ` +
          "lleva dinero, tarifas ni clientes (centinela 14, §4.1)",
      );
    }
    if (!CAMPOS_AGREGADO_CONTROL_CRUDO.includes(clave as (typeof CAMPOS_AGREGADO_CONTROL_CRUDO)[number])) {
      throw new Error(
        `«${clave}» no está en el schema fijo del exportador (AC-FTEN-04): el plano cross-tenant ` +
          "no inventa columnas",
      );
    }
  }
}

/** Fila por tenant que la vista renderiza (spec 05, §3): estado semafórico + los 6 agregados. */
export type FilaTenantControl = {
  tenantSlug: string;
  /** Evaluación real de `signal_rule` en `control`: AC-FSEM-11. Acá llega ya evaluado. */
  color: ColorSemaforo;
  eventosUltimaHora: number | null;
  /** Pendiente: el exportador (AC-FTEN-20) no calcula la media móvil de 7 días todavía —
   *  ninguna migración la agrega hoy, así que esta vista la deja en NULL declarado, jamás en
   *  un cero inventado, y la degrada sin hueco (mismo criterio que `eevd_semanal` antes del
   *  hito c: AC-FTEN-04). */
  actividadVsMediaMovil7dPct: number | null;
  erroresSyncPct: number | null;
  backlogSyncMaxMin: number | null;
  pwaVersionMin: string | null;
  /** Pendiente: `agregados_tecnicos` no tiene columna de latencia p95 hoy (§3 la pide, pero
   *  la BD no la entrega todavía) — mismo tratamiento de NULL declarado que arriba. */
  latenciaP95Ms: number | null;
  eevdAgregada: number | null;
};

export function filaTenantDesdeAgregado(
  tenantSlug: string,
  color: ColorSemaforo,
  crudo: AgregadoControlCrudo,
  pendientes: { actividadVsMediaMovil7dPct?: number | null; latenciaP95Ms?: number | null } = {},
): FilaTenantControl {
  validarSchemaAgregadoControl(crudo);
  return {
    tenantSlug,
    color,
    eventosUltimaHora: crudo.eventos_ultima_hora,
    actividadVsMediaMovil7dPct: pendientes.actividadVsMediaMovil7dPct ?? null,
    erroresSyncPct: crudo.errores_sync_pct,
    backlogSyncMaxMin: crudo.backlog_sync_max_min,
    pwaVersionMin: crudo.pwa_version_min,
    latenciaP95Ms: pendientes.latenciaP95Ms ?? null,
    eevdAgregada: crudo.eevd_semanal,
  };
}

export type EntradaPlanoEauto = {
  tenantSlug: string;
  color: ColorSemaforo;
  crudo: AgregadoControlCrudo;
  pendientes?: { actividadVsMediaMovil7dPct?: number | null; latenciaP95Ms?: number | null };
};

/** Arma las filas que el tablero cross-tenant de e-auto renderiza, una por tenant. */
export function filasPlanoEauto(entradas: EntradaPlanoEauto[]): FilaTenantControl[] {
  return entradas.map((e) => filaTenantDesdeAgregado(e.tenantSlug, e.color, e.crudo, e.pendientes));
}
