import type { Pool, PoolClient } from "pg";
import { enActo, enLectura, registrarEvento, EVENTOS_OPERACION } from "./gobierno.ts";
import { entitlementVigente, FEATURES } from "./config.ts";
import type { Sesion } from "./sesion.ts";

// Armado de rutas: agrupación multi-empresa y derivación de requisitos [AC-FRUT-04]
// — §3.E1.5, §4.5, §4.6, §4.9, §5.2 F1.
//
// ─── DOS ENCARGOS AL MISMO DESTINO SON UNA PARADA, NO DOS ──────────────────────────
//
// El §3.E1.5 lo pide para el caso que es la razón de ser del piloto B: tres panaderías
// distintas mandan pan a la misma sucursal, y el camión tiene que parar UNA vez. Dos paradas
// serían dos veces la misma cuadra, dos firmas al mismo destinatario y una ecuación de cierre
// que hay que sumar a mano.
//
// Lo que NO se puede perder al agrupar es de quién es cada bulto: cuando la sucursal reciba, el
// sub-manifiesto del andén es POR EMPRESA (§5.2 F2) y la ecuación de cierre también (§3.E1.6).
// Por eso la agrupación ocurre en `paradas` y el desglose queda en `items`, uno por encargo,
// cada uno con su empresa. Agrupar sumando los bultos en un solo ítem habría sido más corto y
// habría borrado exactamente el dato que el módulo entero necesita.
//
// El invariante «una sola entrega por destino» NO lo sostiene este archivo: lo sostiene el
// índice único parcial de la 0037. Acá se busca la parada existente antes de crear otra porque
// es la conducta correcta; si algún día este código se equivocara, la BD lo rebota igual.
//
// ─── PUBLICAR ES EL MOMENTO ÚNICO DE DERIVACIÓN ────────────────────────────────────
//
// El §4.6 dice que los `stop_requirement` se derivan del cargo_type; la sección 1 de la spec
// fija ACÁ el momento, que el maestro no fijaba: al publicar el día, junto con los demás
// snapshots. Derivarlos al asignar significaría que un encargo agregado a las seis de la mañana
// cambia lo que el operario ya tenía en pantalla; derivarlos al llegar a la parada significaría
// que dos choferes de la misma ruta ven requisitos distintos según cuándo abrieron la app.
//
// La derivación es una COPIA, no una traducción: `cargo_type_requirement` tiene el mismo shape
// que `stop_requirement` a propósito (0037). Cero condicionales por vertical, que es lo que el
// §4.6 exige con todas las letras.
//
// Una parada agrupada puede tener varios tipos de carga, y entonces sus requisitos son la UNIÓN
// deduplicada por tipo de evidencia: pedir dos firmas porque dos empresas mandaron cosas
// distintas es pedirle al operario que firme dos veces lo mismo, y en el andén eso se resuelve
// firmando cualquier cosa. Si uno de los dos lo marca obligatorio, manda el obligatorio.

export type Ruta = {
  id: string;
  nombre: string | null;
  vehiculo_id: string | null;
  fecha_servicio: string;
  origen: string;
  version: number;
  publicada: boolean;
};

export type Parada = {
  id: string;
  tipo: string;
  orden: number;
  destino_id: string | null;
  destino: string | null;
};

export type ItemDeParada = {
  id: string;
  encargo_id: string;
  empresa_cliente_id: string;
  empresa: string;
  qty_planificada: number;
};

const COLUMNAS_DE_RUTA = `id::text as id, nombre, vehiculo_id::text as vehiculo_id,
   to_char(fecha_servicio, 'YYYY-MM-DD') as fecha_servicio, origen::text as origen, version,
   (publicada_en is not null) as publicada`;

