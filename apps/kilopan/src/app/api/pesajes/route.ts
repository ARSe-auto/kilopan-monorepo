import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

const MOTIVOS_MERMA = ["quemado", "sobrante_dia", "devolucion_cliente", "otro"] as const;

// F1 Pesar (PROMPT_MAESTRO.md §5): ≤4 toques. client_uuid es la clave de idempotencia
// — un doble-tap o un reintento de red con el MISMO client_uuid no duplica el pesaje.
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: {
    clientUuid?: string;
    productoId?: string;
    gramos?: number;
    destino?: "mostrador" | "merma";
    motivoMerma?: string;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { clientUuid, productoId, gramos, destino, motivoMerma } = cuerpo;

  if (!clientUuid || !productoId || !destino) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  if (!Number.isInteger(gramos) || (gramos as number) < 1 || (gramos as number) > 100_000) {
    return NextResponse.json({ error: "Gramos debe ser un entero entre 1 y 100.000" }, { status: 400 });
  }
  if (destino !== "mostrador" && destino !== "merma") {
    return NextResponse.json(
      { error: "Reparto se habilita cuando exista el módulo de despacho" },
      { status: 400 }
    );
  }
  if (destino === "merma" && !MOTIVOS_MERMA.includes(motivoMerma as (typeof MOTIVOS_MERMA)[number])) {
    return NextResponse.json({ error: "Motivo de merma inválido" }, { status: 400 });
  }

  const db = await obtenerDb();

  // AC-PES-03: test centinela "báscula mal tipeada" — outlier >3x mediana exige que
  // el cliente vuelva a mandar el pesaje con confirmarOutlier=true (ver UI).
  const outlier = await db.query<{ outlier: boolean }>(`select pan.es_outlier_pesaje($1,$2) as outlier`, [
    productoId,
    gramos,
  ]);
  const cuerpoConConfirmacion = cuerpo as { confirmarOutlier?: boolean };
  if (outlier.rows[0]?.outlier && !cuerpoConConfirmacion.confirmarOutlier) {
    return NextResponse.json(
      { error: "outlier", mensaje: "Ese peso es muy distinto a lo habitual. ¿Confirmás?" },
      { status: 409 }
    );
  }

  try {
    const r = await db.query<{ id: string }>(
      `insert into pan.pesajes
         (client_uuid, producto_id, gramos, destino, motivo_merma, estado_merma, usuario_id, dispositivo_id, capturado_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now())
       on conflict (client_uuid) do nothing
       returning id`,
      [
        clientUuid,
        productoId,
        gramos,
        destino,
        destino === "merma" ? motivoMerma : null,
        destino === "merma" ? "pendiente" : null,
        sesion.usuarioId,
        sesion.dispositivoId,
      ]
    );
    // DO NOTHING no devuelve fila en un reintento — el id ya existe, se busca aparte.
    // pan_app tiene SELECT pero deliberadamente NO tiene UPDATE(client_uuid) (solo
    // estado_merma/venta_recuperada_id, ver 0002) — un upsert con DO UPDATE hubiera
    // necesitado ese permiso y lo habría vuelto a abrir sin necesidad real.
    const id =
      r.rows[0]?.id ??
      (await db.query<{ id: string }>(`select id from pan.pesajes where client_uuid = $1`, [clientUuid]))
        .rows[0]?.id;
    return NextResponse.json({ id, clientUuid });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/sin sesión/i.test(mensaje)) {
      return NextResponse.json({ error: "Sesión vencida" }, { status: 401 });
    }
    console.error("POST /api/pesajes:", mensaje);
    return NextResponse.json({ error: "No se pudo registrar el pesaje" }, { status: 500 });
  }
}
