import { headers } from "next/headers";
import { sesionDelTenant, esUuid } from "../../../servidor/gobierno.ts";
import { cerrarSesionDeRecarga } from "../../../servidor/energia.ts";

// Cierre de sesión de recarga [AC-FVEH-08] — §3.E1.4, §4.2, §4.8, §9.3 centinela 10.
//
// SYNC DE CAPTURA = 2xx SIEMPRE. El vehículo ya se cargó: negarle la fila al chofer no descarga
// la batería, solo pierde el registro de una energía que sí se consumió — y con él, la mitad
// del reporte de ahorro vs diésel del Anexo A.
//
// CERO CAMPOS MONETARIOS en el cuerpo (§4.8). Ni siquiera se leen: `costo_clp` lo completa el
// trigger de la base desde la tarifa del tenant, dentro de la misma transacción. Y la respuesta
// tampoco lo trae, porque quien cierra la recarga es normalmente un chofer y la RLS del
// centinela 10 le niega esa lectura.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const vehiculoId = String(cuerpo.vehiculo_id ?? "");
  if (!esUuid(vehiculoId)) {
    return Response.json(
      { error: "vehiculo_no_existe", mensaje: "Decime qué vehículo se cargó." },
      { status: 422 },
    );
  }

  const tsDispositivo = cuerpo.ts_dispositivo ? new Date(String(cuerpo.ts_dispositivo)) : new Date();
  if (Number.isNaN(tsDispositivo.getTime())) {
    return Response.json(
      { error: "ts_dispositivo_invalido", mensaje: "La hora del aparato no se pudo leer." },
      { status: 422 },
    );
  }

  const aEntero = (v: unknown) => (v === undefined || v === null ? null : Number(v));
  const resultado = await cerrarSesionDeRecarga(g.acto.pool, g.acto.sesion, {
    vehiculoId,
    turnoId: cuerpo.turno_id ? String(cuerpo.turno_id) : null,
    wh: Number(cuerpo.wh),
    socInicial: aEntero(cuerpo.soc_inicial),
    socFinal: aEntero(cuerpo.soc_final),
    clientUuid: cuerpo.client_uuid ? String(cuerpo.client_uuid) : null,
    tsDispositivo,
    tzOffsetMin: cuerpo.tz_offset_min === undefined ? null : Number(cuerpo.tz_offset_min),
  });

  if (resultado.tipo === "vehiculo_no_existe") {
    return Response.json(
      { error: "vehiculo_no_existe", mensaje: "Ese vehículo no está en tu flota." },
      { status: 422 },
    );
  }
  if (resultado.tipo === "energia_invalida") {
    return Response.json(
      {
        error: "energia_invalida",
        mensaje: "Falta cuánta energía cargó. Va en Wh enteros.",
      },
      { status: 422 },
    );
  }
  // 200 en el replay: el reintento no creó nada (centinela 1).
  return Response.json(
    { recarga: resultado.recarga },
    { status: resultado.recarga.repetida ? 200 : 201 },
  );
}
