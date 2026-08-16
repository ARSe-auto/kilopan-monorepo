import { superficie } from "./estructura.ts";
import { CONTRASTE } from "../../nucleo-comun/src/constants.ts";

// Theming por filas — la MITAD de plataforma del §5.1 [AC-FMIG-02].
//
// «El tenant personaliza EXACTAMENTE tres cosas: logo, UN acento y terminología. La
// plataforma DERIVA pressed/disabled/dark y RECHAZA si el contraste queda por debajo del
// mínimo de CONTRASTE.texto» (§5.1, §4.4). Este archivo es la mitad que deriva; la que
// rechaza es `tenant_theme` (0010_tema_y_terminologia.sql,
// AC-FTEN-10) — su trigger valida `accent_claro` contra `fondo_claro` y `accent_oscuro`
// contra `fondo_oscuro` con la MISMA fórmula WCAG de acá abajo, así que este módulo NUNCA
// decide solo si un tema entra: propone, y la base es la autoridad (AGENTS.md «la BD es la
// autoridad»). Duplicar la fórmula acá no es reimplementar una regla de negocio: es la
// misma norma pública (WCAG 2.x) que la app necesita ANTES de golpear la base, para no
// gastar un viaje de red en un color que la base va a rechazar de todas formas — la base
// vuelve a calcular el mismo número con su propia `contraste_wcag()` y es la que manda.
//
// ─── POR QUÉ LA DERIVACIÓN ES UN DESPLAZAMIENTO FIJO, NO UNA BÚSQUEDA HASTA PASAR ─────────
//
// Mezclar hacia negro (o blanco) SIEMPRE encuentra un punto que cruza el mínimo de
// CONTRASTE.texto — en el extremo, negro puro contra blanco da 21:1. Una derivación que
// buscara «hasta que pase» jamás rebotaría: cualquier acento entraría, aunque el resultado
// ya no se pareciera en nada a la marca del tenant. Eso volvería el caso de rebote del AC
// —«accent_color con contraste por debajo de CONTRASTE.texto ⇒ 422»— IMPOSIBLE de alcanzar,
// y un caso de rebote que no se puede alcanzar es un caso que no está probado. Por eso la
// plataforma mueve el acento un tramo FIJO hacia cada
// fondo (menos para el claro, que ya parte con más margen contra blanco; más para el
// oscuro, porque `#101314` es casi negro) y santo remedio: si ni con ese tramo alcanza, el
// tenant eligió un acento demasiado pálido para ser texto/botón y la plataforma no le va a
// desfigurar la marca para forzarlo — se lo dice con un 422 y elige otro.
const TRAMO_CLARO = 0.16;
const TRAMO_OSCURO = 0.34;

const HEX = /^#[0-9a-fA-F]{6}$/;

