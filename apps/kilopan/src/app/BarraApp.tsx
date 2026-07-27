"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { superficie, acentos } from "@kilopan/miga/tokens.ts";
import { ChipOperador } from "@kilopan/miga/componentes/index.tsx";
import { destinosDe, tituloDeRuta, ETIQUETA_ROL, RUTAS_SIN_BARRA } from "./navegacion.ts";
import { useSesion } from "./SesionCliente.tsx";
import { CerrarSesionBoton } from "./CerrarSesionBoton.tsx";

// Barra fija de la app: el único control que está SIEMPRE en pantalla.
//
// Reemplaza dos cosas que no funcionaban:
//   1. El enlace «← Menú», que solo existía en el primer estado de cada pantalla. Elegido
//      un producto en /pesar o /vender, desaparecía: con una bandeja empezada no quedaba
//      ni un control que llevara a otra parte (verificado en el navegador, no leído).
//      /ruta nunca lo tuvo — el repartidor no tenía salida en ninguno de sus estados.
//   2. El chip del operador flotando en `position: fixed` sobre la esquina superior
//      derecha, encima del contenido: en /pesar se montaba justo sobre el botón «Cambiar».
//      Ahora el chip vive DENTRO de la barra, que ocupa su propio alto y no tapa nada.
//
// Se abre desde cualquier pantalla y cualquier estado interno, porque la barra no sabe
// —ni le importa— en qué paso va la pantalla de abajo.

const ALTO_BARRA = 56;

export function BarraApp() {
  const sesion = useSesion();
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  // Navegar cierra el panel. `usePathname` cambia con la navegación de cliente de <Link>,
  // que es la que usa todo el menú.
  useEffect(() => setAbierto(false), [pathname]);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", alTeclear);
    // Sin esto, el fondo hace scroll bajo el panel abierto en el teléfono.
    const previo = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", alTeclear);
      document.documentElement.style.overflow = previo;
    };
  }, [abierto]);

  // Sin sesión no hay menú al que ir ni operador que nombrar (/ingresar, /vincular, "/").
  if (!sesion || RUTAS_SIN_BARRA.has(pathname)) return null;

  const destinos = destinosDe(sesion.rol);

  return (
    <>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          flex: "none",
          height: ALTO_BARRA,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px 0 4px",
          background: superficie.fondo,
          borderBottom: `1px solid ${superficie.hairline}`,
        }}
      >
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-expanded={abierto}
          aria-label="Abrir el menú"
          style={{
            minHeight: 44,
            minWidth: 44,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 10px",
            borderRadius: 12,
            border: "none",
            background: "none",
            fontSize: 15,
            fontWeight: 700,
            color: superficie.texto,
          }}
        >
          <span aria-hidden style={{ fontSize: 19, lineHeight: 1 }}>☰</span>
          <span>Menú</span>
        </button>

        {/* El título de la sección al centro: en una PWA instalada no hay barra de
            direcciones, así que sin esto no hay nada que diga en qué pantalla estás. */}
        <span
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 15,
            fontWeight: 700,
            color: superficie.textoDim,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tituloDeRuta(pathname)}
        </span>

        {/* AC-ID-07: el nombre del operador visible en todas las pantallas. */}
        <ChipOperador nombre={sesion.nombre} anchoMaximo={132} />
      </header>

      {abierto ? (
        <div
          onClick={() => setAbierto(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(27,23,18,.45)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <nav
            role="dialog"
            aria-modal="true"
            aria-label="Menú"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: superficie.fondo,
              borderRadius: "0 0 18px 18px",
              padding: "12px 16px 20px",
              maxHeight: "100%",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: superficie.texto }}>
                  {sesion.nombre}
                </p>
                {/* Con qué perfil estás dentro. Entrar con el RUT equivocado deja una app
                    de UNA opción y hasta ahora nada lo decía: se leía como app rota. */}
                <p style={{ margin: "2px 0 0", fontSize: 13, color: superficie.textoFaint }}>
                  {ETIQUETA_ROL[sesion.rol]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar el menú"
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  border: "none",
                  background: "none",
                  fontSize: 20,
                  fontWeight: 700,
                  color: superficie.textoDim,
                }}
              >
                ✕
              </button>
            </div>

            <FilaMenu href="/inicio" etiqueta="Inicio" detalle="La pantalla con todas tus opciones" activo={pathname === "/inicio"} />
            {destinos.map((d) => (
              <FilaMenu
                key={d.href}
                href={d.href}
                etiqueta={d.etiqueta}
                detalle={d.detalle}
                activo={pathname === d.href}
              />
            ))}

            <div style={{ marginTop: 6 }}>
              <CerrarSesionBoton variante="fila" />
            </div>
          </nav>
        </div>
      ) : null}
    </>
  );
}

function FilaMenu({
  href,
  etiqueta,
  detalle,
  activo,
}: {
  href: string;
  etiqueta: string;
  detalle: string;
  activo: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={activo ? "page" : undefined}
      style={{
        display: "block",
        minHeight: 56,
        padding: "10px 18px",
        borderRadius: 12,
        border: activo ? `2px solid ${acentos.kilopan}` : `1px solid ${superficie.hairline}`,
        background: activo ? "#FEF3E2" : superficie.tarjeta,
        color: superficie.texto,
        textDecoration: "none",
      }}
    >
      <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{etiqueta}</span>
      <span style={{ display: "block", fontSize: 13, color: superficie.textoDim, marginTop: 2 }}>{detalle}</span>
    </Link>
  );
}
