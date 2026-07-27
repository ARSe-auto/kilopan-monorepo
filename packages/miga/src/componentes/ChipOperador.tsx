// Pieza visual del chip de operador (AC-ID-07). Quién lo rellena y cuándo aparece vive en
// apps/kilopan/src/app/BarraApp.tsx: acá no se lee sesión ni cookies, para que Miga siga
// siendo sistema de diseño puro y no arrastre identidad.
//
// `anchoMaximo` no es cosmético: el chip comparte la barra con el título de la sección, y
// un nombre largo de verdad —«Rafael Urra · Indupan»— empujaba el título fuera de un
// teléfono de 375 px. Se recorta con «…» y el nombre completo queda en el `title`.
export function ChipOperador({ nombre, anchoMaximo }: { nombre: string; anchoMaximo?: number }) {
  return (
    <div
      title={nombre}
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
        maxWidth: anchoMaximo,
        minWidth: 0,
      }}
    >
      <span aria-hidden>👤</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</span>
    </div>
  );
}
