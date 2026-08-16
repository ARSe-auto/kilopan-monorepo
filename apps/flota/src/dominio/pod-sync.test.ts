import test from "node:test";
import assert from "node:assert/strict";
import { RELOJ, REVOCACION } from "../../../../packages/nucleo-comun/src/constants.ts";
import {
  clasificarCapturaPod,
  rechaza,
  dejaRastro,
  severidadDeFlag,
  esHuecoDeSecuencia,
  maximaConSecuencia,
  SEVERIDAD_DE_CAPTURA_POD,
  SEVERIDAD_SIN_MANIFIESTO_CONFIRMADO,
  FLAGS_DE_CAPTURA_POD,
  type CapturaPod,
} from "./pod-sync.ts";

// Mutantes de la degradación de una captura de POD [AC-FPOD-05, AC-FPOD-06] — centinela 4 §9.3.
//
// El borde se deriva de `RELOJ.drift_max_minutos` del §0 y no se escribe literal: el gate de
// constantes marcaría una copia, y el test seguiría diciendo lo de antes si el dueño moviera el
// umbral.
//
// Los casos de SOC fuera de rango y odómetro retrocedido NO se repiten acá: son atributos de una
// lectura de vehículo (`dominio/lecturas.ts`, AC-FVEH-05 ya cerrado) y la entrega del POD no
// lleva ninguno de los dos — reimplementarlos sería una segunda copia del mismo criterio.

const AHORA = new Date("2026-08-11T12:00:00Z");
const enMinutos = (base: Date, m: number) => new Date(base.getTime() + m * 60 * 1000);

const base: CapturaPod = {
  tsDispositivo: AHORA,
  recibidaEn: AHORA,
  moduloEncendido: true,
  revocadoEn: null,
  secuenciaHueco: false,
};

test("ninguna combinación de flags rechaza jamás (centinela 4)", () => {
  const total = 1 << FLAGS_DE_CAPTURA_POD.length;
  for (let mascara = 0; mascara < total; mascara++) {
    const flags = FLAGS_DE_CAPTURA_POD.filter((_, i) => mascara & (1 << i));
    assert.equal(rechaza(flags), false, `rechazó con [${flags.join(", ")}]`);
  }
});

test("una captura con el reloj sincronizado no levanta ninguna bandera", () => {
  assert.deepEqual(clasificarCapturaPod(base), []);
});

test("el borde de tolerancia del reloj: justo en el límite entra limpio", () => {
  const justo = { ...base, tsDispositivo: enMinutos(AHORA, -RELOJ.drift_max_minutos) };
  assert.deepEqual(clasificarCapturaPod(justo), []);
});

test("pasado el límite se marca, y en los DOS sentidos, y NUNCA rechaza", () => {
  // Un reloj adelantado es tan sospechoso como uno atrasado. Comparando sin valor absoluto,
  // solo uno de los dos signos se ve — y el que se escapa es el que fecha una entrega de hoy
  // como de mañana.
  for (const signo of [-1, 1]) {
    const desfasada: CapturaPod = {
      ...base,
      tsDispositivo: enMinutos(AHORA, signo * (RELOJ.drift_max_minutos + 1)),
    };
    const flags = clasificarCapturaPod(desfasada);
    assert.deepEqual(flags, ["reloj_desfasado"], `signo ${signo}`);
    assert.equal(rechaza(flags), false);
  }
});

test("un replay offline de horas después también flaguea, y tampoco rechaza", () => {
  // El mismo criterio de `lecturas.ts` y `custodia.ts`: el desfase compara `ts_dispositivo`
  // contra `record_time` (cuándo lo supo el SERVIDOR), y el servidor no puede distinguir «el
  // reloj del aparato está mal» de «estuvo offline horas» — las dos dejan la misma brecha. Por
  // eso la respuesta NO es rechazar (el chofer ya se fue de la parada, §3.E1.7): es dejarlo
  // dicho en «Por revisar» y que una persona lo mire con el resto del contexto.
  const recibidaEn = enMinutos(AHORA, 180);
  const flags = clasificarCapturaPod({ ...base, recibidaEn });
  assert.deepEqual(flags, ["reloj_desfasado"]);
  assert.equal(rechaza(flags), false);
});

