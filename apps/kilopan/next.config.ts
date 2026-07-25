import type { NextConfig } from "next";

// AC-SEC-04: cabeceras de seguridad base. CSP se endurece por ruta a medida que
// existan orígenes reales que permitir (fotos, mapa estático) — no se declara aquí
// una CSP amplia "por si acaso".
const nextConfig: NextConfig = {
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
