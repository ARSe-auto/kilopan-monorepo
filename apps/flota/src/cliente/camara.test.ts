import { test } from "node:test";
import assert from "node:assert/strict";
import { capturarFoto, type CaptorDeCamara } from "./camara.ts";

// Cámara denegada ⇒ sin foto + flag, jamás lanza [AC-FPOD-12] — §7.6, §3.E1.7.

test("[AC-FPOD-12] cámara concedida: hay foto, sin flag, y el stream se cierra solo", async () => {
  let detenida = false;
  const captor: CaptorDeCamara = {
    getUserMedia: async () => ({ getTracks: () => [{ stop: () => (detenida = true) }] }),
  };
  const resultado = await capturarFoto(captor);
  assert.deepEqual(resultado, { hayFoto: true, flag: null });
  assert.equal(detenida, true, "el stream abierto para el permiso no queda encendido");
});

test("[AC-FPOD-12] getUserMedia rechaza (permiso denegado) ⇒ degrada, nunca lanza", async () => {
  const captor: CaptorDeCamara = {
    getUserMedia: async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    },
  };
  const resultado = await capturarFoto(captor);
  assert.deepEqual(resultado, { hayFoto: false, flag: "camara_denegada" });
});

test("[AC-FPOD-12] sin captor (navegador sin soporte / sin hardware) ⇒ degrada igual", async () => {
  const resultado = await capturarFoto(null);
  assert.deepEqual(resultado, { hayFoto: false, flag: "camara_denegada" });
});
