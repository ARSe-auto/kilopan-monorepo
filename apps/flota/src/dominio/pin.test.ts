import test from "node:test";
import assert from "node:assert/strict";
import { PIN } from "../../../../packages/nucleo-comun/src/constants.ts";
import {
  esperaSegundos,
  evaluarIntento,
  estaBloqueado,
  formaValida,
  DESBLOQUEADO,
  type EstadoPin,
} from "./pin.ts";

// Mutantes del bloqueo del PIN [AC-FIDN-06].
//
// Ni un número de la curva escrito acá: todo se deriva de `PIN` del canónico §0, que es lo
// que hace que el test siga siendo cierto si el dueño cambia la curva — y que no sea él mismo
// una copia de la familia, cosa que el gate de constantes marcaría.

const AHORA = new Date("2026-08-09T04:00:00Z");
const limpio: EstadoPin = { intentos_fallidos: 0, bloqueado_hasta: null };
const enSegundos = (base: Date, s: number) => new Date(base.getTime() + s * 1000);

/** Falla `n` veces seguidas desde un estado limpio, sin dejar pasar el tiempo. */
function fallar(n: number, desde: EstadoPin = limpio, ahora = AHORA): EstadoPin {
  let estado = desde;
  for (let i = 0; i < n; i++) estado = evaluarIntento(estado, false, ahora).estado;
  return estado;
}

// ─── La curva ────────────────────────────────────────────────────────────────────────

test("[AC-FIDN-06] la espera arranca en el valor del §0 y se duplica", () => {
  assert.equal(esperaSegundos(1), PIN.backoff_inicial_segundos);
  assert.equal(esperaSegundos(2), PIN.backoff_inicial_segundos * PIN.backoff_factor);
  assert.equal(esperaSegundos(3), PIN.backoff_inicial_segundos * PIN.backoff_factor ** 2);
});

test("[AC-FIDN-06] la espera SE TOPA: la enésima racha no deja el andén parado toda la noche", () => {
  // El caso que el tope existe para evitar, y la razón por la que el dueño lo pidió: el
  // bloqueo es por usuario, pero el que espera es el turno.
  for (const n of [10, 20, 50, 1000]) {
    assert.equal(esperaSegundos(n), PIN.backoff_tope_segundos, `la racha ${n} superó el tope`);
  }
  // Y la mitad positiva: antes del tope la curva SÍ crece. Sin esto, una implementación que
  // devolviera siempre el tope pasaría la prueba de arriba.
  assert.ok(esperaSegundos(2) > esperaSegundos(1));
  assert.ok(esperaSegundos(1) < PIN.backoff_tope_segundos);
});

// ─── El conteo y el bloqueo ──────────────────────────────────────────────────────────

test("[AC-FIDN-06] hacen falta los intentos del §0 para bloquear, ni uno menos", () => {
  const antes = fallar(PIN.intentos_hasta_bloqueo - 1);
  assert.equal(antes.intentos_fallidos, PIN.intentos_hasta_bloqueo - 1);
  assert.equal(antes.bloqueado_hasta, null, "bloqueó antes de tiempo");

  const justo = evaluarIntento(antes, false, AHORA).estado;
  assert.notEqual(justo.bloqueado_hasta, null, "no bloqueó al llegar al umbral");
  assert.equal(
    justo.bloqueado_hasta!.getTime(),
    enSegundos(AHORA, esperaSegundos(1)).getTime(),
    "el primer bloqueo no dura lo que dice la curva",
  );
});

test("[AC-FIDN-06] el segundo bloqueo del mismo episodio espera el doble", () => {
  // La racha se cuenta sin agregarle una columna a la tabla: el contador NO se reinicia al
  // bloquear, así que el bloqueo cae en cada múltiplo del umbral y su número sale de ahí.
  const primero = fallar(PIN.intentos_hasta_bloqueo);
  const pasado = enSegundos(primero.bloqueado_hasta!, 1);
  const segundo = fallar(PIN.intentos_hasta_bloqueo, primero, pasado);

  assert.equal(segundo.intentos_fallidos, PIN.intentos_hasta_bloqueo * 2);
  assert.equal(
    segundo.bloqueado_hasta!.getTime(),
    enSegundos(pasado, esperaSegundos(2)).getTime(),
  );
});

