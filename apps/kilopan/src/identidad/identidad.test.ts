import { test } from "node:test";
import assert from "node:assert/strict";
import { hashearPin, verificarPin } from "./hash.ts";
import { permitirIntento, _reiniciarParaTests } from "./limitador.ts";

test("hashearPin/verificarPin: el PIN correcto verifica true", async () => {
  const hash = await hashearPin("1234");
  assert.equal(await verificarPin("1234", hash), true);
});

test("hashearPin/verificarPin: un PIN incorrecto verifica false", async () => {
  const hash = await hashearPin("1234");
  assert.equal(await verificarPin("9999", hash), false);
});

test("hashearPin: el mismo PIN produce hashes distintos (sal aleatoria)", async () => {
  const h1 = await hashearPin("1234");
  const h2 = await hashearPin("1234");
  assert.notEqual(h1, h2);
  assert.equal(await verificarPin("1234", h1), true);
  assert.equal(await verificarPin("1234", h2), true);
});

test("verificarPin: hash malformado nunca lanza, devuelve false", async () => {
  assert.equal(await verificarPin("1234", "no-es-un-hash-valido"), false);
  assert.equal(await verificarPin("1234", ""), false);
});

// --- AC-SEC-02: rate limit por IP ---
test("permitirIntento: permite hasta el tope de la ventana y despues bloquea", () => {
  _reiniciarParaTests();
  const ip = "10.0.0.1";
  for (let i = 0; i < 20; i++) {
    assert.equal(permitirIntento(ip), true, `intento ${i + 1} debería pasar`);
  }
  assert.equal(permitirIntento(ip), false, "el intento 21 debe rebotar");
});
test("permitirIntento: el límite es por IP, no global", () => {
  _reiniciarParaTests();
  const ipA = "10.0.0.2";
  const ipB = "10.0.0.3";
  for (let i = 0; i < 20; i++) permitirIntento(ipA);
  assert.equal(permitirIntento(ipA), false);
  assert.equal(permitirIntento(ipB), true, "otra IP no debería verse afectada");
});
