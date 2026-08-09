#!/usr/bin/env node
// Mutantes del grep-gate de la familia canónica de constantes [AC-FTEN-01].
//
// El caso de rebote que exige el AC: «un número mágico de la familia hardcodeado fuera del
// archivo canónico hace fallar el grep-gate (build rojo)». Se ejerce plantando el fixture
// en un SANDBOX (--raiz), nunca en el árbol real: si esto se interrumpe a mitad, no queda
// basura en el worktree de nadie.
//
// Los valores vigilados se leen del propio archivo canónico y se escriben al fixture en
// tiempo de ejecución — literales, este archivo dispararía el gate que está probando.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const GATE = join(RAIZ, "db/flota/gate-constantes.mjs");
const CANONICO = "packages/nucleo-comun/src/constants.ts";

const { CIFRAS_VIGILADAS } = await import(`file://${join(RAIZ, CANONICO)}`);

/** Arma un repo de juguete con el archivo canónico real y los archivos que se le pidan. */
function sandbox(archivos = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "flota-const-"));
  mkdirSync(join(raiz, "packages/nucleo-comun/src"), { recursive: true });
  cpSync(join(RAIZ, CANONICO), join(raiz, CANONICO));
  for (const [rel, contenido] of Object.entries(archivos)) {
    mkdirSync(join(raiz, rel, ".."), { recursive: true });
    writeFileSync(join(raiz, rel), contenido);
  }
  return raiz;
}

function correr(raiz) {
  try {
    return { codigo: 0, salida: execFileSync("node", [GATE, `--raiz=${raiz}`], { encoding: "utf8" }) };
  } catch (e) {
    return { codigo: e.status ?? 1, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("el repo real pasa el gate (y constants.md está al día)", () => {
  try {
    const salida = execFileSync("node", [GATE], { encoding: "utf8" });
    assert.match(salida, /gate-constantes: VERDE/);
    assert.match(salida, /fuera del alcance por ahora/, "el alcance recortado se declara siempre, jamás en silencio");
  } catch (e) {
    assert.fail(`${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
});

test("un número mágico de la familia escrito fuera del canónico ⇒ ROJO", () => {
  const undo = CIFRAS_VIGILADAS.find((c) => c.nombre === "UNDO.ventana_ms");
  const raiz = sandbox({
    "db/flota/.fixture-copia.mjs": `export const esperarUndo = ${undo.valor};\n`,
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 1);
  assert.match(salida, /repite UNDO\.ventana_ms/);
  assert.match(salida, /\.fixture-copia\.mjs:1/, "debe señalar el archivo y la línea exactos");
});

test("cada cifra vigilada dispara de verdad contra un texto que la contiene", () => {
  // Sin esto, un patrón mal escrito dejaría su constante sin vigilancia y el gate seguiría
  // en verde: la lista parecería completa y no protegería nada.
  // Las muestras se ARMAN desde el valor real de cada constante: escritas literales, este
  // archivo sería él mismo una copia de la familia y el gate lo marcaría (pasó de verdad
  // con la primera versión). Además así no pueden quedar desfasadas del canónico.
  const plantillas = {
    "UNDO.ventana_ms": (v) => `const espera = ${v};`,
    "EV.factor_consumo_default": (v) => `const factor = ${v};`,
    "CONTRASTE.texto": (v) => `if (ratio < ${v}) rechazar();`,
    // AC-FMIG-01: los tokens estructurales del §5.1 entraron a la familia junto con
    // `packages/miga`. Igual que el resto, la muestra se ARMA desde el valor real: escrito
    // literal, el stack de fuentes y la escala harían de este archivo una copia más.
    "TIPOGRAFIA.familia": (v) => `font-family: ${v};`,
    "TIPOGRAFIA.escala_pt": (v) => `font-size: ${String(v).split("/")[0]}px;`,
    "GRILLA.base_px": (v) => `gap: ${v}px;`,
    "GRILLA.radio_tarjeta_px": (v) => `border-radius: ${v}px;`,
    "CIFRA_OPERATIVA.tamano_px": (v) => `font-size: ${v}px;`,
    "CIFRA_OPERATIVA.peso": (v) => `font-weight: ${v};`,
    "TACTIL.boton_primario": (v) => `height: ${v}px;`,
    "TACTIL.tecla_min": (v) => `min-height: ${v}px;`,
    "TACTIL.operativo_min": (v) => `min-width: ${v}px;`,
    "TACTIL.piso_wcag": (v) => `min-height: ${v}px;`,
    "EV.umbrales_alerta_pct": (v) => `const umbrales = [${String(v).split("/").join(", ")}];`,
    "CAPACIDAD.p95_bootstrap_ms": (v) => `// p95 de bootstrap bajo ${v} ms`,
    "CAPACIDAD.p95_sync_ms": (v) => `// p95 de sync bajo ${v} ms`,
    "CAPACIDAD.dispositivos_con_turno_abierto": (v) => `// ${v} dispositivos con turno abierto`,
    "PIN.digitos": (v) => `// el PIN son ${v} digitos`,
    "PIN.intentos_hasta_bloqueo": (v) => `// lockout a los ${v}`,
    "RELOJ.drift_max_minutos": (v) => `// drift mayor a ${v} minutos`,
    "INVITACION.expira_dias": (v) => `// la invitacion expira a los ${v} dias`,
    "PLAZOS_LEGALES.pago_dias": (v) => `// pago a ${v} dias`,
    "PLAZOS_LEGALES.reclamo_factura_dias": (v) => `// reclamo a los ${v} dias`,
    "PLAZOS_LEGALES.disputa_liquidacion_dias": (v) => `// disputa dentro de ${v} dias`,
    "TARIFAS.activos_max_por_empresa": (v) => `// max ${v} conceptos activos`,
    "SEMAFORO.tarjetas_max": (v) => `// max ${v} tarjetas`,
    "SOC.capturas_max_por_turno": (v) => `// max ${v} capturas por turno`,
  };
  assert.equal(
    Object.keys(plantillas).length,
    CIFRAS_VIGILADAS.length,
    "hay una cifra vigilada sin muestra en esta prueba: agregarla o el patrón queda sin ejercer",
  );
  for (const cifra of CIFRAS_VIGILADAS) {
    const plantilla = plantillas[cifra.nombre];
    assert.ok(plantilla, `sin muestra para ${cifra.nombre}`);
    const muestra = plantilla(cifra.valor);
    assert.ok(
      new RegExp(cifra.patron).test(muestra),
      `el patrón de ${cifra.nombre} NO dispara contra «${muestra}» — está sin vigilancia real`,
    );
  }
});

test("un uuid que contiene una cifra vigilada NO dispara el gate", () => {
  // Pasó de verdad: el centinela de `tenant_template` es
  // 00000000-0000-7000-8000-000000000000 y el patrón `\b8000\b` mordía adentro, porque el
  // guion abre frontera de palabra. Tres falsos positivos en la primera migración real.
  const raiz = sandbox({
    "db/flota/.fixture-uuid.mjs": "export const centinela = '00000000-0000-7000-8000-000000000000';\n",
  });
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});

test("el gate se pone ROJO si la lista de cifras vigiladas queda vacía (verde vacuo)", () => {
  const raiz = sandbox();
  writeFileSync(join(raiz, CANONICO), "export const CIFRAS_VIGILADAS = [] as const;\n");
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 1);
  assert.match(salida, /verde vacuo prohibido/);
});

test("el archivo canónico puede contener sus propios valores sin dispararse a sí mismo", () => {
  const raiz = sandbox();
  const { codigo, salida } = correr(raiz);
  assert.equal(codigo, 0, salida);
});
