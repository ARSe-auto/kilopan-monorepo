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
export async function listarVehiculos(pool: Pool): Promise<Vehiculo[]> {
  const { rows } = await pool.query<Vehiculo>(
    `select ${COLUMNAS} from vehiculos order by activo desc, patente asc`,
  );
  return rows;
}
