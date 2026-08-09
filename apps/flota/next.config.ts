import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` resuelve bindings y módulos nativos en runtime: empaquetarlo reescribe esas rutas y
  // el standalone se queda sin poder conectarse. Se deja como require() normal de Node.
  serverExternalPackages: ["pg"],
  // distDir configurable: el e2e hace su PROPIO `next build` y necesita una salida
  // separada del `.next` que el gate ya usó para el chequeo standalone y el presupuesto
  // de performance — si compartieran directorio, el build del e2e lo pisaría a mitad de
  // `check.sh --full`. Mismo patrón que apps/kilopan.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // SIN `output: "standalone"`, a diferencia de apps/kilopan. Esta app se sirve con un
  // SERVIDOR PROPIO (`servidor.mjs`), porque el ruteo por subdominio del §4.1 tiene que
  // decidir entre 404, 503 y servir ANTES de que Next vea el request, y eso exige Node y
  // el driver de Postgres (AC-FTEN-05). El standalone y un servidor propio no conviven:
  // Next mismo advierte que su API programática no funciona con esa salida, y al arrancar
  // dentro del standalone se pone a DESCARGAR el paquete de SWC —maquinaria de build que
  // esa salida existe justamente para no llevar—. Un servidor que necesita red al arrancar
  // no es un artefacto de despliegue: es una bomba de tiempo en el primer contenedor sin
  // salida a internet. El despliegue de esta app es el clásico de servidor propio: `.next`
  // + node_modules + `node servidor.mjs`.
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
