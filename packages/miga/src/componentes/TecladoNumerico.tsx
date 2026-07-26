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
      {TECLAS.map((tecla) => {
        // Hallazgo menor de la auditoría: en /ingresar y /vincular (PIN de 4 dígitos,
        // sin decimales) esta tecla se mostraba apagada y sin poder tocarse — un botón
        // muerto ocupando espacio, con contraste bajo el mínimo. Si no aplica, no se
        // pinta: se deja el hueco vacío para no correr "0" y "⌫" de lugar.
        if (tecla === "," && !permitirDecimal) {
          return <div key={tecla} aria-hidden="true" style={{ minHeight: 64, minWidth: 64 }} />;
        }
        return (
          <button
            key={tecla}
            type="button"
            onClick={() => tocar(tecla)}
            aria-label={tecla === "⌫" ? "Borrar" : tecla}
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
            }}
          >
            {tecla}
          </button>
        );
      })}
    </div>
  );
}
