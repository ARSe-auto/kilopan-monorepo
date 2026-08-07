import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tipografia } from "../tokens.ts";

// AC-H0-08: los tokens de la escala ya existían (`tokens.ts`: `pesoBascula` 96/700) y
// `CifraGrande.tsx` ya los aplicaba — lo que faltaba era la prueba que falle si una
// pantalla se sale de la escala. Dos guardias, no una:
//
// (1) la escala misma es la que el maestro define — completa (los 5 peldaños), sin
//     huecos ni inversiones — para que nadie la reduzca o la desordene en silencio;
// (2) cada componente de Miga que declara un tamaño de fuente lo toma de uno de esos
//     5 peldaños — comparado contra el valor VIVO importado de `tokens.ts`, no contra un
//     número copiado en este archivo, para que la prueba seguiría protegiendo aunque la
//     escala cambie de valores el día que el maestro la revise.

const PELDANOS = ["pesoBascula", "display", "titulo", "cuerpo", "pie"] as const;

test("la escala tiene exactamente sus 5 peldaños — ni de más ni de menos [AC-H0-08]", () => {
  assert.deepEqual(
    Object.keys(tipografia).sort(),
    [...PELDANOS].sort(),
    "la escala tipográfica de Miga cambió de forma sin que el AC-H0-08 se entere"
  );
});

test("la escala es estrictamente descendente — sin huecos ni inversiones [AC-H0-08]", () => {
  const tamanos = PELDANOS.map((p) => tipografia[p].tamano);
  for (let i = 1; i < tamanos.length; i++) {
    assert.ok(
      tamanos[i] < tamanos[i - 1],
      `${PELDANOS[i]} (${tamanos[i]}) no es menor que ${PELDANOS[i - 1]} (${tamanos[i - 1]}) — la escala perdió el orden`
    );
  }
});

// El valor que el AC nombra explícitamente como referencia — la cifra más grande de toda
// la app, la que se lee desde medio metro con las manos ocupadas.
test("pesoBascula sigue siendo 96/700 — la cifra que se lee desde medio metro [AC-H0-08]", () => {
  assert.equal(tipografia.pesoBascula.tamano, 96);
  assert.equal(tipografia.pesoBascula.peso, 700);
});

const DIR = process.env.MIGA_COMPONENTES_DIR ?? dirname(fileURLToPath(import.meta.url));

function codigoSinComentarios(archivo: string): string {
  const fuente = readFileSync(join(DIR, archivo), "utf8");
  return fuente.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// `index.tsx` es un barril de reexportación pura: no renderiza nada propio, no declara
// tamaños de fuente.
const NO_ES_COMPONENTE = ["index.tsx"];

const TAMANOS_VALIDOS = new Set(PELDANOS.map((p) => tipografia[p].tamano));

test("todo tamaño de fuente hardcodeado en un componente de Miga pertenece a la escala [AC-H0-08]", () => {
  const componentes = readdirSync(DIR).filter((a) => a.endsWith(".tsx") && !NO_ES_COMPONENTE.includes(a));
  assert.ok(componentes.length > 0, "no se encontró ningún componente — la prueba no estaría mirando nada");

  for (const archivo of componentes) {
    const codigo = codigoSinComentarios(archivo);
    // Solo literales numéricos: `fontSize: tipografia.pie.tamano` ya viene del token y no
    // necesita comparación (y "tipografia" no matchea \d+).
    const literales = [...codigo.matchAll(/fontSize:\s*(\d+)/g)].map((m) => Number(m[1]));
    for (const tamano of literales) {
      assert.ok(
        TAMANOS_VALIDOS.has(tamano),
        `${archivo} usa fontSize: ${tamano}, que no pertenece a ningún peldaño de la escala (${[...TAMANOS_VALIDOS].join(", ")})`
      );
    }
  }
});

// El cierre del hueco que dejaría una lista enumerada a mano: un componente nuevo que se
// agregue a `packages/miga/src/componentes` entra automáticamente al barrido de arriba
// porque se lee el directorio, no una lista fija — pero si alguien mueve `NO_ES_COMPONENTE`
// para excluirlo, este test lo delata.
test("la lista de exclusión no tapa componentes reales [AC-H0-08]", () => {
  const enDisco = readdirSync(DIR).filter((a) => a.endsWith(".tsx"));
  for (const excluido of NO_ES_COMPONENTE) {
    const codigo = codigoSinComentarios(excluido);
    assert.doesNotMatch(
      codigo,
      /fontSize:\s*\d+/,
      `${excluido} está en NO_ES_COMPONENTE pero declara un fontSize propio — no puede estar exento`
    );
  }
  assert.ok(enDisco.includes("CifraGrande.tsx"), "el barrido no está mirando el directorio real de componentes");
});
