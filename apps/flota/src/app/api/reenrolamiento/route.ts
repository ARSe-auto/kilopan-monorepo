import { headers } from "next/headers";
import { poolDe } from "../../../servidor/conexion.ts";
import { verificarPin } from "../../../servidor/pin.ts";
import { formaValida } from "../../../dominio/pin.ts";

// F-E del §5.4: «Ya tengo cuenta», el teléfono nuevo [AC-FIDN-08].
//
// Flujo de PRIMERA CLASE y no una excepción: cambiar de teléfono pasa seguido, y obligar a
// pasar de nuevo por una invitación del dueño convierte un trámite de noventa segundos en una
// llamada telefónica a las cinco de la mañana.
//
// Este endpoint es público —lo llama alguien que no tiene sesión, porque justamente perdió el
// aparato que la tenía— pero NO es anónimo: se entra con RUT + PIN, que es lo que la persona
// ya sabe. El PIN pasa por el mismo camino que el resto (AC-FIDN-06), con su lockout por
// usuario: sin eso, este endpoint sería la puerta sin candado para probar PINs de a diez mil.
//
// Y sigue sin abrir sesión: crea una solicitud `pendiente`. El aparato nuevo no vale nada
// hasta que el dueño aprueba, que es cuando el anterior se revoca en el mismo acto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REBOTES = {
  datos_incompletos: "Faltan datos para pedir el cambio de equipo.",
  // UN SOLO mensaje para «ese RUT no está» y «el PIN no es ese». La alternativa —decir cuál de
  // los dos falló— convertiría este endpoint en un buscador de RUTs de la empresa, que es
  // exactamente lo que la respuesta del dueño a la pregunta 10 cerró en la otra puerta.
  credenciales_invalidas: "El RUT o el PIN no coinciden. Revisalos y volvé a intentar.",
  bloqueado: "Por seguridad, esperá unos minutos antes de volver a intentar.",
  ya_pendiente: "Ya hay una solicitud de cambio de equipo esperando aprobación.",
} as const;

const rebote = (error: keyof typeof REBOTES, status = 422) =>
  Response.json({ error, mensaje: REBOTES[error] }, { status });

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

export async function POST(peticion: Request) {
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    return rebote("datos_incompletos");
  }

  const rut = texto(cuerpo.rut);
  const pin = texto(cuerpo.pin);
  const clavePublica = texto(cuerpo.clave_publica);
  const huella = texto(cuerpo.huella_dispositivo);
  if (!rut || !pin || !clavePublica || !huella) return rebote("datos_incompletos");
  if (!formaValida(pin)) return rebote("credenciales_invalidas");

  const pool = poolDe(bd);
  const { rows } = await pool.query<{ persona_id: string; usuario_id: string }>(
    `select p.id::text as persona_id, u.id::text as usuario_id
       from personas p join usuarios u on u.persona_id = p.id
      where p.rut = $1 and u.activo`,
    [rut],
  );
  const quien = rows[0];
  // El RUT desconocido se responde IGUAL que el PIN equivocado, y encima sin haber consultado
  // ningún hash: la diferencia de tiempo entre ambos caminos es medible, así que este endpoint
  // no debe volverse un oráculo por el reloj tampoco. Es una diferencia acotada y declarada:
  // igualar tiempos de verdad exige un hash de descarte, y eso entra si alguna vez importa.
  if (!quien) return rebote("credenciales_invalidas");

  const veredicto = await verificarPin(pool, quien.usuario_id, pin);
  if (veredicto.tipo === "bloqueado") return rebote("bloqueado", 429);
  if (veredicto.tipo !== "correcto") return rebote("credenciales_invalidas");

  // Una sola solicitud de cambio de equipo a la vez. Con varias pendientes, aprobar una
  // dejaría a las otras apuntando a un aparato que ya no es el activo, y el dueño tendría que
  // resolver una cola que él no creó.
  const { rows: pendientes } = await pool.query(
    "select 1 from solicitudes_acceso where persona_id = $1 and estado = 'pendiente'",
    [quien.persona_id],
  );
  if (pendientes.length > 0) return rebote("ya_pendiente");

  await pool.query(
    `insert into solicitudes_acceso
       (tipo, persona_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
     select 'reenrolamiento', p.id, p.rut, p.nombre, u.pin_hash, $2, $3
       from personas p join usuarios u on u.persona_id = p.id
      where p.id = $1`,
    [quien.persona_id, clavePublica, huella],
  );

  return Response.json({ estado: "pendiente" }, { status: 201 });
}