export async function crearRuta(
  pool: Pool,
  sesion: Sesion,
  datos: { nombre: string | null; vehiculoId: string | null; fechaServicio: string | null; clientUuid: string | null },
): Promise<Ruta> {
  return enActo(pool, async (c) => {
    const { rows } = await c.query<Ruta>(
      `insert into rutas (nombre, vehiculo_id, fecha_servicio, client_uuid)
       values ($1, $2, coalesce($3::date, (now() at time zone 'America/Santiago')::date), $4)
         on conflict (tenant_id, client_uuid) do nothing
       returning ${COLUMNAS_DE_RUTA}`,
      [datos.nombre, datos.vehiculoId, datos.fechaServicio, datos.clientUuid],
    );
    if (!rows[0]) {
      const { rows: previa } = await c.query<Ruta>(
        `select ${COLUMNAS_DE_RUTA} from rutas where client_uuid = $1`,
        [datos.clientUuid],
      );
      return previa[0]!;
    }
    await registrarEvento(c, {
      codigo: EVENTOS_OPERACION.ruta_creada,
      objetoTabla: "rutas",
      objetoId: rows[0].id,
      sesion,
      payload: { vehiculo_id: datos.vehiculoId },
    });
    return rows[0];
  }, sesion);
}

export async function listarRutas(
  pool: Pool,
  sesion: Sesion,
  fecha: string | null,
): Promise<Ruta[]> {
  // Con política activa, el rol `cliente` recibe CERO: el §3.E1.10 dice que el contratante
  // jamás ve rutas completas. La lista no tiene una rama para él — la base no le da filas.
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<Ruta>(
      `select ${COLUMNAS_DE_RUTA} from rutas
        where fecha_servicio = coalesce($1::date, (now() at time zone 'America/Santiago')::date)
          and not es_maestra
        order by creada_en`,
      [fecha],
    );
    return rows;
  });
}

export type Asignacion =
  | { tipo: "ok"; paradas: number; items: number; repetidos: number }
  | { tipo: "ruta_no_existe" }
  | { tipo: "ruta_ya_publicada" }
  | { tipo: "encargo_no_existe"; encargoId: string };

/**
 * Asigna encargos a la ruta, agrupando por destino.
 *
 * `ventana` es OPCIONAL y se aplica a las paradas que esta asignación toca: es cómo el operador
 * dice «esto va entre las 6 y las 9». Opcional a propósito — el camino feliz del §5.3 son quince
 * clics para el día entero y comprometerse con un horario no es obligatorio; lo que sí es cierto
 * es que donde no hubo ventana, al publicar no se congela ninguna promesa (§4.5).
 */
export async function asignarEncargos(
  pool: Pool,
  sesion: Sesion,
  rutaId: string,
  encargoIds: string[],
  ventana?: { desde: string; hasta: string } | null,
): Promise<Asignacion> {
  return enActo(pool, async (c) => {
    const { rows: ruta } = await c.query<{ publicada: boolean }>(
      "select (publicada_en is not null) as publicada from rutas where id = $1",
      [rutaId],
    );
    if (!ruta[0]) return { tipo: "ruta_no_existe" };
    // Un día publicado es un día congelado (§5.2 F1): reabrirlo para meter un encargo más
    // dejaría al chofer con una pantalla que no coincide con lo que se le prometió al cliente.
    if (ruta[0].publicada) return { tipo: "ruta_ya_publicada" };

    let paradasCreadas = 0;
    let itemsCreados = 0;
    let repetidos = 0;

    for (const encargoId of encargoIds) {
      const { rows: encargo } = await c.query<{ destino_id: string; bultos: number }>(
        "select destino_id::text as destino_id, bultos from encargos where id = $1",
        [encargoId],
      );
      if (!encargo[0]) return { tipo: "encargo_no_existe", encargoId };

      const paradaId = await paradaDeEntrega(c, rutaId, encargo[0].destino_id, () => paradasCreadas++);

      if (ventana) {
        await c.query(
          "update paradas set ventana = tstzrange($2::timestamptz, $3::timestamptz) where id = $1",
          [paradaId, ventana.desde, ventana.hasta],
        );
      }

      // `empresa_cliente_id` va NULL a propósito: lo estampa el trigger desde el encargo
      // (0037), y el NOT NULL de la columna se evalúa después del BEFORE INSERT. Que este
      // código no PUEDA escribirlo distinto es el punto — no es que elija no hacerlo.
      const { rows: item } = await c.query<{ id: string }>(
        `insert into items (parada_id, encargo_id, qty_planificada)
         values ($1, $2, $3)
           on conflict (tenant_id, parada_id, encargo_id) do nothing
         returning id::text as id`,
        [paradaId, encargoId, encargo[0].bultos],
      );
      if (!item[0]) {
        // Ya estaba asignado a esta parada: asignar dos veces el mismo encargo es un clic
        // repetido, no un pedido de duplicar los bultos.
        repetidos++;
        continue;
      }
      itemsCreados++;
      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.encargo_asignado,
        objetoTabla: "encargos",
        objetoId: encargoId,
        sesion,
        payload: { ruta_id: rutaId, parada_id: paradaId },
      });
    }

    return { tipo: "ok", paradas: paradasCreadas, items: itemsCreados, repetidos };
  }, sesion);
}

