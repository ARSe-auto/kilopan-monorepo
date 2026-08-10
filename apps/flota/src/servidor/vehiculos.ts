import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { juzgarPatente, juzgarTipo, type PatenteInvalida } from "../dominio/patentes.ts";

// El alta de vehículo del §5.4 [AC-FVEH-01] — §3.E1.3, §4.5, §4.2.
//
// ─── DOS CAMPOS, Y EL VEHÍCULO YA SIRVE ──────────────────────────────────────────────
//
// «Alta en <2 min: patente + tipo (chips) ⇒ vehículo operable de inmediato» (§5.4). Lo que eso
// exige del servidor es una cosa incómoda de sostener: NINGÚN otro campo puede ser obligatorio,
// ni ahora ni cuando lleguen los documentos, las capacidades y los datos EV. Cada vez que
// alguien agregue un requisito «para que los datos estén completos», el alta en dos minutos se
// muere en silencio. Por eso la tabla los tiene todos nullables y el linter de la spec lo
// verifica en el catálogo (pgtap/0010).
//
// ─── EL 422 DE PATENTE DUPLICADA SE JUEGA EN EL ÍNDICE, NO EN UN SELECT PREVIO ────────
//
// Un `select … where patente = $1` antes del insert es una carrera: dos altas simultáneas de
// la misma patente pasan las dos por el hueco. Acá el insert va con `on conflict do nothing` y
// el veredicto sale de si volvió fila o no — o sea, del UNIQUE de la base, que es el único que
// no se puede perder. Y como el evento se escribe DESPUÉS y en la misma transacción, un alta
// que no ocurrió tampoco deja rastro de haber ocurrido.
//
// «0 filas» del AC se cumple por construcción: el `do nothing` no inserta, y sin fila no hay
// evento ni fila de `audit_trail`.
//
// ─── QUIÉN PUEDE ─────────────────────────────────────────────────────────────────────
//
// La ruta vive bajo `/api/gobierno/**` a propósito (centinela 15, §9.3): la guardia del panel
// del dueño es la misma que ya rebota 403 con rol `operador` y 404 sin sesión, y el barrido
// autogenerado de AC-FIDN-12 la recoge sola. La LECTURA es otra puerta —`/api/vehiculos`—
// porque el §5.4 dice «el operador solo lee y asigna a rutas»: esconderle el listado le
// impediría hacer justo lo que sí puede.

export type Vehiculo = {
  id: string;
  patente: string;
  tipo: string;
  activo: boolean;
  capacidad_bultos: number | null;
  capacidad_kg: number | null;
  bateria_wh: number | null;
  autonomia_nominal_km: number | null;
  wh_por_km_base: number | null;
  soh_pct: number | null;
  odometro: number | null;
  soc: number | null;
};

/** Lo que la LISTA agrega a la ficha: cuántos documentos vencidos tiene el vehículo hoy. Va en
 *  el listado y no en cada alta porque la pantalla lo necesita para todos a la vez — con veinte
 *  camiones, preguntarlo uno por uno son veinte requests desde un teléfono [AC-FVEH-03]. */
export type VehiculoEnLista = Vehiculo & { documentos_vencidos: number };

export type AltaDeVehiculo =
  | { tipo: "ok"; vehiculo: Vehiculo }
  | { tipo: "patente_invalida"; motivo: PatenteInvalida }
  | { tipo: "tipo_invalido" }
  | { tipo: "patente_duplicada"; patente: string };

const COLUMNAS = `id::text as id, patente, tipo, activo,
                  capacidad_bultos, capacidad_kg, bateria_wh, autonomia_nominal_km,
                  wh_por_km_base, soh_pct, odometro, soc`;

