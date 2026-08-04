import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { aEnteroEnRango } from "@/comun/validacion.ts";

/** El turno abierto de este dispositivo, o null. P0-4: "esperado" ya no es "todo lo
 *  que vendió este equipo HOY" — es "todo lo que vendió este equipo DESDE QUE SE ABRIÓ
 *  ESTE TURNO", que es el sujeto correcto cuando dos personas usan la misma tablet el
 *  mismo día (ver 0018_turnos_cierre_caja.sql). No se toca pan.ventas: la ventana de
 *  tiempo + dispositivo alcanza sin necesitar turno_id por línea de venta. */
async function turnoAbierto(db: Awaited<ReturnType<typeof obtenerDb>>, dispositivoId: string) {
  const r = await db.query<{ id: string; abierto_at: string }>(
    `select id, abierto_at from pan.turnos where dispositivo_id = $1 and cerrado_at is null`,
    [dispositivoId]
  );
  return r.rows[0] ?? null;
}

// AC-VEN-01 + AC-PAG-01: el cierre de caja pasa de un par esperado/declarado a UNA
// FILA POR MEDIO DE PAGO activo — porque ahora la panadería cobra por 8 vías, no 2.
export async function GET(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "vendedor"]);
  if (sesion instanceof NextResponse) return sesion;

  const db = await obtenerDb();
  const turno = await turnoAbierto(db, sesion.dispositivoId);
  // Sin turno abierto no hay ventana que contar: cero para todos los medios, en vez de
  // inventar un "todo el día" que ya demostró llevar al mismo agujero de antes.
  const r = turno
    ? await db.query<{ medio_pago: string; etiqueta: string; esperado_clp: string }>(
        // AC-ADM-05: una venta anulada (anulada_at not null) deja de sumar al arqueo de su
        // turno — se excluye del esperado igual acá que en el POST del cierre.
        `select mp.clave as medio_pago, mp.etiqueta,
                coalesce(sum(v.total_clp), 0)::text as esperado_clp
           from pan.medios_pago mp
           left join pan.ventas v
                  on v.medio_pago = mp.clave
                 and v.dispositivo_id = $1
                 and v.creado_at >= $2
                 and v.anulada_at is null
          where mp.activo
          group by mp.clave, mp.etiqueta, mp.orden
          order by mp.orden`,
        [sesion.dispositivoId, turno.abierto_at]
      )
    : await db.query<{ medio_pago: string; etiqueta: string; esperado_clp: string }>(
        `select clave as medio_pago, etiqueta, '0' as esperado_clp
           from pan.medios_pago where activo order by orden`
      );
  // Conteo A CIEGAS para quien vende (hallazgo ALTA del red-team): el monto esperado
  // no se le OCULTA en pantalla, no se le MANDA. Ocultarlo solo en el render dejaba la
  // cifra en la respuesta de red, a un devtools de distancia — y el punto del cierre
  // es que quien cuenta no sepa el número al que tiene que llegar. El admin (el dueño)
  // sí lo recibe: es su plata y es el "modo abierto" para revisar.
  const aCiegas = sesion.rol !== "admin";
  const medios = aCiegas
    ? r.rows.map(({ medio_pago, etiqueta }) => ({ medio_pago, etiqueta }))
    : r.rows;
  return NextResponse.json({ medios, aCiegas, turnoAbierto: turno != null });
}

