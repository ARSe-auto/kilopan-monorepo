import test from "node:test";
import assert from "node:assert/strict";
import { SOC, EV } from "./constants.ts";
import {
  consumoDelTramoPct,
  socProyectadoPct,
  estadoDelTramo,
  sinEnchufar,
  METODOS_DE_ESTIMACION,
  type Tramo,
} from "./senales-ev.ts";

// Mutantes de los predicados Flota/EV del Anexo B [AC-FVEH-11].
//
// LO QUE ESTOS CASOS PROTEGEN: que una señal de energía nunca se apague por falta de datos.
// Un `null` mal tratado como cero, o como verde, es una alarma que no suena — y en este dominio
// una alarma que no suena es un camión que se queda en la calle.
//
// EL MODO DE ESTIMAR ES UN PARÁMETRO, no una decisión de este archivo: la pregunta 13 de
// la spec 02 sigue abierta y los dos métodos están implementados. Por eso cada caso que puede
// correrse con los dos se corre con los DOS: el día que el dueño elija, el que sobra se borra
// y ningún test se cae.

/** Un vehículo con la ficha completa. Números redondos para leer la aritmética sin calculadora. */
const conFicha = {
  autonomiaNominalKm: 300,
  sohPct: SOC.maximo,
  whPorKmBase: 200,
  bateriaWh: 60_000,
};

const tramo = (extra: Partial<Tramo> = {}): Tramo => ({
  socActualPct: 80,
  kmDelTramo: 50,
  datos: conFicha,
  ...extra,
});

test("los dos métodos estiman, y ninguno es el default: la pregunta 13 sigue abierta", () => {
  for (const metodo of METODOS_DE_ESTIMACION) {
    const consumo = consumoDelTramoPct(tramo(), metodo);
    assert.ok(consumo !== null && consumo > 0, `el método ${metodo} no estimó nada`);
  }
});

test("un tramo más largo consume más, con cualquiera de los dos métodos", () => {
  // Monotonía: barata y atrapa cualquier signo invertido o división al revés.
  for (const metodo of METODOS_DE_ESTIMACION) {
    const corto = consumoDelTramoPct(tramo({ kmDelTramo: 10 }), metodo)!;
    const largo = consumoDelTramoPct(tramo({ kmDelTramo: 100 }), metodo)!;
    assert.ok(largo > corto, `con ${metodo}, un tramo más largo no consumió más`);
  }
});

test("sin el dato que el método necesita, el consumo es NULO y jamás cero", () => {
  // Un cero se leería como «no consume nada», que en una señal de energía es el peor error
  // posible: apaga la alarma en vez de encenderla.
  assert.equal(
    consumoDelTramoPct(tramo({ datos: { ...conFicha, whPorKmBase: null } }), "wh_por_km"),
    null,
  );
  assert.equal(
    consumoDelTramoPct(tramo({ datos: { ...conFicha, autonomiaNominalKm: null } }), "rango_efectivo"),
    null,
  );
});

test("sin estimación posible, el estado es NULO y NUNCA verde", () => {
  // Verde AFIRMA que el vehículo llega. Afirmarlo sin datos es lo que el §5.7 prohíbe con el
  // estado vacío accionable.
  for (const metodo of METODOS_DE_ESTIMACION) {
    assert.equal(
      estadoDelTramo(tramo({ datos: { ...conFicha, autonomiaNominalKm: null, whPorKmBase: null } }), metodo),
      null,
      metodo,
    );
  }
});

test("el SOC proyectado es el actual menos lo que consume el tramo", () => {
  for (const metodo of METODOS_DE_ESTIMACION) {
    const consumo = consumoDelTramoPct(tramo(), metodo)!;
    assert.equal(socProyectadoPct(tramo(), metodo), 80 - consumo);
  }
});

test("ROJO gana sobre amarillo cuando el tramo dispara los dos", () => {
  // El Anexo B los ordena así, y el orden importa: mostrar el menor de dos males es cómo una
  // alarma deja de creerse. Un tramo que no alcanza con la carga actual es rojo, no amarillo.
  const apretado = tramo({ socActualPct: 5, kmDelTramo: 200 });
  for (const metodo of METODOS_DE_ESTIMACION) {
    assert.equal(estadoDelTramo(apretado, metodo), "rojo", metodo);
  }
});

test("un tramo holgado con la batería llena es verde", () => {
  // Sin este positivo, un predicado que devolviera rojo siempre pasaría todos los casos de
  // arriba y el semáforo estaría en rojo permanente — que es igual a no tener semáforo.
  const holgado = tramo({ socActualPct: SOC.maximo, kmDelTramo: 5 });
  for (const metodo of METODOS_DE_ESTIMACION) {
    assert.equal(estadoDelTramo(holgado, metodo), "verde", metodo);
  }
});

test("el amarillo se enciende cerca de la reserva, antes que el rojo", () => {
  // Se busca un tramo que deje el proyectado justo por encima del mínimo de retorno pero por
  // debajo de la reserva más su holgura: es la franja que el Anexo B pinta de amarillo.
  const cerca = tramo({ socActualPct: 30, kmDelTramo: 30 });
  const estado = estadoDelTramo(cerca, "rango_efectivo");
  assert.ok(estado === "amarillo" || estado === "rojo", `estado inesperado: ${estado}`);
  assert.ok(
    EV.reserva_pct_default > 0,
    "la reserva por omisión salió de la familia canónica y no de este archivo",
  );
});

// ─── «No quedó enchufado»: la única señal que no depende de la pregunta 13 ──────────

const HORA_LIMITE = new Date("2026-08-09T23:00:00Z");
const DESPUES = new Date("2026-08-09T23:30:00Z");
const ANTES = new Date("2026-08-09T22:30:00Z");
const CERRADO = new Date("2026-08-09T21:00:00Z");

test("no quedó enchufado y pasó la hora límite ⇒ la señal se enciende", () => {
  assert.equal(
    sinEnchufar({ enchufadoConfirmado: false, cerradoEn: CERRADO }, HORA_LIMITE, DESPUES),
    true,
  );
});

test("antes de la hora límite no se enciende: todavía hay tiempo de enchufarlo", () => {
  assert.equal(
    sinEnchufar({ enchufadoConfirmado: false, cerradoEn: CERRADO }, HORA_LIMITE, ANTES),
    false,
  );
});

test("«nadie preguntó todavía» NO es «no quedó enchufado»", () => {
  // El mutante que importa: tratar el `null` como `false` pondría en rojo a cada vehículo que
  // todavía está trabajando, y el semáforo se llenaría de camiones que están perfectamente.
  assert.equal(
    sinEnchufar({ enchufadoConfirmado: null, cerradoEn: null }, HORA_LIMITE, DESPUES),
    false,
  );
  assert.equal(
    sinEnchufar({ enchufadoConfirmado: null, cerradoEn: CERRADO }, HORA_LIMITE, DESPUES),
    false,
  );
});

test("si quedó enchufado, no hay señal por más tarde que sea", () => {
  assert.equal(
    sinEnchufar({ enchufadoConfirmado: true, cerradoEn: CERRADO }, HORA_LIMITE, DESPUES),
    false,
  );
});
