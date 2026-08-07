// verifica-es-cl.test.mjs — mata los mutantes que verifica-es-cl.mjs existe para
// atrapar (AC-H0-09: es-CL verificado por grep de gate, RUT validado al escribir, cero
// strings visibles en inglés). Ejerce revisarArchivo() directo, sin tocar disco: el
// bug real que motivó este AC — MapaPodsDia.tsx formateando kg a mano con
// `.toFixed(1)` — es el primer caso que este test reproduce y mata.
import { test } from "node:test";
import assert from "node:assert/strict";
import { revisarArchivo, faltaRutEnVivo, EXCLUIR_DE_TODO } from "./verifica-es-cl.mjs";

test("revisarArchivo: atrapa gramos/1000 formateado a mano (el bug real de MapaPodsDia.tsx)", () => {
  const codigo = '{pod.gramos_entregados ? `${(pod.gramos_entregados / 1000).toFixed(1)} kg` : "Sin peso"}';
  const violaciones = revisarArchivo("X.tsx", codigo, false);
  assert.ok(violaciones.some((v) => v.motivo.includes("formatearKg")));
});

test("revisarArchivo: atrapa CLP armado a mano con `$${…}`", () => {
  const codigo = "const texto = `$${total}`;";
  const violaciones = revisarArchivo("X.tsx", codigo, false);
  assert.ok(violaciones.some((v) => v.motivo.includes("formatearClp")));
});

test("revisarArchivo: atrapa fecha armada a mano con getMonth()+1", () => {
  const codigo = "const mm = fecha.getMonth() + 1;";
  const violaciones = revisarArchivo("X.tsx", codigo, false);
  assert.ok(violaciones.some((v) => v.motivo.includes("formatearFecha")));
});

test("revisarArchivo: atrapa toLocaleDateString() sin locale es-CL explícito", () => {
  const conLocale = revisarArchivo("X.tsx", 'x.toLocaleDateString("es-CL")', false);
  const sinLocale = revisarArchivo("X.tsx", "x.toLocaleDateString()", false);
  assert.equal(conLocale.length, 0);
  assert.ok(sinLocale.some((v) => v.motivo.includes("es-CL")));
});

test("revisarArchivo: atrapa strings visibles en inglés entre > y <", () => {
  const violaciones = revisarArchivo("X.tsx", "<button>Cancel</button>", false);
  assert.ok(violaciones.some((v) => v.motivo.includes("inglés")));
});

test("revisarArchivo: NO marca español legítimo como inglés (sin falsos positivos)", () => {
  const violaciones = revisarArchivo("X.tsx", "<button>Cancelar</button>", false);
  assert.equal(violaciones.length, 0);
});

test("revisarArchivo: comun/formato.ts, peso.ts y valida_rut.ts quedan exentos de los checks de bypass", () => {
  assert.ok(EXCLUIR_DE_TODO.test("apps/kilopan/src/comun/formato.ts"));
  const codigo = "const texto = `$${total}`;";
  const violaciones = revisarArchivo("apps/kilopan/src/comun/formato.ts", codigo, true);
  assert.equal(violaciones.length, 0, "el propio formatearClp() usa este patrón legítimamente");
});

test("faltaRutEnVivo: input de RUT sin estadoRut() es una violación", () => {
  assert.equal(faltaRutEnVivo('<input placeholder="RUT (ej: 12.345.678-5)" />'), true);
});

test("faltaRutEnVivo: input de RUT CON estadoRut() en el archivo no viola nada", () => {
  const contenido = '<input placeholder="RUT" />\n{estadoRut(nuevoRut) === "invalido" ? <p>RUT inválido</p> : null}';
  assert.equal(faltaRutEnVivo(contenido), false);
});

test("faltaRutEnVivo: archivo sin campo de RUT no aplica", () => {
  assert.equal(faltaRutEnVivo('<input placeholder="Razón social" />'), false);
});
