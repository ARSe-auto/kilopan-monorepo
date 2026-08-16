// La memoria de cálculo del EEVD esperado de A y B [AC-FMIG-27] — versionada JUNTO A LOS
// SEEDS, specs/flota/08-diseno-miga-onboarding.md §7 y §10 del maestro
// (docs/PROMPT_MAESTRO_FLOTA.md): «el valor se calcula UNA vez a mano al escribir el seed y
// queda escrito con su derivación completa (numerador, denominador y las filas exactas que
// los producen) para que el test de fixture de AC-FMIG-23 lo consuma SIN RECALCULARLO — si el
// test recalculara, estaría comparando la vista contra sí misma».
//
// Por eso este archivo NO consulta la base: los números de abajo son el cálculo a mano,
// citando la fila exacta de cada seed que los produce. El día que `tenant-a.mjs` o
// `tenant-b-operacion.mjs` cambien la cantidad de turnos que abren, ESTE archivo queda
// desactualizado a propósito —no se recalcula solo— y es tarea de quien toque ese seed
// actualizar la derivación de acá en el MISMO commit.
//
// ─── LA VISTA QUE ESTO DERIVA (`eevd_semanal`, migración 0020, AC-FVEH-20) ─────────────────
//
//   eevd = round(entregas_con_evidencia / vehiculos_dia, 2)
//
//   · `vehiculos_dia` = pares (vehiculo_id, día de APERTURA del turno en America/Santiago)
//     ÚNICOS, contando solo turnos con `estado <> 'anulado'`.
//   · `entregas_con_evidencia` = eventos con `evento_tipo.codigo = 'entrega.con_evidencia'`.
//
// ─── POR QUÉ EL NUMERADOR ES 0 EN LOS DOS TENANTS, HOY ─────────────────────────────────────
//
// `entrega.con_evidencia` NO existe todavía en el catálogo `EVENTOS_OPERACION`
// (apps/flota/src/servidor/gobierno.ts): el POD que capturan estos seeds
// (`aterrizarCapturas`, AC-FPOD-01) emite `entrega.pod_capturada` o, en un supersede,
// `entrega.pod_deshecha` (apps/flota/src/servidor/capturas.ts, líneas ~483-486) — NINGUNO de
// los dos es el código que la vista cuenta. La propia migración 0020 lo deja escrito: «el
// numerador todavía no existe, y eso se nota sin mentir» — no se pone un 0 literal en la
// vista, se cuenta un evento que hoy no está en el catálogo y por eso da cero por sí solo.
// El numerador de AMBOS tenants es 0 hasta que el hito de POD con evidencia (bloqueado por la
// Pregunta al dueño 4 de la spec 04, la misma que bloquea a AC-FMIG-23) agregue ese código y
// lo emita — sin tocar una línea de este archivo ni de la vista.
//
// ─── EL DENOMINADOR: LAS FILAS EXACTAS QUE LO PRODUCEN ─────────────────────────────────────
//
// `abrirTurno` NO recibe un timestamp explícito en ninguno de los dos seeds: `abierto_en`
// queda en el instante REAL en que corre el seed (`now()` de la base), no en el
// `2026-03-03` que `DIA_DE_LA_OPERACION` narra para las capturas de B ni en ninguna otra
// fecha de guion. Por eso la fila de `eevd_semanal` que hay que mirar es la de la SEMANA EN
// QUE CORRE el seed —`date_trunc('week', abierto_en at time zone 'America/Santiago')`—, no
// una fecha fija hardcodeada en este archivo: lo que SÍ es fijo, y es lo que este archivo
// congela, es la CANTIDAD de vehículos-día que esa corrida deja, sea cual sea la semana.
//
//   Tenant A (db/flota/seeds/tenant-a.mjs, `sembrarTenantA`, sección «El turno del chofer de
//   la mañana»): UNA sola llamada a `abrirTurno(pool, sesionChofer, tenant.slug,
//   vehiculos[0].id)` — el chofer de la mañana abre el turno del EV48 `EAUT0001`
//   (`vehiculos[0]`). Ninguna otra sección del seed abre un turno. → 1 fila en `turnos`, no
//   anulada → 1 vehículo-día.
//
//   Tenant B (db/flota/seeds/tenant-b-operacion.mjs, `sembrarOperacionB`, loop sobre
//   `RUTAS_MAESTRAS`): el loop tiene DOS elementos —«norte» y «sur»— y cada iteración llama
//   UNA vez a `abrirTurno(pool, sesionChofer, tenant.slug, vehiculo.id)` con
//   `vehiculo = identidad.vehiculos[i]`: la iteración 0 (norte) abre el turno de `RUTB0001`
//   (`identidad.vehiculos[0]`), la iteración 1 (sur) abre el de `RUTB0002`
//   (`identidad.vehiculos[1]`). Dos vehículos DISTINTOS, cada uno con su propia fila, ninguna
//   anulada, ambas abiertas en la misma corrida (mismo día de calendario real) → 2 filas en
//   `turnos` → 2 vehículos-día.
//
// ─── EL VALOR ESPERADO, HARDCODEADO (no se deriva en tiempo de test) ───────────────────────
export const EEVD_ESPERADO_A = Object.freeze({
  tenant: "a",
  numerador: 0,
  denominador: 1,
  /** `eevd_semanal.eevd` es `numeric`: node-postgres lo trae como STRING, no como number —
   *  comparar contra este string y no contra `0` evita el mismatch de tipo. */
  eevd: "0.00",
});

export const EEVD_ESPERADO_B = Object.freeze({
  tenant: "b",
  numerador: 0,
  denominador: 2,
  eevd: "0.00",
});
