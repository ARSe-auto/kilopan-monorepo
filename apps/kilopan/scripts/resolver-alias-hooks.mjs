// Hook real (corre en el hilo de loaders de Node, separado del hilo principal): mapea
// el alias `@/*` de tsconfig.json a `./src/*` para que `node --test` pueda importar
// código de producción que usa ese alias — sin esto, cualquier test que importe una
// ruta de API o un módulo de cliente que a su vez importe algo por `@/...` falla con
// "Cannot find package '@/...'" antes de llegar a ejercitar una sola línea real.
//
// Por qué un hook propio y no una dependencia (tsx, tsconfig-paths): el proyecto ya
// declaró esa preferencia con scrypt en vez de bcrypt (identidad/hash.ts) — menos
// superficie de cadena de suministro que auditar para resolver un solo alias.
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

export function resolve(specifier, context, siguiente) {
  if (specifier.startsWith("@/")) {
    return siguiente(pathToFileURL(join(RAIZ_SRC, specifier.slice(2))).href, context);
  }
  return siguiente(specifier, context);
}
