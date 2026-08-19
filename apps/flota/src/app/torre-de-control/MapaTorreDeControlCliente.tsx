"use client";

// react-leaflet toca `window` al cargar el módulo: importado directo desde el server component
// de la pantalla se rompe en SSR («ReferenceError: window is not defined»), mismo defecto que
// `MapaPodsDiaCliente.tsx` de apps/kilopan ya documentó y arregló. El mapa solo existe en el
// navegador; este envoltorio cliente hace la carga dinámica con `ssr:false`.
import dynamic from "next/dynamic";

export const MapaTorreDeControl = dynamic(
  () => import("./MapaTorreDeControl.tsx").then((m) => m.MapaTorreDeControl),
  { ssr: false, loading: () => null },
);
