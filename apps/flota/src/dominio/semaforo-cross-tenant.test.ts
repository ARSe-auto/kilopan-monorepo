import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluarSenalesCrossTenant,
  evaluarCanarioAislamiento,
  type HechosCrossTenant,
  type UmbralesCrossTenant,
} from "./semaforo-cross-tenant.ts";

// Señales cross-tenant en `control` [AC-FSEM-11] — spec 05 §3, Anexo B (fila «Cross-tenant
// (e-auto)»). Umbrales seed del Anexo B: actividad −30% vs media 7d, errores sync 1–5%
// amarillo / >5% sostenido 15 min rojo, >20% PWA vieja, cola de sync >4 h (240 min), churn EEVD
// −30% semana/semana — fixtures robustos a la pregunta 5a (mismo criterio que AC-FSEM-07/08/19):
// donde el Anexo B da un rango, el valor de prueba supera cualquier punto posible del rango sin
// alcanzar la banda vecina.
const UMBRALES: UmbralesCrossTenant = {
  actividad_caida_pct_amarillo: 30,
  errores_sync_pct_amarillo: 1,
  errores_sync_pct_recuperacion: 0.5,
  errores_sync_pct_rojo: 5,
  pwa_vieja_pct_amarillo: 20,
  cola_sync_min_rojo: 240,
  churn_eevd_pct_amarillo: 30,
};

function hechosBase(): HechosCrossTenant {
  return {
    umbrales: UMBRALES,
    tenantSinEventosUnDiaHabil: false,
    actividadCaidaPct: null,
    colorPrevioErroresSync: "verde",
    erroresSyncPct: null,
    erroresSyncSostenido15Min: false,
    pctDispositivosPwaVieja: null,
    colaSyncMaxMin: null,
    canarioAislamientoEnFallo: false,
    eevdSemanaActual: null,
    eevdSemanaAnterior: null,
  };
}

test("[AC-FSEM-11] tenant sin eventos un día hábil ⇒ rojo", () => {
  const resultado = evaluarSenalesCrossTenant({ ...hechosBase(), tenantSinEventosUnDiaHabil: true });
  assert.equal(resultado.color, "rojo");
  assert.equal(resultado.senales[0]!.clave, "sin_eventos_dia_habil");
});

test("[AC-FSEM-11] actividad −35% vs media 7d ⇒ amarillo (35% supera cualquier punto del −30%)", () => {
  const resultado = evaluarSenalesCrossTenant({ ...hechosBase(), actividadCaidaPct: 35 });
  assert.equal(resultado.color, "amarillo");
  assert.equal(resultado.senales[0]!.clave, "actividad_caida");
});

test("[AC-FSEM-11] errores de sync en 5% exacto ⇒ amarillo, NO rojo (5% no supera «>5%»)", () => {
  const resultado = evaluarSenalesCrossTenant({
    ...hechosBase(),
    erroresSyncPct: 5,
    erroresSyncSostenido15Min: true,
  });
  assert.equal(resultado.color, "amarillo");
  assert.equal(resultado.senales[0]!.clave, "errores_sync");
});

test("[AC-FSEM-11] errores de sync 6.2% pero NO sostenidos 15 min ⇒ se queda en amarillo", () => {
  const resultado = evaluarSenalesCrossTenant({
    ...hechosBase(),
    erroresSyncPct: 6.2,
    erroresSyncSostenido15Min: false,
  });
  assert.equal(resultado.color, "amarillo");
});

test("[AC-FSEM-11] errores de sync >5% sostenidos 15 min ⇒ rojo", () => {
  const resultado = evaluarSenalesCrossTenant({
    ...hechosBase(),
    erroresSyncPct: 6.2,
    erroresSyncSostenido15Min: true,
  });
  assert.equal(resultado.color, "rojo");
  assert.equal(resultado.senales[0]!.clave, "errores_sync");
});

test("[AC-FSEM-11] errores de sync bajo 1% ⇒ verde, ninguna señal", () => {
  const resultado = evaluarSenalesCrossTenant({ ...hechosBase(), erroresSyncPct: 0.4 });
  assert.equal(resultado.color, "verde");
  assert.equal(resultado.senales.length, 0);
});

test("[AC-FSEM-11] 25% de dispositivos en PWA vieja ⇒ amarillo (25% supera «>20%»)", () => {
  const resultado = evaluarSenalesCrossTenant({ ...hechosBase(), pctDispositivosPwaVieja: 25 });
  assert.equal(resultado.color, "amarillo");
  assert.equal(resultado.senales[0]!.clave, "pwa_vieja");
});

