import test from "node:test";
import assert from "node:assert/strict";
import { tiposDeAccionPrimaria, unaAccionPrimariaPorPantalla, type BotonVisible } from "./una-accion-primaria.ts";

// Mutantes de "una acción primaria por pantalla" [AC-FMIG-21] — §5.1.
//
// El caso que tiene que poder fallar es el último: dos TIPOS de acción `acento` conviviendo.
// Los demás son los estados reales que ya produce el código de `apps/flota` hoy (ver
// `e2e/una-accion-primaria.spec.ts`), acá aislados como fixtures sintéticos para no depender de
// un navegador.

test("[AC-FMIG-21] pantalla sin ninguna acción de énfasis: cero es válido, no un rebote", () => {
  const botones: BotonVisible[] = [
    { testid: "guardar-nombre_de_ruta", variante: "neutro" },
    { testid: "guardar-nombre_de_destino", variante: "neutro" },
  ];
  assert.deepEqual(tiposDeAccionPrimaria(botones), []);
  assert.equal(unaAccionPrimariaPorPantalla(botones), true);
});

test("[AC-FMIG-21] la MISMA acción repetida por fila de una lista es UN tipo, no N", () => {
  const botones: BotonVisible[] = [
    { testid: "encender-modulo_vehiculos", variante: "acento" },
    { testid: "encender-documentos_vencidos_bloquean", variante: "acento" },
    { testid: "encender-certificaciones_vencidas_bloquean", variante: "acento" },
    { testid: "apagar-otro_modulo", variante: "neutro" },
  ];
  assert.deepEqual(tiposDeAccionPrimaria(botones), ["encender"]);
  assert.equal(unaAccionPrimariaPorPantalla(botones), true);
});

test("[AC-FMIG-21] pantalla con una sola acción sin fila (sin guion en el testid)", () => {
  const botones: BotonVisible[] = [{ testid: "invitar", variante: "acento" }];
  assert.deepEqual(tiposDeAccionPrimaria(botones), ["invitar"]);
  assert.equal(unaAccionPrimariaPorPantalla(botones), true);
});

test("[AC-FMIG-21] MUTANTE — dos tipos de acción acento compitiendo ⇒ rojo", () => {
  const botones: BotonVisible[] = [
    { testid: "invitar", variante: "acento" },
    { testid: "aprobar-solicitud", variante: "acento" },
  ];
  assert.deepEqual(tiposDeAccionPrimaria(botones), ["aprobar", "invitar"]);
  assert.equal(unaAccionPrimariaPorPantalla(botones), false);
});
