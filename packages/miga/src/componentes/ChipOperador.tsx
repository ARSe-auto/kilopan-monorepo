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
        // AC-H0-10: el acento "#C2410C" a 13px/700 sobre este fondo tinta daba 3.89:1
        // (axe), bajo el 4.5:1 de AA — mismo matiz de marca, oscurecido lo justo para
        // cruzar el umbral (mismo patrón que `superficie.textoFaint`).
        color: "#9A3412",
        maxWidth: anchoMaximo,
        minWidth: 0,
      }}
    >
      <span aria-hidden>👤</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</span>
    </div>
  );
}
