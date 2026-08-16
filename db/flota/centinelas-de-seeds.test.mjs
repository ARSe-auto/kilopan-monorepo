#!/usr/bin/env node
// Mutantes de la propiedad que hace servibles a los centinelas del seed §10 [AC-FMIG-18].
//
// Sin cluster: es la verificación más barata del paquete de seeds y tiene que correr en el gate
// rápido. Lo que prueba no es el juego real (que hoy está bien y no probaría nada), sino que
// `centinelasNoDisjuntos` DETECTA cada una de las dos formas silenciosas de romper el oráculo
// de «fila cruzada ⇒ rojo» (§9.3.2, centinela 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CENTINELAS, centinelasNoDisjuntos } from "./seeds/centinelas.mjs";

test("[AC-FMIG-18] el juego real de centinelas de A/B/C sirve como oráculo de cruce", () => {
  assert.deepEqual(centinelasNoDisjuntos(), []);
  assert.deepEqual(Object.keys(CENTINELAS).sort(), ["a", "b", "c"]);
});

test("[AC-FMIG-18] dos tenants con el MISMO centinela ⇒ detectado (el cruce sería verde siempre)", () => {
  const motivos = centinelasNoDisjuntos({ ...CENTINELAS, c: CENTINELAS.b });
  assert.ok(motivos.length > 0, "compartir centinela tiene que ser un motivo");
  assert.ok(
    motivos.some((m) => m.includes("comparten el centinela")),
    `el motivo no nombra el empate: ${motivos.join(" | ")}`,
  );
});

test("[AC-FMIG-18] un centinela SUBCADENA de otro ⇒ detectado (el barrido like daría cruce siempre)", () => {
  const motivos = centinelasNoDisjuntos({ ...CENTINELAS, c: `${CENTINELAS.b}-EXTENDIDO` });
  assert.ok(
    motivos.some((m) => m.includes("es subcadena del de")),
    `el motivo no nombra la subcadena: ${motivos.join(" | ")}`,
  );
});

test("[AC-FMIG-18] un centinela demasiado corto ⇒ detectado (aparecería por azar)", () => {
  const motivos = centinelasNoDisjuntos({ ...CENTINELAS, c: "PAN" });
  assert.ok(
    motivos.some((m) => m.includes("caracteres")),
    `el motivo no nombra el largo: ${motivos.join(" | ")}`,
  );
});

test("[AC-FMIG-18] un centinela que no es cadena ⇒ detectado, sin explotar", () => {
  const motivos = centinelasNoDisjuntos({ ...CENTINELAS, c: null });
  assert.ok(motivos.length > 0, "un centinela nulo tiene que ser un motivo, no una excepción");
});
