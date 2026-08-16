import type { Page } from "@playwright/test";

// Trazas de frame-timing de laboratorio [AC-FMIG-19] — §5.7: "<1 s por interacción" y
// "transiciones 60 fps" son, con esas palabras, "gate de CI" (§9.2: solo lo CI cierra el
// loop). Mismo precedente que `presupuesto-perf.mjs` (AC-PERF-04) para "Lighthouse": este
// repo no trae la dependencia de Lighthouse (Chrome headless de sobra, puntaje que mezcla
// SEO con lo que importa), así que se mide directamente lo que Lighthouse mediría por
// debajo — frames pintados y latencia de interacción — con `requestAnimationFrame`, sin
// el binario.
//
// SALTO MÁXIMO, no promedio de fps: un headless Chromium en CI subsamplea distinto según
// la carga de la máquina que lo corre, y promediar fps convertiría ese ruido de infraestructura
// en un rebote que no tiene nada que ver con el producto. El SALTO entre dos frames
// consecutivos sí es una señal real: un salto grande es la firma de un frame perdido
// (jank) — trabajo síncrono bloqueando el hilo principal durante la transición — y eso
// SÍ es responsabilidad del código que este gate vigila.

export type MedicionFrameTiming = {
  /** Del disparo de la interacción a que el destino esté visible (§5.7: "<1s por interacción"). */
  latenciaMs: number;
  /** Cuántos frames se pintaron durante la ventana — 0/1 significa que no hubo nada que medir. */
  frames: number;
  /** El mayor hueco entre dos frames consecutivos — la firma del jank, no el promedio. */
  saltoMaximoMs: number;
};

/** ≈6 frames perdidos seguidos a 60 fps: muy por encima del jitter normal de un headless
 *  Chromium en CI, y muy por debajo de lo que un chofer notaría como "se congeló". */
export const UMBRAL_SALTO_FRAME_MS = 100;
/** El número literal del §5.7. */
export const UMBRAL_LATENCIA_MS = 1000;

/**
 * Mide una transición real de la UI: arranca un contador de `requestAnimationFrame` en la
 * PROPIA página antes de disparar la interacción, dispara, espera a que `esperarListo`
 * resuelva (la condición que prueba que la transición terminó), y devuelve la latencia
 * real y el salto máximo entre frames durante esa ventana.
 */
export async function medirTransicion(
  page: Page,
  disparar: () => Promise<void>,
  esperarListo: () => Promise<unknown>,
): Promise<MedicionFrameTiming> {
  await page.evaluate(() => {
    const w = window as unknown as { __framesMiga?: number[]; __detenerFramesMiga?: () => void };
    w.__framesMiga = [];
    let activo = true;
    w.__detenerFramesMiga = () => {
      activo = false;
    };
    function loop(t: number) {
      if (!activo) return;
      w.__framesMiga!.push(t);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  });

  const inicio = Date.now();
  await disparar();
  await esperarListo();
  const latenciaMs = Date.now() - inicio;

  const frames: number[] = await page.evaluate(() => {
    const w = window as unknown as { __framesMiga?: number[]; __detenerFramesMiga?: () => void };
    w.__detenerFramesMiga?.();
    return w.__framesMiga ?? [];
  });

  let saltoMaximoMs = 0;
  for (let i = 1; i < frames.length; i++) {
    saltoMaximoMs = Math.max(saltoMaximoMs, frames[i]! - frames[i - 1]!);
  }

  return { latenciaMs, frames: frames.length, saltoMaximoMs };
}
