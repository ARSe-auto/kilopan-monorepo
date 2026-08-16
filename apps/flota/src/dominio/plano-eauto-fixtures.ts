import type { EntradaPlanoEauto } from "./plano-eauto.ts";

// Fixtures del Plano B — vista cross-tenant de e-auto (spec 05, §3) [AC-FSEM-10].
//
// Igual que `semaforo-fixtures.ts` para el Plano A (AC-FSEM-01): la EVALUACIÓN real de
// `signal_rule` contra `control` y el job exportador de verdad son de otros ACs (AC-FSEM-11 las
// señales cross-tenant, AC-FTEN-20 el job). Lo que este archivo fija es el payload YA EMPUJADO
// que el exportador entregaría para cada tenant de referencia, así el render de este plano se
// puede construir y probar hoy sin bloquear en el montaje/autenticación de la pregunta 2.

const VENTANA_INICIO = new Date("2026-08-12T13:55:00-04:00");
const VENTANA_FIN = new Date("2026-08-12T14:00:00-04:00");

/** Tenant `daas` (seed A del Plano A, farmacia con `otd_comprometido_pct=95`): sano. */
const DAAS: EntradaPlanoEauto = {
  tenantSlug: "daas",
  color: "verde",
  crudo: {
    tenant_id: "11111111-1111-1111-1111-111111111111",
    ventana_inicio: VENTANA_INICIO,
    ventana_fin: VENTANA_FIN,
    eventos_ultima_hora: 148,
    errores_sync_pct: 0.4,
    dispositivos_activos: 9,
    usuarios_activos: 11,
    pwa_version_min: "2026.8.3",
    eevd_semanal: 0.82,
    backlog_sync_max_min: 6,
  },
  // Ambos pendientes de wiring real (comentario en `plano-eauto.ts`): NULL declarado.
  pendientes: { actividadVsMediaMovil7dPct: null, latenciaP95Ms: null },
};

/** Tenant `mi_flota` (seed C del Plano A): actividad cayendo vs su media móvil — amarillo. */
const MI_FLOTA: EntradaPlanoEauto = {
  tenantSlug: "mi_flota",
  color: "amarillo",
  crudo: {
    tenant_id: "22222222-2222-2222-2222-222222222222",
    ventana_inicio: VENTANA_INICIO,
    ventana_fin: VENTANA_FIN,
    eventos_ultima_hora: 22,
    errores_sync_pct: 2.1,
    dispositivos_activos: 4,
    usuarios_activos: 5,
    pwa_version_min: "2026.7.1",
    // Tenant `mi_flota` sin empresa cliente: la EEVD nace de todos modos (§2 del maestro no la
    // condiciona a `daas`), pero el hito c del exportador es lo que la puebla — hasta entonces,
    // NULL declarado y no cero inventado (mismo criterio que AC-FTEN-04).
    eevd_semanal: null,
    backlog_sync_max_min: 45,
  },
  pendientes: { actividadVsMediaMovil7dPct: null, latenciaP95Ms: null },
};

/** Tenant `t_ruteo_activo`: sin eventos un día hábil — rojo máximo del Plano B (§3). */
const RUTEO_ACTIVO: EntradaPlanoEauto = {
  tenantSlug: "ruteo_activo",
  color: "rojo",
  crudo: {
    tenant_id: "33333333-3333-3333-3333-333333333333",
    ventana_inicio: VENTANA_INICIO,
    ventana_fin: VENTANA_FIN,
    eventos_ultima_hora: 0,
    errores_sync_pct: 6.2,
    dispositivos_activos: 0,
    usuarios_activos: 0,
    pwa_version_min: "2026.6.0",
    eevd_semanal: 0.1,
    backlog_sync_max_min: 260,
  },
  pendientes: { actividadVsMediaMovil7dPct: null, latenciaP95Ms: null },
};

/** Los tres tenants de referencia del Plano B, verde/amarillo/rojo, con y sin EEVD poblada. */
export function seedPlanoEauto(): EntradaPlanoEauto[] {
  return [DAAS, MI_FLOTA, RUTEO_ACTIVO];
}
