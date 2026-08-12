import type { EstadoDominio } from "./semaforo.ts";

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
        { id: "exc-turno-1", descripcion: "Turno de Marcela sin cerrar 1,5 h tras fin de bloque", record_time: horasAntes(2) },
        { id: "exc-turno-2", descripcion: "Sin eventos hace 40 min — furgón BBLL21", record_time: horasAntes(1) },
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
        { id: "exc-sync-2", descripcion: "Sin sync hace 5 h — turno abierto, furgón CCJJ88", record_time: horasAntes(5) },
        { id: "exc-sync-1", descripcion: "Hueco de secuencia — dispositivo del despacho 3", record_time: horasAntes(9) },
        { id: "exc-sync-3", descripcion: "Entrega sin evidencia tras sync — parada 214", record_time: horasAntes(3) },
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
        { id: "exc-sla-1", descripcion: "OTD proyectado del período bajo el comprometido −2 pp — farmacia", record_time: horasAntes(4) },
      ],
    },
  ];
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
        { id: "exc-ev-1", descripcion: "SOC actual bajo el consumo estimado del tramo — furgón AADD12", record_time: horasAntes(1) },
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
        { id: "exc-caja-1", descripcion: "Discrepancia de custodia pendiente — cierre de ruta 88", record_time: horasAntes(6) },
      ],
    },
    // Sin fila `daas_sla`: seed C no tiene ninguna empresa cliente con `otd_comprometido_pct`.
  ];
}
