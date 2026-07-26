import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // distDir configurable: el e2e hace su PROPIO `next build` (contra Postgres en
  // pglite, nunca contra producción) y necesita un directorio de salida separado del
  // `.next` que el gate ya usó para el chequeo standalone y el presupuesto de
  // performance — si compartieran distDir, el build del e2e lo pisaría a mitad de
  // check.sh --full. Mismo patrón que NEXT_DIST_DIR=.next-perf en eauto-crm-next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Salida standalone: empaqueta solo lo que el servidor necesita en runtime, en vez
  // de arrastrar todo node_modules. En un monorepo pnpm eso importa el doble, porque
  // los symlinks de .pnpm no sobreviven a un copy ingenuo al contenedor.
  output: "standalone",
  // El servidor corre desde la raíz del monorepo, no desde apps/kilopan: sin esto
  // Next traza mal las dependencias y el standalone queda incompleto.
  outputFileTracingRoot: join(import.meta.dirname, "..", ".."),
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
