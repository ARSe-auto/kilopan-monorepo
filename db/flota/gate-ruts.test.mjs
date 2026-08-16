#!/usr/bin/env node
// Mutantes del gate de RUTs sembrados [AC-FIDN-21] — §7.8.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { revisarArchivo } from "./gate-ruts.mjs";
import { VALIDOS, INVALIDOS_A_PROPOSITO, declarado, normalizar } from "./ruts-sinteticos.mjs";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const DECLARADO = Object.keys(VALIDOS)[0];
/** Se ARMA: escrito literal, este archivo pondría el gate en rojo — o sea, funcionaría. */
const AJENO = `${8}.${"765"}.${"432"}-${1}`;

test("[AC-FIDN-21] el repo real pasa el gate", () => {
  const salida = execFileSync("node", [`${RAIZ}/db/flota/gate-ruts.mjs`], { encoding: "utf8" });
  assert.match(salida, /gate-ruts: VERDE/);
  assert.doesNotMatch(salida, /× 0 archivos/, "el gate no revisó ningún archivo");
});

test("[AC-FIDN-21] un RUT fuera de la lista congelada ⇒ ROJO", () => {
  const problemas = revisarArchivo("x.sql", `insert into personas (rut) values ('${AJENO}');`);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0].rut, AJENO);
  assert.match(problemas[0].motivo, /lista congelada/);
  // El motivo dice las DOS salidas, porque las dos son legítimas según de quién sea el RUT.
  assert.match(problemas[0].motivo, /ruts-sinteticos\.mjs/);
  assert.match(problemas[0].motivo, /persona real/);
});

test("[AC-FIDN-21] un RUT declarado pasa: el gate no es un no-op al revés", () => {
  assert.deepEqual(revisarArchivo("x.sql", `values ('${DECLARADO}')`), []);
  for (const rut of Object.keys(INVALIDOS_A_PROPOSITO)) {
    assert.deepEqual(revisarArchivo("x.ts", `expect(valida("${rut}")).toBe(false)`), [], rut);
  }
});

test("[AC-FIDN-21] el dígito verificador K pasa en las dos cajas", () => {
  // El mismo RUT escrito `-K` y `-k` es el mismo RUT. Un gate que distinguiera obligaría a
  // declarar dos entradas para uno, y la segunda se olvidaría.
  const conK = Object.keys(VALIDOS).find((r) => normalizar(r).endsWith("-K"));
  assert.ok(conK, "la lista no tiene ningún RUT con dígito verificador K que ejercer");
  assert.deepEqual(revisarArchivo("x.ts", `const a = "${conK.toLowerCase()}";`), []);
  assert.ok(declarado(conK.toLowerCase()));
});

test("[AC-FIDN-21] el archivo de la lista no se denuncia a sí mismo", () => {
  // Contiene los RUTs por definición. Sin la exención, el gate sería rojo para siempre desde
  // el primer commit — y el arreglo cómodo sería borrar la lista.
  const contenido = Object.keys(VALIDOS).map((r) => `"${r}": "razón",`).join("\n");
  assert.ok(revisarArchivo("db/flota/ruts-sinteticos.mjs", `${contenido}\n"${AJENO}": "x",`, true).length === 0);
  // Y cualquier OTRO archivo sí, aunque se le parezca.
  assert.equal(revisarArchivo("db/flota/otro.mjs", `"${AJENO}": "x",`).length, 1);
});

test("[AC-FIDN-21] el gate señala archivo y línea", () => {
  const [p] = revisarArchivo("db/seed.sql", `-- cabecera\n-- otra\ninsert values ('${AJENO}');`);
  assert.equal(p.archivo, "db/seed.sql");
  assert.equal(p.linea, 3);
});

test("[AC-FIDN-21] una cadena que NO tiene forma de RUT no dispara", () => {
  // Fechas, versiones y montos conviven con los RUTs en los mismos archivos. Un patrón ancho
  // marcaría código sano y alguien apagaría el gate.
  for (const texto of ["1.234.567", "v1.2.3-beta", "$ 1.500.000", "2026-08-09", "00000000-0000-7000-8000-0"]) {
    assert.deepEqual(revisarArchivo("x.ts", texto), [], texto);
  }
});
