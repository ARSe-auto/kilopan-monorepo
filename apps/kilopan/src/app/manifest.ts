import type { MetadataRoute } from "next";

// PWA instalable móvil-primero (PROMPT_MAESTRO.md §5). En Android el navegador ofrece
// instalarla solo; en iPhone hay que hacerlo a mano desde Compartir → «Agregar a
// pantalla de inicio» — asimetría real que el instructivo tiene que decir, no esconder.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KiloPan",
    short_name: "KiloPan",
    description: "Del pesaje del pan a la boleta o la entrega con prueba.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F3EF",
    theme_color: "#C2410C",
    orientation: "portrait",
    lang: "es-CL",
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
