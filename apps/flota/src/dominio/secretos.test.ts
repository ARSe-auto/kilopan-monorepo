import test from "node:test";
import assert from "node:assert/strict";
import { sellar, abrir, parDelAparato, secretoNuevo, hashDeSecreto } from "./secretos.ts";

// Mutantes del sobre sellado [AC-FIDN-04].
//
// Se prueban las DOS mitades —sellar y abrir— con `crypto.subtle`, que es la MISMA API que
// corre en el navegador: el código que abre el sobre acá es el que va a correr en el teléfono
// del trabajador. Un test que solo sellara no probaría nada; el sobre que no se abre y el
// sobre bien hecho se ven idénticos desde el lado del servidor.

test("[AC-FIDN-04] el aparato abre su propio sobre y recupera el secreto", async () => {
  const aparato = await parDelAparato();
  const secreto = secretoNuevo();
  const sobre = await sellar(aparato.publica, secreto);

  assert.equal(await abrir(sobre, aparato.privada), secreto);
});

test("[AC-FIDN-04] OTRO aparato no abre el sobre: es la garantía entera", async () => {
  // Si esto fallara, el secreto viajaría en claro para cualquiera que vea la respuesta o la
  // fila. Es la única propiedad que hace que emitir a distancia sea aceptable.
  const destinatario = await parDelAparato();
  const intruso = await parDelAparato();
  const sobre = await sellar(destinatario.publica, secretoNuevo());

  await assert.rejects(() => abrir(sobre, intruso.privada));
});

test("[AC-FIDN-04] el sobre no lleva el secreto a la vista", async () => {
  const aparato = await parDelAparato();
  const secreto = secretoNuevo();
  const sobre = await sellar(aparato.publica, secreto);

  const entero = JSON.stringify(sobre);
  assert.ok(!entero.includes(secreto), "el secreto viaja en claro dentro del sobre");
  // Y tampoco en base64: la comprobación de arriba sola dejaría pasar un «cifrado» que fuera
  // el secreto codificado, que es exactamente el error que se comete al apurar esto.
  assert.ok(!entero.includes(Buffer.from(secreto, "utf8").toString("base64")));
});

test("[AC-FIDN-04] dos sobres del MISMO secreto son distintos", async () => {
  // Sal y nonce nuevos por sobre. Si dos sellados del mismo secreto dieran el mismo texto,
  // quien viera dos respuestas sabría que el secreto no cambió — y con AES-GCM reusar el
  // nonce con la misma clave es la falla que rompe el cifrado, no un detalle estético.
  const aparato = await parDelAparato();
  const secreto = secretoNuevo();
  const uno = await sellar(aparato.publica, secreto);
  const otro = await sellar(aparato.publica, secreto);

  assert.notEqual(uno.cifrado, otro.cifrado);
  assert.notEqual(uno.nonce, otro.nonce);
  assert.notEqual(uno.sal, otro.sal);
  assert.notEqual(uno.efimera, otro.efimera, "la clave efímera se reusó entre sobres");
  // Y los dos abren el mismo secreto: sin esto, «son distintos» lo cumpliría también un sobre roto.
  assert.equal(await abrir(uno, aparato.privada), secreto);
  assert.equal(await abrir(otro, aparato.privada), secreto);
});

test("[AC-FIDN-04] tocar un solo byte del sobre lo invalida entero", async () => {
  // AES-GCM autentica: un sobre alterado no se abre «a medias». Sin esta propiedad, alguien
  // en el medio podría cambiar el secreto por uno suyo.
  const aparato = await parDelAparato();
  const sobre = await sellar(aparato.publica, secretoNuevo());
  const bytes = Buffer.from(sobre.cifrado, "base64");
  bytes[0] = bytes[0]! ^ 0xff;

  await assert.rejects(() => abrir({ ...sobre, cifrado: bytes.toString("base64") }, aparato.privada));
});

test("[AC-FIDN-04] la privada del aparato NO es extraíble", async () => {
  // La razón por la que emitir contra la clave pública significa algo: el navegador impide
  // sacar la privada, así que «nunca salió del teléfono» no es una promesa nuestra.
  const aparato = await parDelAparato();
  assert.equal(aparato.privada.extractable, false);
  await assert.rejects(() => globalThis.crypto.subtle.exportKey("pkcs8", aparato.privada));
});

test("[AC-FIDN-04] en la BD queda el hash y no el secreto", () => {
  const secreto = secretoNuevo();
  const h = hashDeSecreto(secreto);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, secreto);
  assert.equal(hashDeSecreto(secreto), h);
  assert.notEqual(hashDeSecreto(secretoNuevo()), h);
});

test("[AC-FIDN-04] dos secretos seguidos no son el mismo", async () => {
  const vistos = new Set(Array.from({ length: 200 }, () => secretoNuevo()));
  assert.equal(vistos.size, 200);
});

test("[AC-FIDN-04] una clave pública que no lo es rebota en vez de sellar cualquier cosa", async () => {
  // Sellar contra una cadena inválida y devolver un sobre que nadie puede abrir sería la peor
  // falla posible: el trabajador queda esperando para siempre y nada se puso rojo.
  await assert.rejects(() => sellar("no-es-una-clave", secretoNuevo()));
  await assert.rejects(() => sellar("", secretoNuevo()));
});
