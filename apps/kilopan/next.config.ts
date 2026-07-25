import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pglite resuelve sus bundles de extensión (pgcrypto, btree_gist) vía import.meta.url
  // relativo a su propio paquete; si webpack lo empaqueta, reescribe esas rutas a
  // /_next/static/media/... y pglite intenta leerlas del filesystem del servidor donde
  // no existen ("Extension bundle not found"). serverExternalPackages saca a pglite
  // (y a pg, mismo motivo con sus bindings) del bundling y los deja como require()
  // normal de Node en runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // AC-SEC-04: cabeceras de seguridad base. CSP se endurece por ruta a medida que
  // existan orígenes reales que permitir (fotos, mapa estático) — no se declara aquí
  // una CSP amplia "por si acaso".
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
