// Panel interno SaaS de e-auto (spec 05 §3, maestro §10) [AC-FSEM-22].
//
// Extiende el Plano B (AC-FSEM-10, `dominio/plano-eauto.ts`) con los agregados de adopción y
// calidad de la norte que el §10 del maestro exige, además de los 6 agregados técnicos base y
// la alarma churn (AC-FSEM-11, `dominio/semaforo-cross-tenant.ts`). Mismo criterio que
// AC-FSEM-10: función pura, cero fetch, ejercitada a nivel de COMPONENTE/VISTA contra fixtures
// del payload que el exportador empujaría — el montaje autenticado contra `control` real es
// AC-FSEM-24 (pregunta 2, spec 05). El contador de exenciones es la única pieza cuya fuente NO
// es `control`: nace del gate CI (AC-FTEN-26, artefacto ya emitido por el pipeline) y su
// mecanismo de INGESTA real al panel queda condicionado a la pregunta 10 (spec 05 §3) — acá se
// renderiza con tendencia igual, sobre el valor que el pipeline ya produce hoy.

/** Mismo vocabulario prohibido que el centinela 14 (`plano-eauto.ts`, AC-FTEN-04): ningún
 *  agregado nuevo de este panel puede colar dinero/tarifas/clientes. */
const PALABRAS_PROHIBIDAS = /clp|monto|tarifa|precio|costo|factura|liquidacion|cliente|rut/i;

/** Schema fijo del payload de EEVD-por-tenant con tendencia de 4 semanas que el exportador
 *  empujaría (extensión declarada del centinela 14 de AC-FTEN-04 sobre `agregados_tecnicos`,
 *  dependencia de este AC — spec 05, sección Dependencias). */
export const CAMPOS_EEVD_TENDENCIA_TENANT = [
  "tenant_id",
  "eevd_semana_1",
  "eevd_semana_2",
  "eevd_semana_3",
  "eevd_semana_4",
] as const;

export type EevdTendenciaTenantCrudo = {
  tenant_id: string;
  eevd_semana_1: number | null;
  eevd_semana_2: number | null;
  eevd_semana_3: number | null;
  eevd_semana_4: number | null;
};

/** CENTINELA 14 a nivel de vista para este agregado nuevo, mismo criterio que
 *  `validarSchemaAgregadoControl` de `plano-eauto.ts`: rebota si el payload trae una clave con
 *  olor a dato comercial, o una clave fuera del schema fijo declarado arriba. */
export function validarSchemaEevdTendencia(payload: Record<string, unknown>): void {
  for (const clave of Object.keys(payload)) {
    if (PALABRAS_PROHIBIDAS.test(clave)) {
      throw new Error(
        `«${clave}» huele a dato comercial del tenant: el panel SaaS NUNCA lleva dinero, ` +
          "tarifas ni clientes (centinela 14, §4.1)",
      );
    }
    if (!CAMPOS_EEVD_TENDENCIA_TENANT.includes(clave as (typeof CAMPOS_EEVD_TENDENCIA_TENANT)[number])) {
      throw new Error(`«${clave}» no está en el schema fijo del exportador: el panel no inventa columnas`);
    }
  }
}

/** Fila por tenant que el panel renderiza: 4 valores semanales, más antiguo primero. */
export type FilaEevdTendenciaTenant = {
  tenantSlug: string;
  /** NULL declarado si esa semana no tiene datos aún (mismo criterio que `eevd_semanal` en
   *  `plano-eauto.ts`: NULL, jamás un cero inventado). */
  semanas: [number | null, number | null, number | null, number | null];
};

export function filaEevdTendencia(tenantSlug: string, crudo: EevdTendenciaTenantCrudo): FilaEevdTendenciaTenant {
  validarSchemaEevdTendencia(crudo);
  return {
    tenantSlug,
    semanas: [crudo.eevd_semana_1, crudo.eevd_semana_2, crudo.eevd_semana_3, crudo.eevd_semana_4],
  };
}

// --- Embudo de activación p50/p90 alta→primera entrega (métricas 1 y 2 del §2 del maestro) ---

export type TenantActivacion = {
  tenantSlug: string;
  altaEn: Date;
  /** NULL: el tenant aún no tiene primera entrega real con evidencia — no entra al percentil
   *  (mismo criterio NULL-declarado del resto del módulo: no se inventa un 0 ni se cuenta como
   *  si hubiera activado instantáneo). */
  primeraEntregaEn: Date | null;
};

