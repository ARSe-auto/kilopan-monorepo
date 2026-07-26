import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // `.next*` y no solo `.next`: el e2e construye en un distDir propio (.next-e2e, ver
    // playwright.config.ts) para no pisar el build que ya usaron el chequeo standalone y
    // el presupuesto de performance. Sin este comodín, lintear ese directorio sumaba
    // ~12.700 quejas sobre JS minificado generado y ponía el gate rojo por un artefacto
    // de build, no por código escrito por nadie.
    ignores: [".next*/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default config;
