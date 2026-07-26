"use client";
import { useEffect, useState } from "react";

// ChipEstadoConexion (packages/miga) es puramente presentacional — no puede rastrear
// navigator.onLine él mismo sin arrastrar tipos de React a un paquete que hoy no los
// necesita para nada más. Cada pantalla con cola offline llama este hook y le pasa el
// resultado.
export function useEnLinea(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const marcarOnline = () => setOnline(true);
    const marcarOffline = () => setOnline(false);
    window.addEventListener("online", marcarOnline);
    window.addEventListener("offline", marcarOffline);
    return () => {
      window.removeEventListener("online", marcarOnline);
      window.removeEventListener("offline", marcarOffline);
    };
  }, []);

  return online;
}
