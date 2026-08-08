import type { NextConfig } from "next";

// Hito 0 — esqueleto mínimo de apps/flota. Sin
// `output: "standalone"` todavía: eso trae aparejado el script de copia de estáticos y
// el chequeo de `check.sh --full` sobre `.next/standalone` (mismo patrón que
// `apps/kilopan/next.config.ts`) — prematuro mientras esta app no sirve nada real. Se
// agrega cuando exista contenido que empaquetar para producción.
const nextConfig: NextConfig = {};

export default nextConfig;
