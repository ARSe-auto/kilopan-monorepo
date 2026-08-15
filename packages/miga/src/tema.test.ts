import { test } from "node:test";
import assert from "node:assert/strict";
import {
  luminanciaRelativa,
  contrasteWcag,
  mezclar,
  oscurecer,
  aclarar,
  derivarTema,
  contrastesSuficientes,
  variantesDeModo,
  cssDelTema,
  PROPIEDAD_CSS,
} from "./tema.ts";
import { superficie } from "./estructura.ts";
import { CONTRASTE } from "../../nucleo-comun/src/constants.ts";

// AC-FMIG-02 — theming por filas: la plataforma DERIVA pressed/disabled/dark de un acento y
// RECHAZA si el resultado no cruza el mínimo (§5.1, §4.4). Este archivo prueba la mitad que
// vive en `packages/miga` — la derivación y el CSS que arma el bootstrap—; el rebote 422 de
// verdad (fila que no cambia) lo prueba el e2e contra la base real, porque es la BD quien
// tiene la última palabra (`tenant_theme_contraste`, AC-FTEN-10).

// ─── La fórmula WCAG, contra los mismos valores conocidos que el pgTAP de AC-FTEN-10 ──────

test("contraste WCAG: negro sobre blanco da exactamente 21 [AC-FMIG-02]", () => {
  assert.equal(Number(contrasteWcag("#000000", "#ffffff").toFixed(4)), 21);
});

test("contraste WCAG es simétrico y un color contra sí mismo da 1 [AC-FMIG-02]", () => {
  assert.equal(contrasteWcag("#ffffff", "#000000"), contrasteWcag("#000000", "#ffffff"));
  assert.equal(contrasteWcag("#123456", "#123456"), 1);
});

test("luminancia relativa: negro es 0, blanco es 1 [AC-FMIG-02]", () => {
  assert.equal(luminanciaRelativa("#000000"), 0);
  assert.equal(luminanciaRelativa("#ffffff"), 1);
});

test("un color que no es #rrggbb rebota [AC-FMIG-02]", () => {
  assert.throws(() => luminanciaRelativa("rojo"));
  assert.throws(() => derivarTema("no-es-un-color"));
});

// ─── mezclar / oscurecer / aclarar ─────────────────────────────────────────────────────────

test("mezclar en t=0 da el primer color y en t=1 da el segundo [AC-FMIG-02]", () => {
  assert.equal(mezclar("#1D4ED8", "#000000", 0), "#1d4ed8");
  assert.equal(mezclar("#1D4ED8", "#000000", 1), "#000000");
});

test("oscurecer baja la luminancia y aclarar la sube [AC-FMIG-02]", () => {
  const base = "#1D4ED8";
  assert.ok(luminanciaRelativa(oscurecer(base)) < luminanciaRelativa(base));
  assert.ok(luminanciaRelativa(aclarar(base)) > luminanciaRelativa(base));
});

// ─── derivarTema: la plataforma deriva, la base decide (esto solo anticipa) ───────────────

test("un acento con margen de sobra deriva dos variantes que cruzan el mínimo [AC-FMIG-02]", () => {
  for (const accent of ["#1D4ED8", "#0B6E4F", "#C2410C"]) {
    const tema = derivarTema(accent);
    assert.equal(tema.fondoClaro, superficie.claro.fondo);
    assert.equal(tema.fondoOscuro, superficie.oscuro.fondo);
    assert.ok(
      contrastesSuficientes(tema),
      `${accent}: claro ${contrasteWcag(tema.accentClaro, tema.fondoClaro)} / ` +
        `oscuro ${contrasteWcag(tema.accentOscuro, tema.fondoOscuro)} (mínimo ${CONTRASTE.texto})`,
    );
  }
});

test("un acento demasiado pálido NO alcanza el mínimo ni derivado — el caso de rebote es alcanzable [AC-FMIG-02]", () => {
  // Este es el caso que el AC exige poder rebotar con 422: si la derivación buscara «hasta
  // que pase» en vez de mover un tramo fijo, este caso no existiría — cualquier acento
  // terminaría pasando a fuerza de acercarse a negro puro.
  const tema = derivarTema("#FDF2E9");
  assert.ok(!contrastesSuficientes(tema), "un acento casi blanco tiene que fallar el lado claro");
  assert.ok(
    contrasteWcag(tema.accentClaro, tema.fondoClaro) < CONTRASTE.texto,
    "específicamente el lado CLARO es el que no cruza",
  );
});

// ─── El CSS que sirve el bootstrap ─────────────────────────────────────────────────────────

test("cssDelTema sirve :root y @media (prefers-color-scheme: dark) — dark mode automático, no un toggle [AC-FMIG-02]", () => {
  const css = cssDelTema(derivarTema("#1D4ED8"));
  assert.match(css, /:root\s*\{/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(css, /\.dark\b|data-theme|classList/, "el modo oscuro lo decide el SO, no una clase");
});

test("las variantes claro/oscuro de un mismo tema difieren — dos modos, no el mismo color repetido [AC-FMIG-02]", () => {
  const tema = derivarTema("#1D4ED8");
  assert.notEqual(tema.accentClaro, tema.accentOscuro);
  const css = cssDelTema(tema);
  const [bloqueClaro, bloqueOscuro] = css.split("@media");
  assert.ok(bloqueClaro!.includes(tema.accentClaro));
  assert.ok(bloqueOscuro!.includes(tema.accentOscuro));
});

test("cssDelTema NUNCA emite una propiedad fuera del contrato de 4 variables [AC-FMIG-02]", () => {
  // Regla estática del caso de rebote (b): el tema entra ÚNICAMENTE como estas custom
  // properties — nada que acepte o sirva CSS arbitrario por tenant.
  const css = cssDelTema(derivarTema("#0B6E4F"));
  const declaraciones = [...css.matchAll(/(--[\w-]+):/g)].map((m) => m[1]);
  const permitidas = new Set(Object.values(PROPIEDAD_CSS));
  for (const prop of declaraciones) assert.ok(permitidas.has(prop!), `propiedad no declarada: ${prop}`);
  // La translucidez Liquid Glass tiene su propio guardián — `db/flota/gate-theming-por-filas.mjs`,
  // que vigila el árbol entero de `packages/miga` incluido este archivo — esa cadena no se repite acá.
});

// ─── Pressed/disabled: derivados, jamás una fila propia (§4.4: solo logo+acento+extras) ───

test("pressed oscurece en modo claro y aclara en modo oscuro; disabled se lava hacia el fondo [AC-FMIG-02]", () => {
  const tema = derivarTema("#1D4ED8");
  const claro = variantesDeModo(tema.accentClaro, tema.fondoClaro, "negro");
  const oscuro = variantesDeModo(tema.accentOscuro, tema.fondoOscuro, "blanco");

  assert.ok(luminanciaRelativa(claro.acentoPressed) < luminanciaRelativa(claro.acento));
  assert.ok(luminanciaRelativa(oscuro.acentoPressed) > luminanciaRelativa(oscuro.acento));

  // Disabled tiene que quedar ENTRE el acento y su propio fondo — «apagado», no otro color.
  const entre = (x: number, a: number, b: number) => x >= Math.min(a, b) && x <= Math.max(a, b);
  assert.ok(
    entre(luminanciaRelativa(claro.acentoDisabled), luminanciaRelativa(claro.acento), luminanciaRelativa(claro.fondo)),
  );
  assert.ok(
    entre(luminanciaRelativa(oscuro.acentoDisabled), luminanciaRelativa(oscuro.acento), luminanciaRelativa(oscuro.fondo)),
  );
});