test("[AC-FIDN-06] mientras está bloqueado, el intento NO se cuenta ni se verifica", () => {
  // Contarlos dejaría que quien ya no puede entrar siga empujando la espera del legítimo
  // hacia el tope; verificar el hash gastaría un argon2id por golpe, que es lo que el ataque
  // quiere. Y un PIN CORRECTO durante el bloqueo tampoco abre: el bloqueo es el bloqueo.
  const bloqueado = fallar(PIN.intentos_hasta_bloqueo);
  const durante = enSegundos(AHORA, 1);

  const conMalo = evaluarIntento(bloqueado, false, durante);
  assert.equal(conMalo.tipo, "bloqueado");
  assert.equal(conMalo.estado.intentos_fallidos, bloqueado.intentos_fallidos);
  assert.equal(conMalo.estado.bloqueado_hasta!.getTime(), bloqueado.bloqueado_hasta!.getTime());

  const conBueno = evaluarIntento(bloqueado, true, durante);
  assert.equal(conBueno.tipo, "bloqueado");
});

test("[AC-FIDN-06] el veredicto bloqueado dice CUÁNTO falta, para que la pantalla no mienta", () => {
  const bloqueado = fallar(PIN.intentos_hasta_bloqueo);
  const v = evaluarIntento(bloqueado, false, enSegundos(AHORA, 10));
  assert.equal(v.tipo, "bloqueado");
  assert.equal(v.tipo === "bloqueado" && v.faltanSegundos, esperaSegundos(1) - 10);
});

test("[AC-FIDN-06] pasado el plazo el bloqueo se levanta solo, sin que nadie intervenga", () => {
  const bloqueado = fallar(PIN.intentos_hasta_bloqueo);
  const despues = enSegundos(bloqueado.bloqueado_hasta!, 1);
  assert.equal(estaBloqueado(bloqueado, despues), false);
  assert.equal(evaluarIntento(bloqueado, true, despues).tipo, "correcto");
});

test("[AC-FIDN-06] un PIN correcto borra la racha entera", () => {
  const casi = fallar(PIN.intentos_hasta_bloqueo - 1);
  const v = evaluarIntento(casi, true, AHORA);
  assert.equal(v.tipo, "correcto");
  assert.deepEqual(v.estado, DESBLOQUEADO);

  // Y la consecuencia: después del acierto hacen falta OTRA vez los intentos completos.
  const deNuevo = fallar(PIN.intentos_hasta_bloqueo - 1, v.estado);
  assert.equal(deNuevo.bloqueado_hasta, null);
});

test("[AC-FIDN-06] el estado con que el dueño desbloquea deja al usuario como nuevo", () => {
  const bloqueado = fallar(PIN.intentos_hasta_bloqueo * 3);
  assert.notEqual(bloqueado.bloqueado_hasta, null);
  assert.equal(estaBloqueado(DESBLOQUEADO, AHORA), false);
  assert.equal(evaluarIntento(DESBLOQUEADO, false, AHORA).estado.intentos_fallidos, 1);
});

// ─── La forma del PIN ────────────────────────────────────────────────────────────────

test("[AC-FIDN-06] el PIN es de dígitos y del largo del §0", () => {
  assert.ok(formaValida("0".repeat(PIN.digitos)));
  assert.ok(!formaValida("0".repeat(PIN.digitos - 1)), "un dígito de menos pasó");
  assert.ok(!formaValida("0".repeat(PIN.digitos + 1)), "uno de más pasó");
  assert.ok(!formaValida("12a4"), "una letra pasó");
  assert.ok(!formaValida(""), "vacío pasó");
  // El teclado propio del §5.4 solo emite dígitos, pero este es el servidor: lo que llega es
  // lo que alguien mandó, no lo que la pantalla ofrecía.
  assert.ok(!formaValida(" 123"), "un espacio no es un dígito");
});
