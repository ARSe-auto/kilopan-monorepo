import type { Pool, PoolClient } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION, offsetChileMin } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// Chequeos pre/post y el ciclo del defecto [AC-FVEH-04] — §4.5, §5.2-F3/F5, §7.6, §6.
//
// ─── ESTE ENDPOINT TAMPOCO SABE DECIR QUE NO ────────────────────────────────────────
//
// Un chequeo es CAPTURA. La persona ya dio la vuelta al camión, ya vio la luz quemada y ya la
// marcó; un 422 no le devuelve esa vuelta. Por eso el único rebote posible es el de una llamada
// mal formada (sin inspectable, sin momento), y todo lo demás entra.
//
// Y ENTRAR NO ES LO MISMO QUE BLOQUEAR (§7.6). Un ítem fallado deja su defecto escrito y la
// apertura del turno sigue: el §5.2-F3 lo dice con esas palabras — «SOC bajo o ítem fallado
// JAMÁS bloquean la apertura». El `bloqueante` de verdad lo marca el OPERADOR después, con red.
// Si el formulario pudiera detener un camión, la persona aprendería a no marcar nada.
//
// ─── OK-POR-DEFECTO SE VE EN EL PAYLOAD ─────────────────────────────────────────────
//
// El cliente manda SOLO los ítems fallados. Un chequeo sin defectos es un cuerpo con la lista
// vacía, y eso es toda la información que hace falta: veinte «ok» por chequeo serían
// cuatrocientas filas por jornada que nadie lee.

export type ChequeoEntrante = {
  inspectableTipo: string;
  inspectableId: string;
  momento: string;
  turnoId: string | null;
  firmaId: string | null;
  nota: string | null;
  /** Solo lo MALO: OK-por-defecto (§5.2-F3). Lista vacía = todo bien. */
  fallados: string[];
  clientUuid: string | null;
  tsDispositivo: Date;
  tzOffsetMin: number | null;
};

export type ChequeoRegistrado = {
  id: string;
  momento: string;
  defectos: number;
  repetido: boolean;
  /** El veredicto del §4.5 DESPUÉS de este chequeo. `null` = nunca hubo uno firmado. */
  apto: boolean | null;
};

export type ResultadoChequeo =
  | { tipo: "ok"; chequeo: ChequeoRegistrado }
  | { tipo: "momento_invalido" }
  | { tipo: "inspectable_invalido" };

