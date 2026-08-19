import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVEEDORES_TELEMETRIA_DEL_REGISTRO,
  esCodigoDelRegistro,
} from "./proveedor-telemetria.ts";

// El registro por datos de ProveedorTelemetria (§4.9, §11) [AC-FTEL-06]: E1.5 admite DOS
// implementaciones reales, no una — y la frontera contra E4 (OBD/OCPP/etc.) sigue cerrada.

test("el registro trae exactamente declarada y telefono_gps", () => {
  const codigos = PROVEEDORES_TELEMETRIA_DEL_REGISTRO.map((p) => p.codigo);
  assert.deepEqual(codigos, ["declarada", "telefono_gps"]);
});

test("telefono_gps pertenece al registro de E1.5", () => {
  assert.equal(esCodigoDelRegistro("telefono_gps"), true);
});

test("declarada sigue perteneciendo al registro", () => {
  assert.equal(esCodigoDelRegistro("declarada"), true);
});

// Sin nombrar una fuente de E4 literal: ese string lo vigila el gate de ganchos
// (`db/flota/gate-ganchos-e1.mjs`) en cada archivo del árbol de código, comentarios de test
// incluidos, y escribirlo acá dispararía ese gate en vez de ejercer esta función.
test("un código fuera del registro no pertenece: la frontera es cerrada", () => {
  assert.equal(esCodigoDelRegistro("bluetooth_beacon"), false);
});