/**
 * La parada de entrega de ese destino en esa ruta: la que ya está, o una nueva al final.
 *
 * Es el corazón de la agrupación (§3.E1.5). El `select` antes del `insert` es correcto acá
 * porque `enActo` corre todo en una sola transacción y el índice único parcial de la 0037 es la
 * red: si dos armados concurrentes intentaran crear la misma, el segundo rebota en la BD en vez
 * de producir la parada duplicada.
 */
async function paradaDeEntrega(
  c: PoolClient,
  rutaId: string,
  destinoId: string,
  alCrear: () => void,
): Promise<string> {
  const { rows: existente } = await c.query<{ id: string }>(
    "select id::text as id from paradas where ruta_id = $1 and destino_id = $2 and tipo = 'entrega'",
    [rutaId, destinoId],
  );
  if (existente[0]) return existente[0].id;

  const { rows: nueva } = await c.query<{ id: string }>(
    `insert into paradas (ruta_id, tipo, orden, destino_id)
     values ($1, 'entrega',
             coalesce((select max(orden) from paradas where ruta_id = $1), 0) + 1,
             $2)
     returning id::text as id`,
    [rutaId, destinoId],
  );
  alCrear();
  return nueva[0]!.id;
}

export async function verRuta(
  pool: Pool,
  sesion: Sesion,
  rutaId: string,
): Promise<{ ruta: Ruta; paradas: (Parada & { items: ItemDeParada[] })[] } | null> {
  return enLectura(pool, sesion, async (c) => {
  const { rows: ruta } = await c.query<Ruta>(
    `select ${COLUMNAS_DE_RUTA} from rutas where id = $1`,
    [rutaId],
  );
  if (!ruta[0]) return null;

  const { rows: paradas } = await c.query<Parada>(
    `select p.id::text as id, p.tipo::text as tipo, p.orden, p.destino_id::text as destino_id,
            d.nombre as destino
       from paradas p left join destinos d on d.id = p.destino_id
      where p.ruta_id = $1
      order by p.orden`,
    [rutaId],
  );
  const { rows: items } = await c.query<ItemDeParada & { parada_id: string }>(
    `select i.id::text as id, i.parada_id::text as parada_id, i.encargo_id::text as encargo_id,
            i.empresa_cliente_id::text as empresa_cliente_id, e.razon_social as empresa,
            i.qty_planificada
       from items i
       join paradas p on p.id = i.parada_id
       join empresas_cliente e on e.id = i.empresa_cliente_id
      where p.ruta_id = $1
      order by e.razon_social`,
    [rutaId],
  );

  return {
    ruta: ruta[0],
    paradas: paradas.map((p) => ({ ...p, items: items.filter((i) => i.parada_id === p.id) })),
  };
  });
}

