import type { Metadata } from "next";
import { superficie } from "@kilopan/miga/tokens.ts";

export const metadata: Metadata = {
  title: "KiloPan",
  description: "Del pesaje del pan a la boleta o la entrega con prueba.",
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
      </body>
    </html>
  );
}
