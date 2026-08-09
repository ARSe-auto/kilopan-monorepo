import type { Metadata, Viewport } from "next";
import { primitivo, semantico } from "@kilopan/miga/estructura.ts";

// Esqueleto del hito 0 (§9.1). Lo único que este archivo decide son los tokens
// ESTRUCTURALES del §5.1, y no decide ninguno: los toma de `packages/miga`, que a su vez
// los toma de la familia canónica del §0 [AC-FMIG-01]. El tema del tenant —logo, acento y
// terminología— entra como CSS custom properties desde el bootstrap, y eso es del hito g
// (AC-FMIG-02): acá no se adelanta ni un color de marca.

export const metadata: Metadata = {
  title: "FLOTA",
  description: "Plataforma de operación de flotas",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  // `viewport-fit: cover` + las safe-areas de abajo: sin esto, en un iPhone con barra de
  // gestos el botón primario queda DEBAJO de la barra — se ve y no se toca.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // El operario en terreno no hace pinch-zoom con guantes; sí toca dos veces por apuro.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL">
      <body
        style={{
          margin: 0,
          fontFamily: primitivo.fuente,
          fontSize: semantico.texto.cuerpo,
          padding: `${semantico.espacio.margenPantalla}px`,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          // `touch-action: manipulation` mata el retardo de 300 ms del doble toque: en
          // terreno cada toque cuenta y esa espera se siente como una app trabada.
          touchAction: "manipulation",
        }}
      >
        {children}
      </body>
    </html>
  );
}