// ─── Publicar el día: el momento en que la planificación se compromete [AC-FRUT-05] ───
//
// Hasta este clic todo era borrador. Desde acá, tres cosas dejan de moverse: la versión de la
// ruta, la promesa que se le hizo a cada cliente y los requisitos de evidencia de cada parada.
//
// ─── LOS TRES REBOTES, Y POR QUÉ VAN JUSTO ACÁ ────────────────────────────────────
//
// El §5.2 F1 los pide: solape de agenda, documento vencido con feature ON y certificación
// vencida con feature ON, todos 422 con 0 filas. Van al PUBLICAR y no al armar porque armar es
// pensar en voz alta —un borrador con un camión que hoy no puede circular es una idea, no un
// daño— y publicar es lo que pone al chofer en la calle a las cinco de la mañana.
//
// ─── QUÉ CUENTA COMO SOLAPE, Y QUÉ NO ────────────────────────────────────────────
//
// Solo lo que IMPIDE operar: un `mantencion` o un `descanso` encima del horario de la ruta, u
// otra ruta ya publicada para el mismo camión ese día. Un bloque `recarga` NO cuenta, y es la
// distinción que importa: el §5.2 F4 dice que un bloque de recarga es una parada más de la
// ruta, no un compromiso que compita con ella. Tratarlo como choque haría imposible publicar el
// día de cualquier camión que cargue de noche — que son todos.
//
// El horario que se compara sale de las ventanas comprometidas de las paradas. Si NINGUNA tiene
// ventana se toma el día entero de Chile: sin horarios no hay forma de saber que dos cosas caben
// en el mismo día, y la respuesta conservadora es la que no manda un camión a dos lados a la vez.
//
// La consulta va detrás de un `for update` sobre el vehículo. Sin ese cerrojo, dos operadores
// que publican a la vez encontrarían la agenda libre los dos y el camión saldría con dos días
// encima: es exactamente el caso que un `select` de verificación pierde.
//
// ─── LA PROMESA SE CONGELA DESDE LA VENTANA, Y DONDE NO HUBO VENTANA QUEDA VACÍA ──
//
// `promesa_original` es lo que se le dijo al cliente (§4.5). Se copia de `ventana` en este
// instante y no vuelve a moverse. Donde el operador no comprometió ventana, la promesa queda
// NULL: inventarle una —el día entero, la hora de publicación— sería fabricar un compromiso que
// nadie hizo, y después medir el cumplimiento contra él.

// ─── Rutas maestras: la plantilla y el día que nace de ella [AC-FRUT-06] — §3.E1.6, §4.5 ──
//
// ─── COPIA, Y ESTÁ DECLARADO ──────────────────────────────────────────────────────
//
// La **pregunta 2** de la spec 03 está abierta: si la ruta del día nace como COPIA o como
// referencia a la maestra con overrides. El maestro pide maestras editables y rutas del día
// versionadas (§3.E1.6, §4.5) sin cerrar el mecanismo, y el AC exige solo lo observable.
//
// Esta implementación copia, y la razón no es que sea más fácil: es la que hace cierto lo que el
// AC sí fija —«la maestra permanece intacta tras editar el día»— sin ninguna maquinaria. Con
// referencias más overrides, «intacta» pasa a depender de que cada edición del día se escriba en
// el lugar correcto, y el día que una se escriba en el otro, doce rutas futuras cambian a la vez
// y nadie lo nota hasta que un camión sale distinto. Si el dueño elige referencias, cambia esta
// función; lo observable que el AC pide sigue igual.
//
// Lo que se copia son las PARADAS con su tipo, su orden y su ventana. Los ítems NO: cuelgan de
// encargos de un día concreto y una plantilla no tiene encargos. La maestra dice por dónde se
// pasa; el día dice qué se lleva.

