// Sistema de diseño "Miga" — tokens (PROMPT_MAESTRO.md §5). Un solo archivo, cero
// duplicación: cualquier componente de apps/kilopan importa de aquí, nunca hardcodea
// un hex o un tamaño de fuente. Reusado ÍNTEGRO por apps/flota (KiloRuta) cuando exista,
// salvo el acento (ver `acentos`).
//
// Este archivo es la CARA KiloPan de Miga: paleta, escala tipográfica y superficies de
// esta app. Los tokens ESTRUCTURALES de plataforma —los que §5.1 del maestro de FLOTA
// declara constantes NO configurables— viven en `estructura.ts`, derivados de la familia
// canónica del §0. Lo que acá abajo coincide con esa familia (la grilla) se IMPORTA de
// ella en vez de repetirse: dos copias del mismo 8 son una divergencia con fecha [AC-FMIG-01].
import { GRILLA } from "../../nucleo-comun/src/constants.ts";

export const acentos = {
  kilopan: "#C2410C", // "corteza"
  kiloruta: "#1D4ED8", // "ruta" — reservado para apps/flota
} as const;

export const semantico = {
  ok: "#15803D",
  alerta: "#B45309",
  error: "#B91C1C",
} as const;

// "Solo modo claro en el MVP" (PROMPT_MAESTRO.md §5) — literal, no una omisión: estos
// valores se aplican explícitos en el layout raíz (+ color-scheme: light) para que la
// app no herede el modo oscuro del navegador/SO. Un fondo/texto sin fijar en una PWA
// que corre en tablets con distintos temas del sistema es exactamente el tipo de bug
// invisible en el código y roto en la pantalla real (encontrado así, no por lectura).
export const superficie = {
  fondo: "#F5F3EF",
  tarjeta: "#FFFFFF",
  texto: "#1B1712",
  textoDim: "#5B564C",
  // Hallazgo de la auditoría: #8A8377 daba 3.39:1 sobre `fondo` y 3.75:1 sobre
  // `tarjeta` — bajo el mínimo que WCAG AA exige para texto normal (`CONTRASTE.texto`
  // de la familia canónica; esto se usa en tamaños de pie, muy por debajo del umbral
  // de "texto grande", que se conforma con menos). Mismo matiz, oscurecido lo justo
  // para cruzar ese mínimo contra los dos fondos.
  textoFaint: "#746E64",
  hairline: "rgba(27,23,18,.14)",
} as const;

// Escala tipográfica. "pesoBascula" es la cifra más grande de toda la app — la que
// se lee desde medio metro con las manos ocupadas.
export const tipografia = {
  pesoBascula: { tamano: 96, peso: 700 },
  display: { tamano: 34, peso: 700 },
  titulo: { tamano: 22, peso: 600 },
  cuerpo: { tamano: 17, peso: 400 },
  pie: { tamano: 13, peso: 400 },
} as const;

// Derivada, no copiada: la grilla es un token ESTRUCTURAL de plataforma (§5.1) y su
// valor manda desde la familia canónica del §0 [AC-FMIG-01].
export const grilla = { base: GRILLA.base_px, radio: GRILLA.radio_tarjeta_px } as const;

/** Pesos de ÉNFASIS de un control. No son la escala ni la cifra operativa: un chip o un
 *  botón en negrita comparte el 700 con `CIFRA_OPERATIVA.peso` por coincidencia, no por
 *  significado. Se nombran acá para que un componente no los escriba a mano [AC-FMIG-01]. */
export const enfasis = { medio: 600, fuerte: 700 } as const;

// Ningún target de toque puede ser menor a esto, en ninguna pantalla (AA, gate lo mide).
export const targetMinimo = { anchoPt: 44, altoPt: 44, separacionMinimaPx: 8 } as const;

// Toda cifra (kg o CLP) debe rendirse con esta propiedad — es lo que el test de
// abajo verifica sobre las funciones de formato de `apps/kilopan/src/comun/formato.ts`.
export const tabularNums = "tabular-nums" as const;
