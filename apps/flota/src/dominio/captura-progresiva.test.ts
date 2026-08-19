import { test } from "node:test";
import assert from "node:assert/strict";
import { resolverFoto, resolverGps } from "./captura-progresiva.ts";

// Foto y GPS como mejoras progresivas [AC-FPOD-12] — §3.E1.7, §7.6, §3.E1.15.

test("[AC-FPOD-12] cámara concedida: hay foto y ningún flag", () => {
  assert.deepEqual(resolverFoto("concedido"), { hayFoto: true, flag: null });
});

test("[AC-FPOD-12] cámara denegada: degrada a sin foto con flag, jamás lanza ni bloquea", () => {
  assert.deepEqual(resolverFoto("denegado"), { hayFoto: false, flag: "camara_denegada" });
});

test("[AC-FPOD-12] GPS concedido con fix: hay coordenadas y no hay que avisar nada", () => {
  assert.deepEqual(resolverGps(null), { hayCoordenadas: true, motivo: null, avisar: false });
});

test("[AC-FPOD-12] GPS denegado: sin coordenadas, motivo permiso_denegado y aviso visible al operario", () => {
  assert.deepEqual(resolverGps("permiso_denegado"), {
    hayCoordenadas: false,
    motivo: "permiso_denegado",
    avisar: true,
  });
});

test("[AC-FPOD-12] precisión mala (sin fix/timeout) NUNCA se confunde con un permiso negado: sin aviso", () => {
  assert.deepEqual(resolverGps("no_disponible"), {
    hayCoordenadas: false,
    motivo: "no_disponible",
    avisar: false,
  });
});
