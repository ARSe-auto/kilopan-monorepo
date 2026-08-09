import { tipografia, grilla, enfasis } from "../tokens.ts";

// Elegir entre 2-4 opciones en UN toque (destino de pesaje, medio de pago, etc.).
// Ningún estado se comunica solo por color (PROMPT_MAESTRO.md §5): la opción activa
// también lleva check visual (✓) en el texto, no solo un cambio de fondo.
export function SelectorUnToque<T extends string>({
  opciones,
  valor,
  onCambiar,
}: {
  opciones: { valor: T; etiqueta: string }[];
  valor: T | null;
  onCambiar: (v: T) => void;
}) {
  return (
    <div role="radiogroup" style={{ display: "flex", gap: grilla.base, flexWrap: "wrap" }}>
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => onCambiar(o.valor)}
            style={{
              // "1 1 auto" + padding, no "1 1 0": con base 0 las etiquetas largas
              // ("Transferencia", "Fiado (cliente registrado)") se recortaban en el
              // mismo ancho que "Mach". Ahora cada pill crece con su texto y envuelve.
              flex: "1 1 auto",
              minHeight: 44,
              minWidth: 88,
              padding: `${grilla.base}px 14px`,
              borderRadius: grilla.radio,
              border: activo ? "2px solid #C2410C" : "1px solid rgba(27,23,18,.14)",
              background: activo ? "#C2410C" : "#FFFFFF",
              color: activo ? "#FFFFFF" : "#1B1712",
              // AC-H0-08: el tamaño que había acá no pertenecía a la escala tipográfica
              // de Miga — "pie" es el peldaño correcto para la etiqueta de una pill; el peso
              // se mantiene como énfasis propio del control, no de la escala.
              fontSize: tipografia.pie.tamano,
              fontWeight: enfasis.fuerte,
              lineHeight: 1.2,
            }}
          >
            {activo ? "✓ " : ""}
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
