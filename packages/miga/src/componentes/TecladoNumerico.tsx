// Teclado numérico PROPIO — jamás el teclado del sistema (PROMPT_MAESTRO.md §5).
// Teclas >=64px (manos con harina/guantes). Coma es-CL como separador decimal.
const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"] as const;

export function TecladoNumerico({
  valor,
  onCambiar,
  permitirDecimal = false,
}: {
  valor: string;
  onCambiar: (nuevoValor: string) => void;
  permitirDecimal?: boolean;
}) {
  function tocar(tecla: string) {
    if (tecla === "⌫") {
      onCambiar(valor.slice(0, -1));
      return;
    }
    if (tecla === ",") {
      if (!permitirDecimal || valor.includes(",")) return;
      onCambiar(valor.length === 0 ? "0," : valor + ",");
      return;
    }
    onCambiar(valor === "0" ? tecla : valor + tecla);
  }

  return (
    <div
      role="group"
      aria-label="Teclado numérico"
      style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}
    >
      {TECLAS.map((tecla) => (
        <button
          key={tecla}
          type="button"
          onClick={() => tocar(tecla)}
          disabled={tecla === "," && !permitirDecimal}
          aria-label={tecla === "⌫" ? "Borrar" : tecla === "," ? "Coma decimal" : tecla}
          style={{
            minHeight: 64,
            minWidth: 64,
            fontSize: 24,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            borderRadius: 12,
            border: "1px solid rgba(27,23,18,.14)",
            background: "#FFFFFF",
            color: "#1B1712",
            opacity: tecla === "," && !permitirDecimal ? 0.35 : 1,
          }}
        >
          {tecla}
        </button>
      ))}
    </div>
  );
}
