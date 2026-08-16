import type { ColorSemaforo } from "./semaforo.ts";

// Señales cross-tenant en `control` [AC-FSEM-11] — spec 05 §3, Anexo B (fila «Cross-tenant
// (e-auto)»), dependencia AC-FSEM-10 (el plano que las CONSUME ya evaluadas: comentario de
// `dominio/plano-eauto.ts` «Evaluación real de signal_rule en control: AC-FSEM-11»).
//
// Misma mecánica que los dominios tenant (AC-FSEM-07/08): función pura, sin abrir la BD
// `control` — el wiring del job exportador/endpoint real queda para un AC posterior, igual
// criterio que AC-FSEM-07/08 (no está en el texto de este AC ni su oráculo CI lo exige).
//
// Dos familias de señal, igual que en los dominios tenant:
// - Con banda editable (histéresis §2.4): errores de sync (1–5% amarillo, >5% sostenido 15 min
//   rojo — el «sostenido» es un hecho aparte que ya llega resuelto, no algo que esta función
//   calcule de una serie temporal, mismo criterio que «turno abierto» en AC-FSEM-07/08).
// - Binarias del Anexo B, un solo umbral, sin banda que las module (mismo tratamiento que
//   «cruzando medianoche» en AC-FSEM-08): sin eventos un día hábil, actividad −30% vs media 7d,
//   >20% dispositivos en PWA vieja, cola de sync >4 h, churn EEVD −30% semana/semana.
//
// «Backlog creciente 2 intervalos» (Anexo B, amarillo) NO se implementa acá: queda CONDICIONADA
// a la pregunta 3 del dueño (sin cadencia del exportador, «intervalo» no tiene semántica
// cerrada) — mismo tratamiento que la señal de ETA en AC-FSEM-19 y que «webhook pactado caído»
// (E2, fuera de este módulo). Tampoco se siembra en E1 (spec 05 §3).
//
// El canario de aislamiento es la EXCEPCIÓN a toda esta mecánica: rojo máximo que NO pasa por
// histéresis ni por umbral editable — spec 05 §3 lo dice explícito («no degradable por
// histéresis ni edición de umbral»), por eso `evaluarCanarioAislamiento` ni siquiera recibe un
// `colorPrevio` o un `UmbralesCrossTenant`: no hay parámetro que un caller pudiera manipular
// para apagarlo.

export type UmbralesCrossTenant = {
  actividad_caida_pct_amarillo: number;
  errores_sync_pct_amarillo: number;
  errores_sync_pct_recuperacion: number;
  errores_sync_pct_rojo: number;
  pwa_vieja_pct_amarillo: number;
  cola_sync_min_rojo: number;
  churn_eevd_pct_amarillo: number;
};

export type HechosCrossTenant = {
  umbrales: UmbralesCrossTenant;
  tenantSinEventosUnDiaHabil: boolean;
  actividadCaidaPct: number | null;
  colorPrevioErroresSync: ColorSemaforo;
  erroresSyncPct: number | null;
  erroresSyncSostenido15Min: boolean;
  pctDispositivosPwaVieja: number | null;
  colaSyncMaxMin: number | null;
  canarioAislamientoEnFallo: boolean;
  eevdSemanaActual: number | null;
  eevdSemanaAnterior: number | null;
};

export type SenalCrossTenant = {
  clave:
    | "sin_eventos_dia_habil"
    | "actividad_caida"
    | "errores_sync"
    | "pwa_vieja"
    | "cola_sync"
    | "canario_aislamiento"
    | "churn_eevd";
  color: "amarillo" | "rojo";
  descripcion: string;
};

export type ResultadoCrossTenant = {
  /** El peor color entre todas las señales disparadas — el que muestra la fila del tenant en
   *  el plano cross-tenant (AC-FSEM-10). */
  color: ColorSemaforo;
  /** Solo las señales que dispararon (amarillo o rojo) — verde no comunica, misma regla que
   *  el resto del semáforo (§5.6-N0). */
  senales: SenalCrossTenant[];
};

const RANGO: Record<ColorSemaforo, number> = { verde: 0, amarillo: 1, rojo: 2 };
const peorDeLosDos = (a: ColorSemaforo, b: ColorSemaforo): ColorSemaforo => (RANGO[b] > RANGO[a] ? b : a);

/**
 * Errores de sync [Anexo B «errores sync 1–5%» amarillo / «errores >5% por 15 min» rojo]: la
 * banda amarilla es histéresis normal (zona intermedia sticky, igual que `transicionColor` de
 * AC-FSEM-02), pero el rojo exige AMBAS cosas — pasar el 5% Y estar sostenido 15 min — así que
 * 5% exacto sin sostener nunca escala solo (robusto a la pregunta 5a, mismo criterio que
 * AC-FSEM-07/08/19).
 */
