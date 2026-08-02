// Registra el hook de resolución de módulos (ver ./resolver-alias-hooks.mjs) para que
// `node --test` entienda el alias `@/` de tsconfig.json al importar código de
// producción directamente desde un test.
//
// Uso: node --import ./scripts/resolver-alias-tests.mjs --test archivo.test.ts
import { register } from "node:module";

register("./resolver-alias-hooks.mjs", import.meta.url);
