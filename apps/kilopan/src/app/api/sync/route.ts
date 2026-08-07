import { NextResponse, type NextRequest } from "next/server";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { fechaCapturaValida } from "@/comun/validacion.ts";
import { motivoDeCatalogo } from "@/pod/motivosRechazo.ts";

interface EntregaEntrada {
  clientUuid: string;
  pedidoId: string;
  receptorNombre: string;
  receptorRut?: string | null;
  fotoSha256: string;
  // Opcionales: una entrega FALLIDA se puede registrar sin GPS (migración 0015).
  // La exitosa los sigue exigiendo — se valida en el handler.
  lat?: number | null;
  lng?: number | null;
  precisionM?: number | null;
  gramosEntregados: number;
  // AC-POD-05: `motivoCodigo` es el valor del catálogo CERRADO (`pod/motivosRechazo.ts`)
  // que el servidor valida — es lo que separa una entrega FALLIDA de una exitosa.
  // `motivoRechazo` es solo el texto libre, y únicamente se usa cuando el código es
  // "otro"; para los motivos fijos el texto guardado sale del catálogo, no del cliente.
  motivoCodigo?: string | null;
  motivoRechazo?: string | null;
  capturadoAt: string;
}

// AC-POD-02: la cola offline descarga acá. Idempotente por `client_uuid` —
// ON CONFLICT DO NOTHING: reintento infinito sin duplicar, cero merge. Un replay
// de la cola entera es seguro por construcción (test centinela #1).
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["repartidor"]);
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
      // Fallida = motivoCodigo presente: no se dejó nada, así que exige exactamente 0 g.
      // Exitosa (total o parcial) = sin motivo: exige haber dejado algo, nunca 0.
      // Separa los dos caminos en el dato mismo, sin estado intermedio ambiguo.
      const esFallida = !!e.motivoCodigo;
      if (
        !e.clientUuid ||
        !e.pedidoId ||
        !e.receptorNombre ||
        !e.fotoSha256 ||
        !Number.isInteger(e.gramosEntregados) ||
        (esFallida ? e.gramosEntregados !== 0 : e.gramosEntregados < 1)
      ) {
        rechazadas.push({ clientUuid: e.clientUuid, motivo: "faltan campos obligatorios" });
        continue;
      }
      // AC-POD-05: el catálogo de motivos es CERRADO. Antes acá solo se miraba
      // `!!motivoRechazo` y cualquier string colaba, así que un cliente HTTP directo (o un
      // bug de UI) podía dejar un motivo inventado como evidencia de una entrega fallida.
      // Ahora el código tiene que pertenecer a `pod/motivosRechazo.ts`; el texto libre
      // queda reservado SOLO a "otro", la única puerta abierta a propósito del catálogo.
      const catalogoMotivo = esFallida ? motivoDeCatalogo(e.motivoCodigo) : null;
      if (esFallida) {
        if (!catalogoMotivo) {
          rechazadas.push({ clientUuid: e.clientUuid, motivo: "motivo de rechazo fuera del catálogo" });
          continue;
        }
        if (catalogoMotivo.valor === "otro" && !e.motivoRechazo?.trim()) {
          rechazadas.push({ clientUuid: e.clientUuid, motivo: "falta describir el motivo" });
          continue;
        }
      }
      // El GPS es la prueba de que el pan llegó a la dirección correcta: la entrega
      // EXITOSA no se registra sin él. La FALLIDA sí — ahí no se afirma haber dejado
      // nada, y exigirlo dejaba al repartidor sin poder registrar ni el intento
      // cuando el GPS no fija dentro de un galpón (ver migración 0015).
      // El reloj del teléfono fecha la entrega en la conciliación diaria: sin acotar,
      // el repartidor movía entregas a cualquier día cambiando la hora del equipo.
      if (!fechaCapturaValida(e.capturadoAt)) {
        rechazadas.push({ clientUuid: e.clientUuid, motivo: "La fecha del equipo está muy desfasada" });
        continue;
      }
      const tieneGps = typeof e.lat === "number" && typeof e.lng === "number";
      if (!esFallida && !tieneGps) {
        rechazadas.push({ clientUuid: e.clientUuid, motivo: "falta la ubicación de la entrega" });
        continue;
      }
      // Sin esto, cualquier sesión repartidor cierra el POD de CUALQUIER pedido del
      // sistema con solo adivinar el id — la conciliación del día queda falseada y
      // una parada ajena se marca entregada sin que su repartidor real se entere.
      const parada = await db.query<{ ok: boolean; gramos_pedidos: string }>(
        `select true as ok, coalesce(sum(pl.gramos_pedidos), 0)::text as gramos_pedidos
           from pan.ruta_paradas rp
           join pan.rutas r on r.id = rp.ruta_id
           join pan.pedido_lineas pl on pl.pedido_id = rp.pedido_id
          where rp.pedido_id = $1 and r.repartidor_id = $2 and r.estado in ('en_curso','cargando')
          group by rp.id`,
        [e.pedidoId, sesion.usuarioId]
      );
      if (!parada.rows[0]?.ok) {
        rechazadas.push({
          clientUuid: e.clientUuid,
          motivo: "Ese pedido no es una parada de tu ruta activa",
        });
        continue;
      }
      // AC-POD (Tanda 5): antes se aceptaba lo que mandara el cliente sin mirar el
      // pedido, y ese número alimenta directo la TCK del dueño — un repartidor
      // apurado (o un cliente HTTP hablando directo) podía inflarla sin que nada lo
      // notara. No se permite entregar MÁS de lo que el pedido pide.
      const gramosPedidos = Number(parada.rows[0].gramos_pedidos);
      if (e.gramosEntregados > gramosPedidos) {
        rechazadas.push({
          clientUuid: e.clientUuid,
          motivo: `Se intentó entregar ${e.gramosEntregados} g pero el pedido es de ${gramosPedidos} g`,
        });
        continue;
      }
      // Flags que NO bloquean, solo marcan para la cola "Entregas por revisar".
      // Una fallida sin GPS se marca degradada: no es sospechosa, pero el dueño tiene
      // que poder distinguirla de una con ubicación confirmada al revisar.
      const gpsDegradado = !tieneGps || (e.precisionM ?? 0) > 100;
      const distanciaOk = tieneGps
        ? await db.query<{ fuera: boolean }>(
            `select coalesce(
                      sqrt(power((c.lat - $1) * 111000, 2) + power((c.lng - $2) * 90000, 2)) > 300,
                      false) as fuera
               from pan.pedidos p join pan.clientes c on c.id = p.cliente_id
              where p.id = $3`,
            [e.lat, e.lng, e.pedidoId]
          )
        : { rows: [{ fuera: false }] };

      // La foto se sube apenas se toma —en paralelo a que el repartidor completa la
      // pantalla del receptor— para que la resistencia offline no dependa de una
      // segunda vuelta de red. Eso significa que cuando llega ACÁ, `pan.fotos` ya
      // puede tener el JPEG desde antes de que esta entrega exista: si se ignora eso y
      // se inserta siempre en 'pendiente_subida', el POD queda marcado como sin foto
      // para siempre aunque el archivo ya esté guardado.
      const fotoYaSubida = await db.query<{ ok: boolean }>(`select true as ok from pan.fotos where sha256 = $1`, [
        e.fotoSha256,
      ]);
      const fotoEstado = fotoYaSubida.rows[0]?.ok ? "subida" : "pendiente_subida";

      // El texto guardado sale del CATÁLOGO, no de lo que mandó el cliente: para los tres
      // motivos fijos se ignora `e.motivoRechazo` (así nadie cuela una etiqueta falsa
      // aunque el código sea válido) y solo "otro" usa el texto libre, ya validado no
      // vacío arriba y acotado a 200 caracteres.
      const motivoGuardado = catalogoMotivo
        ? catalogoMotivo.valor === "otro"
          ? e.motivoRechazo!.trim().slice(0, 200)
          : catalogoMotivo.etiqueta
        : null;

      // Una fallida NO cierra el POD del pedido (cerrada=false): el índice único
      // `entregas_una_vigente_por_pedido` solo mira filas cerradas, así que un intento
      // fallido no bloquea el reintento de mañana ni exige encadenar supersede_id. El
      // pedido sigue disponible para una parada nueva en otra ruta.
      const r = await db.query<{ id: string }>(
        `insert into pan.entregas
           (client_uuid, pedido_id, receptor_nombre, receptor_rut, foto_sha256, foto_estado,
            lat, lng, precision_m, gps_degradado, gps_fuera_de_zona,
            gramos_entregados, motivo_rechazo, cerrada, usuario_id, dispositivo_id, capturado_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         on conflict (client_uuid) do nothing
         returning id`,
        [
          e.clientUuid,
          e.pedidoId,
          e.receptorNombre,
          e.receptorRut ?? null,
          e.fotoSha256,
          fotoEstado,
          tieneGps ? e.lat : null,
          tieneGps ? e.lng : null,
          tieneGps ? (e.precisionM ?? 0) : null,
          gpsDegradado,
          distanciaOk.rows[0]?.fuera ?? false,
          e.gramosEntregados,
          motivoGuardado,
          !esFallida,
          sesion.usuarioId,
          sesion.dispositivoId,
          e.capturadoAt,
        ]
      );

      // DO NOTHING sin fila = ya estaba sincronizada. Para la cola del cliente eso
      // es un éxito igual: lo importante es que puede borrar el ítem local.
      aceptadas.push(e.clientUuid);
      if (r.rows[0]?.id) {
        // Fallida: la parada vuelve disponible como 'rechazada', NO 'entregada'.
        await db.query(
          `update pan.ruta_paradas set estado = $1
            where pedido_id = $2 and estado = 'pendiente'`,
          [esFallida ? "rechazada" : "entregada", e.pedidoId]
        );
        if (esFallida) {
          // POST /api/rutas ahora sí mueve el pedido a 'en_ruta' al armar la ruta (fix
          // de idempotencia posterior a este): sin este update, una entrega fallida lo
          // dejaba atascado ahí para siempre — "Armar ruta y salir" solo ofrece
          // pedidos en 'confirmado', así que nunca volvía a aparecer para reintentarlo.
          await db.query(`update pan.pedidos set estado = 'confirmado' where id = $1 and estado = 'en_ruta'`, [
            e.pedidoId,
          ]);
        } else {
          await db.query(`update pan.pedidos set estado = 'entregado' where id = $1 and estado <> 'entregado'`, [
            e.pedidoId,
          ]);
        }
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
