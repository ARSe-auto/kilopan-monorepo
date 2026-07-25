// Validación de RUT chileno (módulo 11). Se usa al escribir (usuarios, clientes,
// receptor de POD) — PROMPT_MAESTRO.md exige `CHECK pan.valida_rut(rut)` en la BD;
// esta es la implementación de referencia en TypeScript para validar en el cliente
// antes del round-trip, y para los tests unitarios que la BD también debe cumplir.

/** Normaliza un RUT a "cuerpoNumerico" + "dv" (dv en mayúscula), sin puntos ni guión.
 *  Devuelve null si el formato es imposible de interpretar (vacío, sin dígitos, etc). */
function normalizar(rut: string): { cuerpo: string; dv: string } | null {
  const limpio = rut.replace(/\./g, "").replace(/\s/g, "").toUpperCase();
  if (limpio.length < 2) return null;
  const cuerpo = limpio.slice(0, -1).replace(/-/g, "");
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return null;
  if (!/^[0-9K]$/.test(dv)) return null;
  return { cuerpo, dv };
}

/** Calcula el dígito verificador esperado para un cuerpo numérico de RUT. */
export function calcularDv(cuerpo: string): string {
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/** true solo si el RUT es sintácticamente válido Y su dígito verificador cuadra
 *  (módulo 11). Acepta con o sin puntos/guión: "12.345.678-5", "12345678-5", "123456785". */
export function validaRut(rut: string): boolean {
  const partes = normalizar(rut);
  if (!partes) return false;
  if (partes.cuerpo.length < 7 || partes.cuerpo.length > 8) return false; // rango real de RUTs chilenos
  return calcularDv(partes.cuerpo) === partes.dv;
}

/** Formatea a la forma es-CL estándar: 12.345.678-5. Asume que `rut` ya es válido
 *  (llamar validaRut primero) — no lanza, pero devuelve el input crudo si no puede
 *  interpretarlo, para nunca ocultar un dato malformado silenciosamente. */
export function formatearRut(rut: string): string {
  const partes = normalizar(rut);
  if (!partes) return rut;
  const conMiles = partes.cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${conMiles}-${partes.dv}`;
}