test("[AC-FSEM-11] 20% exacto de dispositivos en PWA vieja ⇒ NO dispara (el umbral es «>20%»)", () => {
  const resultado = evaluarSenalesCrossTenant({ ...hechosBase(), pctDispositivosPwaVieja: 20 });
  assert.equal(resultado.color, "verde");
});

test("[AC-FSEM-11] cola de sync 260 min (>4 h) ⇒ rojo", () => {
  const resultado = evaluarSenalesCrossTenant({ ...hechosBase(), colaSyncMaxMin: 260 });
  assert.equal(resultado.color, "rojo");
  assert.equal(resultado.senales[0]!.clave, "cola_sync");
});

test("[AC-FSEM-11] cola de sync 240 min exacto (=4 h) ⇒ NO dispara (el umbral es «>4 h»)", () => {
  const resultado = evaluarSenalesCrossTenant({ ...hechosBase(), colaSyncMaxMin: 240 });
  assert.equal(resultado.color, "verde");
});

test("[AC-FSEM-11] churn EEVD −35% semana/semana ⇒ amarillo (35% supera «−30%»)", () => {
  const resultado = evaluarSenalesCrossTenant({
    ...hechosBase(),
    eevdSemanaAnterior: 0.8,
    eevdSemanaActual: 0.52, // −35% exacto
  });
  assert.equal(resultado.color, "amarillo");
  assert.equal(resultado.senales[0]!.clave, "churn_eevd");
});

test("[AC-FSEM-11] EEVD que sube semana contra semana ⇒ verde, sin alarma de churn", () => {
  const resultado = evaluarSenalesCrossTenant({
    ...hechosBase(),
    eevdSemanaAnterior: 0.6,
    eevdSemanaActual: 0.7,
  });
  assert.equal(resultado.color, "verde");
  assert.equal(resultado.senales.length, 0);
});

test("[AC-FSEM-11] canario de aislamiento en fallo ⇒ rojo máximo, standalone", () => {
  assert.equal(evaluarCanarioAislamiento(true), "rojo");
  assert.equal(evaluarCanarioAislamiento(false), "verde");
});

test("[AC-FSEM-11] canario de aislamiento en fallo ⇒ rojo, NO degradable por histéresis (colorPrevio verde no lo frena)", () => {
  // El resto de las señales SÍ arrastran su colorPrevio (p.ej. errores_sync); el canario no
  // recibe un colorPrevio en absoluto — no hay parámetro que un caller pudiera pasar «verde»
  // para intentar apagarlo. Acá lo probamos combinado con el resto de hechos en verde.
  const resultado = evaluarSenalesCrossTenant({ ...hechosBase(), canarioAislamientoEnFallo: true });
  assert.equal(resultado.color, "rojo");
  assert.equal(resultado.senales[0]!.clave, "canario_aislamiento");
});

test("[AC-FSEM-11] canario de aislamiento en fallo ⇒ rojo, NO degradable por edición de umbral (umbrales permisivos no lo frenan)", () => {
  const umbralesPermisivos: UmbralesCrossTenant = {
    actividad_caida_pct_amarillo: 100_000,
    errores_sync_pct_amarillo: 100_000,
    errores_sync_pct_recuperacion: 100_000,
    errores_sync_pct_rojo: 100_000,
    pwa_vieja_pct_amarillo: 100_000,
    cola_sync_min_rojo: 100_000,
    churn_eevd_pct_amarillo: 100_000,
  };
  const resultado = evaluarSenalesCrossTenant({
    ...hechosBase(),
    umbrales: umbralesPermisivos,
    canarioAislamientoEnFallo: true,
  });
  assert.equal(resultado.color, "rojo");
});

test("[AC-FSEM-11] «backlog creciente 2 intervalos» no existe como campo evaluable — condicionado a la pregunta 3", () => {
  // Documenta la exclusión deliberada (spec 05, línea del AC): esta clave no está en
  // HechosCrossTenant a propósito, mismo tratamiento que la ETA de AC-FSEM-19.
  const hechos = hechosBase();
  assert.ok(!("backlogCreciente2Intervalos" in hechos));
});

test("[AC-FSEM-11] el color de la fila es el PEOR entre varias señales disparadas a la vez", () => {
  const resultado = evaluarSenalesCrossTenant({
    ...hechosBase(),
    actividadCaidaPct: 35,
    pctDispositivosPwaVieja: 25,
    colaSyncMaxMin: 260,
  });
  assert.equal(resultado.color, "rojo");
  assert.equal(resultado.senales.length, 3);
});

test("[AC-FSEM-11] sin ninguna señal disparada ⇒ verde, lista vacía", () => {
  const resultado = evaluarSenalesCrossTenant(hechosBase());
  assert.equal(resultado.color, "verde");
  assert.deepEqual(resultado.senales, []);
});
