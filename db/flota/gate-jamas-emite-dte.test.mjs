import test from "node:test";
import assert from "node:assert/strict";
import { emisionesEn, sinComentarios, CAPACIDADES } from "./gate-jamas-emite-dte.mjs";

// Mutantes del gate que impide emitir DTEs [AC-FRUT-08] — §7.3, art. 97 N°4 CT.
//
// Un gate que nunca se pone rojo es peor que no tenerlo. Cada caso de acá es una forma REAL en
// que la capacidad de emitir entraría al árbol —siempre con buena intención, siempre llamada de
// otra manera— y cada uno tiene su gemelo legítimo que NO puede rebotar: leer el TED de un papel
// y teclear un folio es exactamente lo que el andén hace, y si el gate lo mordiera, la primera
// respuesta sería apagarlo.

test("generar un folio se detecta", () => {
  assert.equal(emisionesEn("const folio = generarFolio(tipo);").length, 1);
});

test("y sus otros nombres: crear, asignar, siguiente", () => {
  for (const linea of [
    "const f = crearFolio();",
    "await asignarFolioAlDocumento(id);",
    "const n = siguienteFolio(caf);",
  ]) {
    assert.ok(emisionesEn(linea).length > 0, linea);
  }
});

test("construir el TED se detecta, que es fabricar la prueba criptográfica", () => {
  assert.ok(emisionesEn("const ted = construirTed(datos);").length > 0);
  assert.ok(emisionesEn("function armarTed(dte) {}").length > 0);
});

test("armar el XML del SII se detecta aunque no se envíe", () => {
  // Lo que existe termina usándose: el árbol no puede tener la máquina de emitir «apagada».
  assert.ok(emisionesEn("const xml = generarDTE(encargo);").length > 0);
  assert.ok(emisionesEn("const plantilla = `<Documento id=1>`;").length > 0);
});

test("el CAF se detecta: es el archivo con el que el SII autoriza a emitir", () => {
  assert.ok(emisionesEn("const caf = leerArchivoAutorizacion();").length > 0);
});

// ─── Los gemelos legítimos: capturar NO es emitir ───────────────────────────────────

test("un genérico de TypeScript NO es un XML del SII", () => {
  // `Promise<Documento[]>` aparece en medio archivo del servidor. Morderlo enseñaría a apagar el
  // gate el primer día, y un gate apagado no protege de nada.
  assert.deepEqual(emisionesEn("export async function ver(): Promise<Documento[]> {}"), []);
  assert.deepEqual(emisionesEn("const x: Array<Documento> = [];"), []);
});

test("LEER el folio del papel es la conducta correcta y no rebota", () => {
  for (const linea of [
    "const folio = cuerpo.folio;",
    "const { tipo, folio, emisor } = datos;",
    "await asociarDocumento(pool, sesion, { tipo, folio, emisor });",
    "escanearTedDelPapel(imagen);",
  ]) {
    assert.deepEqual(emisionesEn(linea), [], linea);
  }
});

test("nombrar la prohibición en un comentario es obligatorio, y no puede rebotar", () => {
  const codigo = `// La app JAMÁS hace generarFolio ni construirTed: solo referencia (§7.3).
const folio = cuerpo.folio;`;
  assert.deepEqual(emisionesEn(codigo), []);
});

test("ni dentro de un bloque, que es donde va la explicación larga", () => {
  const codigo = `/* Emitir un DTE exige CAF y firma: generarDTE no existe acá a propósito. */
const emisor = String(cuerpo.emisor);`;
  assert.deepEqual(emisionesEn(codigo), []);
});

// ─── Que el gate vigile algo, y que sepa decir por qué ─────────────────────────────

test("cada capacidad explica POR QUÉ está prohibida", () => {
  // El día que una se ponga roja, lo primero que va a pensar quien la lea es que el gate se
  // equivocó. El mensaje tiene que ganarle a esa reacción.
  for (const c of CAPACIDADES) {
    assert.ok(c.porque.length > 40, `«${c.nombre}» no explica por qué`);
    assert.ok(c.nombre.length > 0);
  }
});

test("la lista no está vacía: un gate sin patrones sería un verde vacuo", () => {
  assert.ok(CAPACIDADES.length >= 4);
});

test("`sinComentarios` conserva el número de líneas", () => {
  // Si las colapsara, la línea reportada apuntaría a otro lado y quien la reciba buscaría el
  // problema donde no está.
  const texto = "uno\n/* dos\ntres */\ncuatro";
  assert.equal(sinComentarios(texto).split("\n").length, texto.split("\n").length);
});
