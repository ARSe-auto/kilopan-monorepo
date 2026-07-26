import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/identidad/sesion.ts";
import { superficie } from "@kilopan/miga/tokens.ts";
import { Copyright } from "@kilopan/miga/componentes/index.tsx";
import { CerrarSesionBoton } from "./CerrarSesionBoton.tsx";
import { LogoKiloPan } from "../LogoKiloPan.tsx";

// Cada opción lleva una línea que dice QUÉ SE HACE ahí, en lenguaje de panadería.
// Antes el menú eran siete palabras sueltas: "Despacho" y "Consolidar y facturar" no
// le dicen nada a alguien que recién parte, y la única forma de saberlo era entrar a
// cada una a ver qué pasaba (auditoría de experiencia).
const ENLACES_POR_ROL: Record<string, { href: string; etiqueta: string; detalle: string }[]> = {
  admin: [
    { href: "/dashboard", etiqueta: "Panel del dueño", detalle: "Cómo va el día: kilos, ventas y pérdidas" },
    { href: "/pedidos", etiqueta: "Despacho", detalle: "Pedidos de clientes y armar la ruta del furgón" },
    { href: "/facturar", etiqueta: "Consolidar y facturar", detalle: "Juntar las guías de un cliente para cobrarle" },
    { href: "/pesar", etiqueta: "Pesaje", detalle: "Anotar las bandejas que salen del horno" },
    { href: "/vender", etiqueta: "Venta mostrador", detalle: "Cobrar en el mesón" },
    { href: "/caja", etiqueta: "Cierre de caja", detalle: "Contar la plata al final del turno" },
    { href: "/admin", etiqueta: "Ajustes", detalle: "Personal, productos, precios y medios de pago" },
  ],
  maestro: [{ href: "/pesar", etiqueta: "Pesaje", detalle: "Anotar las bandejas que salen del horno" }],
  vendedor: [
    { href: "/vender", etiqueta: "Venta mostrador", detalle: "Cobrar en el mesón" },
    { href: "/caja", etiqueta: "Cierre de caja", detalle: "Contar la plata al final del turno" },
  ],
  repartidor: [{ href: "/ruta", etiqueta: "Mi ruta", detalle: "Tus entregas de hoy, con foto y ubicación" }],
};

export default async function InicioPage() {
  // Antes esta pantalla reimplementaba la consulta de sesión a mano y se le había
  // olvidado el chequeo de expiración por inactividad (AC-ID-05) que sí tiene
  // obtenerSesionActual — una sesión vencida hacía "F5" acá y seguía adentro.
  const sesion = await obtenerSesionActual({ cookies: await cookies() });
  if (!sesion) redirect("/ingresar");

  const enlaces = ENLACES_POR_ROL[sesion.rol] ?? [];

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <LogoKiloPan tamano={28} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ fontSize: 13, color: superficie.textoFaint, margin: 0 }}>Hola,</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{sesion.nombre}</h1>
        </div>
        <CerrarSesionBoton />
      </div>
      {/* <Link>, no <a href>: con mala señal, un <a> es una navegación de documento
          completa que golpea la red — si la ruta nunca se visitó, el service worker
          no tiene nada que servir y cae a /ingresar. <Link> navega del lado del
          cliente con lo que el JS de la app ya tiene cargado en esta sesión. */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {enlaces.map((e) => (
          <Link
            key={e.href}
            href={e.href}
            style={{
              display: "block",
              minHeight: 56,
              padding: "10px 18px",
              borderRadius: 12,
              border: "1px solid rgba(27,23,18,.14)",
              color: "#1B1712",
              textDecoration: "none",
            }}
          >
            <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{e.etiqueta}</span>
            <span style={{ display: "block", fontSize: 13, color: superficie.textoDim, marginTop: 2 }}>
              {e.detalle}
            </span>
          </Link>
        ))}
      </nav>

      <Copyright />
    </main>
  );
}
