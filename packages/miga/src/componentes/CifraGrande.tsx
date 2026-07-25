// La cifra más grande de toda la app (96/700 — PROMPT_MAESTRO.md §5). SIEMPRE
// tabular-nums: es la razón de ser de este componente, no una opción.
export function CifraGrande({ valor, unidad }: { valor: string; unidad?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span
        style={{
          fontSize: 96,
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {valor}
      </span>
      {unidad ? <span style={{ fontSize: 22, fontWeight: 600, color: "#8A8377" }}>{unidad}</span> : null}
    </div>
  );
}
