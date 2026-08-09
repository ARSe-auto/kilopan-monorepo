import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // distDir configurable: el e2e hace su PROPIO `next build` y necesita una salida
  // separada del `.next` que el gate ya usó para el chequeo standalone y el presupuesto
  // de performance — si compartieran directorio, el build del e2e lo pisaría a mitad de
  // `check.sh --full`. Mismo patrón que apps/kilopan.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Salida standalone: empaqueta solo lo que el servidor necesita en runtime. En un
  // monorepo pnpm importa el doble, porque los symlinks de .pnpm no sobreviven a un copy
  // ingenuo al contenedor.
  output: "standalone",
  // El servidor corre desde la raíz del monorepo, no desde apps/flota: sin esto Next
  // traza mal las dependencias y el standalone queda incompleto.
  outputFileTracingRoot: join(import.meta.dirname, "..", ".."),
  // Cabeceras base. La CSP se endurece por ruta a medida que existan orígenes reales que
  // permitir: no se declara acá una amplia «por si acaso».
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
