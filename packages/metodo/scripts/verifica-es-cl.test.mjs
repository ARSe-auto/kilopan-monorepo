// verifica-es-cl.test.mjs — mata los mutantes que verifica-es-cl.mjs existe para
// atrapar (AC-H0-09: es-CL verificado por grep de gate, RUT validado al escribir, cero
// strings visibles en inglés). Ejerce revisarArchivo() directo, sin tocar disco: el
// bug real que motivó este AC — MapaPodsDia.tsx formateando kg a mano con
// `.toFixed(1)` — es el primer caso que este test reproduce y mata.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { revisarArchivo, faltaRutEnVivo, EXCLUIR_DE_TODO } from "./verifica-es-cl.mjs";

const SCRIPT = new URL("./verifica-es-cl.mjs", import.meta.url).pathname;

test("revisarArchivo: atrapa gramos/1000 formateado a mano (el bug real de MapaPodsDia.tsx)", () => {
  const codigo = '{pod.gramos_entregados ? `${(pod.gramos_entregados / 1000).toFixed(1)} kg` : "Sin peso"}';
  const violaciones = revisarArchivo("X.tsx", codigo, false);
  assert.ok(violaciones.some((v) => v.motivo.includes("formatearKg")));
});

test("revisarArchivo: atrapa CLP armado a mano con `$${…}`", () => {
  const codigo = "const texto = `$${total}`;";
  const violaciones = revisarArchivo("X.tsx", codigo, false);
  assert.ok(violaciones.some((v) => v.motivo.includes("formatearClp")));
});

test("revisarArchivo: atrapa fecha armada a mano con getMonth()+1", () => {
  const codigo = "const mm = fecha.getMonth() + 1;";
  const violaciones = revisarArchivo("X.tsx", codigo, false);
  assert.ok(violaciones.some((v) => v.motivo.includes("formatearFecha")));
});

test("revisarArchivo: atrapa toLocaleDateString() sin locale es-CL explícito", () => {
  const conLocale = revisarArchivo("X.tsx", 'x.toLocaleDateString("es-CL")', false);
  const sinLocale = revisarArchivo("X.tsx", "x.toLocaleDateString()", false);
  assert.equal(conLocale.length, 0);
  assert.ok(sinLocale.some((v) => v.motivo.includes("es-CL")));
});

test("revisarArchivo: atrapa strings visibles en inglés entre > y <", () => {
  const violaciones = revisarArchivo("X.tsx", "<button>Cancel</button>", false);
  assert.ok(violaciones.some((v) => v.motivo.includes("inglés")));
});

test("revisarArchivo: NO marca español legítimo como inglés (sin falsos positivos)", () => {
  const violaciones = revisarArchivo("X.tsx", "<button>Cancelar</button>", false);
  assert.equal(violaciones.length, 0);
});

test("revisarArchivo: comun/formato.ts, peso.ts y valida_rut.ts quedan exentos de los checks de bypass", () => {
  assert.ok(EXCLUIR_DE_TODO.test("apps/kilopan/src/comun/formato.ts"));
  const codigo = "const texto = `$${total}`;";
  const violaciones = revisarArchivo("apps/kilopan/src/comun/formato.ts", codigo, true);
  assert.equal(violaciones.length, 0, "el propio formatearClp() usa este patrón legítimamente");
});

test("faltaRutEnVivo: input de RUT sin estadoRut() es una violación", () => {
  assert.equal(faltaRutEnVivo('<input placeholder="RUT (ej: 12.345.678-5)" />'), true);
});

test("faltaRutEnVivo: input de RUT CON estadoRut() en el archivo no viola nada", () => {
  const contenido = '<input placeholder="RUT" />\n{estadoRut(nuevoRut) === "invalido" ? <p>RUT inválido</p> : null}';
  assert.equal(faltaRutEnVivo(contenido), false);
});

test("faltaRutEnVivo: archivo sin campo de RUT no aplica", () => {
  assert.equal(faltaRutEnVivo('<input placeholder="Razón social" />'), false);
});

// ─── [AC-FMIG-05] El mismo oráculo, para FLOTA ────────────────────────────────────────
//
// specs/flota/08-diseno-miga-onboarding.md exige el mismo caso de rebote que AC-H0-09 ya
// probaba para KiloPan («string visible en inglés en src/ ⇒ grep-gate rojo», §0/§9.2) pero
// contra los árboles de FLOTA: `apps/flota/src` y `packages/miga/src`. Hasta este AC, nada
// ejercía el CLI con `--app=flota` de punta a punta — solo revisarArchivo() app-agnóstico —
// así que el cableado real (RAICES = apps/flota/src + packages/miga/src) nunca se probó.

test("[AC-FMIG-05] node verifica-es-cl.mjs --app=flota: verde contra el árbol real hoy", () => {
  // Oráculo declarado del AC: CI. Corre el binario tal cual lo invoca check.sh
  // (packages/metodo/scripts/check.sh:143) — si esto lanza, el test lo reporta con el
  // stdout/stderr real del gate, igual que vería el motor.
  const salida = execFileSync("node", [SCRIPT, "--app=flota"], { encoding: "utf8" });
  assert.match(salida, /verifica-es-cl: OK/);
});

test("[AC-FMIG-05] --app=flota --raiz=<sandbox>: una pantalla de FLOTA con inglés visible pone el gate rojo", () => {
  // Sandbox aislado (patrón de db/flota/gate-constantes.test.mjs): prueba que el CLI, con
  // el par (--app, RAICES) real de FLOTA, SÍ detecta el caso de rebote — no solo que
  // revisarArchivo() lo detectaría si alguien lo llamara.
  const raiz = mkdtempSync(join(tmpdir(), "flota-es-cl-"));
  try {
    const dirApp = join(raiz, "apps/flota/src/app/panel");
    mkdirSync(dirApp, { recursive: true });
    writeFileSync(join(dirApp, "page.tsx"), "export default function Panel() {\n  return <button>Cancel</button>;\n}\n");
    mkdirSync(join(raiz, "packages/miga/src"), { recursive: true });

    assert.throws(
      () => execFileSync("node", [SCRIPT, "--app=flota", `--raiz=${raiz}`], { encoding: "utf8" }),
      (err) => {
        // `??` no sirve acá: execFileSync deja `stdout` en `""` (no `undefined`) cuando
        // toda la salida del gate fue por stderr, y `"" ?? x` se queda en `""`.
        assert.match((err.stdout || "") + (err.stderr || ""), /string visible en inglés/);
        return true;
      },
    );
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("[AC-FMIG-05] --app=flota --raiz=<sandbox>: español limpio en apps/flota/src queda verde", () => {
  const raiz = mkdtempSync(join(tmpdir(), "flota-es-cl-"));
  try {
    const dirApp = join(raiz, "apps/flota/src/app/panel");
    mkdirSync(dirApp, { recursive: true });
    writeFileSync(join(dirApp, "page.tsx"), "export default function Panel() {\n  return <button>Cancelar</button>;\n}\n");
    mkdirSync(join(raiz, "packages/miga/src"), { recursive: true });

    const salida = execFileSync("node", [SCRIPT, "--app=flota", `--raiz=${raiz}`], { encoding: "utf8" });
    assert.match(salida, /verifica-es-cl: OK/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
