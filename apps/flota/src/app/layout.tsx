import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Plataforma FLOTA",
  description:
    "SaaS multi-tenant de transporte de carga con vehículos eléctricos — visibilidad " +
    "por semáforo, custodia con evidencia, tarificación y liquidación que se escribe sola.",
};

export const viewport: Viewport = {
  themeColor: "#1D4ED8", // acento reservado en packages/miga/src/tokens.ts (acentos.kiloruta)
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

// System font stack (docs/PROMPT_MAESTRO_FLOTA.md §5.1) — sin webfonts, mismo criterio
// que apps/kilopan.
const pilaTipografica =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL">
      <body style={{ margin: 0, fontFamily: pilaTipografica }}>{children}</body>
    </html>
  );
}