export type Instanciacion =
  | { tipo: "ok"; ruta: Ruta; paradas: number }
  | { tipo: "maestra_no_existe" }
  | { tipo: "no_es_maestra" };

export async function instanciarDesdeMaestra(
  pool: Pool,
  sesion: Sesion,
  maestraId: string,
  datos: { vehiculoId: string | null; fechaServicio: string | null },
): Promise<Instanciacion> {
  return enActo(pool, async (c) => {
    const { rows: maestra } = await c.query<{ nombre: string | null; es_maestra: boolean }>(
      "select nombre, es_maestra from rutas where id = $1",
      [maestraId],
    );
    if (!maestra[0]) return { tipo: "maestra_no_existe" };
    // Instanciar desde una ruta del día produciría una copia de un día concreto con cara de
    // plantilla, y el operador la editaría creyendo que no toca nada.
    if (!maestra[0].es_maestra) return { tipo: "no_es_maestra" };

    const { rows: nueva } = await c.query<Ruta>(
      `insert into rutas (nombre, vehiculo_id, fecha_servicio, origen, maestra_id)
       values ($1, $2, coalesce($3::date, (now() at time zone 'America/Santiago')::date),
               'maestra', $4)
       returning ${COLUMNAS_DE_RUTA}`,
      [maestra[0].nombre, datos.vehiculoId, datos.fechaServicio, maestraId],
    );

    // Las paradas se copian con su tipo, su orden y su ventana. Los ítems no: cuelgan de
    // encargos de un día concreto, y una plantilla no tiene encargos.
    const { rows: copiadas } = await c.query<{ id: string }>(
      `insert into paradas (ruta_id, tipo, orden, destino_id, ventana)
       select $1, tipo, orden, destino_id, ventana from paradas where ruta_id = $2
       returning id::text as id`,
      [nueva[0]!.id, maestraId],
    );

    await registrarEvento(c, {
      codigo: EVENTOS_OPERACION.ruta_creada,
      objetoTabla: "rutas",
      objetoId: nueva[0]!.id,
      sesion,
      payload: { origen: "maestra", maestra_id: maestraId, paradas: copiadas.length },
    });
    return { tipo: "ok", ruta: nueva[0]!, paradas: copiadas.length };
  }, sesion);
}

/** Las plantillas del tenant. Van aparte de `listarRutas`, que solo trae los días. */
export async function listarMaestras(pool: Pool, sesion: Sesion): Promise<Ruta[]> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<Ruta>(
      `select ${COLUMNAS_DE_RUTA} from rutas where es_maestra order by nombre`,
    );
    return rows;
  });
}

export type Reordenamiento = { tipo: "ok"; paradas: number } | { tipo: "ruta_no_existe" };

/**
 * Reordena las paradas de una ruta [AC-FRUT-06].
 *
 * La MISMA función sirve al drag & drop del escritorio y a los botones de subir/bajar del móvil.
 * Es el punto del AC: el §3.E1.6 pide arrastrar solo en escritorio, y si el móvil no tuviera
 * ninguna otra vía, «sin drag & drop» sería «sin poder reordenar» — que es pérdida de datos por
 * omisión. Dos gestos, un endpoint, un solo lugar donde el orden se escribe.
 *
 * Va en dos pasadas por lo mismo que `ordenarPorHora`: `(ruta_id, orden)` es único y no admite
 * diferir, así que los órdenes salen del rango en uso antes de tomar el definitivo.
 */
