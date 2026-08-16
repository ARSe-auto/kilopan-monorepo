// La suite de gate-lock-al-dia.mjs — cada aserción es un caso que el gate promete atrapar.
//
// El caso central es el REAL: el commit ea5b9b1 del 12-ago-2026 agregó `@axe-core/playwright`
// a apps/flota/package.json y dejó el lock afuera. Verde en la máquina —el install local no es
// `--frozen-lockfile`— y rojo en CI antes de correr una sola prueba. Si esta suite no
// reprodujera EXACTAMENTE eso, el gate sería una opinión.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desajustes, resueltasDe, paquetesDe } from "./gate-lock-al-dia.mjs";

/** Un workspace de mentira en disco: raíz + apps/<app>, con el lock que se le pase. */
function arbol({ pedidas = {}, lock }) {
  const raiz = mkdtempSync(join(tmpdir(), "lock-gate-"));
  writeFileSync(join(raiz, "package.json"), JSON.stringify({ name: "raiz" }));
  mkdirSync(join(raiz, "apps", "flota"), { recursive: true });
  writeFileSync(
    join(raiz, "apps", "flota", "package.json"),
    JSON.stringify({ name: "flota", dependencies: pedidas }),
  );
  writeFileSync(join(raiz, "pnpm-lock.yaml"), lock);
  return raiz;
}

const LOCK_CON_PLAYWRIGHT = `lockfileVersion: '9.0'

importers:

  .:

  apps/flota:
    dependencies:
      playwright:
        specifier: ^1.62.0
        version: 1.62.0
`;

test("EL CASO REAL: una dependencia en package.json que el lock no conoce ⇒ ROJO", () => {
  // Exactamente ea5b9b1: package.json pide @axe-core/playwright, el lock solo sabe de playwright.
  const raiz = arbol({
    pedidas: { playwright: "^1.62.0", "@axe-core/playwright": "^4.12.1" },
    lock: LOCK_CON_PLAYWRIGHT,
  });
  const fallos = desajustes(raiz);
  assert.equal(fallos.length, 1);
  assert.match(fallos[0].problema, /no conoce '@axe-core\/playwright'/);
  assert.equal(fallos[0].importer, "apps/flota");
});

test("el lock al día no molesta a nadie ⇒ VERDE", () => {
  const raiz = arbol({ pedidas: { playwright: "^1.62.0" }, lock: LOCK_CON_PLAYWRIGHT });
  assert.deepEqual(desajustes(raiz), []);
});

test("un RANGO que se movió sin regenerar el lock también ⇒ ROJO", () => {
  // El caso silencioso: la dependencia está en las dos partes, pero el package.json pide otro
  // rango. `--frozen-lockfile` lo rechaza igual, y a simple vista el diff se ve inofensivo.
  const raiz = arbol({ pedidas: { playwright: "^1.63.0" }, lock: LOCK_CON_PLAYWRIGHT });
  const fallos = desajustes(raiz);
  assert.equal(fallos.length, 1);
  assert.match(fallos[0].problema, /pide \^1\.63\.0/);
});

test("las devDependencies cuentan igual que las de producción", () => {
  const raiz = mkdtempSync(join(tmpdir(), "lock-gate-dev-"));
  writeFileSync(join(raiz, "package.json"), JSON.stringify({ name: "raiz" }));
  mkdirSync(join(raiz, "apps", "flota"), { recursive: true });
  writeFileSync(
    join(raiz, "apps", "flota", "package.json"),
    JSON.stringify({ name: "flota", devDependencies: { "@axe-core/playwright": "^4.12.1" } }),
  );
  writeFileSync(join(raiz, "pnpm-lock.yaml"), LOCK_CON_PLAYWRIGHT);
  // CI instala el workspace entero: una devDependency que falte rompe el install igual.
  assert.equal(desajustes(raiz).length, 1);
});

test("un paquete del workspace sin bloque en el lock ⇒ ROJO, no verde por omisión", () => {
  // El modo de fallar más peligroso de un gate así: no encontrar nada y llamarlo verde.
  const raiz = arbol({ pedidas: { playwright: "^1.62.0" }, lock: "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n" });
  const fallos = desajustes(raiz);
  assert.equal(fallos.length, 1);
  assert.match(fallos[0].problema, /no tiene un bloque/);
});

test("el lector de importers no se lleva las dependencias del vecino", () => {
  // Dos importers seguidos: si el lector no corta en la sangría, `apps/flota` heredaría lo de
  // `apps/kilopan` y el gate daría verde sobre un lock que no conoce nada de flota.
  const lock = `lockfileVersion: '9.0'

importers:

  apps/kilopan:
    dependencies:
      next:
        specifier: ^15.0.0
        version: 15.0.0

  apps/flota:
    dependencies:
      playwright:
        specifier: ^1.62.0
        version: 1.62.0
`;
  assert.deepEqual(resueltasDe(lock, "apps/flota"), { playwright: "^1.62.0" });
  assert.deepEqual(resueltasDe(lock, "apps/kilopan"), { next: "^15.0.0" });
});

test("descubre los paquetes del workspace, no una lista escrita a mano", () => {
  const raiz = arbol({ pedidas: {}, lock: LOCK_CON_PLAYWRIGHT });
  const encontrados = paquetesDe(raiz);
  assert.ok(encontrados.includes("."));
  assert.ok(encontrados.includes("apps/flota"));
});
