"use client";
import { useEffect } from "react";

// Registra el service worker que hace que la app abra sin señal. Silencioso a
// propósito: si el navegador no lo soporta (o el usuario está en modo privado), la
// app funciona igual, solo que necesita red para cargar.
export function RegistrarSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
