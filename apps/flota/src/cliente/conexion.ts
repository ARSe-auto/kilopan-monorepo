"use client";

import { useEffect, useState } from "react";

// Sin conexión, estado obligatorio del §5.7, para pantallas SOLO planificación/lectura — el
// portal no captura, no hay outbox de por medio (spec 07 §2.3, AC-FPOR-09, que ya usaba este
// mismo patrón en línea en `cliente/nuevo/page.tsx`; AC-FPOR-12 lo extrae para que las otras 3
// pantallas no repitan el `useEffect`). Arranca en `true` (asumir conectado hasta saber lo
// contrario, mismo criterio que `ChipEstadoConexion`) y se corrige apenas monta, para no
// depender de qué trae `navigator.onLine` en el primer render del servidor.
// Nombre en inglés (`use*`) por el linter de hooks (`react-hooks/rules-of-hooks`): mismo
// criterio que `useDigestSemaforo` en `hoy/usar-digest-semaforo.ts` — el ARCHIVO es español,
// la función exportada lleva el prefijo que la regla exige para reconocerla como hook.
export function useConexion(): boolean {
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
