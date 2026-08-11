import test from "node:test";
import assert from "node:assert/strict";
import { RELOJ, REVOCACION } from "../../../../packages/nucleo-comun/src/constants.ts";
import {
  clasificarCapturaPod,
  rechaza,
  dejaRastro,
  severidadDeFlag,
  SEVERIDAD_DE_CAPTURA_POD,
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
  });
  assert.deepEqual(flags, ["reloj_desfasado", "post_revocacion_tardia"]);
  assert.equal(rechaza(flags), false);
});

test("post_revocacion no deja rastro; las demás sí, incluida la revocación tardía", () => {
  assert.equal(dejaRastro("post_revocacion"), false);
  for (const flag of ["modulo_apagado", "reloj_desfasado", "post_revocacion_tardia"] as const) {
    assert.equal(dejaRastro(flag), true, `${flag} debería dejar rastro`);
  }
});

test("severidad: post_revocacion_tardia sube a alta; el resto queda en la severidad de siempre", () => {
  assert.equal(severidadDeFlag("post_revocacion_tardia"), "alta");
  assert.equal(severidadDeFlag("modulo_apagado"), SEVERIDAD_DE_CAPTURA_POD);
  assert.equal(severidadDeFlag("reloj_desfasado"), SEVERIDAD_DE_CAPTURA_POD);
});