export const MOMENTOS = ["pre", "post"] as const;
export const INSPECTABLES = ["vehiculos", "instrument"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El veredicto de aptitud, leído de la base: la regla del §4.5 vive ahí y no acá. */
async function aptoDe(c: PoolClient, tipo: string, id: string): Promise<boolean | null> {
  if (tipo !== "vehiculos") return null;
  const { rows } = await c.query<{ apto: boolean | null }>("select vehiculo_apto($1) as apto", [id]);
  return rows[0]?.apto ?? null;
}

export async function registrarChequeo(
  pool: Pool,
  sesion: Sesion,
  entrante: ChequeoEntrante,
): Promise<ResultadoChequeo> {
  if (!(MOMENTOS as readonly string[]).includes(entrante.momento)) return { tipo: "momento_invalido" };
  if (!(INSPECTABLES as readonly string[]).includes(entrante.inspectableTipo)) {
    return { tipo: "inspectable_invalido" };
  }
  if (!UUID.test(entrante.inspectableId)) return { tipo: "inspectable_invalido" };

  return enActo(pool, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into chequeos
         (inspectable_tipo, inspectable_id, momento, turno_id, firma_id, nota,
          ts_dispositivo, tz_offset_min, client_uuid)
       values ($1, $2, $3::chequeo_momento, $4, $5, $6, $7, $8, $9)
         on conflict (tenant_id, client_uuid) do nothing
       returning id::text as id`,
      [
        entrante.inspectableTipo,
        entrante.inspectableId,
        entrante.momento,
        entrante.turnoId,
        entrante.firmaId,
        entrante.nota,
        entrante.tsDispositivo,
        entrante.tzOffsetMin ?? offsetChileMin(entrante.tsDispositivo),
        entrante.clientUuid,
      ],
    );

    if (!rows[0]) {
      // Replay del outbox (centinela 1): la fila ya estaba. Se devuelve LA MISMA, sin crear
      // defectos de nuevo ni escribir eventos — un segundo aviso haría creer que el camión
      // tuvo el mismo problema dos veces.
      const { rows: previo } = await c.query<{ id: string; n: string }>(
        `select c.id::text as id,
                (select count(*)::text from defectos d where d.chequeo_id = c.id) as n
           from chequeos c where c.client_uuid = $1`,
        [entrante.clientUuid],
      );
      return {
        tipo: "ok",
        chequeo: {
          id: previo[0]!.id,
          momento: entrante.momento,
          defectos: Number(previo[0]!.n),
          repetido: true,
          apto: await aptoDe(c, entrante.inspectableTipo, entrante.inspectableId),
        },
      };
    }

    const id = rows[0].id;
    await registrarEvento(c, {
      codigo: EVENTOS_OPERACION.chequeo_registrado,
      objetoTabla: "chequeos",
      objetoId: id,
      sesion,
      payload: { momento: entrante.momento, fallados: entrante.fallados.length },
    });

    // Los ítems fallados, uno por fila. Se deduplican: el aparato puede reintentar dentro del
    // mismo cuerpo y dos filas iguales harían aparecer dos defectos del mismo ítem.
    for (const item of [...new Set(entrante.fallados.map((f) => f.trim()).filter(Boolean))]) {
      const { rows: defecto } = await c.query<{ id: string }>(
        "insert into defectos (chequeo_id, item) values ($1, $2) returning id::text as id",
        [id, item],
      );
      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.chequeo_defecto,
        objetoTabla: "defectos",
        objetoId: defecto[0]!.id,
        sesion,
        payload: { item, chequeo_id: id },
      });
    }

    return {
      tipo: "ok",
      chequeo: {
        id,
        momento: entrante.momento,
        defectos: new Set(entrante.fallados.map((f) => f.trim()).filter(Boolean)).size,
        repetido: false,
        apto: await aptoDe(c, entrante.inspectableTipo, entrante.inspectableId),
      },
    };
  });
}

export type CambioDeDefecto =
  | { tipo: "ok"; estado: string; bloqueante: boolean }
  | { tipo: "no_existe" }
  | { tipo: "resolucion_sin_nota" }
  | { tipo: "estado_invalido" };

export const ESTADOS_DE_DEFECTO = ["abierto", "en_curso", "resuelto"] as const;

/**
 * El ciclo del §6: abierto → en curso → resuelto, más el `bloqueante` que marca el operador.
 *
 * Es PLANIFICACIÓN y rebota: lo hace alguien sentado con red, y resolver un defecto sin decir
 * cómo es un defecto que vuelve a aparecer sin que nadie sepa qué se probó la vez anterior.
 */
export async function cambiarDefecto(
  pool: Pool,
  sesion: Sesion,
  defectoId: string,
  cambios: { estado?: string; bloqueante?: boolean; nota?: string | null },
): Promise<CambioDeDefecto> {
  if (cambios.estado !== undefined && !(ESTADOS_DE_DEFECTO as readonly string[]).includes(cambios.estado)) {
    return { tipo: "estado_invalido" };
  }
  if (cambios.estado === "resuelto" && !cambios.nota?.trim()) return { tipo: "resolucion_sin_nota" };

  return enActo(pool, async (c) => {
    const { rows: existe } = await c.query("select 1 from defectos where id = $1", [defectoId]);
    if (existe.length === 0) return { tipo: "no_existe" };

    const { rows } = await c.query<{ estado: string; bloqueante: boolean }>(
      `update defectos
          set estado = coalesce($2::defecto_estado, estado),
              bloqueante = coalesce($3, bloqueante),
              nota = coalesce($4, nota),
              resuelto_en = case when $2 = 'resuelto' then now() else resuelto_en end
        where id = $1
        returning estado::text as estado, bloqueante`,
      [defectoId, cambios.estado ?? null, cambios.bloqueante ?? null, cambios.nota ?? null],
    );
    const fila = rows[0]!;

    // Un evento por lo que de verdad pasó. «Bloqueante» tiene el suyo porque es la decisión que
    // detiene un camión, y en la auditoría no puede verse igual que mover un estado.
    if (cambios.bloqueante === true) {
      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.defecto_bloqueante,
        objetoTabla: "defectos",
        objetoId: defectoId,
        sesion,
      });
    }
    if (cambios.estado === "en_curso" || cambios.estado === "resuelto") {
      await registrarEvento(c, {
        codigo:
          cambios.estado === "resuelto"
            ? EVENTOS_OPERACION.defecto_resuelto
            : EVENTOS_OPERACION.defecto_en_curso,
        objetoTabla: "defectos",
        objetoId: defectoId,
        sesion,
      });
    }
    return { tipo: "ok", estado: fila.estado, bloqueante: fila.bloqueante };
  });
}
