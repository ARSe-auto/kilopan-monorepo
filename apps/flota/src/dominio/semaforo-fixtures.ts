import type { EstadoDominio } from "./semaforo.ts";
import type { EventoTimelineN2, TipoEvidenciaN2 } from "./detalle-n2.ts";

// Fixtures de seed A y seed C para el Nivel 0 del «Hoy» [AC-FSEM-01].
//
// El maestro define seed A (tenant `daas`, empresa cliente farmacia con
// `otd_comprometido_pct=95`) y seed C (tenant `mi_flota`, sin empresas clientes) como los
// tenants de referencia para los e2e del módulo (§10, dependencia con el hito g). La
// PROVISIÓN real de esos tenants —con `signal_rule` evaluando contra `eventos`/`paradas`
// reales— es de los módulos 00/02/03/04/06/08, que este AC no construye: ninguno de ellos
// existe todavía como tabla ni como endpoint. Lo que ESTE archivo fija es el ESTADO YA
// EVALUADO que esos módulos entregarían para cada semilla, así el Nivel 0 se puede construir
// y probar de verdad hoy, sin bloquear en una migración que el motor no puede escribir.

const HOY = new Date("2026-08-12T14:00:00-04:00");
const horasAntes = (h: number) => new Date(HOY.getTime() - h * 60 * 60 * 1000);

/** Seed A: tenant `daas`, farmacia con `otd_comprometido_pct=95` — la SLA SÍ existe. */
export function seedA(): EstadoDominio[] {
  return [
    {
      clave: "entregas_vs_plan",
      color: "verde",
      agregado: { numerador: 34, denominador: 40 },
      excepciones: [],
    },
    {
      clave: "turnos_conductores",
      color: "amarillo",
      agregado: { numerador: 11, denominador: 12 },
      excepciones: [
        {
          id: "exc-turno-1",
          descripcion: "Turno de Marcela sin cerrar 1,5 h tras fin de bloque",
          record_time: horasAntes(2),
          quien: "Marcela",
          que: "Turno sin cerrar tras fin de bloque",
          cuanto: "1,5 h de exceso",
          playbook: "Llamar para confirmar el cierre o cerrarlo manualmente con nota.",
          severidad: "amarillo",
          estado: "nueva",
        },
        {
          id: "exc-turno-2",
          descripcion: "Sin eventos hace 40 min — furgón BBLL21",
          record_time: horasAntes(1),
          quien: "Furgón BBLL21",
          que: "Sin eventos en el turno",
          cuanto: "40 min sin señal",
          playbook: "Confirmar cobertura o contactar al conductor.",
          severidad: "amarillo",
          estado: "nueva",
        },
      ],
    },
    {
      clave: "flota_energia_ev",
      color: "verde",
      agregado: { numerador: 18, denominador: 18 },
      excepciones: [],
    },
    {
      clave: "datos_sync",
      color: "rojo",
      agregado: { numerador: 15, denominador: 18 },
      // Fuera de orden a propósito: «más antigua» tiene que salir de `record_time`, no de
      // la posición en el arreglo — si la selección fuera por índice, este fixture la delata.
      excepciones: [
        {
          id: "exc-sync-2",
          descripcion: "Sin sync hace 5 h — turno abierto, furgón CCJJ88",
          record_time: horasAntes(5),
          quien: "Furgón CCJJ88",
          que: "Sin sync con turno abierto",
          cuanto: "5 h sin sincronizar",
          playbook: "Contactar al conductor y verificar la conectividad del aparato.",
          severidad: "rojo",
          estado: "nueva",
        },
        {
          id: "exc-sync-1",
          descripcion: "Hueco de secuencia — dispositivo del despacho 3",
          record_time: horasAntes(9),
          quien: "Dispositivo del despacho 3",
          que: "Hueco de secuencia detectado",
          cuanto: "9 h desde el hueco",
          playbook: "Revisar el registro de sync del dispositivo y forzar reenvío.",
          severidad: "rojo",
          estado: "nueva",
        },
        {
          id: "exc-sync-3",
          descripcion: "Entrega sin evidencia tras sync — parada 214",
          record_time: horasAntes(3),
          quien: "Parada 214",
          que: "Entrega sin evidencia tras sync",
          cuanto: "3 h desde el sync",
          playbook: "Revisar la parada y solicitar la evidencia al conductor.",
          severidad: "rojo",
          estado: "nueva",
        },
      ],
    },
    {
      clave: "caja_custodia_liquidacion",
      color: "verde",
      agregado: { numerador: 6, denominador: 6 },
      excepciones: [],
    },
    {
      clave: "daas_sla",
      color: "amarillo",
      agregado: { numerador: 93, denominador: 95 },
      excepciones: [
        {
          id: "exc-sla-1",
          descripcion: "OTD proyectado del período bajo el comprometido −2 pp — farmacia",
          record_time: horasAntes(4),
          quien: "Farmacia",
          que: "OTD proyectado bajo el comprometido",
          cuanto: "−2 pp bajo la meta",
          playbook: "Revisar las rutas del contrato y priorizar las paradas en riesgo.",
          severidad: "amarillo",
          estado: "nueva",
        },
      ],
    },
  ];
}

