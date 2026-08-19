import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { primitivo, semantico } from "@kilopan/miga/estructura.ts";
import { cssDelTema, TEMA_DEFECTO } from "@kilopan/miga/tema.ts";
import { poolDe } from "../servidor/conexion.ts";
import { temaDelTenant } from "../servidor/tema.ts";

// Esqueleto del hito 0 (§9.1). Los tokens ESTRUCTURALES del §5.1 los toma de `packages/miga`,
// que a su vez los toma de la familia canónica del §0 [AC-FMIG-01].
//
// El tema del tenant —logo, acento y terminología— entra ACÁ como CSS custom properties
// desde el bootstrap [AC-FMIG-02]: cada request resuelve `x-flota-tenant-bd` (lo puso el
// ruteo, §4.1) y lee la fila VIGENTE de `tenant_theme` de esa base — nunca cacheada entre
// tenants, así que un UPDATE de la fila lo sirve el PRÓXIMO bootstrap, sin build ni deploy
// (§2 métrica 3). Sin tenant resuelto (o sin fila todavía, antes de que el wizard o el panel
// admin escriban una) se sirve `TEMA_DEFECTO` — el MISMO para cualquiera, así que sigue
// siendo «cero forks por cliente» y no una excepción.

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const bd = (await headers()).get("x-flota-tenant-bd");
  const tema = bd ? await temaDelTenant(poolDe(bd)) : null;
  const css = cssDelTema(tema ?? TEMA_DEFECTO);

  return (
    <html lang="es-CL">
      <head>
        <style>{css}</style>
      </head>
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
