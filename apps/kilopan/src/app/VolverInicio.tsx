import Link from "next/link";

// Cada pantalla de nivel superior (pesar, vender, caja, pedidos, facturar, admin,
// dashboard, ruta) se llega desde el menú de /inicio pero no tenía forma de volver
// ahí salvo el botón atrás del navegador — inexistente o poco visible en una PWA
// instalada en la pantalla de inicio del teléfono. <Link>, no <a href>, por la misma
// razón que en inicio/page.tsx: con mala señal navega con lo que el JS ya tiene
// cargado en vez de golpear la red.
export function VolverInicio() {
  return (
    <Link
      href="/inicio"
      style={{
        minHeight: 44,
        display: "inline-flex",
        alignItems: "center",
        color: "#5B564C",
        fontSize: 14,
        fontWeight: 700,
        textDecoration: "none",
      }}
    >
      ← Menú
    </Link>
  );
}
