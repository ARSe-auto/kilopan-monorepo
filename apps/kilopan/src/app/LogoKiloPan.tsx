// Mismo ícono que /icono-192.png (manifest.ts) — un solo asset de marca, no uno
// nuevo para pantalla y otro para PWA.
export function LogoKiloPan({ tamano = 32, conTexto = true }: { tamano?: number; conTexto?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: tamano * 0.28 }}>
      <img
        src="/icono-192.png"
        alt={conTexto ? "" : "KiloPan"}
        width={tamano}
        height={tamano}
        style={{ borderRadius: tamano * 0.22, display: "block" }}
      />
      {conTexto ? (
        <span style={{ fontSize: tamano * 0.6, fontWeight: 700 }}>KiloPan</span>
      ) : null}
    </div>
  );
}
