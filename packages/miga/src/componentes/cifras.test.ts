import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// AC-H0-03: `prueba-arnes.sh` hacía `grep -rq "tabular-nums" packages/miga/src` — eso
// comprueba que la cadena existe UNA VEZ en cualquier parte del árbol, no que CADA componente que
// muestra una cifra de dinero o peso la use. Un mutante que la borre de un componente
// mientras sigue viva en otro sobrevive a ese grep sin que nadie se entere.
//
// Se lista cada componente que renderiza una cifra (kg o CLP) y se exige la propiedad
// EN SU PROPIO archivo. Se descartan las líneas `//` antes de buscar — el comentario de
// CifraGrande.tsx menciona "tabular-nums" explicando por qué existe, y un chequeo sobre
// el texto crudo se dispararía contra su propia documentación en vez de contra el CSS.
//
// Límite honesto: esta es una lista enumerada, no un escaneo del árbol. Un componente
// NUEVO que muestre cifras y no esté en `COMPONENTES_CON_CIFRAS` no lo cubre este test
// — hay que agregarlo a mano. Preferible a la falsa sensación de cobertura de un grep
// que "pasa" sin haber mirado nada en particular.
const COMPONENTES_CON_CIFRAS = ["CifraGrande.tsx", "TecladoNumerico.tsx"];

const DIR = dirname(fileURLToPath(import.meta.url));

function codigoSinComentarios(archivo: string): string {
  const fuente = readFileSync(join(DIR, archivo), "utf8");
  return fuente.replace(/^\s*\/\/.*$/gm, "");
}

for (const archivo of COMPONENTES_CON_CIFRAS) {
  test(`${archivo}: la cifra usa tabular-nums en su propio código, no solo en el árbol [AC-H0-03]`, () => {
    const codigo = codigoSinComentarios(archivo);
    assert.match(
      codigo,
      /tabular-nums/,
      `${archivo} no tiene tabular-nums en su código (fuera de comentarios) — una cifra ahí se leería con el ancho de fuente normal`
    );
  });
}

test("la lista de componentes con cifras no quedó vacía por error", () => {
  assert.ok(COMPONENTES_CON_CIFRAS.length > 0);
});
