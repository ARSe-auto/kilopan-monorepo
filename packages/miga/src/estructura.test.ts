import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { primitivo, semantico, componente, CAPAS } from "./estructura.ts";
import {
  TIPOGRAFIA,
  GRILLA,
  TACTIL,
  CIFRA_OPERATIVA,
  CONTRASTE,
} from "../../nucleo-comun/src/constants.ts";

// AC-FMIG-01 — entrega del hito 0 (§9.1). Lo que estos casos protegen no es que exista un
// archivo de tokens: es que la escala, la grilla, los targets y la cifra operativa sean
// UNA sola verdad, derivada de la familia canónica del §0, y que la cifra operativa se
// rinda de verdad en el componente que la muestra.
//
// El daño que cierran es concreto: el día que el maestro suba el mínimo táctil, un valor
// copiado a mano en un componente queda viejo y NADIE se entera hasta que un operario con
// guantes no le acierta al botón. Por eso la capa 1 se compara por IDENTIDAD contra
// `constants.ts` en vez de contra un número escrito de nuevo acá.
//
// Lo que este archivo NO aserta, dicho para que nadie lo dé por cubierto: las reglas
// CONDUCTUALES del §5.1 —«una acción primaria por pantalla» y «máx 2 niveles de
// profundidad»— tienen su oráculo en AC-FMIG-21, sobre e2e y sobre el manifest de
// navegación. Publicar una constante no puede fallar (§5, encabezado); esas reglas sí.

// Mismo override que `cifras.test.ts`: `prueba-arnes.sh` ejerce los mutantes contra un
// árbol de juguete en vez de escribir un .tsx de mentira dentro del src/ real.
const DIR_COMPONENTES =
  process.env.MIGA_COMPONENTES_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "componentes");
const fuenteDe = (archivo: string) => readFileSync(join(DIR_COMPONENTES, archivo), "utf8");

// ─── Las 3 capas del §5.1 ─────────────────────────────────────────────────────────────

test("las 3 capas existen, en el orden del §5.1 [AC-FMIG-01]", () => {
  assert.deepEqual(
    [...CAPAS],
    ["primitivo", "semantico", "componente"],
    "la arquitectura de tokens dejó de ser primitivo→semántico→componente"
  );
  for (const capa of [primitivo, semantico, componente]) {
    assert.equal(typeof capa, "object");
    assert.ok(Object.keys(capa).length > 0, "una capa quedó vacía — no publicaría nada");
  }
});

test("los tokens estructurales NO son configurables: cada capa está congelada [AC-FMIG-01]", () => {
  // «Constantes de plataforma NO configurables» (§5.1). El tenant personaliza tres cosas
  // —logo, acento y terminología— y ninguna vive acá. Congelado de verdad, no por promesa:
  // una pantalla que intente ajustar un token tiene que romperse en el acto.
  for (const [nombre, capa] of Object.entries({ primitivo, semantico, componente })) {
    assert.ok(Object.isFrozen(capa), `la capa ${nombre} no está congelada: una pantalla podría mutarla`);
  }
  for (const [nombre, grupo] of Object.entries(componente)) {
    assert.ok(Object.isFrozen(grupo), `componente.${nombre} no está congelado`);
  }
  assert.throws(
    () => {
      "use strict";
      (componente.botonPrimario as { altoMinPx: number }).altoMinPx = 1;
    },
    TypeError,
    "se pudo reescribir el alto del botón primario en caliente"
  );
});

test("la capa primitiva NO copia la familia canónica: la referencia [AC-FMIG-01]", () => {
  // Identidad contra `constants.ts`, no igualdad contra un número escrito otra vez acá:
  // así el test seguiría protegiendo el día que el maestro revise un valor.
  assert.equal(primitivo.fuente, TIPOGRAFIA.familia);
  assert.equal(primitivo.escalaPt, TIPOGRAFIA.escala_pt);
  assert.equal(primitivo.espacioBasePx, GRILLA.base_px);
  assert.equal(primitivo.radioTarjetaPx, GRILLA.radio_tarjeta_px);
  assert.equal(primitivo.radioControl, GRILLA.radio_control);
  assert.equal(primitivo.objetivoOperativoPx, TACTIL.operativo_min);
  assert.equal(primitivo.teclaPx, TACTIL.tecla_min);
  assert.equal(primitivo.botonPrimarioPx, TACTIL.boton_primario);
  assert.equal(primitivo.pisoWcagPx, TACTIL.piso_wcag);
  assert.equal(primitivo.cifraPx, CIFRA_OPERATIVA.tamano_px);
  assert.equal(primitivo.cifraPeso, CIFRA_OPERATIVA.peso);
  assert.equal(primitivo.cifraVarianteNumerica, CIFRA_OPERATIVA.variante_numerica);
  assert.equal(primitivo.contrasteTexto, CONTRASTE.texto);
  assert.equal(primitivo.contrasteUi, CONTRASTE.ui);
  assert.equal(primitivo.contrasteCifra, CONTRASTE.cifra_operativa_y_semaforos);
});

// ─── Los valores que el §5.1 nombra por su número ─────────────────────────────────────

test("la escala es la del §5.1, completa y estrictamente descendente [AC-FMIG-01]", () => {
  // El maestro la escribe con sus cinco peldaños. Pinearlos acá es lo que impide que
  // alguien la recorte o la desordene en silencio; la identidad de arriba impide que se
  // copie. Los dos guardias juntos, no uno.
  const peldanos = [
    semantico.texto.tituloGrande,
    semantico.texto.cuerpo,
    semantico.texto.subtitulo,
    semantico.texto.pie,
    semantico.texto.minimo,
  ];
  assert.deepEqual(peldanos, [34, 17, 15, 13, 11], "la escala iOS del §5.1 cambió de forma");
  for (let i = 1; i < peldanos.length; i++) {
    assert.ok(peldanos[i] < peldanos[i - 1], "la escala perdió el orden descendente");
  }
});

