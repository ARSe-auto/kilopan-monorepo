#!/usr/bin/env node
// Mutantes del guardrail de FLOTA [AC-FTEN-28]: un fixture por CADA una de las tres reglas
// del §7.1, más la corrida contra el árbol limpio.
//
// Casilla 11 del prevuelo: «cada guardrail probado contra el caso que dice proteger; un
// guard que nunca dispara es indistinguible de uno roto». Los tres fixtures se plantan y
// se retiran en el árbol real porque el grep del guard es sobre el árbol real; cada uno se
// borra en su `finally`, y ninguno toca un archivo preexistente.
//
// Los tokens de cáscara se ARMAN en tiempo de ejecución: escritos literales, este archivo
// dispararía el guard que está probando.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const GUARDRAIL = join(RAIZ, "db/flota/guardrail.sh");

function correr(env = {}) {
  try {
    const salida = execFileSync("bash", [GUARDRAIL], {
      cwd: RAIZ,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { codigo: 0, salida };
  } catch (e) {
    return { codigo: e.status ?? 1, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Planta un archivo, corre el guard y lo retira pase lo que pase. */
function conArchivo(ruta, contenido, fn) {
  const abs = join(RAIZ, ruta);
  assert.equal(existsSync(abs), false, `el fixture ${ruta} pisaría un archivo real`);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contenido);
  try {
    return fn();
  } finally {
    rmSync(abs, { force: true });
  }
}

test("árbol limpio ⇒ exit 0", () => {
  const { codigo, salida } = correr();
  assert.equal(codigo, 0, salida);
  assert.match(salida, /guardrail flota: OK/);
});

test("regla 1 — DATABASE_URL con host remoto ⇒ exit ≠ 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "flota-env-"));
  const env = join(dir, ".env.local");
  // La remota va SEGUNDA a propósito: el modo de fallo real es pegar la cadena del
  // dashboard al final de un archivo que arriba dice localhost.
  writeFileSync(
    env,
    "DATABASE_URL=postgres://u:p@127.0.0.1:54331/t_demo\n" +
      "DATABASE_URL=postgres://u:p@db.proveedor-real.com:5432/prod\n",
  );
  const { codigo, salida } = correr({ FLOTA_ENV_FILE: env });
  assert.equal(codigo, 1);
  assert.match(salida, /apunta fuera de localhost/);
});

test("regla 1 — DATABASE_URL en 127.0.0.1 ⇒ pasa (el guard no es un no-op al revés)", () => {
  const dir = mkdtempSync(join(tmpdir(), "flota-env-"));
  const env = join(dir, ".env.local");
  writeFileSync(env, "DATABASE_URL=postgres://flota_admin@127.0.0.1:54331/t_demo\n");
  const { codigo, salida } = correr({ FLOTA_ENV_FILE: env });
  assert.equal(codigo, 0, salida);
});

test("regla 1 — no hay excepción de «remota intencional» como en KiloPan", () => {
  const dir = mkdtempSync(join(tmpdir(), "flota-env-"));
  const env = join(dir, ".env.local");
  writeFileSync(
    env,
    "DATABASE_URL=postgres://u:p@db.proveedor-real.com:5432/prod\n" +
      "KILOPAN_DB_REMOTA_INTENCIONAL=1\nFLOTA_DB_REMOTA_INTENCIONAL=1\n",
  );
  const { codigo } = correr({ FLOTA_ENV_FILE: env });
  assert.equal(codigo, 1, "el §7.1 de FLOTA dice SOLO localhost, sin puerta de escape");
});

test("regla 2 — archivo de entorno no cubierto por .gitignore ⇒ exit ≠ 0", () => {
  // `.env.pruebas` no calza con ninguno de los patrones de .gitignore (.env.local,
  // .env*.local, .env.local.*), así que quedaría versionable.
  const { codigo, salida } = conArchivo("db/flota/.env.pruebas", "DATABASE_URL=x\n", correr);
  assert.equal(codigo, 1);
  assert.match(salida, /no está cubierto por \.gitignore/);
});

test("regla 2 — secreto escrito en el código de FLOTA ⇒ exit ≠ 0", () => {
  const secreto = ["const", "apiKey", "=", `"${"k".repeat(24)}"`].join(" ");
  const { codigo, salida } = conArchivo(
    "db/flota/.fixture-secreto.mjs",
    `export ${secreto};\n`,
    correr,
  );
  assert.equal(codigo, 1);
  assert.match(salida, /posible secreto escrito en el código de FLOTA/);
});

test("regla 3 — cáscara plantada en el código de FLOTA ⇒ exit ≠ 0", () => {
  const token = "PLACE" + "HOLDER";
  const { codigo, salida } = conArchivo(
    "db/flota/.fixture-cascara.mjs",
    `// ${token}: esto es un fixture del arnés\nexport const x = 1;\n`,
    correr,
  );
  assert.equal(codigo, 1);
  assert.match(salida, /cáscaras encontradas/);
});

test("regla 3 — «TODOS» en español NO dispara el guard (bug real del 06-ago-2026)", () => {
  const { codigo, salida } = conArchivo(
    "db/flota/.fixture-espanol.mjs",
    "// Salir a ruta exige TODOS los DTE asociados (art. 55); los métodos no.\nexport const y = 1;\n",
    correr,
  );
  assert.equal(codigo, 0, salida);
});

test("el guard mira el árbol de FLOTA, no el de KiloPan", () => {
  // Una cáscara en apps/kilopan/src es problema del guardrail de KiloPan; si este guard
  // la reportara, un rojo ajeno le sumaría un strike a un AC sano de FLOTA.
  const token = "FIX" + "ME";
  const { codigo, salida } = conArchivo(
    "apps/kilopan/src/.fixture-flota-no-mira.ts",
    `// ${token}: fixture de frontera\nexport const z = 1;\n`,
    correr,
  );
  assert.equal(codigo, 0, salida);
});
