import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { obtenerSesionActual } from "@/identidad/sesion.ts";
import { superficie } from "@kilopan/miga/tokens.ts";
import { Copyright } from "@kilopan/miga/componentes/index.tsx";
import { Pantalla } from "../Pantalla.tsx";

// AC-ADM-04: pantalla `/arreglar`, SOLO rol admin. «Marcha atrás»: el lugar desde donde
// el dueño deshace un error de operación sin entrar a la base por SQL (specs/kilopan/
// 10-administracion.md, Ola 2; docs/PROMPT_CORRECTIVO.md §5).
//
// La lección de `pesaje_foto_obligatoria` mandando: esconder el enlace es teatro de
// cliente. Quien no es admin NO recibe un 200 con la pantalla en blanco: el SERVIDOR le
// contesta HTTP 403 vía `forbidden()` (renderiza `app/forbidden.tsx`). El chequeo de rol
// vive acá, en el Server Component, no en el menú.
//
// Cada una de las seis acciones destructivas vive en su propio AC (AC-ADM-05..09) y se
// confirma escribiendo el MOTIVO —jamás marcando una casilla— dejando su evento en
// `pan.eventos` (regla transversal de la sección). Esta pantalla es su índice: existe y
// las lista. Las pantallas de detalle llegan con sus ACs.
const ACCIONES = [
  {
    titulo: "Anular una venta",
    detalle: "Deja de sumar al arqueo de su turno. Con motivo escrito y su evento.",
  }, // AC-ADM-05
  {
    titulo: "Corregir un cierre de turno",
    detalle: "El cierre original no se pisa: la corrección se registra encima y ambos quedan legibles.",
  }, // AC-ADM-06
  {
    titulo: "Cerrar una ruta con odómetro",
    detalle: "Para la ruta que quedó abierta. Con motivo escrito y su evento.",
  }, // AC-ADM-07
  {
    titulo: "Revocar un equipo enrolado",
    detalle: "Saca de circulación una tablet o teléfono. Con motivo escrito y su evento.",
  }, // AC-ADM-08
  {
    titulo: "Desbloquear un PIN",
    detalle: "Devuelve el acceso a quien quedó bloqueado. Con motivo escrito y su evento.",
  }, // AC-ADM-08
  {
    titulo: "Quitar un pedido de una ruta",
    detalle: "Saca un pedido de la ruta a la que se asignó por error. Con motivo escrito y su evento.",
  }, // AC-ADM-09
] as const;

export default async function ArreglarPage() {
  // Misma puerta que /dashboard: la sesión se valida en el servidor, con expiración por
  // inactividad incluida (AC-ID-05). Sin sesión, a /ingresar; con sesión no-admin, 403.
  const usuario = await obtenerSesionActual({ cookies: await cookies() });
  if (!usuario) redirect("/ingresar");
  if (usuario.rol !== "admin") forbidden();

  return (
    <Pantalla titulo="Arreglar" bajada="Deshacer un error de operación sin entrar a la base." ancho={620}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {ACCIONES.map((accion) => (
          <li
            key={accion.titulo}
            style={{
              background: superficie.tarjeta,
              border: `1px solid ${superficie.hairline}`,
              borderRadius: 14,
              padding: 16,
            }}
          >
            <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>{accion.titulo}</p>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: superficie.textoDim, lineHeight: 1.4 }}>
              {accion.detalle}
            </p>
          </li>
        ))}
      </ul>
      <Copyright />
    </Pantalla>
  );
}
