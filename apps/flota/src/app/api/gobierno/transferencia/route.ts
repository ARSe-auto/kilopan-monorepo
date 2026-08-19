import { headers } from "next/headers";
import { guardia, esUuid } from "../../../../servidor/gobierno.ts";
import { emitirOpciones, confirmarTransferencia, type MotivoDeRebote } from "../../../../servidor/transferencia.ts";

// Transferir propiedad con passkey/WebAuthn [AC-FIDN-13] — §5.4 F-H.
//
// DOS ACTOS Y NO UNO, mismo criterio que `usuarios/[id]/pin`: «opciones» arma la ceremonia
// (registro o autenticación, según si esta persona ya tiene passkey) y fija el DESTINO desde
// ese momento; «confirmar» la cierra. Separarlas es lo que permite que el navegador ejecute
// `navigator.credentials.create()`/`.get()` entre las dos —esa llamada vive del lado del
// cliente, este servidor no la puede hacer por él.
//
// RP ID = el subdominio del tenant, sin puerto. Cada tenant es su propia relying party: la
// passkey de A no sirve contra el origin de B, ni aunque alguien la copiara entera.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function origenYRpId(cabeceras: Headers): { rpId: string; origen: string } {
  const host = cabeceras.get("host") ?? "";
  const rpId = host.split(":")[0] ?? "";
  const proto =
    cabeceras.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  return { rpId, origen: `${proto}://${host}` };
}

const MENSAJES: Record<MotivoDeRebote, string> = {
  destino_invalido: "Ese destino no puede recibir la propiedad de la cuenta.",
  reto_invalido: "La ceremonia expiró o ya se usó. Iniciá de nuevo.",
  reto_vencido: "La ceremonia expiró. Iniciá de nuevo.",
  passkey_invalida: "No se pudo verificar la passkey.",
};

function rebote(motivo: MotivoDeRebote): Response {
  return Response.json({ error: motivo, mensaje: MENSAJES[motivo] }, { status: 422 });
}

export async function POST(peticion: Request) {
  const cabeceras = await headers();
  const g = await guardia(cabeceras);
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: { accion?: unknown; nuevo_admin_usuario_id?: unknown; reto_id?: unknown; credencial?: unknown };
  try {
    cuerpo = (await peticion.json()) as typeof cuerpo;
  } catch {
    cuerpo = {};
  }
  const accion = String(cuerpo.accion ?? "");
  const { rpId, origen } = origenYRpId(cabeceras);

  if (accion === "opciones") {
    const nuevoAdminUsuarioId = String(cuerpo.nuevo_admin_usuario_id ?? "");
    if (!esUuid(nuevoAdminUsuarioId)) return rebote("destino_invalido");
    const resultado = await emitirOpciones(g.acto.pool, g.acto.sesion, rpId, nuevoAdminUsuarioId);
    if (resultado.tipo === "rebote") return rebote(resultado.motivo);
    return Response.json(resultado.datos, { status: 201 });
  }

  if (accion === "confirmar") {
    const retoId = String(cuerpo.reto_id ?? "");
    if (!esUuid(retoId)) return rebote("reto_invalido");
    const resultado = await confirmarTransferencia(g.acto.pool, g.acto.sesion, rpId, origen, retoId, cuerpo.credencial);
    if (resultado.tipo === "rebote") return rebote(resultado.motivo);
    return Response.json({ estado: "transferida", nuevo_admin_usuario_id: resultado.nuevoAdminUsuarioId });
  }

  return Response.json(
    { error: "accion_desconocida", mensaje: "Acción no válida sobre la propiedad de la cuenta." },
    { status: 422 },
  );
}