/** Seed «vacío»: tenant sin ningún dominio evaluado todavía (recién provisionado, cero
 *  `signal_rule` con datos que evaluar). Ejercita el estado «vacío accionable» del §5.7
 *  [AC-FSEM-12] — `tarjetasNivelCero([])` ya devuelve `[]` sin cambio de código en
 *  `dominio/semaforo.ts`, así que este fixture es la única pieza que faltaba para probarlo. */
export function seedVacio(): EstadoDominio[] {
  return [];
}

/** Seed C: tenant `mi_flota` — sin empresas clientes, sin fila de SLA. */
export function seedC(): EstadoDominio[] {
  return [
    {
      clave: "entregas_vs_plan",
      color: "verde",
      agregado: { numerador: 22, denominador: 24 },
      excepciones: [],
    },
    {
      clave: "turnos_conductores",
      color: "verde",
      agregado: { numerador: 5, denominador: 5 },
      excepciones: [],
    },
    {
      clave: "flota_energia_ev",
      color: "rojo",
      agregado: { numerador: 4, denominador: 5 },
      excepciones: [
        {
          id: "exc-ev-1",
          descripcion: "SOC actual bajo el consumo estimado del tramo — furgón AADD12",
          record_time: horasAntes(1),
          quien: "Furgón AADD12",
          que: "SOC actual bajo el consumo estimado del tramo",
          cuanto: "bajo el estimado del tramo",
          playbook: "Reprogramar recarga o acortar el tramo restante.",
          severidad: "rojo",
          estado: "nueva",
        },
      ],
    },
    {
      clave: "datos_sync",
      color: "verde",
      agregado: { numerador: 5, denominador: 5 },
      excepciones: [],
    },
    {
      clave: "caja_custodia_liquidacion",
      color: "amarillo",
      agregado: { numerador: 3, denominador: 4 },
      excepciones: [
        {
          id: "exc-caja-1",
          descripcion: "Discrepancia de custodia pendiente — cierre de ruta 88",
          record_time: horasAntes(6),
          quien: "Cierre de ruta 88",
          que: "Discrepancia de custodia pendiente",
          cuanto: "pendiente de revisión",
          playbook: "Revisar el cierre y confirmar el conteo con el conductor.",
          severidad: "amarillo",
          estado: "nueva",
        },
      ],
    },
    // Sin fila `daas_sla`: seed C no tiene ninguna empresa cliente con `otd_comprometido_pct`.
  ];
}

/** Timeline + evidencia del Detalle N2 [AC-FSEM-05], por id de excepción de las semillas de
 *  arriba. Solo las excepciones que el e2e del módulo ejerce llevan datos acá — el resto
 *  degrada igual (`construirDetalleN2` de `dominio/detalle-n2.ts` no exige que exista una
 *  entrada) porque una excepción sin este extra ES el caso «cero evidencia, cero eventos». */
export const detalleExtraDeExcepcion: Record<
  string,
  { timeline: EventoTimelineN2[]; evidencia: Partial<Record<TipoEvidenciaN2, string>> }
> = {
  // Hueco de secuencia: el registro de sync SÍ existe (es lo que detectó el hueco), pero no
  // hay foto/GPS/SOC — no son evidencia de un hueco de secuencia, así que degradan las tres.
  "exc-sync-1": {
    timeline: [
      { id: "t1", texto: "Secuencia 4120 registrada por el dispositivo del despacho 3", cuando: horasAntes(9.2) },
      { id: "t2", texto: "Hueco detectado: falta la secuencia 4121 en el orden autoritativo", cuando: horasAntes(9) },
    ],
    evidencia: { sync: "3 reintentos automáticos fallidos — el último hace 9 h" },
  },
  // «Entrega sin evidencia»: acá la degradación es TOTAL a propósito — es exactamente el caso
  // que la excepción reporta, y el detalle tiene que mostrarlo sin hueco ni error.
  "exc-sync-3": {
    timeline: [
      { id: "t1", texto: "Parada 214 marcada como entregada por el conductor", cuando: horasAntes(3.1) },
      { id: "t2", texto: "Sync del dispositivo completado sin ninguna evidencia adjunta", cuando: horasAntes(3) },
    ],
    evidencia: {},
  },
  // SOC bajo el estimado: la curva SOC existe; foto/GPS/sync no aplican a esta señal.
  "exc-ev-1": {
    timeline: [
      { id: "t1", texto: "Lectura de SOC 20% registrada — furgón AADD12", cuando: horasAntes(1.2) },
      { id: "t2", texto: "Proyección de consumo del tramo restante calculada", cuando: horasAntes(1) },
    ],
    evidencia: { soc: "82 % → 20 % en 4 tramos del turno" },
  },
};