export async function reordenarParadas(
  pool: Pool,
  sesion: Sesion,
  rutaId: string,
  enOrden: string[],
): Promise<Reordenamiento> {
  return enActo(pool, async (c) => {
    const { rows: ruta } = await c.query("select 1 from rutas where id = $1", [rutaId]);
    if (ruta.length === 0) return { tipo: "ruta_no_existe" };

    await c.query("update paradas set orden = orden + 10000 where ruta_id = $1", [rutaId]);
    let n = 0;
    for (const [i, paradaId] of enOrden.entries()) {
      const { rowCount } = await c.query(
        "update paradas set orden = $3 where ruta_id = $1 and id = $2",
        [rutaId, paradaId, i + 1],
      );
      n += rowCount ?? 0;
    }
    // Las que el cliente no nombró conservan su orden relativo, detrás de las que sí: perder una
    // parada porque la lista que llegó venía incompleta sería exactamente la pérdida de datos
    // que el AC prohíbe.
    await c.query(
      `with resto as (
         select id, row_number() over (order by orden) as k
           from paradas where ruta_id = $1 and orden > 10000
       )
       update paradas set orden = $2 + resto.k from resto where paradas.id = resto.id`,
      [rutaId, enOrden.length],
    );
    return { tipo: "ok", paradas: n };
  }, sesion);
}

export type Publicacion =
  | { tipo: "ok"; paradas: number; requisitos: number; promesas: number }
  | { tipo: "ruta_no_existe" }
  | { tipo: "ruta_ya_publicada" }
  | { tipo: "ruta_vacia" }
  | { tipo: "ruta_sin_vehiculo" }
  | { tipo: "documento_vencido" }
  | { tipo: "certificacion_vencida" }
  | { tipo: "agenda_solapada" };

export async function publicarRuta(
  pool: Pool,
  sesion: Sesion,
  slug: string,
  rutaId: string,
): Promise<Publicacion> {
  return enActo(pool, async (c) => {
    const { rows: ruta } = await c.query<{ publicada: boolean; vehiculo_id: string | null }>(
      `select (publicada_en is not null) as publicada, vehiculo_id::text as vehiculo_id
         from rutas where id = $1`,
      [rutaId],
    );
    if (!ruta[0]) return { tipo: "ruta_no_existe" };
    if (ruta[0].publicada) return { tipo: "ruta_ya_publicada" };
    // Un día sin camión no lo hace nadie. Rebota antes que los demás porque los tres rebotes
    // que siguen son SOBRE el vehículo.
    if (!ruta[0].vehiculo_id) return { tipo: "ruta_sin_vehiculo" };
    const vehiculoId = ruta[0].vehiculo_id;

    const { rows: paradas } = await c.query<{ id: string }>(
      "select id::text as id from paradas where ruta_id = $1 order by orden",
      [rutaId],
    );
    // Publicar un día vacío manda al chofer a la calle sin nada que hacer, y es
    // PLANIFICACIÓN: acá se rebota (§4.2).
    if (paradas.length === 0) return { tipo: "ruta_vacia" };

    // Los dos rebotes por feature, con la misma regla que la agenda del módulo 02 (§4.9):
    // apagados no rebotan nada, y un entitlement AUSENTE no es «apagado» (`estadoDeFeature`).
    if (await entitlementVigente(c, slug, FEATURES.documentos_vencidos_bloquean)) {
      const { rows } = await c.query<{ vencido: boolean }>(
        "select tiene_documentos_vencidos($1) as vencido",
        [vehiculoId],
      );
      if (rows[0]!.vencido) return { tipo: "documento_vencido" };
    }
    if (await entitlementVigente(c, slug, FEATURES.certificaciones_vencidas_bloquean)) {
      const { rows } = await c.query<{ vencida: boolean }>(
        "select tiene_certificaciones_vencidas($1) as vencida",
        [vehiculoId],
      );
      if (rows[0]!.vencida) return { tipo: "certificacion_vencida" };
    }

    // El cerrojo va ANTES de mirar: sin él, dos publicaciones simultáneas del mismo camión
    // encuentran la agenda libre las dos.
    await c.query("select 1 from vehiculos where id = $1 for update", [vehiculoId]);

    const { rows: choque } = await c.query<{ motivo: string }>(
      `with horario as (
         select coalesce(min(lower(p.ventana)),
                         (r.fecha_servicio::timestamp at time zone 'America/Santiago')) as desde,
                coalesce(max(upper(p.ventana)),
                         (r.fecha_servicio::timestamp at time zone 'America/Santiago')
                           + interval '1 day') as hasta,
                r.fecha_servicio
           from rutas r join paradas p on p.ruta_id = r.id
          where r.id = $2
          group by r.fecha_servicio
       )
       -- Lo que impide operar. Los de recarga quedan fuera: son una parada más (§5.2 F4).
       select 'bloque' as motivo from bloques_agenda b, horario h
        where b.vehiculo_id = $1
          and b.tipo in ('mantencion', 'descanso')
          and b.periodo && tstzrange(h.desde, h.hasta)
       union all
       -- Y el día ya publicado del mismo camión: un chofer con dos rutas no sabe cuál hace.
       select 'ruta' from rutas otra, horario h
        where otra.vehiculo_id = $1 and otra.id <> $2
          and otra.publicada_en is not null
          and otra.fecha_servicio = h.fecha_servicio`,
      [vehiculoId, rutaId],
    );
    if (choque.length > 0) return { tipo: "agenda_solapada" };

    // El bloque de recarga se convierte en parada ACÁ, antes de derivar y de congelar: si se
    // materializara después, la parada nueva no tendría requisitos ni promesa (§5.2 F4).
    const recargas = await materializarRecargas(c, rutaId, vehiculoId);
    if (recargas > 0) await ordenarPorHora(c, rutaId);

    const { rows: todas } = await c.query<{ id: string }>(
      "select id::text as id from paradas where ruta_id = $1 order by orden",
      [rutaId],
    );

    let requisitos = 0;
    for (const parada of todas) requisitos += await derivarRequisitos(c, parada.id);

    // La promesa se congela desde la ventana comprometida, y solo donde la hubo.
    const { rowCount: promesas } = await c.query(
      "update paradas set promesa_original = ventana where ruta_id = $1 and ventana is not null",
      [rutaId],
    );

    await c.query(
      "update rutas set publicada_en = now(), version = version + 1 where id = $1",
      [rutaId],
    );
    await registrarEvento(c, {
      codigo: EVENTOS_OPERACION.ruta_publicada,
      objetoTabla: "rutas",
      objetoId: rutaId,
      sesion,
      payload: { paradas: todas.length, recargas, requisitos, promesas: promesas ?? 0 },
    });
    return { tipo: "ok", paradas: todas.length, requisitos, promesas: promesas ?? 0 };
  }, sesion);
}