function partes(hex: string): [number, number, number] {
  if (!HEX.test(hex)) {
    throw new Error(`color inválido: «${hex}» — se espera #rrggbb`);
  }
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function aHex(canales: readonly [number, number, number]): string {
  return `#${canales.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Luminancia relativa WCAG 2.x — misma fórmula que `luminancia_relativa()` en la BD. */
export function luminanciaRelativa(hex: string): number {
  const [r, g, b] = partes(hex);
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const canal = c / 255;
    return canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

/** Contraste WCAG entre dos `#rrggbb` — misma fórmula que `contraste_wcag()` en la BD. */
export function contrasteWcag(a: string, b: string): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mezcla lineal de dos colores: `t=0` da `a`, `t=1` da `b`. */
export function mezclar(a: string, b: string, t: number): string {
  const pa = partes(a);
  const pb = partes(b);
  return aHex(pa.map((c, i) => c + (pb[i]! - c) * t) as [number, number, number]);
}

/** El acento, oscurecido el tramo fijo para servir de texto/botón sobre un fondo CLARO. */
export function oscurecer(hex: string, tramo: number = TRAMO_CLARO): string {
  return mezclar(hex, "#000000", tramo);
}

/** El acento, aclarado el tramo fijo para servir de texto/botón sobre un fondo OSCURO. */
export function aclarar(hex: string, tramo: number = TRAMO_OSCURO): string {
  return mezclar(hex, "#ffffff", tramo);
}

export type TemaDerivado = {
  accentColor: string;
  accentClaro: string;
  fondoClaro: string;
  accentOscuro: string;
  fondoOscuro: string;
};

/**
 * Lo que la plataforma DERIVA de un acento (§5.1): las dos variantes, cada una con el fondo
 * NEUTRO de plataforma contra el que se valida (Pregunta al dueño 7). No valida nada — eso
 * es de la fila que la base rechaza o acepta; esto solo propone la fila.
 */
export function derivarTema(accentColor: string): TemaDerivado {
  if (!HEX.test(accentColor)) {
    throw new Error(`color inválido: «${accentColor}» — se espera #rrggbb`);
  }
  return {
    accentColor,
    accentClaro: oscurecer(accentColor),
    fondoClaro: superficie.claro.fondo,
    accentOscuro: aclarar(accentColor),
    fondoOscuro: superficie.oscuro.fondo,
  };
}

/**
 * El acento ANTES de que el tenant personalice nada (§4.4: `tenant_theme` nace sin fila; el
 * wizard y el panel admin blanco-etiqueta son del hito g, no de este AC). Es el MISMO para
 * cualquier tenant sin tema propio, así que servirlo no es una excepción a «cero forks por
 * cliente» (§5.1): es lo que el bootstrap sirve mientras no haya una fila que lo reemplace.
 * `#1D4ED8` es el acento «kiloruta» que `tokens.ts` ya reserva para esta app.
 */
export const ACENTO_DEFECTO_PLATAFORMA = "#1D4ED8";
export const TEMA_DEFECTO: TemaDerivado = derivarTema(ACENTO_DEFECTO_PLATAFORMA);

/**
 * Lo mismo que valida `tenant_theme_contraste` en la BD, calculado acá para que la UI pueda
 * anticipar el 422 sin golpear la base primero. NO es la autoridad — la base recalcula esto
 * mismo con `contraste_wcag()` y es su veredicto el que manda.
 */
export function contrastesSuficientes(tema: TemaDerivado): boolean {
  return (
    contrasteWcag(tema.accentClaro, tema.fondoClaro) >= CONTRASTE.texto &&
    contrasteWcag(tema.accentOscuro, tema.fondoOscuro) >= CONTRASTE.texto
  );
}

/**
 * Pressed/disabled: la OTRA mitad de «la plataforma deriva pressed/disabled/dark» (§5.1).
 * No son una cuarta personalización ni una cuarta fila — `tenant_theme` solo guarda logo,
 * acento y extras (§4.4) — así que se calculan acá, en el momento de servir el bootstrap, y
 * nunca se persisten. Pressed oscurece (claro) o aclara (oscuro) contra el propio acento del
 * modo; disabled mezcla el acento con SU fondo, que es lo que lo lava hacia «apagado» sin
 * importar si el modo es claro u oscuro.
 */
export function variantesDeModo(acento: string, fondo: string, hacia: "negro" | "blanco") {
  const extremo = hacia === "negro" ? "#000000" : "#ffffff";
  return {
    acento,
    acentoPressed: mezclar(acento, extremo, 0.18),
    acentoDisabled: mezclar(acento, fondo, 0.55),
    fondo,
  };
}

/** Las variables CSS que el bootstrap inyecta, por modo. Nombres estables: son el contrato
 *  que consumen los componentes de terreno de `packages/miga`. */
export const PROPIEDAD_CSS = {
  acento: "--miga-acento",
  acentoPressed: "--miga-acento-pressed",
  acentoDisabled: "--miga-acento-disabled",
  fondo: "--miga-fondo",
} as const;

/**
 * El bloque `<style>` que el bootstrap sirve (§5.1: «CSS custom properties desde el
 * bootstrap»; §5.7: «dark mode automático de serie»). El modo oscuro es
 * `@media (prefers-color-scheme: dark)` — nunca una clase ni un toggle de JS: los turnos
 * parten de madrugada y el modo lo decide el sistema operativo, no un clic.
 *
 * REGLA ESTÁTICA del caso de rebote (b) del AC: esta función es la ÚNICA fuente del CSS que
 * el bootstrap sirve, y sus únicas entradas son las CUATRO columnas de `tenant_theme`
 * (logo, acento, extras — el logo y los extras no entran acá porque no son custom
 * properties de color) más los fondos de plataforma. No hay parámetro de CSS libre: quien
 * llame a esto no puede colarle una propiedad ni una regla que no sea una de las cuatro de
 * `PROPIEDAD_CSS`.
 */
export function cssDelTema(tema: TemaDerivado): string {
  const claro = variantesDeModo(tema.accentClaro, tema.fondoClaro, "negro");
  const oscuro = variantesDeModo(tema.accentOscuro, tema.fondoOscuro, "blanco");
  const linea = (v: ReturnType<typeof variantesDeModo>) =>
    (Object.keys(PROPIEDAD_CSS) as (keyof typeof PROPIEDAD_CSS)[])
      .map((clave) => `${PROPIEDAD_CSS[clave]}: ${v[clave]};`)
      .join(" ");
  return (
    `:root { color-scheme: light dark; ${linea(claro)} }\n` +
    `@media (prefers-color-scheme: dark) {\n  :root { ${linea(oscuro)} }\n}`
  );
}