test("la familia es la del SISTEMA: se pinta con el primer frame, sin bajar nada [AC-FMIG-01]", () => {
  // Una webfont en el andén a las 5 AM con 4G malo es una pantalla en blanco mientras baja.
  assert.match(semantico.texto.familia, /system/i, "la familia no arranca por la fuente del sistema");
  assert.ok(semantico.texto.familia.endsWith("sans-serif"), "el stack no termina en una familia genérica");
  assert.doesNotMatch(
    semantico.texto.familia,
    /url\(|https?:|\.woff|\.ttf/i,
    "el stack referencia una webfont: dejaría la pantalla sin texto hasta que baje"
  );
});

test("grilla, esquinas y espaciados del §5.1 [AC-FMIG-01]", () => {
  assert.equal(semantico.espacio.unidad, 8, "la base de la grilla dejó de ser la del §5.1");
  assert.equal(semantico.esquina.tarjeta, 12, "el radio de tarjeta dejó de ser el del §5.1");
  assert.equal(semantico.esquina.control, "capsula", "los controles dejaron de ser cápsula (§5.1)");
  // Todo espacio es múltiplo de la base: un valor suelto desalinea la grilla y nadie lo
  // nota hasta la captura de pantalla.
  for (const [nombre, valor] of Object.entries(semantico.espacio)) {
    assert.equal(valor % semantico.espacio.unidad, 0, `espacio.${nombre} no es múltiplo de la base`);
  }
});

test("los targets táctiles del §0 están ordenados y por sobre el piso WCAG [AC-FMIG-01]", () => {
  assert.equal(componente.objetivoTactil.altoMinPx, 48, "el objetivo táctil operativo cambió");
  assert.equal(componente.tecla.altoMinPx, 64, "la tecla del teclado propio cambió");
  assert.equal(componente.botonPrimario.altoMinPx, 56, "el botón primario cambió de alto");
  assert.equal(componente.objetivoTactil.pisoAbsolutoPx, 24, "el piso WCAG cambió");
  // El orden importa tanto como los valores: una tecla más chica que un target cualquiera
  // significa que el teclado propio dejó de ser el control más fácil de acertar.
  assert.ok(componente.tecla.altoMinPx > componente.botonPrimario.altoMinPx);
  assert.ok(componente.botonPrimario.altoMinPx > componente.objetivoTactil.altoMinPx);
  assert.ok(componente.objetivoTactil.altoMinPx > componente.objetivoTactil.pisoAbsolutoPx);
});

// ─── La cifra operativa: el token Y el componente que lo rinde ────────────────────────

test("el token de cifra operativa es el del §0 [AC-FMIG-01]", () => {
  assert.equal(componente.cifraOperativa.tamanoPx, 96, "la cifra operativa dejó de leerse desde medio metro");
  assert.equal(componente.cifraOperativa.peso, 700);
  assert.equal(componente.cifraOperativa.varianteNumerica, "tabular-nums");
  // Al sol directo, de pie, con el teléfono en una mano: la cifra pide más contraste que
  // el texto corriente.
  assert.ok(componente.cifraOperativa.contrasteMinimo > semantico.contrasteMinimo.texto);
});

test("el componente de cifra operativa RINDE tamaño, peso y tabular-nums [AC-FMIG-01]", () => {
  // Este es el caso que el AC pide que FALLE si falta. No basta con que el token exista:
  // el componente que muestra la cifra tiene que estar atado a él. Se aserta sobre el
  // código real —sin comentarios, para que la prueba no se conforme con su propia
  // documentación— y se exige que las tres propiedades salgan del token, no de un número.
  const codigo = fuenteDe("CifraGrande.tsx")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  assert.match(
    codigo,
    /fontSize:\s*componente\.cifraOperativa\.tamanoPx/,
    "la cifra no toma su tamaño del token: un número a mano se desincroniza del §0"
  );
  assert.match(
    codigo,
    /fontWeight:\s*componente\.cifraOperativa\.peso/,
    "la cifra no toma su peso del token"
  );
  const variante = codigo.match(/fontVariantNumeric:\s*"([^"]+)"/)?.[1];
  assert.ok(variante, "la cifra no declara fontVariantNumeric — los dígitos bailarían al actualizarse");
  // AC-H0-03 exige la cadena literal EN CADA componente con cifras (un mutante que la borre
  // debe morir aunque siga viva en otro archivo). Que ese literal coincida con el token
  // canónico es lo que impide que las dos verdades se separen.
  assert.equal(
    variante,
    componente.cifraOperativa.varianteNumerica,
    "el literal de la cifra y el token canónico divergieron"
  );
});

test("el botón primario es full-width, anclado abajo y respeta la safe-area [AC-FMIG-01]", () => {
  const codigo = fuenteDe("BotonPrimario.tsx")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  assert.equal(componente.botonPrimario.ancho, "100%");
  assert.equal(componente.botonPrimario.anclado, "abajo");
  assert.ok(componente.botonPrimario.respetaSafeArea);
  assert.match(
    codigo,
    /minHeight:\s*componente\.botonPrimario\.altoMinPx/,
    "el botón primario no toma su alto del token"
  );
  assert.match(codigo, /width:\s*componente\.botonPrimario\.ancho/, "el botón primario dejó de ser full-width");
  // Sin esto, en un iPhone con gesture bar el botón queda debajo de la barra: se ve, no se
  // toca. Es el control más importante de la pantalla.
  assert.match(codigo, /safe-area-inset-bottom/, "el botón primario no respeta la safe-area inferior");
});
