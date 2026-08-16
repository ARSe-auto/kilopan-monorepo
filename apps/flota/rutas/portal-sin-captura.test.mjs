// El namespace `/cliente/*` no expone endpoints de captura [AC-FPOR-04] — spec 07 §1.
//
// El §1 lo dice con esas palabras: «el namespace del portal es 100% planificación/lectura: NO
// expone endpoints de captura, por lo que ninguna ruta /cliente/* participa del contrato "sync
// de captura = 2xx siempre"». La captura tiene UNA sola puerta hoy —`/api/sync/capturas`— y es
// la única que puede llamar a `sesionParaSincronizarCapturas` (gobierno.ts lo dice con esas
// palabras: «Ninguna otra ruta debe usar esto»). La auditoría es del MANIFIESTO GENERADO (AC-
// FTEN-26) y no de una lista a mano, por la misma razón que `linea-manual.test.mjs`: «no existe
// una ruta que haga X» solo prueba algo si el inventario no puede quedar incompleto — cualquier
// ruta nueva que caiga bajo `/cliente/` entra a este archivo el día que Next la registre, sin
// que nadie tenga que acordarse de agregarla acá.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AQUI = import.meta.dirname;
const APP = join(AQUI, "..");
const MANIFIESTO = JSON.parse(readFileSync(join(AQUI, "manifiesto.json"), "utf8"));

const DEL_PORTAL = MANIFIESTO.rutas.filter((r) => r.ruta === "/cliente" || r.ruta.startsWith("/cliente/"));

test("[AC-FPOR-04] el namespace /cliente/* existe en el manifiesto — la ausencia no es por estar vacío", () => {
  // El verde vacuo de este AC: con el manifiesto sin ninguna ruta /cliente/*, «ninguna usa el
  // motor de capturas» sería trivialmente cierto y no diría nada del producto.
  assert.ok(DEL_PORTAL.length > 0, "el manifiesto no tiene ninguna ruta /cliente/* que auditar");
});

test("[AC-FPOR-04] ninguna ruta /cliente/* importa el motor de sync de capturas", () => {
  for (const r of DEL_PORTAL) {
    const contenido = readFileSync(join(APP, r.archivo), "utf8");
    assert.ok(
      !contenido.includes("sesionParaSincronizarCapturas"),
      `${r.archivo} (${r.ruta}) usa sesionParaSincronizarCapturas — el §1 exige que /cliente/* ` +
        "sea 100% planificación/lectura, jamás parte del contrato «sync de captura = 2xx siempre»",
    );
  }
});

test("[AC-FPOR-04] el chequeo atrapa de verdad: la ÚNICA puerta de captura real SÍ usa el motor", () => {
  // El positivo que impide que el test de arriba pase por un `includes` mal escrito: si
  // `/api/sync/capturas` no usara el motor, el chequeo estaría comparando contra un string que
  // no aparece en ningún archivo del árbol y pasaría siempre, diga lo que diga /cliente/*.
  const capturas = MANIFIESTO.rutas.find((r) => r.ruta === "/api/sync/capturas");
  assert.ok(capturas, "no está el endpoint de captura real — el fixture del test cambió de forma");
  const contenido = readFileSync(join(APP, capturas.archivo), "utf8");
  assert.ok(contenido.includes("sesionParaSincronizarCapturas"), "el fixture del positivo ya no aplica");
});
