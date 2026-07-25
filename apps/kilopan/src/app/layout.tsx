import type { Metadata, Viewport } from "next";
import { superficie } from "@kilopan/miga/tokens.ts";
import { RegistrarSW } from "./RegistrarSW.tsx";

export const metadata: Metadata = {
  title: "KiloPan",
  description: "Del pesaje del pan a la boleta o la entrega con prueba.",
  appleWebApp: { capable: true, title: "KiloPan", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#C2410C",
  // La app se usa con las manos ocupadas: un zoom accidental con harina en los dedos
  // descoloca la cifra del pesaje. Se fija la escala pero NO se bloquea el zoom del
  // sistema (accesibilidad): maximumScale queda en 5, no en 1.
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover", // safe-area del notch del iPhone
};

// System font stack (PROMPT_MAESTRO.md §5) — sin webfonts.
const pilaTipografica =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // "Solo modo claro en el MVP": fijado acá, no dejado a que el navegador/SO decida.
    <html lang="es-CL" style={{ colorScheme: "light" }}>
      <body
        style={{
          margin: 0,
          fontFamily: pilaTipografica,
          background: superficie.fondo,
          color: superficie.texto,
          minHeight: "100dvh",
        }}
      >
        {children}
        <RegistrarSW />
      </body>
    </html>
  );
}