// ─── El módulo apagado con turno abierto [AC-FPOD-06] — §0 HTTP, §5.5, §4.4 ─────────

test("el módulo apagado en la config CONGELADA del turno marca la captura, y no rechaza", () => {
  const apagado: CapturaPod = { ...base, moduloEncendido: false };
  const flags = clasificarCapturaPod(apagado);
  assert.deepEqual(flags, ["modulo_apagado"]);
  assert.equal(rechaza(flags), false);
});

test("módulo apagado Y reloj corrido se marcan los DOS, y ninguno de más", () => {
  const desfasada: CapturaPod = {
    tsDispositivo: AHORA,
    recibidaEn: enMinutos(AHORA, RELOJ.drift_max_minutos + 1),
    moduloEncendido: false,
    revocadoEn: null,
    secuenciaHueco: false,
  };
  const flags = clasificarCapturaPod(desfasada);
  assert.deepEqual(flags, ["modulo_apagado", "reloj_desfasado"]);
  assert.equal(rechaza(flags), false);
});

test("módulo encendido no deja ningún rastro del flag", () => {
  assert.deepEqual(clasificarCapturaPod({ ...base, moduloEncendido: true }), []);
});

// ─── Captura de un aparato revocado [AC-FPOD-07] — §4.3, centinela 4 §9.3 ───────────
//
// El umbral se lee de `REVOCACION.ventana_horas`, nunca escrito literal acá — mismo motivo que
// arriba con `RELOJ.drift_max_minutos`: si el dueño mueve el umbral, este test sigue siendo
// cierto, y si alguien lo copiara en el código el gate de constantes lo marcaría.

const enHorasDesdeRevocacion = (revocadoEn: Date, h: number) => new Date(revocadoEn.getTime() + h * 3_600_000);

test("un aparato que nunca fue revocado no marca nada", () => {
  assert.deepEqual(clasificarCapturaPod({ ...base, revocadoEn: null }), []);
});

test("captura DENTRO de la ventana: flag post_revocacion, y JAMÁS rechaza", () => {
  const revocadoEn = AHORA;
  for (const h of [0, 1, REVOCACION.ventana_horas - 1, REVOCACION.ventana_horas]) {
    // El reloj del aparato viaja CON `recibidaEn` a propósito: este test aísla la clasificación
    // por revocación, y un desfase de horas activaría también `reloj_desfasado` sin que eso
    // tenga que ver con lo que se está probando acá.
    const recibidaEn = enHorasDesdeRevocacion(revocadoEn, h);
    const flags = clasificarCapturaPod({ ...base, tsDispositivo: recibidaEn, recibidaEn, revocadoEn });
    assert.deepEqual(flags, ["post_revocacion"], `a las ${h} h`);
    assert.equal(rechaza(flags), false);
  }
});

test("captura FUERA de la ventana: flag post_revocacion_tardia, y JAMÁS rechaza", () => {
  const revocadoEn = AHORA;
  const apenas = new Date(enHorasDesdeRevocacion(revocadoEn, REVOCACION.ventana_horas).getTime() + 1);
  for (const recibidaEn of [apenas, enHorasDesdeRevocacion(revocadoEn, REVOCACION.ventana_horas * 10)]) {
    const flags = clasificarCapturaPod({ ...base, tsDispositivo: recibidaEn, recibidaEn, revocadoEn });
    assert.deepEqual(flags, ["post_revocacion_tardia"]);
    assert.equal(rechaza(flags), false);
  }
});

test("revocación Y reloj corrido se marcan los DOS, y ninguno de más", () => {
  const revocadoEn = AHORA;
  const recibidaEn = enHorasDesdeRevocacion(revocadoEn, REVOCACION.ventana_horas * 10);
  const flags = clasificarCapturaPod({
    tsDispositivo: enMinutos(recibidaEn, RELOJ.drift_max_minutos + 1),
    recibidaEn,
    moduloEncendido: true,
    revocadoEn,
    secuenciaHueco: false,
  });
  assert.deepEqual(flags, ["reloj_desfasado", "post_revocacion_tardia"]);
  assert.equal(rechaza(flags), false);
});

