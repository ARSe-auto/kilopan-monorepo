import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "KiloPan",
  description: "Del pesaje del pan a la boleta o la entrega con prueba.",
};

// System font stack (PROMPT_MAESTRO.md §5) — sin webfonts.
const pilaTipografica =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL">
      <body style={{ margin: 0, fontFamily: pilaTipografica }}>{children}</body>
    </html>
  );
}
