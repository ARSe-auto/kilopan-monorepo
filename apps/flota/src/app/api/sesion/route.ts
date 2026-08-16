import { headers } from "next/headers";
import { poolDe } from "../../../servidor/conexion.ts";
import { resolverSesion } from "../../../servidor/sesion.ts";

// Quién soy [AC-FIDN-09]. La ruta que hace verificable, por HTTP y de punta a punta, que la
// revocación del §5.4 F-F tiene efecto EN EL REQUEST SIGUIENTE.
//
// Devuelve lo mínimo: el rol y los ids opacos que la PWA necesita para pintar la pantalla. Ni
// el RUT ni el nombre — eso lo pide quien lo necesite y quedará auditado; una ruta de sesión
// que devuelve datos personales los reparte en cada arranque de la app (§7.8).
//
// El 401 es el MISMO para las cuatro formas de no tener sesión: sin credencial, credencial
// desconocida, aparato revocado y usuario desactivado. A un teléfono robado no le sirve saber
// si lo dieron de baja o si el secreto nunca existió, y la diferencia sería un oráculo — el
// mismo criterio con que el AC-FTEN-05 hace idénticos el 404 del archivado y el del inexistente.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cabeceras = await headers();
  const bd = cabeceras.get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  const veredicto = await resolverSesion(poolDe(bd), cabeceras.get("authorization"));
  if (veredicto.tipo !== "valida") {
    return Response.json({ error: "sin_sesion", mensaje: "Tenés que volver a enrolar este equipo." }, { status: 401 });
  }

  // El enrolamiento COMPLETO se informa acá y no se convierte en un 401 [AC-FIDN-05]: a un
  // aparato al que le falta standalone o persist() hay que DECIRLE qué le falta, y sin sesión
  // no hay pantalla donde decírselo. Negarle la sesión sería la degradación silenciosa que el
  // AC prohíbe con esas palabras. Lo que no puede hacer es capturar en terreno, y eso lo
  // exigen los endpoints de captura del módulo 04 (hito e) — ALCANCE DECLARADO, no olvido.
  const { isStandalone, storagePersisted } = veredicto.sesion;
  return Response.json({
    rol: veredicto.sesion.rol,
    usuario_id: veredicto.sesion.usuarioId,
    dispositivo_id: veredicto.sesion.dispositivoId,
    is_standalone: isStandalone,
    storage_persisted: storagePersisted,
    enrolamiento_completo: isStandalone && storagePersisted,
  });
}
