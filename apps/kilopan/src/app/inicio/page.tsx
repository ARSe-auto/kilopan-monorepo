import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionOMotivo } from "@/identidad/sesion.ts";
import { superficie, acentos } from "@kilopan/miga/tokens.ts";
import { Copyright } from "@kilopan/miga/componentes/index.tsx";
import { LogoKiloPan } from "../LogoKiloPan.tsx";
import { destinosDe, ETIQUETA_ROL } from "../navegacion.ts";

export default async function InicioPage() {
  // Antes esta pantalla reimplementaba la consulta de sesión a mano y se le había
  // olvidado el chequeo de expiración por inactividad (AC-ID-05) que sí tiene
  // obtenerSesionActual — una sesión vencida hacía "F5" acá y seguía adentro.
  const { sesion, motivo } = await obtenerSesionOMotivo({ cookies: await cookies() });
  // El motivo viaja a /ingresar para que la pantalla lo diga. Sin él, tocar «Menú» con la
  // sesión caída te dejaba en el login sin una palabra de explicación — que es exactamente
  // lo que se ve desde el mesón como «la app me botó y no sé por qué».
  if (!sesion) redirect(`/ingresar?motivo=${motivo}`);

  const destinos = destinosDe(sesion.rol);

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20, width: "100%" }}>
      <LogoKiloPan tamano={28} />
      <div>
        <p style={{ fontSize: 13, color: superficie.textoFaint, margin: 0 }}>Hola,</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{sesion.nombre}</h1>
        {/* Con qué perfil está dentro. Es la diferencia entre «esta app tiene una sola
            pantalla» y «el maestro solo pesa»: sin decirlo, lo primero es lo que parece. */}
        <p style={{ fontSize: 13, color: superficie.textoFaint, margin: "2px 0 0" }}>
          {ETIQUETA_ROL[sesion.rol]}
        </p>
      </div>

      {/* <Link>, no <a href>: con mala señal, un <a> es una navegación de documento
          completa que golpea la red — si la ruta nunca se visitó, el service worker
          no tiene nada que servir y cae a /ingresar. <Link> navega del lado del
          cliente con lo que el JS de la app ya tiene cargado en esta sesión. */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {destinos.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            style={{
              display: "block",
              minHeight: 56,
              padding: "10px 18px",
              borderRadius: 12,
              border: `1px solid ${superficie.hairline}`,
              background: superficie.tarjeta,
              color: superficie.texto,
              textDecoration: "none",
            }}
          >
            <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{d.etiqueta}</span>
            <span style={{ display: "block", fontSize: 13, color: superficie.textoDim, marginTop: 2 }}>
              {d.detalle}
            </span>
          </Link>
        ))}
      </nav>

      {/* Un rol con una sola pantalla no tiene por qué parecer una app a medio hacer:
          se dice qué hace ese perfil y quién hace el resto. */}
      {destinos.length === 1 ? (
        <p style={{ fontSize: 13, color: superficie.textoFaint, margin: 0, lineHeight: 1.5 }}>
          Tu perfil tiene esta única pantalla, y es a propósito: cada quien firma solo lo
          suyo. El resto del día —pedidos, mesón, caja y panel— lo maneja el administrador
          con su propio RUT.
        </p>
      ) : null}

      <p style={{ fontSize: 13, color: superficie.textoFaint, margin: 0 }}>
        Desde cualquier pantalla, el botón{" "}
        <span style={{ fontWeight: 700, color: acentos.kilopan }}>☰ Menú</span> de arriba te
        trae de vuelta acá.
      </p>

      <Copyright />
    </main>
  );
}
