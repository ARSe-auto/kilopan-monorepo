import { headers } from "next/headers";
import { hash as hashear } from "@node-rs/argon2";
import { poolDe } from "../../../servidor/conexion.ts";
import { normalizarCodigo, hashDeCodigo, veredictoDe } from "../../../dominio/invitaciones.ts";
import { PIN } from "../../../../../../packages/nucleo-comun/src/constants.ts";

// F-B del §5.4: solicitar acceso con el código de la invitación [AC-FIDN-03].
//
// Este endpoint es PÚBLICO por definición: lo llama alguien que todavía no tiene cuenta. Y es
// PLANIFICACIÓN (§4.2), así que valida online y rebota 422 tipado — nada de aceptar y
// arreglar después, que es lo que corresponde a la captura del terreno y no a esto.
//
// LO QUE ESTE ENDPOINT NO HACE, y es la mitad del AC: no abre sesión y no emite el secreto
// del dispositivo. Un código válido crea una fila `pendiente` y nada más. El secreto lo emite
// la aprobación del dueño contra la clave pública que viaja acá (AC-FIDN-04).
//
// CERO emails (§5.4): no hay campo de correo ni verificación por correo en ningún paso.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Los rebotes tipados. El `mensaje` es lo que ve la persona; el `error`, lo que lee la UI. */
const REBOTES = {
  datos_incompletos: "Faltan datos para enviar la solicitud.",
  codigo_invalido: "Ese código no tiene la forma de un código de invitación. Revisalo y volvé a intentar.",
  invitacion_invalida: "Ese código no corresponde a ninguna invitación.",
  invitacion_expirada: "Esta invitación venció. Pedile una nueva a quien te la envió.",
  invitacion_pausada: "Esta invitación está pausada. Avisale a quien te la envió.",
  invitacion_revocada: "Esta invitación fue anulada. Pedile una nueva a quien te la envió.",
  rut_invalido: "Ese RUT no es válido. Revisá el número y el dígito verificador.",
  // El largo sale de la constante y no del texto: si el §0 cambiara el PIN, un mensaje con
  // el número escrito a mano seguiría diciendo el viejo, y la persona leería una instrucción
  // que ya no es cierta justo cuando no puede entrar.
  pin_invalido: `El PIN tiene que ser de ${PIN.digitos} dígitos.`,
} as const;

function rebote(error: keyof typeof REBOTES) {
  return Response.json({ error, mensaje: REBOTES[error] }, { status: 422 });
}

const PIN_ESPERADO = new RegExp(`^\\d{${PIN.digitos}}$`);

type Cuerpo = {
  codigo?: unknown;
  rut?: unknown;
  nombre?: unknown;
  pin?: unknown;
  clave_publica?: unknown;
  huella_dispositivo?: unknown;
};

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

export async function POST(peticion: Request) {
  const bd = (await headers()).get("x-flota-tenant-bd");
  // Sin la cabecera que puso el ruteo, este handler se alcanzó por fuera del servidor: no se
  // adivina de quién sería la solicitud (§4.1).
  if (!bd) return new Response(null, { status: 404 });

  let cuerpo: Cuerpo;
  try {
    cuerpo = (await peticion.json()) as Cuerpo;
  } catch {
    return rebote("datos_incompletos");
  }

  const rut = texto(cuerpo.rut);
  const nombre = texto(cuerpo.nombre);
  const pin = texto(cuerpo.pin);
  const clavePublica = texto(cuerpo.clave_publica);
  const huella = texto(cuerpo.huella_dispositivo);
  if (!rut || !nombre || !pin || !clavePublica || !huella) return rebote("datos_incompletos");

  if (!PIN_ESPERADO.test(pin)) return rebote("pin_invalido");

  const codigo = normalizarCodigo(texto(cuerpo.codigo) ?? "");
  if (!codigo) return rebote("codigo_invalido");

  const pool = poolDe(bd);
  const { rows } = await pool.query<{
    id: string;
    expira_at: Date;
    pausada_at: Date | null;
    revocada_at: Date | null;
  }>(
    "select id, expira_at, pausada_at, revocada_at from invitaciones where token_hash = $1",
    [hashDeCodigo(codigo)],
  );

  const invitacion = rows[0];
  if (!invitacion) return rebote("invitacion_invalida");

  const veredicto = veredictoDe(invitacion, new Date());
  if (veredicto === "expirada") return rebote("invitacion_expirada");
  if (veredicto === "pausada") return rebote("invitacion_pausada");
  if (veredicto === "revocada") return rebote("invitacion_revocada");

  // El PIN se hashea ACÁ, server-side, y el valor en claro no viaja a ningún log ni queda en
  // ninguna variable que se serialice. En la fila queda solo el hash (§4.3, §7.8).
  //
  // Sin pasarle `algorithm`: argon2id ES el que la librería usa por omisión, y nombrarlo con
  // su enum obliga a importar un `const enum` ambiente que `isolatedModules` no deja resolver.
  // Que el hash sea argon2id no queda en la confianza: el e2e asierta el prefijo `$argon2id$`
  // de la fila que quedó en la base, que es donde el §4.3 exige que esté.
  const pinHash = await hashear(pin);

  // EL RUT YA REGISTRADO NO SE MIRA ACÁ, y es una decisión del dueño (09-ago-2026, pregunta
  // 10), no un olvido: quien tiene el código no está autenticado y el código viaja por
  // WhatsApp. Si este endpoint rebotara al reconocer un RUT de la casa, cualquiera con un
  // link enumeraría la nómina a un RUT por intento. La colisión la resuelve el dueño al
  // aprobar (AC-FIDN-04), que sí conoce a su gente y puede decidir en un toque.
  try {
    await pool.query(
      `insert into solicitudes_acceso
         (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
       values ($1, $2, $3, $4, $5, $6)`,
      [invitacion.id, rut, nombre, pinHash, clavePublica, huella],
    );
  } catch (error) {
    // El módulo 11 tiene UNA implementación y está en la BD (`rut_valido`, AC-FIDN-01):
    // repetirla acá sería dos algoritmos que se separan. Lo que hace este catch es TRADUCIR
    // su rebote al 422 tipado que el §4.2 exige, sin inventar una segunda verdad.
    const codigoSql = (error as { code?: string }).code;
    const restriccion = (error as { constraint?: string }).constraint;
    if (codigoSql === "23514" && restriccion === "solicitudes_rut_modulo_11") return rebote("rut_invalido");
    throw error;
  }

  // 201 y el estado, nada más. No se devuelve el id de la solicitud: no le sirve a quien
  // espera —la pantalla siguiente es «Esperando aprobación», sin nada que consultar— y sería
  // un identificador de la casa en manos de alguien que todavía no es de la casa.
  return Response.json({ estado: "pendiente" }, { status: 201 });
}
