import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// AC-H0-03: `prueba-arnes.sh` hacía `grep -rq "tabular-nums" packages/miga/src` — eso
// comprueba que la cadena existe UNA VEZ en cualquier parte del árbol, no que CADA
// componente que muestra una cifra de dinero o peso la use. Un mutante que la borre de un
// componente mientras sigue viva en otro sobrevive a ese grep sin que nadie se entere.
//
// Se lista cada componente que renderiza una cifra (kg o CLP) y se exige la propiedad
// EN SU PROPIO archivo. Se descartan las líneas `//` antes de buscar — el comentario de
// CifraGrande.tsx menciona "tabular-nums" explicando por qué existe, y un chequeo sobre
// el texto crudo se dispararía contra su propia documentación en vez de contra el CSS.
const COMPONENTES_CON_CIFRAS = ["CifraGrande.tsx", "TecladoNumerico.tsx"];

// El resto del padrón, revisado uno por uno: `BotonPrimario` renderiza `children`,
// `ChipOperador` un nombre, `SelectorUnToque` etiquetas de texto y `Copyright` texto fijo
// — ninguno muestra una cifra. `ChipEstadoConexion` sí interpola un número
// (`pendientes`), pero es un CONTADOR de cola, no dinero ni peso, y va embebido en una
// frase corriente, no en una columna que deba alinearse. Fuera del alcance del AC.
const COMPONENTES_SIN_CIFRAS = [
  "BotonPrimario.tsx",
  "ChipEstadoConexion.tsx",
  "ChipOperador.tsx",
  "Copyright.tsx",
  "SelectorUnToque.tsx",
];

// `index.tsx` es un barril de reexportación pura: no renderiza nada propio.
const NO_ES_COMPONENTE = ["index.tsx"];

// Sobrescribible para que `prueba-arnes.sh` pueda ejercer el cierre de abajo contra un
// árbol de juguete, en vez de escribir un `.tsx` de mentira dentro del `src/` real y
// depender de borrarlo bien. Mismo patrón que `KILOPAN_PANEL_DIR` en `packages/metodo`.
const DIR = process.env.MIGA_COMPONENTES_DIR ?? dirname(fileURLToPath(import.meta.url));

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

// El cierre del hueco que dejaba la lista enumerada. Sin esto, un componente NUEVO que
// muestre plata y que nadie agregue a `COMPONENTES_CON_CIFRAS` no lo mira este test ni
// ningún otro: la lista se queda vieja EN SILENCIO, que es exactamente el defecto del
// grep global al que este AC vino a reemplazar. Ahora aparecer en `componentes/` obliga
// a clasificarse; olvidarse pone el gate en rojo con el nombre del archivo.
test("todo componente del padrón está clasificado — la lista no se queda vieja en silencio [AC-H0-03]", () => {
  const enDisco = readdirSync(DIR).filter((a) => a.endsWith(".tsx"));
  const clasificados = [...COMPONENTES_CON_CIFRAS, ...COMPONENTES_SIN_CIFRAS, ...NO_ES_COMPONENTE];
  const sinClasificar = enDisco.filter((a) => !clasificados.includes(a));
  assert.deepEqual(
    sinClasificar,
    [],
    `componente(s) sin clasificar: ${sinClasificar.join(", ")} — si muestra dinero o peso va en COMPONENTES_CON_CIFRAS (y necesita tabular-nums); si no, en COMPONENTES_SIN_CIFRAS con el porqué`
  );
});

// Y el guardia del guardia: si alguien vacía `COMPONENTES_CON_CIFRAS`, el bucle de arriba
// no corre ningún test y la suite pasa en verde sin haber mirado nada.
test("la lista de componentes con cifras no quedó vacía por error", () => {
  assert.ok(COMPONENTES_CON_CIFRAS.length > 0);
});