test("post_revocacion no deja rastro; las demás sí, incluida la revocación tardía y el hueco de secuencia", () => {
  assert.equal(dejaRastro("post_revocacion"), false);
  for (const flag of [
    "modulo_apagado",
    "reloj_desfasado",
    "post_revocacion_tardia",
    "secuencia_hueco",
  ] as const) {
    assert.equal(dejaRastro(flag), true, `${flag} debería dejar rastro`);
  }
});

test("severidad: post_revocacion_tardia sube a alta; el resto —incluido el hueco de secuencia— queda en la de siempre", () => {
  assert.equal(severidadDeFlag("post_revocacion_tardia"), "alta");
  assert.equal(severidadDeFlag("modulo_apagado"), SEVERIDAD_DE_CAPTURA_POD);
  assert.equal(severidadDeFlag("reloj_desfasado"), SEVERIDAD_DE_CAPTURA_POD);
  assert.equal(severidadDeFlag("secuencia_hueco"), SEVERIDAD_DE_CAPTURA_POD);
});

// ─── Secuencia monotónica por dispositivo [AC-FPOD-10] — §4.7, centinela 4 §9.3 ─────

test("secuenciaHueco=true marca la captura, y no rechaza", () => {
  const conHueco: CapturaPod = { ...base, secuenciaHueco: true };
  const flags = clasificarCapturaPod(conHueco);
  assert.deepEqual(flags, ["secuencia_hueco"]);
  assert.equal(rechaza(flags), false);
});

test("hueco de secuencia Y reloj corrido se marcan los DOS, y ninguno de más", () => {
  const desfasada: CapturaPod = {
    tsDispositivo: AHORA,
    recibidaEn: enMinutos(AHORA, RELOJ.drift_max_minutos + 1),
    moduloEncendido: true,
    revocadoEn: null,
    secuenciaHueco: true,
  };
  const flags = clasificarCapturaPod(desfasada);
  assert.deepEqual(flags, ["reloj_desfasado", "secuencia_hueco"]);
  assert.equal(rechaza(flags), false);
});

test("esHuecoDeSecuencia: sin captura previa aterrizada, la primera NUNCA es un hueco — fija el punto de partida", () => {
  for (const secuencia of [1, 2, 47, 9_999]) {
    assert.equal(esHuecoDeSecuencia(null, secuencia), false, `secuencia ${secuencia}`);
  }
});

test("esHuecoDeSecuencia: el siguiente exacto nunca es un hueco", () => {
  for (const maxima of [1, 2, 99]) {
    assert.equal(esHuecoDeSecuencia(maxima, maxima + 1), false, `maxima ${maxima}`);
  }
});

test("esHuecoDeSecuencia: saltarse un número —evicción del outbox o manipulación— SÍ es un hueco", () => {
  assert.equal(esHuecoDeSecuencia(5, 7), true, "saltó el 6");
  assert.equal(esHuecoDeSecuencia(5, 100), true, "saltó 94 números");
});

test("esHuecoDeSecuencia: una repetición o un retroceso NO son un hueco — eso lo cubre la idempotencia del client_uuid", () => {
  assert.equal(esHuecoDeSecuencia(5, 5), false, "repetida");
  assert.equal(esHuecoDeSecuencia(5, 3), false, "retrocedida");
});

test("maximaConSecuencia: sin máxima previa, la primera secuencia ES la máxima", () => {
  assert.equal(maximaConSecuencia(null, 7), 7);
});

test("maximaConSecuencia: crece con lo más alto visto, y un hueco no descarta lo que sí llegó", () => {
  assert.equal(maximaConSecuencia(5, 7), 7, "saltó el 6, pero el 7 sí aterrizó y ahora es la máxima");
  assert.equal(maximaConSecuencia(5, 3), 5, "una llegada retrasada no baja la máxima ya vista");
});

// ─── El contrato de transporte del binario [AC-FPOD-19] — §4.6, centinela 4 §9.3 ────

test("sin promesa de sha256 no hay mismatch, aunque llegue un binario", () => {
  assert.deepEqual(clasificarCapturaPod({ ...base, shaRecalculado: "b".repeat(64) }), []);
});

