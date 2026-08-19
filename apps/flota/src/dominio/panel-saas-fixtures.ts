import type { EevdTendenciaTenantCrudo, EventoSupersedePod, TenantActivacion, TenantSalud } from "./panel-saas.ts";
import type { CierreDeJornada } from "./telemetria-semaforo.ts";

// Fixtures del Panel interno SaaS de e-auto (spec 05 §3, maestro §10) [AC-FSEM-22].
//
// Mismo criterio que `plano-eauto-fixtures.ts` (AC-FSEM-10): el payload YA EMPUJADO que el
// exportador entregaría, para los mismos tres tenants de referencia (`daas` sano, `mi_flota`
// sin EEVD poblada todavía, `ruteo_activo` degradado). El wiring real contra `control` es
// AC-FSEM-24 (pregunta 2); acá el panel se construye y prueba sin bloquear en eso.

/** EEVD por tenant con tendencia de 4 semanas — `daas` sube sostenido, `mi_flota` recién nace
 *  (3 semanas en NULL declarado, no un cero inventado), `ruteo_activo` cae. */
export function seedEevdTendenciaCruda(): { tenantSlug: string; crudo: EevdTendenciaTenantCrudo }[] {
  return [
    {
      tenantSlug: "daas",
      crudo: {
        tenant_id: "11111111-1111-1111-1111-111111111111",
        eevd_semana_1: 0.71,
        eevd_semana_2: 0.76,
        eevd_semana_3: 0.79,
        eevd_semana_4: 0.82,
      },
    },
    {
      tenantSlug: "mi_flota",
      crudo: {
        tenant_id: "22222222-2222-2222-2222-222222222222",
        eevd_semana_1: null,
        eevd_semana_2: null,
        eevd_semana_3: null,
        eevd_semana_4: null,
      },
    },
    {
      tenantSlug: "ruteo_activo",
      crudo: {
        tenant_id: "33333333-3333-3333-3333-333333333333",
        eevd_semana_1: 0.45,
        eevd_semana_2: 0.31,
        eevd_semana_3: 0.18,
        eevd_semana_4: 0.1,
      },
    },
  ];
}

/** Embudo de activación: `daas` activó en 6 h (dentro de la meta p50<4h... no siempre, sirve
 *  para ejercitar el cálculo real); `ruteo_activo` activó tarde (28 h, sobre la meta p90<24h);
 *  `mi_flota` es de alta reciente y AÚN no tiene primera entrega — NULL declarado, fuera del
 *  percentil pero contado como pendiente. */
export function seedActivacionTenants(): TenantActivacion[] {
  return [
    {
      tenantSlug: "daas",
      altaEn: new Date("2026-07-20T09:00:00-04:00"),
      primeraEntregaEn: new Date("2026-07-20T15:00:00-04:00"),
    },
    {
      tenantSlug: "ruteo_activo",
      altaEn: new Date("2026-07-22T09:00:00-04:00"),
      primeraEntregaEn: new Date("2026-07-23T13:00:00-04:00"),
    },
    {
      tenantSlug: "mi_flota",
      altaEn: new Date("2026-08-11T09:00:00-04:00"),
      primeraEntregaEn: null,
    },
  ];
}

/** Salud de plataforma: `ruteo_activo` está inactivo (rojo máximo, sin eventos un día hábil,
 *  §3) y no aporta vehículos con turno hoy. */
export function seedSaludTenants(): TenantSalud[] {
  return [
    { tenantSlug: "daas", activo: true, vehiculosActivos: 3, vehiculosConTurno: 3 },
    { tenantSlug: "mi_flota", activo: true, vehiculosActivos: 1, vehiculosConTurno: 1 },
    { tenantSlug: "ruteo_activo", activo: false, vehiculosActivos: 2, vehiculosConTurno: 0 },
  ];
}

/** Calidad de la norte: 40 paradas de entrega con 3 sin evidencia; de 10 PODs supersedidos, 1
 *  es un undo post-replay (§4.7) — ESE no cuenta, mismo fixture textual que pide la spec 05 §3
 *  («un supersede con motivo=`undo` NO cuenta»). */
export function seedCalidadNorte(): {
  paradas: { totalEntrega: number; sinEvidencia: number };
  pods: { total: number; supersedidos: EventoSupersedePod[] };
} {
  return {
    paradas: { totalEntrega: 40, sinEvidencia: 3 },
    pods: {
      total: 10,
      supersedidos: [
        { motivo: "correccion_terreno" },
        { motivo: "correccion_terreno" },
        { motivo: "foto_rechazada" },
        { motivo: "undo" },
      ],
    },
  };
}

/** Contador de exenciones de la suite, tendencia semanal (creciente = bandera roja, §10
 *  maestro). Fuente real: artefacto del gate CI (AC-FTEN-26) — hoy emite 0 (`ultimo-check.log`:
 *  «0 exenciones»); el fixture ejercita también el caso creciente para que la bandera se pruebe. */
export function seedTendenciaExenciones(): number[] {
  return [0, 0, 1, 1];
}

/** Cola al cierre del día para la sección `panel-saas-cola-cierre` de la vista [AC-FSEM-14] —
 *  spec 05 §5 («Telemetría del propio módulo»), maestro §10. Mismo criterio que el resto de este
 *  archivo: el payload que el exportador entregaría, no una consulta.
 *
 *  Es UNA serie de plataforma y no una por tenant: la sección del panel muestra la conducta que
 *  el §10 manda observar en el piloto —¿la cola de `review_queue` cierra el día tendiendo a
 *  cero?—, y esa pregunta se responde sobre el piloto entero. El desglose por tenant vive en las
 *  filas de EEVD, que sí son por tenant.
 *
 *  La forma es la del piloto de verdad y no una recta bonita: arranca ALTA porque el semáforo
 *  recién encendido saca a la luz excepciones que nadie estaba revisando, rebota un día
 *  (12 pendientes tras 11) y recién después converge. Los fines de semana NO aparecen: la
 *  ventana es la lista de jornadas CERRADAS, no un calendario — y `colaAlCierreDelDia` ordena
 *  por fecha ISO, así que el hueco no la descoloca. */
export function seedCierresDeJornada(): CierreDeJornada[] {
  return [
    { fecha: "2026-08-03", pendientes: 14 },
    { fecha: "2026-08-04", pendientes: 11 },
    { fecha: "2026-08-05", pendientes: 12 },
    { fecha: "2026-08-06", pendientes: 7 },
    { fecha: "2026-08-07", pendientes: 4 },
    { fecha: "2026-08-10", pendientes: 2 },
    { fecha: "2026-08-11", pendientes: 0 },
  ];
}
