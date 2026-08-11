import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { ecuacionDeRuta, cerrarRuta, type Declaracion } from "../../../../../servidor/cierres.ts";

// La ecuación de cierre por empresa (F5) [AC-FRUT-11] — §3.E1.6, §4.5, §5.2 F5, §4.2, §4.8.
//
// GET la entrega YA calculada, que es lo que el §5.2 F5 pide: el chofer la mira, no la hace.
// POST cierra, y NO REBOTA NUNCA — es CAPTURA (§4.2). Un cierre descuadrado que igual llegue por
// sync entra 2xx con su flag, su evento y su fila en «Por revisar»: el día ya terminó y rebotar
// no deshace nada, solo borra la única constancia de qué faltó.
//
// El bloqueo del «no cierra descuadrada» vive en el CLIENTE, contra el snapshot. Acá no está, y
// esa ausencia es la regla — no un olvido.
//
// Ni un campo de dinero en toda la ruta: el chofer ve bultos (§4.8, §5.2 F5).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  const ecuacion = await ecuacionDeRuta(g.acto.pool, g.acto.sesion, id);
  if (!ecuacion.existe) return noExiste();
  return Response.json({ renglones: ecuacion.renglones, cerrada: ecuacion.cerrada });
}

export async function POST(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    // Un cuerpo ilegible tampoco rebota: se cierra sin declaraciones y la ecuación queda
    // descuadrada con su flag. Rechazar acá sería perder el cierre por un byte del transporte.
    cuerpo = {};
  }

  const crudas = Array.isArray(cuerpo.empresas) ? cuerpo.empresas : [];
  const declaraciones: Declaracion[] = crudas
    .map((cruda) => (cruda ?? {}) as Record<string, unknown>)
    .filter((d) => esUuid(String(d.empresa_cliente_id ?? "")))
    .map((d) => ({
      empresa_cliente_id: String(d.empresa_cliente_id),
      devuelto: Number(d.devuelto ?? 0) || 0,
      faltante: Number(d.faltante ?? 0) || 0,
      // El motivo de catálogo de la devolución [AC-FRUT-21]. Sin él —o inválido— la fila de
      // `devoluciones` simplemente no se materializa; el cierre no rebota por eso (§4.2).
      motivo_id: esUuid(String(d.motivo_id ?? "")) ? String(d.motivo_id) : null,
    }));

  const cierre = await cerrarRuta(g.acto.pool, g.acto.sesion, {
    rutaId: id,
    turnoId: esUuid(String(cuerpo.turno_id ?? "")) ? String(cuerpo.turno_id) : null,
    declaraciones,
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
    tsDispositivo: cuerpo.ts_dispositivo ? String(cuerpo.ts_dispositivo) : new Date().toISOString(),
    tzOffsetMin: Number(cuerpo.tz_offset_min ?? 0),
  });

  if (cierre.tipo === "ruta_no_existe") return noExiste();
  return Response.json(cierre, { status: cierre.repetido ? 200 : 201 });
}
