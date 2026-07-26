"use client";
import { useEffect } from "react";

// Registra el service worker que hace que la app abra sin señal. Silencioso a
// propósito: si el navegador no lo soporta (o el usuario está en modo privado), la
// app funciona igual, solo que necesita red para cargar.
export function RegistrarSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    // El outbox vive en IndexedDB, no en el cache del service worker: bajo presión de
    // espacio en el equipo, un storage "best-effort" (el default) es el primero que el
    // navegador vacía sin avisar — perdería ventas o pesajes ya confirmados por el
    // operador pero aún no subidos. "persistent" no obliga al navegador a concederlo,
    // pero pedirlo es gratis y, concedido, saca esos datos de esa lista de descarte.
    if (navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => undefined);
    }
  }, []);
  return null;
}
