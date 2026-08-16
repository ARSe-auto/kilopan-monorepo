import test from "node:test";
import assert from "node:assert/strict";
import { RELOJ } from "../../../../packages/nucleo-comun/src/constants.ts";
import {
  clasificarCustodia,
  rechaza,
  FLAGS_DE_CUSTODIA,
  type CapturaDeCustodia,
} from "./custodia.ts";

// Mutantes de la degradación de una captura de custodia [AC-FRUT-10] — §4.2, §9.3.4.
//
// Ni un número de la familia canónica escrito acá: el borde del drift sale de `RELOJ` del §0.
// Escrito literal, este archivo seguiría diciendo lo de antes el día que el dueño mueva el
// umbral — y un test que no se entera de que cambió la regla es peor que no tenerlo.

const AHORA = new Date("2026-08-10T12:00:00Z");
const enMinutos = (base: Date, m: number) => new Date(base.getTime() + m * 60 * 1000);

/** Una captura LIMPIA: todo contado, con documento, en hora, con el módulo encendido. */
const limpia: CapturaDeCustodia = {
  itemsDeclarados: 2,
  itemsContados: 2,
  incompletoConfirmado: false,
  itemsSinDte: 0,
  tsDispositivo: AHORA,
  recibidaEn: AHORA,
  moduloEncendido: true,
  shaPrometido: null,
  shaRecalculado: null,
};

// ─── Ninguna rechaza. Es la regla de oro del §4.2 con algo concreto que asertar ──────

test("ninguna combinación de flags rechaza jamás", () => {
  // Conjunto POTENCIA: si alguien agrega mañana una condición que rebota, no alcanza con que
  // este test mire los casos que se le ocurrieron a quien lo escribió. Rechazos = 0 (§9.3.4).
  const total = 1 << FLAGS_DE_CUSTODIA.length;
  for (let mascara = 0; mascara < total; mascara++) {
    const flags = FLAGS_DE_CUSTODIA.filter((_, i) => (mascara & (1 << i)) !== 0);
    assert.equal(rechaza(flags), false, `la combinación ${flags.join("+")} rechazó`);
  }
});

// ─── El caso (a): la captura limpia no ensucia la bandeja ───────────────────────────

test("una captura conforme no deja NINGÚN flag", () => {
  // La mitad que se olvida. Marcar de más sale gratis en el momento y hace que la cola «Por
  // revisar» del §5.6 deje de mirarse, que es donde se pierden las que importaban.
  assert.deepEqual(clasificarCustodia(limpia), []);
});

test("una foto que re-hashea igual tampoco degrada", () => {
  const sha = "a".repeat(64);
  assert.deepEqual(
    clasificarCustodia({ ...limpia, shaPrometido: sha, shaRecalculado: sha }),
    [],
  );
});

test("la comparación del sha256 no distingue mayúsculas: es el MISMO hash", () => {
  const sha = "abc123".padEnd(64, "0");
  assert.deepEqual(
    clasificarCustodia({
      ...limpia,
      shaPrometido: sha.toUpperCase(),
      shaRecalculado: sha,
    }),
    [],
  );
});

// ─── El caso (b): cada degradación enumerada, una por una ──────────────────────────

test("confirmar la modal de manifiesto incompleto degrada", () => {
  assert.deepEqual(clasificarCustodia({ ...limpia, incompletoConfirmado: true }), [
    "manifiesto_incompleto",
  ]);
});

test("contar MENOS ítems de los declarados degrada aunque nadie confirme la modal", () => {
  // El outbox que sincronizó a medias no tiene forma de confirmar nada: si solo mirara la
  // modal, esa captura entraría como conforme y nadie sabría que faltó la mitad del andén.
  assert.deepEqual(clasificarCustodia({ ...limpia, itemsContados: 1 }), [
    "manifiesto_incompleto",
  ]);
});

test("contar de MÁS no es un manifiesto incompleto", () => {
  // Contar más de lo declarado es una discrepancia positiva —el dato del §5.2 F2— y ya tiene su
  // propio evento. Marcarla acá además la contaría dos veces en la bandeja.
  assert.deepEqual(clasificarCustodia({ ...limpia, itemsContados: 3 }), []);
});

test("mercadería a bordo sin DTE degrada (art. 55 DL 825)", () => {
  assert.deepEqual(clasificarCustodia({ ...limpia, itemsSinDte: 1 }), ["item_sin_dte"]);
});

test("el módulo apagado con la captura ya hecha degrada, no rebota", () => {
  assert.deepEqual(clasificarCustodia({ ...limpia, moduloEncendido: false }), [
    "modulo_apagado",
  ]);
});

test("el drift de reloj degrada JUSTO pasado el umbral del §0, en los dos sentidos", () => {
  const borde = RELOJ.drift_max_minutos;
  // Exactamente en el umbral todavía no: el §0 dice «>5 min», y un test que degradara en el
  // borde volvería ruido la tolerancia que el dueño fijó a propósito.
  assert.deepEqual(
    clasificarCustodia({ ...limpia, tsDispositivo: enMinutos(AHORA, -borde) }),
    [],
  );
  assert.deepEqual(
    clasificarCustodia({ ...limpia, tsDispositivo: enMinutos(AHORA, -borde - 1) }),
    ["reloj_desfasado"],
  );
  // Adelantado es tan sospechoso como atrasado, y sin valor absoluto solo se ve uno de los dos.
  assert.deepEqual(
    clasificarCustodia({ ...limpia, tsDispositivo: enMinutos(AHORA, borde + 1) }),
    ["reloj_desfasado"],
  );
});

test("el binario que no re-hashea como lo prometido degrada", () => {
  assert.deepEqual(
    clasificarCustodia({
      ...limpia,
      shaPrometido: "a".repeat(64),
      shaRecalculado: "b".repeat(64),
    }),
    ["sha256_mismatch"],
  );
});

test("la promesa SIN binario todavía no es un mismatch", () => {
  // Entre la mutación y la subida hay un rato en que solo existe la promesa (§4.6). Degradar ahí
  // marcaría toda captura con foto durante la ventana normal de sincronización.
  assert.deepEqual(clasificarCustodia({ ...limpia, shaPrometido: "a".repeat(64) }), []);
});

// ─── Se degrada SOLO lo que falla, y todo lo que falla ──────────────────────────────

test("dos condiciones malas dejan DOS flags, no uno genérico", () => {
  const flags = clasificarCustodia({
    ...limpia,
    itemsSinDte: 2,
    moduloEncendido: false,
  });
  assert.deepEqual([...flags].sort(), ["item_sin_dte", "modulo_apagado"]);
});

test("una captura entera en falso deja los CINCO flags y ninguno de más", () => {
  const flags = clasificarCustodia({
    itemsDeclarados: 3,
    itemsContados: 1,
    incompletoConfirmado: true,
    itemsSinDte: 1,
    tsDispositivo: enMinutos(AHORA, -RELOJ.drift_max_minutos - 30),
    recibidaEn: AHORA,
    moduloEncendido: false,
    shaPrometido: "a".repeat(64),
    shaRecalculado: "b".repeat(64),
  });
  assert.equal(flags.length, FLAGS_DE_CUSTODIA.length);
  assert.deepEqual([...flags].sort(), [...FLAGS_DE_CUSTODIA].sort());
  // Y aun así entra: es lo que separa «lo tenemos y sabemos que hay que mirarlo» de no tenerlo.
  assert.equal(rechaza(flags), false);
});
