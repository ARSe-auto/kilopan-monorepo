import { test } from "node:test";
import assert from "node:assert/strict";
import { siguienteSecuenciaDispositivo } from "./secuencia-dispositivo.ts";
import type { AlmacenLocal } from "./outbox-local.ts";

// La secuencia monotónica del dispositivo [AC-FPOD-10] — §4.7.

function almacen(): AlmacenLocal {
  const datos = new Map<string, string>();
  return {
    getItem: (llave) => datos.get(llave) ?? null,
    setItem: (llave, valor) => {
      datos.set(llave, valor);
    },
  };
}

test("[AC-FPOD-10] la primera captura del aparato arranca en 1, no en 0", () => {
  assert.equal(siguienteSecuenciaDispositivo(almacen()), 1);
});

test("[AC-FPOD-10] cada llamada crece de a uno, sin repetir ni saltar", () => {
  const disco = almacen();
  const vistos = Array.from({ length: 5 }, () => siguienteSecuenciaDispositivo(disco));
  assert.deepEqual(vistos, [1, 2, 3, 4, 5]);
});

test("[AC-FPOD-10] la secuencia sobrevive al cierre del aparato: sigue donde quedó, no se reinicia", () => {
  const disco = almacen();
  siguienteSecuenciaDispositivo(disco);
  siguienteSecuenciaDispositivo(disco);
  // «Reabrir la app» acá es simplemente volver a leer el mismo almacén con una llamada nueva —
  // no hay estado en memoria que perder, que es justo la garantía que hace el AC.
  assert.equal(siguienteSecuenciaDispositivo(disco), 3);
});

test("[AC-FPOD-10] la secuencia NO se particiona por identidad: cambiar de usuario en el mismo aparato no la reinicia", () => {
  // A diferencia del outbox (`outbox-local.ts`, AC-FPOD-09), este contador es del APARATO, no de
  // la credencial: dos identidades en el mismo teléfono comparten la misma historia de cierres.
  const disco = almacen();
  siguienteSecuenciaDispositivo(disco);
  siguienteSecuenciaDispositivo(disco);
  siguienteSecuenciaDispositivo(disco);
  assert.equal(
    siguienteSecuenciaDispositivo(disco),
    4,
    "no hay una segunda llave que reinicie el conteo al autenticarse otra persona",
  );
});

test("[AC-FPOD-10] un valor guardado ilegible no revienta: se lee como si el aparato jamás hubiera cerrado nada", () => {
  const disco = almacen();
  disco.setItem("flota.dispositivo.secuencia", "no-es-un-numero");
  assert.equal(siguienteSecuenciaDispositivo(disco), 1);
});

test("[AC-FPOD-10] un almacén que niega la escritura no bloquea: devuelve igual la siguiente secuencia", () => {
  const disco: AlmacenLocal = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(siguienteSecuenciaDispositivo(disco), 1, "el hecho ya ocurrió (§4.2): el almacén lleno no lo tumba");
});
