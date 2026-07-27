import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { superficie } from "@kilopan/miga/tokens.ts";
import { obtenerSesionActual } from "@/identidad/sesion.ts";
import { RegistrarSW } from "./RegistrarSW.tsx";
import { InterceptarSesionVencida } from "./InterceptarSesionVencida.tsx";
import { ProveedorSesion } from "./SesionCliente.tsx";
import { BarraPestanas, ALTO_BARRA_PESTANAS } from "./BarraPestanas.tsx";

export const metadata: Metadata = {
  title: "KiloPan",
  description: "Del pesaje del pan a la boleta o la entrega con prueba.",
  appleWebApp: { capable: true, title: "KiloPan", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#C2410C",
  // La app se usa con las manos ocupadas: un zoom accidental con harina en los dedos
  // descoloca la cifra del pesaje. Se fija la escala pero NO se bloquea el zoom del
  // sistema (accesibilidad): maximumScale queda en 5, no en 1.
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover", // safe-area del notch del iPhone
};

// System font stack (PROMPT_MAESTRO.md §5) — sin webfonts.
const pilaTipografica =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// El único CSS global de la app. `box-sizing: border-box` no es preferencia de estilo:
// sin él, las pantallas que combinan alto completo con `padding: 24` miden 100dvh + 48px,
// y el botón principal —«Confirmar» en Pesar, «Ingresar», «Confirmar entrega»— queda
// parcialmente bajo el pliegue. Medido en un iPhone de 812px: el botón terminaba en 836.
// Obliga a hacer scroll para completar la acción más frecuente de la app, con las manos
// enharinadas. Encontrado recién al mirar el despliegue real en viewport de teléfono; en
// el escritorio no se nota nunca.
const RESET_GLOBAL = `*,*::before,*::after{box-sizing:border-box}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // La sesión se lee UNA vez acá, en el servidor, desde la cookie HttpOnly. La barra y el
  // menú la necesitan en todas las pantallas; bajarla por contexto evita que cada pantalla
  // de cliente tenga que pedir /api/auth/me por su cuenta.
  const sesion = await obtenerSesionActual({ cookies: await cookies() });
  const sesionCliente = sesion ? { nombre: sesion.nombre, rol: sesion.rol } : null;

  return (
    // "Solo modo claro en el MVP": fijado acá, no dejado a que el navegador/SO decida.
    <html lang="es-CL" style={{ colorScheme: "light" }}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: RESET_GLOBAL }} />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: pilaTipografica,
          background: superficie.fondo,
          color: superficie.texto,
          // Columna flex en vez de `minHeight: 100dvh` suelto en cada <main>: la barra
          // ocupa su alto y el contenido rellena EXACTAMENTE lo que queda. Con el alto
          // fijo de antes, sumarle una barra de 56 px habría empujado bajo el pliegue el
          // botón «Confirmar» — el mismo defecto que el reset de arriba corrige.
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ProveedorSesion sesion={sesionCliente}>
          {/* La tab bar es de posición fija: reserva su alto acá para que el botón
              primario de cada pantalla («Confirmar», «Cobrar») no quede tapado detrás
              de ella — el mismo defecto que ya corrigió el reset de box-sizing arriba,
              esta vez por el lado de abajo. Sin sesión no hay tab bar (RUTAS_SIN_BARRA
              en navegacion.ts), así que tampoco hace falta el relleno. */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              paddingBottom: sesionCliente ? ALTO_BARRA_PESTANAS : 0,
            }}
          >
            {children}
          </div>
          <BarraPestanas />
        </ProveedorSesion>
        <RegistrarSW />
        <InterceptarSesionVencida />
      </body>
    </html>
  );
}
