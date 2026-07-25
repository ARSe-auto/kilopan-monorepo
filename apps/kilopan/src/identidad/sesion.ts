// Cookie de sesión: HttpOnly + Secure (en producción) + SameSite=Lax (AC-SEC-05).
// Nunca en localStorage — la cookie HttpOnly es invisible a JS del cliente, que es
// justamente el punto (mitiga robo de sesión por XSS).
import type { NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";

export const NOMBRE_COOKIE = "kp_sesion";

export const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 12, // 12h de tope duro; la inactividad de 10 min (AC-ID-05) la corta la UI
};

export interface SesionActual {
  sesionId: string;
  usuarioId: string;
  dispositivoId: string;
  nombre: string;
  rol: "admin" | "maestro" | "vendedor" | "repartidor";
}

/** Lee la cookie, valida contra sesiones_operador (fin IS NULL) y trae el usuario.
 *  Devuelve null si no hay sesión viva — nunca lanza, para que cada ruta decida qué
 *  hacer (401 la mayoría, pero el login mismo también consulta esto). */
export async function obtenerSesionActual(request: NextRequest): Promise<SesionActual | null> {
  const sesionId = request.cookies.get(NOMBRE_COOKIE)?.value;
  if (!sesionId) return null;

  const db = await obtenerDb();
  const r = await db.query<{
    sesion_id: string;
    usuario_id: string;
    dispositivo_id: string;
    nombre: string;
    rol: SesionActual["rol"];
  }>(
    `select s.id as sesion_id, s.usuario_id, s.dispositivo_id, u.nombre, u.rol
       from pan.sesiones_operador s
       join pan.usuarios u on u.id = s.usuario_id
      where s.id = $1 and s.fin is null and u.activo`,
    [sesionId]
  );
  const fila = r.rows[0];
  if (!fila) return null;
  return {
    sesionId: fila.sesion_id,
    usuarioId: fila.usuario_id,
    dispositivoId: fila.dispositivo_id,
    nombre: fila.nombre,
    rol: fila.rol,
  };
}

/** Azúcar para rutas API: sesión o 401, en una línea. Uso:
 *  const sesion = await exigirSesion(request); if (sesion instanceof NextResponse) return sesion; */
export async function exigirSesion(request: NextRequest) {
  const sesion = await obtenerSesionActual(request);
  if (!sesion) {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }
  return sesion;
}
