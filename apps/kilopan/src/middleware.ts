// AC-SEC (Tanda 1 de la auditoría, hallazgo CRÍTICO): hasta acá, el menú de /inicio
// era la ÚNICA autorización de la app — escribir la URL abría cualquier pantalla, con
// sesión o sin ella. Esto cierra esa puerta a nivel de ruta, antes de que la página
// del cliente llegue a renderizar un solo dato: sin la cookie de sesión, redirige a
// /ingresar.
//
// Por qué solo chequea que la cookie EXISTA, no que la sesión siga viva en la BD:
// este archivo corre en el runtime Edge, que no puede importar `pg`/`node:fs` (y
// Next.js 15.5 descarta en silencio, sin error, cualquier middleware que declare
// `runtime: "nodejs"` — no quedó registrado ni una vez en el manifest de build al
// probarlo). La validación FUERTE —sesión viva, expiración por inactividad, rol—
// sigue viviendo donde ya vivía y donde SÍ hay acceso a Postgres: `exigirSesion` /
// `exigirRol` en cada endpoint, y la consulta directa en los Server Components de
// /inicio y /dashboard. Este middleware tapa el agujero real que describía la
// auditoría (abrir /caja, /vender, etc. sin haber iniciado sesión nunca); una cookie
// vencida-pero-presente la rechaza igual la API en cuanto la pantalla pide datos.
import { NextResponse, type NextRequest } from "next/server";
import { NOMBRE_COOKIE } from "@/identidad/cookie.ts";

export const config = {
  // Deja pasar sin filtrar: assets de Next, el manifest/service worker de la PWA y
  // cualquier ruta bajo /api/ (cada endpoint ya exige su propia sesión con
  // exigirSesion/exigirRol, y a una API no le corresponde REDIRIGIR — le corresponde
  // devolver 401/403 en JSON, que es lo que ya hace).
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js).*)"],
};

const RUTAS_PUBLICAS = new Set(["/", "/ingresar", "/vincular"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (RUTAS_PUBLICAS.has(pathname)) return NextResponse.next();

  if (!request.cookies.get(NOMBRE_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/ingresar", request.url));
  }
  return NextResponse.next();
}
