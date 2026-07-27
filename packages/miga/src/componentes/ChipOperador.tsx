// Pieza visual del chip de operador (AC-ID-07). Quién lo rellena y cuándo aparece vive en
// apps/kilopan/src/app/EncabezadoConOperador.tsx: acá no se lee sesión ni cookies, para que
// Miga siga siendo sistema de diseño puro y no arrastre identidad.
export function ChipOperador({ nombre }: { nombre: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 100,
        fontSize: 13,
        fontWeight: 700,
        background: "rgba(194,65,12,.13)",
        color: "#C2410C",
      }}
    >
      <span>👤</span>
      <span>{nombre}</span>
    </div>
  );
}