export async function crearVehiculo(
  pool: Pool,
  sesion: Sesion,
  datos: { patente: unknown; tipo: unknown },
): Promise<AltaDeVehiculo> {
  const patente = juzgarPatente(String(datos.patente ?? ""));
  if (patente.tipo === "invalida") return { tipo: "patente_invalida", motivo: patente.motivo };
  const tipoVehiculo = juzgarTipo(String(datos.tipo ?? ""));
  if (tipoVehiculo.tipo === "invalida") return { tipo: "tipo_invalido" };

  return enActo(pool, async (c) => {
    const { rows } = await c.query<Vehiculo>(
      `insert into vehiculos (patente, tipo) values ($1, $2)
         on conflict (tenant_id, patente) do nothing
       returning ${COLUMNAS}`,
      [patente.patente, tipoVehiculo.valor],
    );
    const vehiculo = rows[0];
    if (!vehiculo) return { tipo: "patente_duplicada", patente: patente.patente };

    await registrarEvento(c, {
      codigo: EVENTOS.vehiculo_creado,
      objetoTabla: "vehiculos",
      objetoId: vehiculo.id,
      sesion,
      // La patente NO es dato personal (§7.8 vigila RUT, PIN y secretos), y sin ella el
      // evento diría «se creó un vehículo» sin decir cuál — una auditoría que no se puede leer.
      payload: { patente: vehiculo.patente, tipo: vehiculo.tipo },
    });
    return { tipo: "ok", vehiculo };
  });
}

/**
 * El listado que ve el dueño y el que usa el operador para asignar (§5.4).
 *
 * Los activos primero: un vehículo desactivado sigue existiendo —tiene hechos asociados y
 * jamás se borra (§7.4)— pero no es lo que alguien busca cuando abre la pantalla.
 */
export async function listarVehiculos(pool: Pool): Promise<VehiculoEnLista[]> {
  const { rows } = await pool.query<VehiculoEnLista>(
    `select ${COLUMNAS},
            (select count(*)::int from vehiculo_documentos d
              where d.vehiculo_id = vehiculos.id
                and d.vence_el < (now() at time zone 'America/Santiago')::date) as documentos_vencidos
       from vehiculos order by activo desc, patente asc`,
  );
  return rows;
}

// ─── Edición y desactivación: los otros dos actos del dueño [AC-FVEH-02] ──────────────
//
// QUÉ SE PUEDE EDITAR, Y QUÉ NO. El §5.4 dice «edita capacidades/documentos»: acá van las
// capacidades y los datos EV —lo progresivo del alta— más el tipo y el estado. Fuera quedan
// dos cosas, y las dos por una razón que no es de estilo:
//
//   · `patente` es la IDENTIDAD operativa del vehículo. Cambiarla no es editar una ficha: es
//     decir que este es otro camión, con toda la historia del anterior colgando. El maestro no
//     pide ese acto y esta puerta no lo inventa.
//   · `odometro` y `soc` son proyecciones de `reading` (§4.5). El trigger de la base ya rebota
//     su escritura, pero un rebote de restricción sale como error del servidor; que la lista
//     de campos editables no las incluya convierte el intento en un 422 tipado, que es lo que
//     el §4.2 pide de una mutación de planificación.

/** Los campos que el dueño puede mover. La lista es CERRADA: lo que no está, no se edita. */
const EDITABLES = [
  "tipo",
  "capacidad_bultos",
  "capacidad_kg",
  "bateria_wh",
  "autonomia_nominal_km",
  "wh_por_km_base",
  "soh_pct",
  "activo",
] as const;

const NUMERICOS = new Set<string>([
  "capacidad_bultos",
  "capacidad_kg",
  "bateria_wh",
  "autonomia_nominal_km",
  "wh_por_km_base",
  "soh_pct",
]);

export type EdicionDeVehiculo =
  | { tipo: "ok"; vehiculo: Vehiculo; reactivado: boolean }
  | { tipo: "no_existe" }
  | { tipo: "sin_cambios" }
  | { tipo: "campo_no_editable"; campo: string }
  | { tipo: "valor_invalido"; campo: string };

