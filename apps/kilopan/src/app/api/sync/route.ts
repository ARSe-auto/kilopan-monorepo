import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirSesion } from "@/identidad/sesion.ts";

interface EntregaEntrada {
  clientUuid: string;
  pedidoId: string;
  receptorNombre: string;
  receptorRut?: string | null;
  fotoSha256: string;
  lat: number;
  lng: number;
  precisionM: number;
  gramosEntregados: number;
  motivoRechazo?: string | null;
  capturadoAt: string;
}

// AC-POD-02: la cola offline descarga acá. Idempotente por `client_uuid` —
// ON CONFLICT DO NOTHING: reintento infinito sin duplicar, cero merge. Un replay
// de la cola entera es seguro por construcción (test centinela #1).
export async function POST(request: NextRequest) {
  const sesion = await exigirSesion(request);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { entregas?: EntregaEntrada[] };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const entregas = cuerpo.entregas ?? [];
  if (entregas.length === 0) return NextResponse.json({ aceptadas: [], rechazadas: [] });

  const db = await obtenerDb();
  const aceptadas: string[] = [];
  const rechazadas: { clientUuid: string; motivo: string }[] = [];

  for (const e of entregas) {
    try {
      if (!e.clientUuid || !e.pedidoId || !e.receptorNombre || !e.fotoSha256) {
        rechazadas.push({ clientUuid: e.clientUuid, motivo: "faltan campos obligatorios" });
        continue;
      }
      // Flags que NO bloquean, solo marcan para la cola "Entregas por revisar".
      const gpsDegradado = e.precisionM > 100;
      const distanciaOk = await db.query<{ fuera: boolean }>(
        `select coalesce(
                  sqrt(power((c.lat - $1) * 111000, 2) + power((c.lng - $2) * 90000, 2)) > 300,
                  false) as fuera
           from pan.pedidos p join pan.clientes c on c.id = p.cliente_id
          where p.id = $3`,
        [e.lat, e.lng, e.pedidoId]
      );

      const r = await db.query<{ id: string }>(
        `insert into pan.entregas
           (client_uuid, pedido_id, receptor_nombre, receptor_rut, foto_sha256, foto_estado,
            lat, lng, precision_m, gps_degradado, gps_fuera_de_zona,
            gramos_entregados, motivo_rechazo, cerrada, usuario_id, dispositivo_id, capturado_at)
         values ($1,$2,$3,$4,$5,'pendiente_subida',$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15)
         on conflict (client_uuid) do nothing
         returning id`,
        [
          e.clientUuid,
          e.pedidoId,
          e.receptorNombre,
          e.receptorRut ?? null,
          e.fotoSha256,
          e.lat,
          e.lng,
          e.precisionM,
          gpsDegradado,
          distanciaOk.rows[0]?.fuera ?? false,
          e.gramosEntregados,
          e.motivoRechazo ?? null,
          sesion.usuarioId,
          sesion.dispositivoId,
          e.capturadoAt,
        ]
      );

      // DO NOTHING sin fila = ya estaba sincronizada. Para la cola del cliente eso
      // es un éxito igual: lo importante es que puede borrar el ítem local.
      aceptadas.push(e.clientUuid);
      if (r.rows[0]?.id) {
        await db.query(
          `update pan.ruta_paradas set estado = 'entregada'
            where pedido_id = $1 and estado = 'pendiente'`,
          [e.pedidoId]
        );
        await db.query(`update pan.pedidos set estado = 'entregado' where id = $1 and estado <> 'entregado'`, [
          e.pedidoId,
        ]);
      }
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err);
      // Un rebote de invariante (GPS fuera de Chile, POD duplicado vigente) NO se
      // reintenta al infinito: se devuelve como rechazo explícito para que la app lo
      // muestre en vez de quedar girando en la cola para siempre.
      rechazadas.push({ clientUuid: e.clientUuid, motivo: mensaje.slice(0, 200) });
    }
  }

  return NextResponse.json({ aceptadas, rechazadas });
}
