// Cookie de sesión: HttpOnly + Secure (cuando la conexión va por TLS) + SameSite=Lax (AC-SEC-05).
// Nunca en localStorage — la cookie HttpOnly es invisible a JS del cliente, que es
// justamente el punto (mitiga robo de sesión por XSS).
import type { NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { esUuid } from "@/comun/validacion.ts";
import { NOMBRE_COOKIE } from "./cookie.ts";

export { NOMBRE_COOKIE };

// 12h de tope duro; la inactividad de 10 min (AC-ID-05) la corta la UI.
const MAX_EDAD_COOKIE_S = 60 * 60 * 12;

/** Serializa el `Set-Cookie` de la sesión a mano: con `Max-Age` y SIN `Expires`.
 *
 *  No es estilo, es un defecto real encontrado el 26-jul-2026. `respuesta.cookies.set()`
 *  de Next DERIVA un `Expires` a partir de `maxAge`, y esa fecha lleva una coma
 *  («Expires=Mon, 27 Jul 2026 09:55:37 GMT»). La coma es justamente el separador con que
 *  se juntan headers repetidos, así que cualquier intermediario que junte o reescriba
 *  headers puede partir ese `Set-Cookie` en dos fragmentos rotos. El navegador entonces
 *  no descarta el fragmento: descarta la cookie ENTERA, y el operador queda sin sesión
 *  después de un login que respondió 200 — sin ningún error visible en ninguna capa.
 *
 *  Síntoma con el que se manifestó: el e2e fallaba el 100% de las veces bajo el test
 *  runner (`context.cookies()` devolvía lista vacía tras el login) y nunca al reproducirlo
 *  a mano, porque los dos caminos de red no parten el header igual. En producción, un
 *  proxy que haga lo mismo rompe el ingreso de la misma forma.
 *
 *  `Max-Age` por sí solo expresa el mismo tope y no contiene comas. */
export function cabeceraCookieSesion(sesionId: string, request: NextRequest): string {
  return armarCookie(`${NOMBRE_COOKIE}=${sesionId}`, `Max-Age=${MAX_EDAD_COOKIE_S}`, request);
}

/** El borrado de la sesión tiene el MISMO problema: `cookies.delete()` de Next emite
 *  `Expires=Thu, 01 Jan 1970 00:00:00 GMT` — otra coma. Si ese header se parte, la cookie
 *  no se borra y el operador sigue con la sesión abierta después de apretar «Salir».
 *  `Max-Age=0` la caduca igual, sin comas. */
export function cabeceraCookieSesionBorrada(request: NextRequest): string {
  return armarCookie(`${NOMBRE_COOKIE}=`, "Max-Age=0", request);
}

/** AC-SEC-05: `Secure` según el PROTOCOLO REAL de la petición, no según `NODE_ENV`.
 *
 *  `NODE_ENV === "production"` no responde la pregunta que importa —«¿esta conexión va
 *  cifrada?»—, solo dice cómo se compiló. El servidor standalone fija `NODE_ENV=production`
 *  siempre, así que servir por http:// (el e2e, o una tablet en la panadería contra un
 *  equipo de la red local sin certificado) emitía una cookie `Secure` sobre una conexión
 *  sin TLS: el navegador la descarta entera y el operador queda sin sesión tras un login
 *  que respondió 200, sin ningún error visible. En Railway la petición llega por https
 *  (o con `x-forwarded-proto: https` desde el proxy de borde), así que ahí sigue saliendo
 *  `Secure` exactamente como antes — no se afloja nada en el despliegue real. */
function armarCookie(asignacion: string, edad: string, request: NextRequest): string {
  const partes = [asignacion, "Path=/", edad, "HttpOnly", "SameSite=Lax"];
  const protoDeclarado = request.headers.get("x-forwarded-proto");
  // El último salto es el que puso el proxy de borde; los anteriores los puede rellenar
  // el cliente (mismo razonamiento que ipDelCliente en identidad/limitador.ts).
  const protoBorde = protoDeclarado?.split(",").map((s) => s.trim()).pop();
  const porTls = protoBorde ? protoBorde === "https" : request.nextUrl.protocol === "https:";
  if (porTls) partes.push("Secure");
  return partes.join("; ");
}

export interface SesionActual {
  sesionId: string;
  usuarioId: string;
  dispositivoId: string;
  nombre: string;
  rol: "admin" | "maestro" | "vendedor" | "repartidor";
}

/** Lo mínimo que hace falta para leer la cookie de sesión — tanto `NextRequest.cookies`
 *  (rutas API) como el `cookies()` de `next/headers` (Server Components) cumplen esta
 *  forma, así que `obtenerSesionActual` sirve para los dos sin duplicar la consulta.
 *  Tanda 6 de la auditoría: /inicio y /dashboard reimplementaban esta misma query a
 *  mano y se les había olvidado el chequeo de expiración por inactividad (AC-ID-05). */
export interface LectorCookies {
  get: (nombre: string) => { value: string } | undefined;
}

/** Por qué NO hay sesión. Existe para que la pantalla de ingreso pueda decir la verdad
 *  en vez de aparecer en blanco: hasta acá, una sesión caída botaba al operador a
 *  /ingresar sin una sola palabra de explicación, y desde el lado del mesón eso se lee
 *  como que la app se rompió. Se distinguen los tres casos porque la acción del panadero
 *  es distinta en cada uno (volver a entrar / avisar que le tomaron el RUT / vincular). */
export type MotivoSinSesion =
  /** Nunca hubo cookie: entrada directa a una URL protegida, o primera vez. */
  | "sin-sesion"
  /** Había sesión viva y se cerró sola por 10 min de inactividad (AC-ID-05). */
  | "vencida"
  /** La cookie existe pero la sesión ya no está abierta: alguien entró con el mismo RUT
   *  en otro equipo (AC-ID-04), pasaron las 12 h de tope duro, o se cerró desde otro lado. */
  | "cerrada";

export type ResultadoSesion =
  | { sesion: SesionActual; motivo: null }
  | { sesion: null; motivo: MotivoSinSesion };

/** Lee la cookie, valida contra sesiones_operador (fin IS NULL) y trae el usuario.
 *  Devuelve null si no hay sesión viva — nunca lanza, para que cada ruta decida qué
 *  hacer (401 la mayoría, pero el login mismo también consulta esto). */
export async function obtenerSesionActual(origen: { cookies: LectorCookies }): Promise<SesionActual | null> {
  return (await obtenerSesionOMotivo(origen)).sesion;
}

/** Igual que `obtenerSesionActual`, pero dice POR QUÉ no hay sesión. Lo usan las pantallas
 *  que redirigen a /ingresar, para pasarle el motivo y que se pueda explicar. */
export async function obtenerSesionOMotivo(origen: { cookies: LectorCookies }): Promise<ResultadoSesion> {
  const sesionId = origen.cookies.get(NOMBRE_COOKIE)?.value;
  if (!sesionId) return { sesion: null, motivo: "sin-sesion" };
  // Una cookie que NO es un uuid es exactamente lo mismo que no tener sesión. Sin
  // este chequeo el valor crudo llegaba a `where s.id = $1` sobre una columna uuid y
  // Postgres lanzaba "invalid input syntax for type uuid": esta función promete
  // "nunca lanza — devuelve null si no hay sesión viva", y esa promesa se rompía.
  // Efecto real (red-team): cualquiera SIN sesión tumbaba con HTTP 500 y cuerpo
  // vacío TODAS las rutas protegidas mandando `Cookie: kp_sesion=fantasma`.
  if (!esUuid(sesionId)) return { sesion: null, motivo: "sin-sesion" };

  const db = await obtenerDb();
  const r = await db.query<{
    sesion_id: string;
    usuario_id: string;
    dispositivo_id: string;
    nombre: string;
    rol: SesionActual["rol"];
  }>(
    // `s.inicio > now() - interval '12 hours'`: TOPE DURO de servidor. Antes el
    // "límite de 12 h" vivía solo en el Max-Age de la cookie, o sea del lado del
    // cliente — quien conservara el valor de la cookie tenía una sesión que solo
    // moría por inactividad, y bastaba tocarla cada 10 min para estirarla sin fin
    // (red-team). Ahora la antigüedad la corta el servidor.
    `select s.id as sesion_id, s.usuario_id, s.dispositivo_id, u.nombre, u.rol
       from pan.sesiones_operador s
       join pan.usuarios u on u.id = s.usuario_id
      where s.id = $1 and s.fin is null and u.activo
        and s.inicio > now() - interval '12 hours'`,
    [sesionId]
  );
  const fila = r.rows[0];
  if (!fila) return { sesion: null, motivo: "cerrada" };

  // AC-ID-05: auto-bloqueo a los 10 min de inactividad, validado EN EL SERVIDOR.
  // Un cliente adulterado simplemente no llamaría al cierre por su cuenta, así que
  // la UI no puede ser la única guardiana de esto.
  const expirada = await db.query<{ expirada: boolean }>(`select pan.sesion_expirada($1, 10) as expirada`, [
    sesionId,
  ]);
  if (expirada.rows[0]?.expirada) {
    await db.query(`update pan.sesiones_operador set fin = now() where id = $1 and fin is null`, [sesionId]);
    return { sesion: null, motivo: "vencida" };
  }
  await db.query(`select pan.tocar_sesion($1)`, [sesionId]);

  return {
    sesion: {
      sesionId: fila.sesion_id,
      usuarioId: fila.usuario_id,
      dispositivoId: fila.dispositivo_id,
      nombre: fila.nombre,
      rol: fila.rol,
    },
    motivo: null,
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

/** Igual que `exigirSesion`, pero además exige que el rol de quien llama esté en la
 *  lista dada — 403 si no. Patrón tomado de `POST /api/clientes` y `POST /api/rutas`,
 *  que ya lo hacían a mano; esto lo vuelve replicable en el resto de endpoints de
 *  escritura y en las lecturas que exponen plata. Uso:
 *  const sesion = await exigirRol(request, ["admin", "vendedor"]);
 *  if (sesion instanceof NextResponse) return sesion; */
export async function exigirRol(request: NextRequest, roles: SesionActual["rol"][]) {
  const sesion = await exigirSesion(request);
  const { NextResponse } = await import("next/server");
  if (sesion instanceof NextResponse) return sesion;
  if (!roles.includes(sesion.rol)) {
    return NextResponse.json({ error: "No tienes permiso para esto" }, { status: 403 });
  }
  return sesion;
}
