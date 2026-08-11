import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { esUuid } from "../../servidor/gobierno.ts";
import { poolDe } from "../../servidor/conexion.ts";
import { horaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";
import type {
  ItemDeParada,
  ParadaDeRuta,
  RequisitoDeEvidencia,
  TipoDeEvidencia,
} from "../../dominio/pod-terreno.ts";
import TarjetaDeEntrega from "./tarjeta-de-entrega.tsx";

// La envoltura de servidor de la tarjeta de entrega [AC-FRUT-22, AC-FPOD-01] — §0 (contrato
// HTTP), §5.2 F4, §7.2, §9.3.2 (centinela 2).
//
// Mismo patrón que `ruta/cerrar/page.tsx`: la parada viaja en la CONSULTA y no como segmento,
// porque el App Router serializa el árbol de segmentos —con el valor concreto del parámetro—
// dentro del HTML que sirve, incluso en el 404. La existencia (y que sea de tipo `entrega`) se
// resuelve ACÁ, antes de pintar nada; el candado en sí lo sirve `/api/paradas/[id]/entrega`.
//
// ─── LA SECUENCIA ENTERA VIAJA CON LA PRIMERA CARGA ──────────────────────────────
//
// F4 es un BUCLE LINEAL (§5.2): el «avance automático» de la segunda acción tiene que dejar la
// tarjeta siguiente a la vista sin costar un toque ni una navegación. Por eso las paradas de
// entrega de la ruta —con su destino, su ventana y sus bultos— salen de una sola consulta acá y
// no de un viaje por parada: en un subterráneo sin señal, un `fetch` entre parada y parada es
// una tarjeta que no aparece.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lo que devuelve la consulta, en la forma en que la BD lo entrega. */
type FilaDeParada = {
  id: string;
  orden: number;
  destino: string;
  desde: Date | null;
  hasta: Date | null;
  bultos: number;
};

/** Un ítem de una parada, para el stepper de la variante parcial [AC-FPOD-02]. */
type FilaDeItem = {
  parada_id: string;
  id: string;
  empresa: string;
  qty_planificada: number;
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const consulta = await searchParams;
  const pedida = Array.isArray(consulta.parada) ? consulta.parada[0] : consulta.parada;
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd || !pedida || !esUuid(pedida)) notFound();

  const pool = poolDe(bd);
  const { rows: deLaParada } = await pool.query<{ ruta_id: string }>(
    "select ruta_id::text as ruta_id from paradas where id = $1 and tipo = 'entrega'",
    [pedida],
  );
  if (!deLaParada[0]) notFound();

  const { rows } = await pool.query<FilaDeParada>(
    `select p.id::text        as id,
            p.orden           as orden,
            d.nombre          as destino,
            lower(p.ventana)  as desde,
            upper(p.ventana)  as hasta,
            coalesce(sum(i.qty_planificada), 0)::int as bultos
       from paradas p
       join destinos d on d.id = p.destino_id
       left join items i on i.parada_id = p.id
      where p.ruta_id = $1 and p.tipo = 'entrega'
      group by p.id, p.orden, d.nombre, p.ventana
      order by p.orden`,
    [deLaParada[0].ruta_id],
  );

  // El desglose por ítem [AC-FPOD-02]: el stepper de la variante parcial necesita saber DE QUÉ
  // empresa es cada bulto que ajusta (§3.E1.5, §4.5). Una consulta aparte y no un `json_agg` en
  // la de arriba: agrupar arrays dentro de un `group by` que YA agrupa por parada duplicaría la
  // fila de item por cada combinación, y acá no hay nada que agregar todavía.
  const { rows: itemFilas } = await pool.query<FilaDeItem>(
    `select i.parada_id::text as parada_id,
            i.id::text        as id,
            ec.razon_social   as empresa,
            i.qty_planificada as qty_planificada
       from items i
       join empresas_cliente ec on ec.id = i.empresa_cliente_id
       join paradas p on p.id = i.parada_id
      where p.ruta_id = $1 and p.tipo = 'entrega'
      order by i.parada_id, ec.razon_social`,
    [deLaParada[0].ruta_id],
  );
  const itemsPorParada = new Map<string, ItemDeParada[]>();
  for (const f of itemFilas) {
    const lista = itemsPorParada.get(f.parada_id) ?? [];
    lista.push({ id: f.id, empresa: f.empresa, qtyPlanificada: f.qty_planificada });
    itemsPorParada.set(f.parada_id, lista);
  }

  // La evidencia que cada parada exige [AC-FPOD-02]: filas de `stop_requirement`, derivadas del
  // cargo_type al publicar el día (§4.6, AC-FRUT-04). Viajan con la parada para que el flujo del
  // operario quede ARMADO POR DATOS: la pantalla no pregunta de qué vertical es el tenant, lee
  // lo que la parada trae. Lo normal en E1 es que no traiga ninguna.
  const { rows: requisitoFilas } = await pool.query<{
    parada_id: string;
    id: string;
    tipo: TipoDeEvidencia;
    obligatorio: boolean;
    orden: number;
  }>(
    `select sr.parada_id::text as parada_id,
            sr.id::text        as id,
            sr.tipo_evidencia  as tipo,
            sr.obligatorio     as obligatorio,
            sr.orden           as orden
       from stop_requirement sr
       join paradas p on p.id = sr.parada_id
      where p.ruta_id = $1 and p.tipo = 'entrega'
      order by sr.parada_id, sr.orden`,
    [deLaParada[0].ruta_id],
  );
  const requisitosPorParada = new Map<string, RequisitoDeEvidencia[]>();
  for (const f of requisitoFilas) {
    const lista = requisitosPorParada.get(f.parada_id) ?? [];
    lista.push({ id: f.id, tipo: f.tipo, obligatorio: f.obligatorio, orden: f.orden });
    requisitosPorParada.set(f.parada_id, lista);
  }

  // El motivo de la no-entrega, y el mismo catálogo para `motivo_item` de la variante parcial
  // (§4.5): es el único catálogo que el tenant siembra desde `vertical_template.motivos[]`
  // (AC-FRUT-13) — no hay uno separado por variante.
  const { rows: motivosFilas } = await pool.query<{ id: string; etiqueta: string }>(
    "select id::text as id, etiqueta from motivos where activo order by orden, codigo",
  );

  // `bultos_max_sin_receptor` (§4.4): fila única, y `null` si el tenant no lo sembró (Pregunta
  // al dueño 1 de la spec 04, sin responder) — `dejarEnPunto` lo trata como «sin umbral».
  const { rows: parametrosFilas } = await pool.query<{ bultos_max_sin_receptor: number | null }>(
    "select bultos_max_sin_receptor from parametros limit 1",
  );

  const secuencia: ParadaDeRuta[] = rows.map((f) => ({
    id: f.id,
    orden: f.orden,
    destino: f.destino,
    // La ventana se formatea acá, con el huso de Chile: mandarla cruda al cliente la dejaría a
    // merced del reloj del teléfono, que en terreno está tan seguido corrido como la red caída.
    ventana: f.desde && f.hasta ? `${horaEsCl(f.desde)} a ${horaEsCl(f.hasta)}` : null,
    bultos: f.bultos,
    items: itemsPorParada.get(f.id) ?? [],
    requisitos: requisitosPorParada.get(f.id) ?? [],
  }));

  return (
    <TarjetaDeEntrega
      secuencia={secuencia}
      indice={secuencia.findIndex((p) => p.id === pedida)}
      motivos={motivosFilas}
      bultosMaxSinReceptor={parametrosFilas[0]?.bultos_max_sin_receptor ?? null}
    />
  );
}
