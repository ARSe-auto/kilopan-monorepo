// Mutantes del covering array 2-way [AC-FPOD-18]: el algoritmo es implementación propia (no
// hay binario `pict` que instalar en el runner del motor), así que su corrección se prueba
// acá, no se asume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parsearPict,
  esFilaValida,
  filasValidas,
  paresRequeridos,
  generarCoveringArray,
  generarDocumento,
  sha256Del,
  RUTA_PICT,
} from "./generar-covering-array.mjs";

const PICT_JUGUETE = `
# comentario, se ignora
a: si, no;
b: x, y, z;
if [a] = "si" then [b] <> "z";
`;

test("parsearPict: factores en el orden de declaración, con sus valores", () => {
  const { factores } = parsearPict(PICT_JUGUETE);
  assert.deepEqual(factores, [
    { nombre: "a", valores: ["si", "no"] },
    { nombre: "b", valores: ["x", "y", "z"] },
  ]);
});

test("parsearPict: restricción con <> y con =", () => {
  const { restricciones } = parsearPict(PICT_JUGUETE);
  assert.deepEqual(restricciones, [
    { siFactor: "a", siValor: "si", entoncesFactor: "b", operador: "<>", entoncesValor: "z" },
  ]);
  const { restricciones: conIgual } = parsearPict(`
    a: si, no;
    b: x, y;
    if [a] = "si" then [b] = "x";
  `);
  assert.equal(conIgual[0].operador, "=");
});

test("parsearPict: factor duplicado revienta con mensaje claro", () => {
  assert.throws(() => parsearPict("a: 1, 2;\na: 3, 4;"), /factor duplicado/);
});

test("parsearPict: restricción sobre un factor inexistente revienta", () => {
  assert.throws(() => parsearPict('a: 1, 2;\nif [b] = "1" then [a] <> "1";'), /factor inexistente/);
});

test("parsearPict: línea que no calza ningún patrón revienta", () => {
  assert.throws(() => parsearPict("esto no es ni factor ni restricción"), /no calza ningún patrón/);
});

test("esFilaValida: rebota la combinación que la restricción prohíbe", () => {
  const { restricciones } = parsearPict(PICT_JUGUETE);
  assert.equal(esFilaValida({ a: "si", b: "z" }, restricciones), false);
  assert.equal(esFilaValida({ a: "si", b: "x" }, restricciones), true);
  assert.equal(esFilaValida({ a: "no", b: "z" }, restricciones), true);
});

test("filasValidas: cartesiano completo menos las que la restricción tumba", () => {
  const { factores, restricciones } = parsearPict(PICT_JUGUETE);
  const filas = filasValidas(factores, restricciones);
  // 2×3 = 6 combinaciones totales, menos (a=si,b=z) = 5.
  assert.equal(filas.length, 5);
  assert.ok(!filas.some((f) => f.a === "si" && f.b === "z"));
});

test("paresRequeridos: un par imposible por una cadena de restricciones (no solo directa) queda afuera", () => {
  // a fuerza b (directo); b fuerza c (directo) — el par (a=si, c=z) es imposible por
  // TRANSITIVIDAD, sin que ninguna restricción lo prohíba a él directamente.
  const texto = `
    a: si, no;
    b: x, z;
    c: p, z;
    if [a] = "si" then [b] = "x";
    if [b] = "x" then [c] <> "z";
  `;
  const { factores, restricciones } = parsearPict(texto);
  const filas = filasValidas(factores, restricciones);
  const pares = paresRequeridos(factores, filas);
  assert.equal(pares.has("a=si|c=z"), false, "a=si arrastra b=x arrastra c<>z: el par es transitivamente imposible");
  assert.equal(pares.has("a=no|c=z"), true, "sin la cadena, a=no con c=z sí es alcanzable");
});

test("generarCoveringArray: cubre TODOS los pares requeridos, cero excepciones", () => {
  const { factores, restricciones } = parsearPict(PICT_JUGUETE);
  const { filas } = generarCoveringArray(factores, restricciones);
  const requeridos = paresRequeridos(factores, filasValidas(factores, restricciones));
  const cubiertos = new Set();
  for (const fila of filas) {
    for (let i = 0; i < factores.length; i++) {
      for (let j = i + 1; j < factores.length; j++) {
        const A = factores[i];
        const B = factores[j];
        cubiertos.add(`${A.nombre}=${fila[A.nombre]}|${B.nombre}=${fila[B.nombre]}`);
      }
    }
  }
  for (const llave of requeridos.keys()) {
    assert.ok(cubiertos.has(llave), `el par ${llave} quedó sin cubrir`);
  }
});

test("generarCoveringArray: toda fila generada respeta TODAS las restricciones", () => {
  const { factores, restricciones } = parsearPict(PICT_JUGUETE);
  const { filas } = generarCoveringArray(factores, restricciones);
  for (const fila of filas) assert.ok(esFilaValida(fila, restricciones), JSON.stringify(fila));
});

test("generarDocumento: determinista — dos corridas sobre el mismo texto producen el MISMO array", () => {
  const doc1 = generarDocumento(PICT_JUGUETE);
  const doc2 = generarDocumento(PICT_JUGUETE);
  assert.deepEqual(doc1, doc2);
});

test("generarDocumento: el sha256 cambia si el .pict cambia — la señal que el gate compara", () => {
  const doc1 = generarDocumento(PICT_JUGUETE);
  const doc2 = generarDocumento(`${PICT_JUGUETE}\n# un byte más`);
  assert.notEqual(doc1.shaPict, doc2.shaPict);
});

test("sha256Del: coincide con el vector conocido de sha256('')", () => {
  // Para no confiar ciegamente en la propia implementación: es EL vector público de sha256
  // sobre la cadena vacía, no un valor que este archivo inventó.
  assert.equal(sha256Del(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("MUTANTE: agregar un factor al .pict real sin regenerar cambia el documento", () => {
  const textoReal = readFileSync(RUTA_PICT, "utf8");
  const docReal = generarDocumento(textoReal);
  const conFactorNuevo = `${textoReal}\nfactorNuevo: si, no;\n`;
  const docMutado = generarDocumento(conFactorNuevo);
  assert.notEqual(
    JSON.stringify(docReal),
    JSON.stringify(docMutado),
    "un factor nuevo tiene que producir un documento distinto — si no, el gate no lo detectaría",
  );
  assert.notEqual(docReal.shaPict, docMutado.shaPict);
});

test("el .pict real de la pantalla de parada genera un documento válido y estable", () => {
  const textoReal = readFileSync(RUTA_PICT, "utf8");
  const doc = generarDocumento(textoReal);
  assert.ok(doc.filas.length > 0);
  const { restricciones } = parsearPict(textoReal);
  for (const fila of doc.filas) assert.ok(esFilaValida(fila, restricciones));
  // Estable: generar de nuevo no cambia nada.
  assert.deepEqual(generarDocumento(textoReal), doc);
});
