import test from "node:test";
import assert from "node:assert/strict";
import { EV, SOC } from "./constants.ts";
import {
  rangoEfectivoKm,
  reservaKm,
  maxDistanceKm,
  semaforoDeSalida,
  umbralDeAlerta,
  factorDe,
  reservaPctDe,
  type DatosEv,
} from "./energia.ts";

// Mutantes de la fórmula única de energía [AC-FVEH-09] — §0, §3.E1.12.
//
// Ni un número de la familia canónica escrito acá: el factor, la reserva y los umbrales se
// derivan de `EV`. Escritos literales, este archivo sería él mismo una copia de la familia —el
// gate de constantes lo marcaría— y el test seguiría diciendo lo de antes si el dueño moviera
// un default, que es justo cuando hay que enterarse.

/** Un vehículo con ficha completa. Los números NO son del EV48: el seed real es la pregunta 4
 *  de la spec 02 y sigue abierta. Estos son redondos a propósito, para que la aritmética del
 *  test se pueda leer sin calculadora. */
const conFicha: DatosEv = { autonomiaNominalKm: 300, sohPct: SOC.maximo };

// ─── El rango efectivo NO lleva reserva ──────────────────────────────────────────────

test("rango efectivo = autonomía × SOH × factor, y nada más", () => {
  assert.equal(rangoEfectivoKm(conFicha), 300 * EV.factor_consumo_default);
});

test("EL ERROR CARO: el rango efectivo no puede traer la reserva restada", () => {
  // Es el defecto que este archivo existe para impedir. Si el rango ya viniera con la reserva
  // adentro, el semáforo la restaría de nuevo y el camión aparecería «sin alcance» con media
  // batería — hasta que el operador aprende a ignorar el semáforo.
  const rango = rangoEfectivoKm(conFicha)!;
  const conReservaRestada = 300 * EV.factor_consumo_default * (1 - EV.reserva_pct_default / SOC.maximo);
  assert.notEqual(rango, conReservaRestada);
  assert.ok(rango > conReservaRestada, "el rango efectivo tiene que ser MAYOR que el rango con reserva");
});

test("el SOH degrada el rango de forma proporcional", () => {
  const mitad = rangoEfectivoKm({ autonomiaNominalKm: 300, sohPct: SOC.maximo / 2 })!;
  assert.equal(mitad, rangoEfectivoKm(conFicha)! / 2);
});

test("un override de `parametros` reemplaza al default sin tocar el resto", () => {
  const propio = EV.factor_consumo_default / 2;
  assert.equal(factorDe({ factorConsumo: propio }), propio);
  assert.equal(factorDe({}), EV.factor_consumo_default);
  // `null` es «no hay fila en parametros», no «cero»: tiene que caer al default.
  assert.equal(factorDe({ factorConsumo: null }), EV.factor_consumo_default);
  assert.equal(reservaPctDe({ reservaPct: null }), EV.reserva_pct_default);
  assert.equal(rangoEfectivoKm(conFicha, { factorConsumo: propio }), 300 * propio);
});

// ─── Sin ficha no hay cálculo: `null`, jamás un número de folleto ────────────────────

test("falta un dato EV ⇒ null, y NUNCA un cero", () => {
  // Un cero se ve igual que «no llega a ninguna parte», y un vehículo recién dado de alta llega
  // perfectamente: lo que falta es la ficha, no la batería (§5.4, alta progresiva).
  for (const datos of [
    { autonomiaNominalKm: null, sohPct: SOC.maximo },
    { autonomiaNominalKm: 300, sohPct: null },
    { autonomiaNominalKm: null, sohPct: null },
  ] as DatosEv[]) {
    assert.equal(rangoEfectivoKm(datos), null, JSON.stringify(datos));
    assert.equal(maxDistanceKm(50, datos), null);
    assert.equal(semaforoDeSalida(50, 100, datos), "sin_datos");
  }
});

test("una autonomía no positiva tampoco produce cálculo", () => {
  assert.equal(rangoEfectivoKm({ autonomiaNominalKm: 0, sohPct: SOC.maximo }), null);
  assert.equal(rangoEfectivoKm({ autonomiaNominalKm: -10, sohPct: SOC.maximo }), null);
});

// ─── max_distance: la reserva se resta UNA vez ───────────────────────────────────────

test("max_distance = SOC% × rango − reserva, exactamente una vez", () => {
  const rango = rangoEfectivoKm(conFicha)!;
  const esperado = (SOC.maximo / SOC.maximo) * rango - reservaKm(rango);
  assert.equal(maxDistanceKm(SOC.maximo, conFicha), esperado);
});

test("con la batería llena, lo alcanzable es el rango MENOS la reserva y no menos que eso", () => {
  // El mutante de la doble resta: si alguien la restara dos veces, este número bajaría.
  const rango = rangoEfectivoKm(conFicha)!;
  const alcance = maxDistanceKm(SOC.maximo, conFicha)!;
  const doble = rango - reservaKm(rango) * 2;
  assert.ok(alcance > doble, "la reserva se está restando dos veces");
  assert.equal(alcance, rango - reservaKm(rango));
});

test("el alcance nunca es negativo: un camión no recorre menos que cero", () => {
  // Con menos carga que su propia reserva. Un número negativo en pantalla se lee como un error
  // de la app, no como «este camión no sale».
  const alcance = maxDistanceKm(SOC.minimo + 1, conFicha)!;
  assert.ok(alcance >= 0, `alcance negativo: ${alcance}`);
});

test("más carga nunca da menos alcance", () => {
  // Monotonía: barata de verificar y atrapa cualquier signo invertido en la fórmula.
  let previo = -1;
  for (let soc = SOC.minimo; soc <= SOC.maximo; soc += 10) {
    const alcance = maxDistanceKm(soc, conFicha)!;
    assert.ok(alcance >= previo, `con SOC ${soc} el alcance bajó`);
    previo = alcance;
  }
});

// ─── El semáforo ─────────────────────────────────────────────────────────────────────

test("alcanza cuando lo disponible cubre el plan; no alcanza cuando no", () => {
  const alcance = maxDistanceKm(SOC.maximo, conFicha)!;
  assert.equal(semaforoDeSalida(SOC.maximo, alcance, conFicha), "alcanza");
  assert.equal(semaforoDeSalida(SOC.maximo, alcance - 1, conFicha), "alcanza");
  assert.equal(semaforoDeSalida(SOC.maximo, alcance + 1, conFicha), "no_alcanza");
});

test("sin plan del día no se afirma «no alcanza»: se dice que faltan datos", () => {
  // Afirmar «no alcanza» sin saber cuántos kilómetros hay que hacer es inventar un veredicto.
  assert.equal(semaforoDeSalida(SOC.maximo, null, conFicha), "sin_datos");
  assert.equal(semaforoDeSalida(null, 100, conFicha), "sin_datos");
});

// ─── Umbrales de alerta ──────────────────────────────────────────────────────────────

test("cada umbral de la familia dispara justo en su valor", () => {
  for (const umbral of EV.umbrales_alerta_pct) {
    assert.equal(umbralDeAlerta(umbral), Math.min(...EV.umbrales_alerta_pct.filter((u) => u >= umbral)));
  }
});

test("por encima del umbral más alto no hay banner", () => {
  const masAlto = Math.max(...EV.umbrales_alerta_pct);
  assert.equal(umbralDeAlerta(masAlto + 1), null);
});

test("se avisa el umbral MÁS BAJO cruzado, que es el que describe la situación", () => {
  const masBajo = Math.min(...EV.umbrales_alerta_pct);
  assert.equal(umbralDeAlerta(SOC.minimo), masBajo);
});
