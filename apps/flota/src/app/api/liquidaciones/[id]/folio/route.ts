import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import {
  registrarFolioDeLiquidacion,
  puedeVerLiquidaciones,
  moduloDeLiquidacionEncendido,
} from "../../../../../servidor/liquidaciones.ts";
import { esTipoDeDte } from "../../../../../servidor/manifiestos.ts";
import { moduloApagadoRespuesta } from "../../../../../servidor/config.ts";

// El registro MANUAL del folio del DTE que ampara la liquidación [AC-FTAR-16] — spec 06, §7.3,
// §4.6, §3.E2, art. 97 N°4 CT.
//
// La app REGISTRA lo que un emisor autorizado por el SII ya emitió afuera —software facturador
// del tenant o portal del SII— y JAMÁS emite: acá no se genera folio, ni XML, ni TED. Es camino
// paralelo PERMANENTE (§3.E2), no un puente hasta que exista el puerto `EmisorDTE`.
//
// Las mismas tres puertas que el GET de la liquidación, en el mismo orden y por el mismo motivo:
// rol con dinero (§8), módulo comprado (§5.5, AC-FTAR-18) y recién después el id — así el 403 del
// módulo apagado se contesta igual para un id propio que para uno inventado y no filtra si la
// liquidación existe.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este panel es de operación o administración." },
    { status: 403 },
  );

export async function POST(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (!puedeVerLiquidaciones(g.acto.sesion.rol)) return SIN_ACCESO();
  if (!(await moduloDeLiquidacionEncendido(g.acto.pool, g.acto.slug))) {
    return moduloApagadoRespuesta();
  }

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const tipo = String(cuerpo.tipo ?? "");
  const folio = String(cuerpo.folio ?? "").trim();
  const emisor = String(cuerpo.emisor ?? "").trim();

  if (!esTipoDeDte(tipo) || folio === "" || emisor === "") {
    return Response.json(
      {
        error: "documento_incompleto",
        mensaje: "Un documento necesita su tipo (33, 39, 52 o 61), su folio y quién lo emitió.",
      },
      { status: 422 },
    );
  }

  const registro = await registrarFolioDeLiquidacion(g.acto.pool, g.acto.sesion, {
    liquidacionId: id,
    tipo,
    folio,
    emisor,
    fecha: cuerpo.fecha ? String(cuerpo.fecha) : null,
  });

  // El 404 del id que no está (o que es de otro tenant, §4.1) va PELADO, igual que el resto del
  // panel: un cuerpo explicativo acá diría que la liquidación existe en algún lado.
  if (registro.tipo === "liquidacion_no_existe") return noExiste();

  // Los tres rebotes son 422 con CERO filas escritas, y con código distinto cada uno porque la
  // corrección de la persona es distinta: cerrar la liquidación, revisar el folio tecleado, o
  // darse cuenta de que ya lo había registrado.
  if (registro.tipo === "estado_no_admite_folio") {
    return Response.json(
      {
        error: "liquidacion_no_cerrada",
        mensaje:
          registro.estado === "abierta"
            ? "El folio se registra sobre una liquidación cerrada: cerrarla es lo que congela sus líneas y su total."
            : "Esta liquidación ya está pagada: su folio tenía que registrarse antes del pago.",
        estado: registro.estado,
      },
      { status: 422 },
    );
  }
  if (registro.tipo === "folio_duplicado") {
    return Response.json(
      {
        error: "folio_duplicado",
        mensaje: "Ese folio, de ese tipo y ese emisor, ya está registrado. No se cambió nada.",
      },
      { status: 422 },
    );
  }
  if (registro.tipo === "ya_tiene_folio") {
    return Response.json(
      {
        error: "liquidacion_con_folio",
        mensaje: "Esta liquidación ya tiene su documento registrado. No se cambió nada.",
      },
      { status: 422 },
    );
  }

  return Response.json(registro, { status: 201 });
}
