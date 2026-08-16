"use client";

import { useState, type ButtonHTMLAttributes } from "react";

// Feedback táctil SIMULADO (§5.7): PWA iOS no tiene Vibration API, así que la ÚNICA forma
// de confirmarle al dedo que el toque registró es visual — el control se hunde al
// presionar (scale 0.96) y vuelve al soltar. `BotonTactil` es la superficie ÚNICA que lo
// produce: cualquier `<button>` operativo de `packages/miga` pasa por acá, o el gate de
// AC-FMIG-19 (`feedback-tactil.test.ts`) lo marca en rojo — el mismo patrón que
// `objetivoTactil`/`componente.tecla` ya usan para el tamaño en vez de que cada control
// reinvente su propio mínimo.
export function BotonTactil({ style, onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, ...resto }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const [presionado, setPresionado] = useState(false);
  return (
    <button
      {...resto}
      style={{
        transition: "transform 100ms ease-out",
        transform: presionado ? "scale(0.96)" : "scale(1)",
        ...style,
      }}
      onPointerDown={(e) => {
        setPresionado(true);
        onPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        setPresionado(false);
        onPointerUp?.(e);
      }}
      onPointerLeave={(e) => {
        setPresionado(false);
        onPointerLeave?.(e);
      }}
      onPointerCancel={(e) => {
        setPresionado(false);
        onPointerCancel?.(e);
      }}
    />
  );
}
