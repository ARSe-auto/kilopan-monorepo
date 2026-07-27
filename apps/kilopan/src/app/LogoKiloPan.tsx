// Mismo ícono que /icono-192.png (manifest.ts) — un solo asset de marca, no uno
// nuevo para pantalla y otro para PWA. El original de la marca es
// /logo-kilopan.svg (la balanza sobre el cuadrado ámbar de kilopan.cl); los PNG se
// rasterizan de ahí. Si hace falta otro tamaño, sale de ese SVG: no se dibuja una
// marca nueva.
//
// `comoTitulo` existe porque en /ingresar el logo ES el título de la página: al
// reemplazar el <h1>KiloPan</h1> por este componente, la pantalla quedó sin ningún
// encabezado. Un lector de pantalla pierde el punto de entrada y el e2e se puso rojo.
// No se resuelve poniendo <h1> siempre: en /inicio y /vincular el logo va arriba de un
// h1 propio, y dos h1 en la misma pantalla es el mismo problema al revés.
export function LogoKiloPan({
  tamano = 32,
  conTexto = true,
  comoTitulo = false,
}: {
  tamano?: number;
  conTexto?: boolean;
  comoTitulo?: boolean;
}) {
  const marca = { fontSize: tamano * 0.6, fontWeight: 700, margin: 0 };
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
        comoTitulo ? (
          <h1 style={marca}>KiloPan</h1>
        ) : (
          <span style={marca}>KiloPan</span>
        )
      ) : null}
    </div>
  );
}
