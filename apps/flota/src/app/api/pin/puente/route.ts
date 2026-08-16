import { headers } from "next/headers";
import { hash as hashear } from "@node-rs/argon2";
import { sesionDelTenant, canjearCodigoPuente } from "../../../../servidor/gobierno.ts";
import { normalizarCodigo } from "../../../../dominio/invitaciones.ts";
import { formaValida } from "../../../../dominio/pin.ts";
import { PIN } from "../../../../../../../packages/nucleo-comun/src/constants.ts";

// La otra mitad de «rotar PIN» [AC-FIDN-12] — §5.4, Pregunta 2 respondida el 09-ago-2026.
//
// ACÁ NO ENTRA EL DUEÑO: entra el OPERARIO, desde su propio aparato enrolado, con el código
// que el dueño le dictó. Esa es toda la mecánica y es lo que hace que el dueño no conozca el
// PIN — si lo eligiera él, lo sabría, y la firma por PIN dejaría de probar quién firmó (§4.5 del
// maestro).
//
// POR QUÉ EL CÓDIGO SOLO NO ALCANZA, Y POR QUÉ ESO ES LO QUE LO HACE SEGURO SIN UN PLAZO. El
// canje exige la SESIÓN del propio operario, o sea su aparato enrolado (§4.3: la sesión ES el
// aparato). Quien escuche el código dictado en un galpón no tiene con qué usarlo. Por eso el
// código puente no lleva vencimiento inventado: ni el maestro ni la respuesta del dueño fijan
// uno, y lo acotan los dos ejes que sí están definidos —un solo uso, uno vivo por usuario—
// más el aparato, que es la credencial de verdad.
//
// Y por eso la sesión sigue viva aunque el PIN se haya olvidado: en el teléfono personal la
// sesión no caduca mientras el aparato siga enrolado (Pregunta 1). El PIN se usa para FIRMAR,
// no para abrir la app — que es exactamente el caso en que alguien lo olvida.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REBOTES = {
  datos_incompletos: "Faltan datos para definir el PIN nuevo.",
  pin_invalido: `El PIN tiene que ser de ${PIN.digitos} dígitos.`,
  // UN SOLO mensaje para «ese código no existe», «ya se usó», «lo anularon» y «es de otra
  // persona». Distinguirlos convertiría esta puerta en un probador de códigos ajenos.
  codigo_invalido: "Ese código no sirve. Pedile uno nuevo a quien administra la cuenta.",
} as const;

const rebote = (error: keyof typeof REBOTES) =>
  Response.json({ error, mensaje: REBOTES[error] }, { status: 422 });

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    return rebote("datos_incompletos");
  }

  const codigo = normalizarCodigo(String(cuerpo.codigo ?? ""));
  const pinNuevo = String(cuerpo.pin ?? "");
  if (!codigo) return rebote("codigo_invalido");
  if (!formaValida(pinNuevo)) return rebote("pin_invalido");

  // El PIN se hashea ACÁ, server-side, con el mismo argon2id del resto (§4.3). El valor en
  // claro no se guarda, no se devuelve y no entra a ninguna variable que se serialice.
  const hash = await hashear(pinNuevo);
  const veredicto = await canjearCodigoPuente(g.acto.pool, g.acto.sesion, codigo, hash);
  if (veredicto !== "ok") return rebote("codigo_invalido");

  return Response.json({ estado: "pin_definido" });
}
