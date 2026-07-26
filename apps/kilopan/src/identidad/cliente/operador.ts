"use client";
// Quién es el operador ACTUALMENTE logueado en este equipo, cacheado en localStorage
// para poder leerlo sin red (misma clase de garantía que identidad/cliente/dispositivo.ts).
// NO reemplaza la cookie de sesión — es solo el id que /pod/outbox.ts necesita en el
// momento de encolar, para poder comparar más tarde "¿sigue siendo esta persona quien
// está logueada?" antes de subir una mutación que quedó pendiente.
const CLAVE = "kp_operador_actual";

export function recordarOperador(usuarioId: string) {
  window.localStorage.setItem(CLAVE, usuarioId);
}

export function operadorActual(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CLAVE);
}

export function olvidarOperador() {
  window.localStorage.removeItem(CLAVE);
}