export async function editarVehiculo(
  pool: Pool,
  sesion: Sesion,
  vehiculoId: string,
  cambios: Record<string, unknown>,
): Promise<EdicionDeVehiculo> {
  const columnas: string[] = [];
  const valores: unknown[] = [];

  for (const [campo, valor] of Object.entries(cambios)) {
    if (!(EDITABLES as readonly string[]).includes(campo)) {
      return { tipo: "campo_no_editable", campo };
    }
    if (campo === "tipo") {
      const juicio = juzgarTipo(String(valor ?? ""));
      if (juicio.tipo === "invalida") return { tipo: "valor_invalido", campo };
      valores.push(juicio.valor);
    } else if (campo === "activo") {
      if (typeof valor !== "boolean") return { tipo: "valor_invalido", campo };
      valores.push(valor);
    } else if (NUMERICOS.has(campo)) {
      // `null` es un valor legítimo: es «todavía no lo sabemos», que es el estado con el que
      // nace toda columna progresiva y al que se puede volver si alguien cargó un número mal.
      if (valor !== null && !Number.isInteger(valor)) return { tipo: "valor_invalido", campo };
      valores.push(valor);
    }
    columnas.push(`${campo} = $${valores.length}`);
  }
  if (columnas.length === 0) return { tipo: "sin_cambios" };

  return enActo(pool, async (c) => {
    const { rows: antes } = await c.query<{ activo: boolean }>(
      "select activo from vehiculos where id = $1",
      [vehiculoId],
    );
    if (antes.length === 0) return { tipo: "no_existe" };

    const { rows } = await c.query<Vehiculo>(
      `update vehiculos set ${columnas.join(", ")} where id = $${valores.length + 1}
       returning ${COLUMNAS}`,
      [...valores, vehiculoId],
    );
    const vehiculo = rows[0]!;
    // Volver a poner en operación un vehículo que estaba fuera deja su PROPIO rastro: en la
    // auditoría no es lo mismo que corregir una capacidad.
    const reactivado = !antes[0]!.activo && vehiculo.activo;
    await registrarEvento(c, {
      codigo: reactivado ? EVENTOS.vehiculo_reactivado : EVENTOS.vehiculo_editado,
      objetoTabla: "vehiculos",
      objetoId: vehiculo.id,
      sesion,
      payload: { patente: vehiculo.patente, campos: Object.keys(cambios) },
    });
    return { tipo: "ok", vehiculo, reactivado };
  });
}

export type Desactivacion =
  | { tipo: "ok"; vehiculo: Vehiculo }
  | { tipo: "no_existe" }
  | { tipo: "ya_estaba" };

/**
 * El DELETE de HTTP, materializado como desactivación (§5.4, §7.4).
 *
 * La fila NO se toca más allá de `activo`: sus lecturas, sus chequeos y sus turnos siguen
 * enteros, porque son la historia con la que la EEVD se computa hacia atrás (§2). Un borrado
 * físico acá no sería «limpiar»: sería perder el denominador de las semanas ya cerradas.
 */
export async function desactivarVehiculo(
  pool: Pool,
  sesion: Sesion,
  vehiculoId: string,
): Promise<Desactivacion> {
  return enActo(pool, async (c) => {
    const { rows: existe } = await c.query("select 1 from vehiculos where id = $1", [vehiculoId]);
    if (existe.length === 0) return { tipo: "no_existe" };

    const { rows } = await c.query<Vehiculo>(
      `update vehiculos set activo = false where id = $1 and activo returning ${COLUMNAS}`,
      [vehiculoId],
    );
    const vehiculo = rows[0];
    // Idempotente y sin evento de más: desactivar dos veces no es un acto nuevo, y una
    // auditoría con dos filas iguales le hace creer a quien la lee que pasó dos veces.
    if (!vehiculo) return { tipo: "ya_estaba" };

    await registrarEvento(c, {
      codigo: EVENTOS.vehiculo_desactivado,
      objetoTabla: "vehiculos",
      objetoId: vehiculo.id,
      sesion,
      payload: { patente: vehiculo.patente },
    });
    return { tipo: "ok", vehiculo };
  });
}
