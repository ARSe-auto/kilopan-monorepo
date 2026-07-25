// Sistema de diseño "Miga" — tokens (PROMPT_MAESTRO.md §5). Un solo archivo, cero
// duplicación: cualquier componente de apps/kilopan importa de aquí, nunca hardcodea
// un hex o un tamaño de fuente. Reusado ÍNTEGRO por apps/flota (KiloRuta) cuando exista,
// salvo el acento (ver `acentos`).

export const acentos = {
  kilopan: "#C2410C", // "corteza"
  kiloruta: "#1D4ED8", // "ruta" — reservado para apps/flota
} as const;

export const semantico = {
  ok: "#15803D",
  alerta: "#B45309",
  error: "#B91C1C",
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

export const grilla = { base: 8, radio: 12 } as const;

// Ningún target de toque puede ser menor a esto, en ninguna pantalla (AA, gate lo mide).
export const targetMinimo = { anchoPt: 44, altoPt: 44, separacionMinimaPx: 8 } as const;

// Toda cifra (kg o CLP) debe rendirse con esta propiedad — es lo que el test de
// abajo verifica sobre las funciones de formato de `apps/kilopan/src/comun/formato.ts`.
export const tabularNums = "tabular-nums" as const;
