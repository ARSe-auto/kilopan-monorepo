import { cookies } from "next/headers";
import { obtenerSesionActual } from "@/identidad/sesion.ts";
import { ChipOperador } from "@kilopan/miga/componentes/index.tsx";

// AC-ID-07 (§5 F5): el nombre del operador va visible en TODAS las pantallas, no solo en
// /inicio. La tablet del mesón es compartida y el relevo es de un toque: sin el chip, quien
// pesa una bandeja no tiene cómo confirmar de un vistazo que el turno abierto es el suyo, y
// el pesaje queda firmado a nombre del que se acaba de ir.
//
// Server Component a propósito: la sesión se lee de la cookie HttpOnly, que el cliente no
// puede ver. Devuelve null sin sesión —en /ingresar y /vincular no hay a quién nombrar— y
// por eso el layout lo puede montar sin condicionales.
export async function EncabezadoConOperador() {
  const sesion = await obtenerSesionActual({ cookies: await cookies() });
  if (!sesion) return null;
  return <ChipOperador nombre={sesion.nombre} />;
}