test("promesa SIN binario todavía no es un mismatch — es la ventana normal entre la mutación y la subida", () => {
  assert.deepEqual(clasificarCapturaPod({ ...base, shaPrometido: "a".repeat(64) }), []);
});

test("el binario que no re-hashea como lo prometido degrada, y no rechaza", () => {
  const flags = clasificarCapturaPod({
    ...base,
    shaPrometido: "a".repeat(64),
    shaRecalculado: "b".repeat(64),
  });
  assert.deepEqual(flags, ["sha256_mismatch"]);
  assert.equal(rechaza(flags), false);
});

test("el binario que SÍ re-hashea igual no degrada — mayúsculas incluidas (hex case-insensitive)", () => {
  assert.deepEqual(
    clasificarCapturaPod({ ...base, shaPrometido: "a".repeat(64), shaRecalculado: "A".repeat(64) }),
    [],
  );
});

test("mismatch de sha256 y reloj corrido se marcan los DOS, y ninguno de más", () => {
  const desfasada: CapturaPod = {
    tsDispositivo: AHORA,
    recibidaEn: enMinutos(AHORA, RELOJ.drift_max_minutos + 1),
    moduloEncendido: true,
    revocadoEn: null,
    secuenciaHueco: false,
    shaPrometido: "a".repeat(64),
    shaRecalculado: "b".repeat(64),
  };
  const flags = clasificarCapturaPod(desfasada);
  assert.deepEqual(flags, ["reloj_desfasado", "sha256_mismatch"]);
  assert.equal(rechaza(flags), false);
});

test("sha256_mismatch deja rastro y entra con la severidad de siempre", () => {
  assert.equal(dejaRastro("sha256_mismatch"), true);
  assert.equal(severidadDeFlag("sha256_mismatch"), SEVERIDAD_DE_CAPTURA_POD);
});

// ─── El candado del SERVIDOR sobre el POD que llega por sync [AC-FRUT-23] — KR-29 ────

test("[AC-FRUT-23] POD sin el manifiesto de su carga confirmado: flag, y NO rechazo", () => {
  const flags = clasificarCapturaPod({ ...base, manifiestoConfirmado: false });
  assert.deepEqual(flags, ["sin_manifiesto_confirmado"]);
  // §9.3.4, centinela 4: el pan ya se entregó y un rebote no devuelve la parada, la borra.
  assert.equal(rechaza(flags), false);
});

test("[AC-FRUT-23] con el manifiesto confirmado no hay flag", () => {
  assert.deepEqual(clasificarCapturaPod({ ...base, manifiestoConfirmado: true }), []);
});

test("[AC-FRUT-23] SIN juicio de candado (undefined) tampoco hay flag: ausencia no es «sin confirmar»", () => {
  // La subida del binario de una evidencia y la parada que no es de entrega no juzgan candado.
  // Leer `undefined` como «sin confirmar» llenaría «Por revisar» de severidad alta desde el día 1.
  assert.deepEqual(clasificarCapturaPod(base), []);
});

test("[AC-FRUT-23] el POD sin manifiesto deja rastro y sube a severidad ALTA", () => {
  assert.equal(dejaRastro("sin_manifiesto_confirmado"), true);
  assert.equal(severidadDeFlag("sin_manifiesto_confirmado"), SEVERIDAD_SIN_MANIFIESTO_CONFIRMADO);
  // Alta, y por eso distinta del resto: lo que falta es el ancla documental del art. 55 DL 825
  // (§7.3), no algo que el terreno explique como un teléfono con la hora corrida.
  assert.notEqual(SEVERIDAD_SIN_MANIFIESTO_CONFIRMADO, SEVERIDAD_DE_CAPTURA_POD);
});

test("[AC-FRUT-23] el candado se acumula con las otras degradaciones, sin tapar ninguna", () => {
  const flags = clasificarCapturaPod({
    ...base,
    recibidaEn: enMinutos(AHORA, RELOJ.drift_max_minutos + 1),
    moduloEncendido: false,
    manifiestoConfirmado: false,
  });
  assert.deepEqual(flags, ["modulo_apagado", "reloj_desfasado", "sin_manifiesto_confirmado"]);
  assert.equal(rechaza(flags), false);
});
