import test from "node:test";
import assert from "node:assert/strict";
import { RELOJ } from "../../../../packages/nucleo-comun/src/constants.ts";
import { clasificarCapturaPod, rechaza, FLAGS_DE_CAPTURA_POD, type CapturaPod } from "./pod-sync.ts";

// Mutantes de la degradación de una captura de POD [AC-FPOD-05] — centinela 4 del §9.3.
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

const base: CapturaPod = { tsDispositivo: AHORA, recibidaEn: AHORA };

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
  const flags = clasificarCapturaPod({ tsDispositivo: AHORA, recibidaEn });
  assert.deepEqual(flags, ["reloj_desfasado"]);
  assert.equal(rechaza(flags), false);
});
