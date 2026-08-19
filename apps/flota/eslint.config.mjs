import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // `.next*` y no solo `.next`: el e2e construye en un distDir propio (.next-e2e).
    // Sin el comodín, lintear ese directorio suma miles de quejas sobre JS minificado
    // generado y pone el gate rojo por un artefacto de build.
    ignores: [".next*/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default config;
