import test from "node:test";
import assert from "node:assert/strict";
import { SOC, RELOJ } from "../../../../packages/nucleo-comun/src/constants.ts";
import {
  clasificar,
  rechaza,
  valorProyectado,
  quedanCapturasDeSoc,
  FLAGS,
  type Lectura,
} from "./lecturas.ts";

// Mutantes de la degradación de una lectura [AC-FVEH-05] — centinela 4 del §9.3.
//
// Ni un número de la familia canónica escrito acá: los bordes se derivan de `SOC` y `RELOJ`
// del §0. Escribirlos literales haría de este archivo una copia de la familia —el gate de
// constantes lo marcaría— y, peor, el test seguiría diciendo lo de antes si el dueño moviera
// un umbral.

const AHORA = new Date("2026-08-09T12:00:00Z");
const enMinutos = (base: Date, m: number) => new Date(base.getTime() + m * 60 * 1000);

const base: Lectura = {
  magnitud: "soc",
  valor: 50,
  anterior: null,
  tsDispositivo: AHORA,
  recibidaEn: AHORA,
  tieneTurno: true,
  moduloEncendido: true,
  capturasDeSocEnElTurno: 0,
};

// ─── Ninguna rechaza. Es el invariante del centinela 4 ───────────────────────────────

test("ninguna combinación de flags rechaza jamás", () => {
  // Se recorre el conjunto POTENCIA de los flags: si algún día alguien agrega una condición
  // que rebota, no alcanza con que este test mire los casos que se le ocurrieron a quien lo
  // escribió. Rechazos = 0, con esas palabras (§9.3.4).
  const total = 1 << FLAGS.length;
  for (let mascara = 0; mascara < total; mascara++) {
    const flags = FLAGS.filter((_, i) => mascara & (1 << i));
    assert.equal(rechaza(flags), false, `rechazó con [${flags.join(", ")}]`);
  }
});

test("una lectura sana no levanta ninguna bandera", () => {
  assert.deepEqual(clasificar(base), []);
});

// ─── SOC fuera de rango ──────────────────────────────────────────────────────────────

test("los bordes del SOC entran limpios, y uno más allá levanta bandera", () => {
  for (const valor of [SOC.minimo, SOC.maximo]) {
    assert.deepEqual(clasificar({ ...base, valor }), [], `SOC ${valor}`);
  }
  for (const valor of [SOC.minimo - 1, SOC.maximo + 1]) {
    assert.deepEqual(clasificar({ ...base, valor }), ["soc_fuera_de_rango"], `SOC ${valor}`);
  }
});

test("la proyección del SOC queda ACOTADA, y la lectura conserva lo declarado", () => {
  // El CHECK 0–100 vive solo en la proyección (§0 fila SOC). Sin el acotado, un 150 declarado
  // tumbaría la transacción de una CAPTURA — justo lo que el §4.2 prohíbe.
  assert.equal(valorProyectado({ ...base, valor: SOC.maximo + 50 }), SOC.maximo);
  assert.equal(valorProyectado({ ...base, valor: SOC.minimo - 50 }), SOC.minimo);
  assert.equal(valorProyectado({ ...base, valor: 42 }), 42);
});

test("un odómetro fuera de 0–100 NO es SOC fuera de rango", () => {
  // El mutante obvio: aplicar el rango del SOC a toda lectura dejaría todo odómetro real
  // marcado, y la bandeja «Por revisar» se volvería ruido el primer día.
  assert.deepEqual(clasificar({ ...base, magnitud: "odometro", valor: 120_000 }), []);
});

// ─── Odómetro: monotonicidad SUAVE ───────────────────────────────────────────────────

test("un odómetro menor al anterior entra CON bandera, y la proyección no lo sigue", () => {
  const lectura: Lectura = { ...base, magnitud: "odometro", valor: 12_000, anterior: 120_000 };
  assert.deepEqual(clasificar(lectura), ["odometro_retrocedido"]);
  assert.equal(rechaza(clasificar(lectura)), false);
  // La serie guarda 12.000 —lo que la persona declaró—; la proyección se queda con 120.000,
  // porque un odómetro físico no retrocede y el próximo tramo se calcula contra ella.
  assert.equal(valorProyectado(lectura), 120_000);
});

test("el mismo odómetro dos veces no es retroceso, y uno mayor tampoco", () => {
  const igual: Lectura = { ...base, magnitud: "odometro", valor: 120_000, anterior: 120_000 };
  assert.deepEqual(clasificar(igual), []);
  assert.equal(valorProyectado(igual), 120_000);
  const mayor: Lectura = { ...base, magnitud: "odometro", valor: 120_500, anterior: 120_000 };
  assert.deepEqual(clasificar(mayor), []);
  assert.equal(valorProyectado(mayor), 120_500);
});

test("la primera lectura de un vehículo no puede retroceder contra nada", () => {
  const primera: Lectura = { ...base, magnitud: "odometro", valor: 7, anterior: null };
  assert.deepEqual(clasificar(primera), []);
  assert.equal(valorProyectado(primera), 7);
});

