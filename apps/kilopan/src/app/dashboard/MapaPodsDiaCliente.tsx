"use client";

// react-leaflet toca `window` al cargar el módulo: importado directo desde el server
// component del dashboard se rompía completamente en SSR («ReferenceError: window
// is not defined», 07-ago-2026) y los e2e morían esperando una página 500. El mapa
// solo existe en el navegador; un server component no puede usar ssr:false, así que
// este envoltorio cliente hace la carga dinámica. El h2 «Entregas del día» vive dentro
// del propio mapa: aparece cuando el chunk carga, y los e2e lo esperan con expect.
import dynamic from "next/dynamic";

export const MapaPodsDia = dynamic(
  () => import("./MapaPodsDia.tsx").then((m) => m.MapaPodsDia),
  { ssr: false, loading: () => null }
);
