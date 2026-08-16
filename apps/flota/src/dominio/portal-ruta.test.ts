import test from "node:test";
import assert from "node:assert/strict";
import { esRutaDelPortalCliente } from "./portal-ruta.ts";

// Matcher del namespace `/cliente/*` [AC-FPOR-04] — spec 07 §1, §2.

test("«/cliente» y todo lo que cuelgue de «/cliente/» son del portal", () => {
  for (const url of ["/cliente", "/cliente/", "/cliente/hoy", "/cliente/encargos/123", "/cliente?x=1"]) {
    assert.ok(esRutaDelPortalCliente(url), `«${url}» debería ser del portal`);
  }
});

test("un nombre parecido NO es del portal — el corte es por segmento, no por substring", () => {
  for (const url of ["/clientela", "/cliente-vip", "/clientes", "/", "/hoy", "", null, undefined]) {
    assert.ok(!esRutaDelPortalCliente(url), `«${url}» no debería ser del portal`);
  }
});
