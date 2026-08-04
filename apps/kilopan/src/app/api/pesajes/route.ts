import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { esUuid } from "@/comun/validacion.ts";

const LIMITE_DEFECTO = 30;
const LIMITE_MAXIMO = 100;

type FilaHistorial = Record<string, unknown> & {
  id: string;
  gramos: number;
  destino: string;
  motivo_merma: string | null;
  foto_sha256: string | null;
  foto_estado: string | null;
  recibido_at: string;
  producto_nombre: string;
  maestro_nombre: string;
};

// Historial acumulativo de pesajes, con fecha, hora y foto (si la panadería la exige).
// El maestro ve SIEMPRE el suyo, sin excepción — no hay parámetro que lo cambie: es su
// propio registro de trabajo, no una vitrina del de los demás. El admin puede acotar a
// un maestro (?usuarioId=) o ver la panadería entera (sin el parámetro).
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "maestro"]);
  if (sesion instanceof NextResponse) return sesion;

  const params = request.nextUrl.searchParams;

  let usuarioId: string | null = null;
  if (sesion.rol === "maestro") {
    usuarioId = sesion.usuarioId;
  } else {
    const solicitado = params.get("usuarioId");
    if (solicitado) {
      if (!esUuid(solicitado)) return NextResponse.json({ error: "usuarioId inválido" }, { status: 400 });
      usuarioId = solicitado;
    }
  }

  // Paginación por cursor sobre `recibido_at`, no por número de página: la lista crece
  // todos los días y un OFFSET se vuelve más lento (y más inconsistente si algo se
  // inserta entre medio) cuanto más atrás se pagina.
  const cursor = params.get("antes");
  if (cursor && Number.isNaN(Date.parse(cursor))) {
    return NextResponse.json({ error: "El cursor 'antes' no es una fecha válida" }, { status: 400 });
  }
  const limiteCrudo = Number(params.get("limite") ?? LIMITE_DEFECTO);
  const limite = Number.isFinite(limiteCrudo)
    ? Math.min(Math.max(Math.trunc(limiteCrudo), 1), LIMITE_MAXIMO)
    : LIMITE_DEFECTO;

  const db = await obtenerDb();
  const r = await db.query<FilaHistorial>(
    `select pe.id, pe.gramos, pe.destino, pe.motivo_merma, pe.foto_sha256, pe.foto_estado,
            pe.recibido_at, pr.nombre as producto_nombre, u.nombre as maestro_nombre
       from pan.pesajes pe
       join pan.productos pr on pr.id = pe.producto_id
       join pan.usuarios u on u.id = pe.usuario_id
      where ($1::uuid is null or pe.usuario_id = $1)
        and ($2::timestamptz is null or pe.recibido_at < $2)
      order by pe.recibido_at desc
      limit $3`,
    [usuarioId, cursor, limite]
  );

  // Hay más páginas si esta vino llena: si vino corta, el "límite" no se alcanzó a
  // agotar y no queda nada más atrás que buscar.
  const siguienteCursor = r.rows.length === limite ? r.rows[r.rows.length - 1]?.recibido_at ?? null : null;

  return NextResponse.json({ pesajes: r.rows, siguienteCursor });
}

const MOTIVOS_MERMA = ["quemado", "sobrante_dia", "devolucion_cliente", "otro"] as const;

