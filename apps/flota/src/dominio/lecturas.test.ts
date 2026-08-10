import test from "node:test";
import assert from "node:assert/strict";
import { SOC, RELOJ } from "../../../../packages/nucleo-comun/src/constants.ts";
import { clasificar, rechaza, valorProyectado, FLAGS, type Lectura } from "./lecturas.ts";

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

test("las banderas se acumulan: una lectura puede tener varias cosas mal a la vez", () => {
  const fea: Lectura = {
    magnitud: "soc",
    valor: SOC.maximo + 10,
    anterior: null,
    tsDispositivo: enMinutos(AHORA, -(RELOJ.drift_max_minutos + 10)),
    recibidaEn: AHORA,
    tieneTurno: false,
  };
  assert.deepEqual(clasificar(fea).sort(), ["reloj_desfasado", "sin_turno", "soc_fuera_de_rango"]);
  assert.equal(rechaza(clasificar(fea)), false);
});