/**
 * El bloque de recarga del día se convierte en una parada más [AC-FRUT-18] — §5.2 F4, §4.5.
 *
 * El §5.2 F4 lo dice sin rodeos: un bloque de recarga ES una parada. No una nota al margen ni un
 * recordatorio en otra pantalla — el chofer que a las once de la noche tiene que enchufar el
 * camión lo tiene que ver en la MISMA lista donde ve las entregas, o no lo ve.
 *
 * El módulo 02 PROVEE el bloque —lo agenda el operador, o lo sugiere el tablero—; la
 * materialización la ejecuta este módulo al publicar, que es cuando el día se congela. Antes no:
 * un bloque agendado a las seis de la mañana todavía se puede mover.
 *
 * Se toman los bloques que TOCAN el día de servicio, no los que caen enteros adentro: una
 * recarga de 22:00 a 06:00 empieza hoy y termina mañana, y es exactamente la forma que tiene una
 * recarga nocturna. Pedir que quepa en el día calendario la dejaría fuera siempre.
 */
async function materializarRecargas(c: PoolClient, rutaId: string, vehiculoId: string): Promise<number> {
  const { rows } = await c.query<{ id: string }>(
    `insert into paradas (ruta_id, tipo, orden, ventana, bloque_agenda_id)
     select $1, 'recarga',
            coalesce((select max(orden) from paradas where ruta_id = $1), 0)
              + row_number() over (order by b.empieza_en),
            b.periodo, b.id
       from bloques_agenda b, rutas r
      where r.id = $1 and b.vehiculo_id = $2 and b.tipo = 'recarga'
        and b.periodo && tstzrange(
              (r.fecha_servicio::timestamp at time zone 'America/Santiago'),
              (r.fecha_servicio::timestamp at time zone 'America/Santiago') + interval '1 day')
        -- Publicar es una vez sola, pero el día que deje de serlo esto no duplica la parada.
        and not exists (select 1 from paradas p where p.ruta_id = $1 and p.bloque_agenda_id = b.id)
     returning id::text as id`,
    [rutaId, vehiculoId],
  );
  return rows.length;
}

