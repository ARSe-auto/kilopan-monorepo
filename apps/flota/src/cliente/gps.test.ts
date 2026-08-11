import { test } from "node:test";
import assert from "node:assert/strict";
import { capturarGps, type CaptorDeGps } from "./gps.ts";

// GPS denegado bloquea SOLO la captura de coordenadas, con aviso — jamás el POD ni su sync
// [AC-FPOD-12] — §7.6, §3.E1.15.

test("[AC-FPOD-12] posición concedida: hay coordenadas y no hay que avisar nada", async () => {
  const captor: CaptorDeGps = { getCurrentPosition: (exito) => exito() };
  const resultado = await capturarGps(captor);
  assert.deepEqual(resultado, { hayCoordenadas: true, motivo: null, avisar: false });
});

test("[AC-FPOD-12] PERMISSION_DENIED (código 1): sin coordenadas, con aviso visible al operario", async () => {
  const captor: CaptorDeGps = { getCurrentPosition: (_e, error) => error({ code: 1 }) };
  const resultado = await capturarGps(captor);
  assert.deepEqual(resultado, { hayCoordenadas: false, motivo: "permiso_denegado", avisar: true });
});

test("[AC-FPOD-12] POSITION_UNAVAILABLE (código 2): mala precisión, sin aviso — jamás se confunde con permiso denegado", async () => {
  const captor: CaptorDeGps = { getCurrentPosition: (_e, error) => error({ code: 2 }) };
  const resultado = await capturarGps(captor);
  assert.deepEqual(resultado, { hayCoordenadas: false, motivo: "no_disponible", avisar: false });
});

test("[AC-FPOD-12] TIMEOUT (código 3): sin coordenadas y sin aviso, jamás bloquea", async () => {
  const captor: CaptorDeGps = { getCurrentPosition: (_e, error) => error({ code: 3 }) };
  const resultado = await capturarGps(captor);
  assert.deepEqual(resultado, { hayCoordenadas: false, motivo: "no_disponible", avisar: false });
});

test("[AC-FPOD-12] sin captor (sin soporte de geolocalización) ⇒ degrada, jamás lanza", async () => {
  const resultado = await capturarGps(null);
  assert.deepEqual(resultado, { hayCoordenadas: false, motivo: "no_disponible", avisar: false });
});