// F1 Pesar (PROMPT_MAESTRO.md §5): ≤4 toques. client_uuid es la clave de idempotencia
// — un doble-tap o un reintento de red con el MISMO client_uuid no duplica el pesaje.
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "maestro"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: {
    clientUuid?: string;
    productoId?: string;
    gramos?: number;
    destino?: "mostrador" | "merma" | "reparto";
    motivoMerma?: string;
    fotoSha256?: string;
    pedidoLineaId?: string;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { clientUuid, productoId, gramos, destino, motivoMerma, fotoSha256, pedidoLineaId } = cuerpo;

  if (!clientUuid || !productoId || !destino) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  // Sin esto, un productoId mal formado reventaba en el cast a uuid ANTES del
  // try/catch (la consulta de outlier) y salía un HTTP 500 con el cuerpo vacío.
  if (!esUuid(productoId)) {
    return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
  }
  if (!Number.isInteger(gramos) || (gramos as number) < 1 || (gramos as number) > 100_000) {
    return NextResponse.json({ error: "Gramos debe ser un entero entre 1 y 100.000" }, { status: 400 });
  }
  if (destino !== "mostrador" && destino !== "merma" && destino !== "reparto") {
    return NextResponse.json({ error: "Destino inválido" }, { status: 400 });
  }
  // pan.pesajes exige la línea de pedido cuando el destino es reparto
  // (constraint pesajes_reparto_requiere_pedido): un kilo despachado sin decir a qué
  // pedido va no se puede conciliar contra nada.
  if (destino === "reparto" && !pedidoLineaId) {
    return NextResponse.json(
      { error: "Elige a qué pedido va este pesaje" },
      { status: 400 }
    );
  }
  if (destino !== "reparto" && pedidoLineaId) {
    return NextResponse.json(
      { error: "Solo un pesaje con destino reparto va asociado a un pedido" },
      { status: 400 }
    );
  }
  if (destino === "merma" && !MOTIVOS_MERMA.includes(motivoMerma as (typeof MOTIVOS_MERMA)[number])) {
    return NextResponse.json({ error: "Motivo de merma inválido" }, { status: 400 });
  }

  const db = await obtenerDb();

  // La línea de pedido tiene que existir, ser DE ESTE producto y pertenecer a un
  // pedido que todavía admita pan. Sin la comprobación del producto, un error de
  // tipeo mandaría 20 kg de marraqueta a la línea de hallulla del mismo pedido: la
  // FK lo aceptaría feliz y el despacho saldría mal armado sin que nada avisara.
  if (destino === "reparto") {
    const linea = await db.query<{ estado: string; producto_id: string; razon_social: string }>(
      `select p.estado, pl.producto_id, c.razon_social
         from pan.pedido_lineas pl
         join pan.pedidos p on p.id = pl.pedido_id
         join pan.clientes c on c.id = p.cliente_id
        where pl.id = $1`,
      [pedidoLineaId]
    );
    const fila = linea.rows[0];
    if (!fila) {
      return NextResponse.json({ error: "Ese pedido ya no existe" }, { status: 404 });
    }
    if (fila.producto_id !== productoId) {
      return NextResponse.json(
        { error: "Ese pedido no está esperando este producto" },
        { status: 409 }
      );
    }
    if (fila.estado !== "confirmado" && fila.estado !== "pesado") {
      return NextResponse.json(
        { error: `El pedido de ${fila.razon_social} ya está ${fila.estado}: no admite más pan` },
        { status: 409 }
      );
    }
  }

  // AC-PES-04 (decisión #1): si el admin exigió foto por pesaje, el que manda es el
  // SERVIDOR, no la pantalla. Validarlo solo en la UI sería teatro: cualquiera que
  // hable con la API directamente se lo saltaría, y esta bandera existe justamente
  // como control del dueño sobre la operación.
  const parametro = await db.query<{ valor: number }>(
    `select valor from pan.parametros where clave = 'pesaje_foto_obligatoria'`
  );
  const exigeFoto = (parametro.rows[0]?.valor ?? 0) === 1;
  if (exigeFoto && !/^[0-9a-f]{64}$/.test(fotoSha256 ?? "")) {
    return NextResponse.json(
      { error: "Esta panadería exige foto por cada pesaje" },
      { status: 400 }
    );
  }

  // No se puede mermar pan que no está. `pan.stock_disponible()` resta la merma
  // (0012), así que sin este tope el stock quedaba NEGATIVO sin límite: el maestro
  // ladino escribía merma ilimitada para lavar pan robado o vendido por fuera, esos
  // gramos entraban a la conciliación como "merma tipificada" y el dueño veía merma
  // sana en vez de un faltante (red-team, ALTA — verificado llegando a -139.000 g).
  // El camino de venta ya tenía esta guarda; el de pesaje se había quedado sin ella.
  if (destino === "merma") {
    const disponible = await db.query<{ stock: number }>(`select pan.stock_disponible($1) as stock`, [
      productoId,
    ]);
    const stock = disponible.rows[0]?.stock ?? 0;
    if ((gramos as number) > stock) {
      return NextResponse.json(
        { error: `No puedes mermar más de lo que hay (disponible: ${stock} g)` },
        { status: 409 }
      );
    }
  }

  // AC-PES-03: test centinela "báscula mal tipeada" — outlier >3x mediana exige que
  // el cliente vuelva a mandar el pesaje con confirmarOutlier=true (ver UI).
  const outlier = await db.query<{ outlier: boolean }>(`select pan.es_outlier_pesaje($1,$2) as outlier`, [
    productoId,
    gramos,
  ]);
  const cuerpoConConfirmacion = cuerpo as { confirmarOutlier?: boolean };
  if (outlier.rows[0]?.outlier && !cuerpoConConfirmacion.confirmarOutlier) {
    return NextResponse.json(
      { error: "outlier", mensaje: "Ese peso es muy distinto a lo habitual. ¿Lo confirmas?" },
      { status: 409 }
    );
  }

  // La foto se sube apenas se toma, en paralelo a que el maestro termina de pesar —
  // así que cuando esta request llega, `pan.fotos` puede tener el JPEG desde ANTES de
  // que este pesaje exista. Si se ignora eso e insertar siempre en 'pendiente_subida',
  // el pesaje queda marcado como sin foto para siempre aunque el archivo ya esté.
  let fotoEstado: "pendiente_subida" | "subida" | null = fotoSha256 ? "pendiente_subida" : null;
  if (fotoSha256) {
    const fotoYaSubida = await db.query<{ ok: boolean }>(`select true as ok from pan.fotos where sha256 = $1`, [
      fotoSha256,
    ]);
    if (fotoYaSubida.rows[0]?.ok) fotoEstado = "subida";
  }

  try {
    const r = await db.query<{ id: string }>(
      `insert into pan.pesajes
         (client_uuid, producto_id, gramos, destino, motivo_merma, estado_merma,
          pedido_linea_id, foto_sha256, foto_estado, usuario_id, dispositivo_id, capturado_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       on conflict (client_uuid) do nothing
       returning id`,
      [
        clientUuid,
        productoId,
        gramos,
        destino,
        destino === "merma" ? motivoMerma : null,
        destino === "merma" ? "pendiente" : null,
        destino === "reparto" ? pedidoLineaId : null,
        fotoSha256 ?? null,
        // Mismo contrato que el POD: el hash viaja con el pesaje y el JPEG se sube
        // aparte; /api/fotos marca 'subida' cuando el binario llega y el hash cuadra.
        fotoEstado,
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
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo registrar el pesaje");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