/**
 * Deja las paradas en el orden que les corresponde DENTRO DEL DÍA [AC-FRUT-18].
 *
 * La recarga no va al final por ser recarga: va donde cae su hora. Una de mediodía queda entre
 * las entregas de la mañana y las de la tarde, que es donde el chofer la va a hacer.
 *
 * A las paradas SIN ventana se les da una hora ficticia derivada de su posición, empezando a las
 * 00:00 del día. Así conservan su orden relativo entre ellas —el que el operador les dio— y
 * quedan antes que cualquier recarga nocturna, que es lo correcto: si se las ordenara por
 * `ventana` a secas, un NULL las mandaría al fondo y el camión cargaría después de repartir.
 *
 * El reordenamiento va en dos pasadas porque `(ruta_id, orden)` es único y no admite diferir:
 * primero todos los órdenes salen del rango en uso, después se asignan los definitivos. Hacerlo
 * en una sola sentencia choca contra la restricción a mitad de camino.
 */
async function ordenarPorHora(c: PoolClient, rutaId: string): Promise<void> {
  await c.query("update paradas set orden = orden + 10000 where ruta_id = $1", [rutaId]);
  await c.query(
    `with posicion as (
       select p.id, p.ventana, r.fecha_servicio,
              row_number() over (order by p.orden) as k
         from paradas p join rutas r on r.id = p.ruta_id
        where p.ruta_id = $1
     ),
     nuevo as (
       select id,
              row_number() over (
                order by coalesce(
                           lower(ventana),
                           (fecha_servicio::timestamp at time zone 'America/Santiago')
                             + (k * interval '1 minute')),
                         k) as n
         from posicion
     )
     update paradas set orden = nuevo.n from nuevo where paradas.id = nuevo.id`,
    [rutaId],
  );
}

/**
 * Copia a la parada los requisitos de evidencia de los tipos de carga que lleva.
 *
 * La UNIÓN deduplicada por tipo de evidencia, con el obligatorio ganando: dos empresas que
 * mandan cosas distintas al mismo destino no producen dos firmas del mismo destinatario. El
 * `orden` se renumera de corrido porque el de la plantilla es relativo a SU tipo de carga y
 * `stop_requirement` lo tiene único por parada.
 *
 * Es una copia y no una traducción — cero condicionales por vertical (§4.6).
 */
async function derivarRequisitos(c: PoolClient, paradaId: string): Promise<number> {
  const { rows } = await c.query<{ n: string }>(
    `with de_la_parada as (
       select r.tipo_evidencia,
              bool_or(r.obligatorio) as obligatorio,
              min(r.orden)           as orden
         from items i
         join encargos e on e.id = i.encargo_id
         join cargo_type_requirement r on r.cargo_type_id = e.cargo_type_id
        where i.parada_id = $1
        group by r.tipo_evidencia
     )
     insert into stop_requirement (parada_id, tipo_evidencia, obligatorio, orden)
     select $1, tipo_evidencia, obligatorio,
            row_number() over (order by orden, tipo_evidencia)
       from de_la_parada
     returning 1 as n`,
    [paradaId],
  );
  return rows.length;
}