export type EmbudoActivacion = {
  p50Horas: number | null;
  p90Horas: number | null;
  tenantsActivados: number;
  tenantsPendientes: number;
};

/** Percentil por rango más cercano sobre una lista YA ordenada ascendente — determinístico y
 *  sin dependencia externa de estadística, suficiente para el N chico del piloto (§2 maestro). */
function percentil(valoresOrdenados: number[], p: number): number {
  const indice = Math.ceil((p / 100) * valoresOrdenados.length) - 1;
  const indiceAcotado = Math.min(Math.max(indice, 0), valoresOrdenados.length - 1);
  const valor = valoresOrdenados.at(indiceAcotado);
  if (valor === undefined) throw new Error("percentil: lista vacía — el caller debe filtrar antes de llamar");
  return valor;
}

export function embudoActivacion(tenants: TenantActivacion[]): EmbudoActivacion {
  const horas = tenants
    .filter((t): t is TenantActivacion & { primeraEntregaEn: Date } => t.primeraEntregaEn !== null)
    .map((t) => (t.primeraEntregaEn.getTime() - t.altaEn.getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  return {
    p50Horas: horas.length === 0 ? null : percentil(horas, 50),
    p90Horas: horas.length === 0 ? null : percentil(horas, 90),
    tenantsActivados: horas.length,
    tenantsPendientes: tenants.length - horas.length,
  };
}

// --- Tenants activos y % de vehículos con turno ---

export type TenantSalud = {
  tenantSlug: string;
  activo: boolean;
  vehiculosActivos: number;
  vehiculosConTurno: number;
};

export type SaludPlataforma = {
  tenantsActivos: number;
  pctVehiculosConTurno: number | null;
};

export function saludPlataforma(tenants: TenantSalud[]): SaludPlataforma {
  const activos = tenants.filter((t) => t.activo);
  const totalVehiculos = tenants.reduce((acc, t) => acc + t.vehiculosActivos, 0);
  const totalConTurno = tenants.reduce((acc, t) => acc + t.vehiculosConTurno, 0);
  return {
    tenantsActivos: activos.length,
    pctVehiculosConTurno: totalVehiculos === 0 ? null : totalConTurno / totalVehiculos,
  };
}

// --- Calidad de la norte: % paradas sin evidencia · % PODs supersedidos EXCLUYENDO undo ---

export type EventoSupersedePod = { motivo: string | null };

export type CalidadNorte = {
  pctParadasSinEvidencia: number | null;
  pctPodsSupersedidosSinUndo: number | null;
};

/** «Calidad de la norte» (§10 maestro, §4.7 spec 05): el undo post-replay es un supersede con
 *  `motivo='undo'` (mismo esquema que `outbox-undo.ts`, AC-FPOD-08) y queda EXCLUIDO del
 *  métrico de gaming por definición SQL — un supersede así NO cuenta como corrección real. */
export function calidadNorte(
  paradas: { totalEntrega: number; sinEvidencia: number },
  pods: { total: number; supersedidos: EventoSupersedePod[] },
): CalidadNorte {
  const supersedidosSinUndo = pods.supersedidos.filter((e) => e.motivo !== "undo").length;
  return {
    pctParadasSinEvidencia: paradas.totalEntrega === 0 ? null : paradas.sinEvidencia / paradas.totalEntrega,
    pctPodsSupersedidosSinUndo: pods.total === 0 ? null : supersedidosSinUndo / pods.total,
  };
}

// --- Contador de exenciones de la suite, con tendencia (§10 maestro: creciente = bandera roja) ---

export type ContadorExenciones = {
  valorActual: number;
  /** Tendencia semanal, más antigua primero. Fuente: artefacto del gate CI (AC-FTEN-26); la
   *  INGESTA real al panel está condicionada a la pregunta 10 (spec 05, §3) — el valor que
   *  llega acá ya es el que el pipeline emite hoy. */
  tendenciaSemanal: number[];
  creciente: boolean;
};

export function contadorExenciones(tendenciaSemanal: number[]): ContadorExenciones {
  const valorActual = tendenciaSemanal.at(-1) ?? 0;
  const primero = tendenciaSemanal.at(0);
  // «Creciente» compara los dos extremos de la ventana, no solo el último par: una tendencia
  // que sube y se aplana (0,0,1,1) sigue siendo la bandera roja que el §10 del maestro pide,
  // no solo un salto puntual entre las dos últimas semanas.
  const creciente = tendenciaSemanal.length >= 2 && primero !== undefined && valorActual > primero;
  return { valorActual, tendenciaSemanal, creciente };
}
