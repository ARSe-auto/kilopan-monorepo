"use client";
// Identidad del equipo (client-side). PROMPT_MAESTRO.md §4 declara explícitamente esta
// garantía menor que Keychain como aceptada: "el secreto vive en IndexedDB [...] en el
// cliente" — localStorage es la misma clase de garantía, más simple de implementar.
// NO es la sesión del operador (esa es la cookie HttpOnly); esto identifica el EQUIPO,
// que puede quedar enrolado por meses mientras distintos operadores hacen F5 encima.
const CLAVE = "kp_dispositivo";

export interface IdentidadDispositivo {
  id: string;
  secreto: string;
  nombre: string;
}

export function leerDispositivo(): IdentidadDispositivo | null {
  if (typeof window === "undefined") return null;
  const crudo = window.localStorage.getItem(CLAVE);
  if (!crudo) return null;
  try {
    return JSON.parse(crudo) as IdentidadDispositivo;
  } catch {
    return null;
  }
}

export function guardarDispositivo(identidad: IdentidadDispositivo) {
  window.localStorage.setItem(CLAVE, JSON.stringify(identidad));
}

export function olvidarDispositivo() {
  window.localStorage.removeItem(CLAVE);
}
