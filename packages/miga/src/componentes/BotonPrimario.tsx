// Botón primario full-width 56px, anclado abajo en safe-area (PROMPT_MAESTRO.md §5).
export function BotonPrimario({
  children,
  onClick,
  disabled,
  variante = "acento",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variante?: "acento" | "neutro";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        minHeight: 56,
        borderRadius: 12,
        border: "none",
        fontSize: 17,
        fontWeight: 700,
        color: variante === "acento" ? "#FFFFFF" : "#1B1712",
        background: disabled ? "#B8AFA2" : variante === "acento" ? "#C2410C" : "#E3E1DA",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {children}
    </button>
  );
}
