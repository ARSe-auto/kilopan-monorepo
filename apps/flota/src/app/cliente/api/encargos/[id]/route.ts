import { headers } from "next/headers";
import { sesionDelTenant, esUuid, noExiste } from "../../../../../servidor/gobierno.ts";
import { encargoDelCliente } from "../../../../../servidor/portal-cliente.ts";
import { editarEncargo } from "../../../../../servidor/encargos.ts";

// El encargo propio, dentro del namespace del portal [AC-FPOR-06] — spec 07 §2, §9.3
// centinela 3. Rol distinto de `cliente` (sesión válida, pero de la casa): 403 — es de la
// misma familia que `SIN_ACCESO` en `/api/liquidaciones/[id]`, aplicado acá porque este panel
// es EXCLUSIVO del contratante. Sin sesión, o encargo que no existe, o de otra empresa (RLS de
// `encargos`, 0040): 404 pelado — las tres se ven igual (§0, centinela 2).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_ACCESO = () =>
  Response.json(
    { error: "sin_acceso", mensaje: "Este panel es del contratante." },
    { status: 403 },
  );

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  const encargo = await encargoDelCliente(g.acto.pool, g.acto.sesion, id);
  if (!encargo) return noExiste();

  return Response.json({ encargo });
}

// El contratante corrige su encargo, y SOLO hasta la aceptación [AC-FPOR-08] — spec 07 §2.3,
// §3.E1.10, §4.5, §4.2. `editarEncargo` (servidor/encargos.ts, AC-FRUT-03) ya aplica las dos
// mitades: «su creador» comparando `sesion.usuarioId` cuando `sesion.rol === "cliente"`, y «hasta
// la aceptación» con la guarda de la 0048 en la BD — acá solo falta abrir el namespace del
// portal con el mismo candado de rol que el resto de `/cliente/*`.
export async function PATCH(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const g = await sesionDelTenant(await headers());
  if (g.tipo === "rebote") return g.respuesta;
  if (g.acto.sesion.rol !== "cliente") return SIN_ACCESO();

  const { id } = await contexto.params;
  if (!esUuid(id)) return noExiste();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    cuerpo = {};
  }

  const destinoId = cuerpo.destino_id ? String(cuerpo.destino_id) : undefined;
  if (destinoId !== undefined && !esUuid(destinoId)) {
    return Response.json(
      { error: "destino_no_existe", mensaje: "Ese destino no está cargado todavía." },
      { status: 422 },
    );
  }

  const edicion = await editarEncargo(g.acto.pool, g.acto.sesion, id, {
    ...(destinoId !== undefined ? { destinoId } : {}),
    ...(cuerpo.bultos !== undefined ? { bultos: Number(cuerpo.bultos) } : {}),
    ...(cuerpo.fecha_servicio !== undefined
      ? { fechaServicio: String(cuerpo.fecha_servicio) }
      : {}),
  });

  // Sin sesión, id ajeno o encargo de otro tenant: 404 pelado (§0, centinela 2, ya lo aplica
  // el GET de esta misma ruta). Y el de otro creador de la MISMA empresa también 404: decir
  // «existe pero no es tuyo» le enumeraría al contratante los pedidos de sus compañeros.
  if (edicion.tipo === "no_existe") return noExiste();
  if (edicion.tipo === "no_es_de_su_creador") return noExiste();
  if (edicion.tipo === "ya_aceptado") {
    return Response.json(
      {
        error: "ya_aceptado",
        mensaje: "Este encargo ya lo aceptó la casa y no se puede corregir. Llamá para cambiarlo.",
        estado: edicion.estado,
      },
      { status: 422 },
    );
  }
  if (edicion.tipo === "bultos_fuera_de_rango") {
    return Response.json(
      {
        error: "bultos_fuera_de_rango",
        mensaje: "Los bultos van de 1 a 500. Un cero no es un encargo y más de 500 es un camión entero.",
      },
      { status: 422 },
    );
  }
  if (edicion.tipo === "attrs_invalidos") {
    return Response.json(
      {
        error: "attrs_invalidos",
        mensaje: "Falta un dato del tipo de carga, o uno de los que mandaste no es de ese tipo.",
        detalle: edicion.detalle,
      },
      { status: 422 },
    );
  }
  return Response.json({ encargo: edicion.encargo });
}
