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
    <div role="radiogroup" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
              flex: "1 1 0",
              minHeight: 44,
              minWidth: 88,
              borderRadius: 12,
              border: activo ? "2px solid #C2410C" : "1px solid rgba(27,23,18,.14)",
              background: activo ? "#C2410C" : "#FFFFFF",
              color: activo ? "#FFFFFF" : "#1B1712",
              fontSize: 15,
              fontWeight: 700,
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
