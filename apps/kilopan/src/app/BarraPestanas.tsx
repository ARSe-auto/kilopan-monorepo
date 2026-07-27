"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { superficie, acentos } from "@kilopan/miga/tokens.ts";
import { pestanasDe, RUTAS_SIN_BARRA, type Pestana } from "./navegacion.ts";
import { useSesion } from "./SesionCliente.tsx";

// Barra de pestañas fija abajo — el mismo patrón del CRM E-Auto Next (§1.3: cuatro
// destinos raíz, tab bar al alcance del pulgar).
//
// Es lo que reemplaza a «volver al menú». Antes, cambiar de tarea era: encontrar el
// enlace «← Menú» (que la mitad de los estados no mostraba), tocarlo, leer una lista de
// siete y elegir. Ahora la tarea siguiente está a un toque desde cualquier pantalla y
// cualquier paso interno, sin salir del pulgar y sin pasar por ninguna lista.
//
// Abajo y no arriba: en un teléfono sostenido con una mano —la otra está enharinada— el
// borde superior no se alcanza sin recolocar el aparato.

export const ALTO_BARRA_PESTANAS = 64;

export function BarraPestanas() {
  const sesion = useSesion();
  const pathname = usePathname();
  if (!sesion || RUTAS_SIN_BARRA.has(pathname)) return null;

  const pestanas = pestanasDe(sesion.rol);

  return (
    <nav
      aria-label="Navegación principal"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        display: "flex",
        background: "rgba(245,243,239,.94)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: `1px solid ${superficie.hairline}`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {pestanas.map((p) => {
        const activa = pathname === p.href;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={activa ? "page" : undefined}
            style={{
              flex: 1,
              minHeight: ALTO_BARRA_PESTANAS,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              padding: "8px 4px",
              textDecoration: "none",
              color: activa ? acentos.kilopan : superficie.textoFaint,
            }}
          >
            <Icono nombre={p.icono} activa={activa} />
            <span style={{ fontSize: 11, fontWeight: activa ? 800 : 600, lineHeight: 1 }}>{p.etiqueta}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// Iconos dibujados a mano en SVG: el repo no tiene librería de iconos y no se le agrega
// una por seis glifos (el bundle viaja por datos móviles a las 5 de la mañana).
function Icono({ nombre, activa }: { nombre: Pestana["icono"]; activa: boolean }) {
  const grosor = activa ? 2.2 : 1.8;
  const comun = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: grosor,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (nombre) {
    case "hoy": // sol: la jornada
      return (
        <svg {...comun}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      );
    case "pesar": // balanza
      return (
        <svg {...comun}>
          <path d="M12 4v16M7 20h10M4 9h16" />
          <path d="M4 9l-2 5a3 3 0 006 0L6 9M20 9l-2 5a3 3 0 006 0l-2-5" />
        </svg>
      );
    case "vender": // mesón / caja registradora
      return (
        <svg {...comun}>
          <path d="M3 10h18l-1.5 9a2 2 0 01-2 1.7H6.5a2 2 0 01-2-1.7L3 10z" />
          <path d="M8 10V7a4 4 0 018 0v3" />
        </svg>
      );
    case "caja": // billete
      return (
        <svg {...comun}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "ruta": // furgón
      return (
        <svg {...comun}>
          <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z" />
          <circle cx="6" cy="18" r="1.8" />
          <circle cx="17" cy="18" r="1.8" />
        </svg>
      );
    default: // más
      return (
        <svg {...comun}>
          <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