// ─── Reloj ───────────────────────────────────────────────────────────────────────────

test("el borde de tolerancia del reloj: justo en el límite entra limpio", () => {
  const justo = { ...base, tsDispositivo: enMinutos(AHORA, -RELOJ.drift_max_minutos) };
  assert.deepEqual(clasificar(justo), []);
});

test("pasado el límite se marca, y en los DOS sentidos", () => {
  // Un reloj adelantado es tan sospechoso como uno atrasado. Comparando sin valor absoluto,
  // solo uno de los dos signos se ve — y el que se escapa es el que fecha una captura de hoy
  // como de mañana.
  for (const signo of [-1, 1]) {
    const desfasada = {
      ...base,
      tsDispositivo: enMinutos(AHORA, signo * (RELOJ.drift_max_minutos + 1)),
    };
    assert.deepEqual(clasificar(desfasada), ["reloj_desfasado"], `signo ${signo}`);
  }
});

// ─── Sin turno ───────────────────────────────────────────────────────────────────────

test("una lectura sin turno entra igual, con su bandera", () => {
  // `reading` es genérica (§4.6): su turno es opcional. Sin turno no hay vehículo al que
  // proyectar, pero rechazarla rompería la regla de oro por un caso que el maestro no prohíbe.
  const suelta: Lectura = { ...base, tieneTurno: false };
  assert.deepEqual(clasificar(suelta), ["sin_turno"]);
  assert.equal(rechaza(clasificar(suelta)), false);
});

test("el módulo apagado marca la captura y NO la rechaza (§0, fila HTTP)", () => {
  // El caso donde la regla de oro se ve más clara: el dueño apagó un módulo en una oficina y el
  // chofer ya había tecleado el dato en la calle. La captura entra igual, con su bandera.
  const conModuloApagado: Lectura = { ...base, moduloEncendido: false };
  assert.deepEqual(clasificar(conModuloApagado), ["modulo_apagado"]);
  assert.equal(rechaza(clasificar(conModuloApagado)), false);
});

// ─── Máximo de capturas de carga por turno [AC-FVEH-19] ──────────────────────────────

test("hasta el máximo del §0 no hay bandera, y la siguiente sí la levanta", () => {
  // Los bordes se derivan de `SOC.capturas_max_por_turno`: escritos literales, este archivo
  // sería una copia de la familia canónica y el gate lo marcaría.
  for (let ya = 0; ya < SOC.capturas_max_por_turno; ya++) {
    assert.deepEqual(clasificar({ ...base, capturasDeSocEnElTurno: ya }), [], `con ${ya} previas`);
  }
  assert.deepEqual(
    clasificar({ ...base, capturasDeSocEnElTurno: SOC.capturas_max_por_turno }),
    ["exceso_de_soc"],
  );
});

test("el exceso NO rechaza: la persona ya lo miró y ya lo tecleó", () => {
  const excedida: Lectura = { ...base, capturasDeSocEnElTurno: SOC.capturas_max_por_turno + 5 };
  assert.equal(rechaza(clasificar(excedida)), false);
});

test("el máximo es de CARGA: un odómetro no lo consume ni lo dispara", () => {
  // El mutante obvio: contar todas las lecturas del turno haría que el cuarto odómetro del día
  // marcara un exceso de SOC, y la bandeja se llenaría de un flag que no describe nada.
  const odometro: Lectura = {
    ...base,
    magnitud: "odometro",
    valor: 1000,
    capturasDeSocEnElTurno: SOC.capturas_max_por_turno + 2,
  };
  assert.deepEqual(clasificar(odometro), []);
});

test("el CLIENTE sabe cuándo dejar de pedir la carga, con el mismo número", () => {
  // §4.2: la validación bloqueante corre en el cliente. Lo que el límite protege no es la base
  // —una captura de más entra igual— sino que la app no le pida el SOC diez veces por jornada.
  assert.equal(quedanCapturasDeSoc(0), true);
  assert.equal(quedanCapturasDeSoc(SOC.capturas_max_por_turno - 1), true);
  assert.equal(quedanCapturasDeSoc(SOC.capturas_max_por_turno), false);
});

test("las banderas se acumulan: una lectura puede tener varias cosas mal a la vez", () => {
  const fea: Lectura = {
    magnitud: "soc",
    valor: SOC.maximo + 10,
    anterior: null,
    tsDispositivo: enMinutos(AHORA, -(RELOJ.drift_max_minutos + 10)),
    recibidaEn: AHORA,
    tieneTurno: false,
    moduloEncendido: true,
    capturasDeSocEnElTurno: 0,
  };
  assert.deepEqual(clasificar(fea).sort(), ["reloj_desfasado", "sin_turno", "soc_fuera_de_rango"]);
  assert.equal(rechaza(clasificar(fea)), false);
});