function colorErroresSync(
  colorPrevio: ColorSemaforo,
  pct: number,
  sostenido15Min: boolean,
  umbrales: UmbralesCrossTenant,
): ColorSemaforo {
  if (pct > umbrales.errores_sync_pct_rojo && sostenido15Min) return "rojo";
  if (pct >= umbrales.errores_sync_pct_amarillo) return "amarillo";
  if (pct <= umbrales.errores_sync_pct_recuperacion) return "verde";
  return colorPrevio === "rojo" ? "amarillo" : colorPrevio;
}

/**
 * Canario de aislamiento en fallo [Anexo B «sospecha de fuga = rojo máximo siempre»,
 * spec 05 §3]: rojo máximo que NO se degrada por histéresis ni por edición de umbral — por
 * diseño, esta función no toma umbral ni color previo, nada que un caller pueda editar para
 * apagarla.
 */
export function evaluarCanarioAislamiento(enFallo: boolean): "verde" | "rojo" {
  return enFallo ? "rojo" : "verde";
}

/**
 * Evalúa las señales cross-tenant de un tenant en `control` [AC-FSEM-11] — spec 05 §3,
 * Anexo B: combina la banda con histéresis (errores de sync) y las binarias del Anexo B en el
 * color de la fila del plano cross-tenant (AC-FSEM-10), el peor de todas.
 */
export function evaluarSenalesCrossTenant(hechos: HechosCrossTenant): ResultadoCrossTenant {
  const senales: SenalCrossTenant[] = [];
  let peor: ColorSemaforo = "verde";

  const agregar = (senal: SenalCrossTenant) => {
    peor = peorDeLosDos(peor, senal.color);
    senales.push(senal);
  };

  if (hechos.tenantSinEventosUnDiaHabil) {
    agregar({
      clave: "sin_eventos_dia_habil",
      color: "rojo",
      descripcion: "Tenant sin eventos un día hábil completo",
    });
  }

  if (hechos.actividadCaidaPct !== null && hechos.actividadCaidaPct >= hechos.umbrales.actividad_caida_pct_amarillo) {
    agregar({
      clave: "actividad_caida",
      color: "amarillo",
      descripcion: `Actividad ${hechos.actividadCaidaPct}% bajo la media móvil de 7 días`,
    });
  }

  if (hechos.erroresSyncPct !== null) {
    const color = colorErroresSync(
      hechos.colorPrevioErroresSync,
      hechos.erroresSyncPct,
      hechos.erroresSyncSostenido15Min,
      hechos.umbrales,
    );
    if (color !== "verde") {
      agregar({ clave: "errores_sync", color, descripcion: `Errores de sync en ${hechos.erroresSyncPct}%` });
    }
  }

  if (
    hechos.pctDispositivosPwaVieja !== null &&
    hechos.pctDispositivosPwaVieja > hechos.umbrales.pwa_vieja_pct_amarillo
  ) {
    agregar({
      clave: "pwa_vieja",
      color: "amarillo",
      descripcion: `${hechos.pctDispositivosPwaVieja}% de dispositivos en PWA vieja`,
    });
  }

  if (hechos.colaSyncMaxMin !== null && hechos.colaSyncMaxMin > hechos.umbrales.cola_sync_min_rojo) {
    agregar({
      clave: "cola_sync",
      color: "rojo",
      descripcion: `Cola de sync sin vaciar hace ${hechos.colaSyncMaxMin} min`,
    });
  }

  if (evaluarCanarioAislamiento(hechos.canarioAislamientoEnFallo) === "rojo") {
    agregar({ clave: "canario_aislamiento", color: "rojo", descripcion: "Canario de aislamiento en fallo" });
  }

  if (hechos.eevdSemanaActual !== null && hechos.eevdSemanaAnterior !== null && hechos.eevdSemanaAnterior > 0) {
    const cambioPct = ((hechos.eevdSemanaActual - hechos.eevdSemanaAnterior) / hechos.eevdSemanaAnterior) * 100;
    if (cambioPct <= -hechos.umbrales.churn_eevd_pct_amarillo) {
      agregar({
        clave: "churn_eevd",
        color: "amarillo",
        descripcion: `EEVD agregada cayó ${Math.abs(cambioPct).toFixed(1)}% semana contra semana`,
      });
    }
  }

  return { color: peor, senales };
}
