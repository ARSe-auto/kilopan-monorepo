"use client";
import { superficie, acentos } from "@kilopan/miga/tokens.ts";

// Indicador de avance DENTRO de una tarea (docs/HANDOFF.md §5.6, prioridad baja: la
// navegación entre pantallas ya la resuelve <SiguientePaso>; esto es solo para que el
// avance dentro de una misma pantalla —Producto → Peso y destino → Confirmado, en
// /pesar y /vender— se vea, no para reemplazar nada del flujo).
export function Pasos({ pasos, actual }: { pasos: string[]; actual: number }) {
  return (
    <div
      aria-hidden
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12 }}
    >
      {pasos.map((p, i) => (
        <span key={p} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              flexShrink: 0,
              background: i <= actual ? acentos.kilopan : superficie.hairline,
            }}
          />
          <span style={{ fontWeight: i === actual ? 700 : 500, color: i === actual ? superficie.texto : superficie.textoFaint }}>
            {p}
          </span>
          {i < pasos.length - 1 ? <span style={{ color: superficie.hairline }}>›</span> : null}
        </span>
      ))}
    </div>
  );
}