export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "vendedor"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: {
    declarados?: { medioPago: string; declaradoClp: number }[];
    totalFacturadorClp?: number | null;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const declarados = cuerpo.declarados ?? [];
  if (declarados.length === 0) {
    return NextResponse.json({ error: "Nada que cerrar" }, { status: 400 });
  }

  // aEnteroEnRango y no Number.isInteger a secas: lo segundo dejaba pasar montos por
  // sobre el techo de int4 (el INSERT reventaba con un 500 crudo "value out of range")
  // y, en el total del facturador, ni siquiera había validación — entraban negativos
  // que envenenaban la conciliación del día (red-team).
  const declaradosValidados: { medioPago: string; declaradoClp: number }[] = [];
  for (const d of declarados) {
    const monto = aEnteroEnRango(d.declaradoClp, 0);
    if (monto === null) {
      return NextResponse.json({ error: "Monto declarado inválido" }, { status: 400 });
    }
    if (typeof d.medioPago !== "string" || !d.medioPago) {
      return NextResponse.json({ error: "Medio de pago inválido" }, { status: 400 });
    }
    declaradosValidados.push({ medioPago: d.medioPago, declaradoClp: monto });
  }

  let totalFacturadorClp: number | null = null;
  if (cuerpo.totalFacturadorClp != null) {
    totalFacturadorClp = aEnteroEnRango(cuerpo.totalFacturadorClp, 0);
    if (totalFacturadorClp === null) {
      return NextResponse.json(
        { error: "Total del facturador inválido: escribe solo números" },
        { status: 400 }
      );
    }
  }

  const db = await obtenerDb();

  // El medio de pago tiene que existir y estar activo. Antes una clave inventada
  // llegaba a la FK y salía un 500 crudo con el nombre del constraint — /api/ventas
  // ya validaba esto, /api/cierre-caja se había quedado sin la misma guarda.
  const activos = await db.query<{ clave: string }>(`select clave from pan.medios_pago where activo`);
  const clavesActivas = new Set(activos.rows.map((m) => m.clave));
  for (const d of declaradosValidados) {
    if (!clavesActivas.has(d.medioPago)) {
      return NextResponse.json(
        { error: `Medio de pago no disponible: ${d.medioPago}` },
        { status: 400 }
      );
    }
  }

  try {
    // Todos los medios de pago entran juntos o ninguno: sin la transacción, un corte de
    // red a mitad de la lista dejaba el cierre a medias — 3 medios cerrados y el resto
    // pendiente, sin forma de saber si el cierre "pasó" o no.
    const resultado = await db.transaccion(async (tx) => {
      // P0-4: `for update` toma el turno DENTRO de la transacción — si dos cierres del
      // mismo turno llegan a la vez, el segundo espera al primero y luego encuentra
      // `cerrado_at` ya puesto (ver abajo), no una fila fantasma.
      const turnoRes = await tx.query<{ id: string; abierto_at: string; cerrado_at: string | null }>(
        `select id, abierto_at, cerrado_at from pan.turnos
          where dispositivo_id = $1 and cerrado_at is null
          for update`,
        [sesion.dispositivoId]
      );
      const turno = turnoRes.rows[0];
      if (!turno) {
        throw Object.assign(new Error("sin_turno"), {
          publico: "No hay un turno abierto en este equipo. Ábrelo antes de cerrar caja.",
          estado: 409,
        });
      }

      const filas: { medioPago: string; esperado: number; declarado: number; diferencia: number }[] = [];
      for (const d of declaradosValidados) {
        const esperado = await tx.query<{ esperado: string }>(
          // AC-ADM-05: la venta anulada no cuenta en lo esperado del cierre.
          `select coalesce(sum(total_clp), 0)::text as esperado from pan.ventas
            where medio_pago = $1 and dispositivo_id = $2 and creado_at >= $3
              and anulada_at is null`,
          [d.medioPago, sesion.dispositivoId, turno.abierto_at]
        );
        const esperadoClp = Number(esperado.rows[0]?.esperado ?? 0);

        await tx.query(
          `insert into pan.cierres_caja
             (dispositivo_id, vendedor_id, medio_pago, esperado_clp, declarado_clp, total_facturador_clp, turno_id)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            sesion.dispositivoId,
            sesion.usuarioId,
            d.medioPago,
            esperadoClp,
            d.declaradoClp,
            // AC-DASH-04 (decisión #3, fase 1): el total que marcó el facturador se teclea
            // UNA vez y se compara. La fase 2 lo reemplaza por subir el CSV del día; la
            // fase 3 (API) solo si el piloto de Indupan lo pide.
            totalFacturadorClp,
            turno.id,
          ]
        );
        filas.push({
          medioPago: d.medioPago,
          esperado: esperadoClp,
          declarado: d.declaradoClp,
          diferencia: d.declaradoClp - esperadoClp,
        });
      }

      // Cerrar caja CIERRA el turno: el próximo que venda en este equipo necesita abrir
      // uno nuevo. Todos los medios de pago se cierran juntos, así que un solo turno se
      // cierra una sola vez, no una vez por medio.
      await tx.query(`update pan.turnos set cerrado_at = now() where id = $1`, [turno.id]);

      return filas;
    });

    const totalEsperado = resultado.reduce((s, r) => s + r.esperado, 0);
    return NextResponse.json({
      resultado,
      totalEsperado,
      diferenciaFacturador:
        totalFacturadorClp != null ? totalFacturadorClp - totalEsperado : null,
    });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    const publico = err instanceof Error ? (err as Error & { publico?: string; estado?: number }) : null;
    if (publico?.publico) {
      return NextResponse.json({ error: publico.publico }, { status: publico.estado ?? 409 });
    }
    if (/cierres_caja_un_cierre_por_turno/i.test(mensaje)) {
      return NextResponse.json(
        { error: "Ya cerraste este turno para uno de estos medios de pago" },
        { status: 409 }
      );
    }
    console.error("POST /api/cierre-caja:", mensaje);
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo cerrar la caja");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
