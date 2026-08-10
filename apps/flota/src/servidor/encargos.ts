import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// El alta de encargo de la bandeja [AC-FRUT-01] — §3.E1.5, §4.5, §4.2, §4.9.
//
// ─── TRES DATOS, Y EL ENCARGO YA ESTÁ ──────────────────────────────────────────────
//
// El §3.E1.5 pide el alta en menos de diez segundos con empresa, destino y bultos. Todo lo
// demás tiene default: `fecha_servicio` es hoy, `attrs` y `detalle_externo` nacen vacíos, y el
// estado sale de quién lo crea. Cada campo que alguien agregue como obligatorio se come esos
// diez segundos, y el operador vuelve a la planilla.
//
// ─── ES PLANIFICACIÓN: ACÁ SÍ SE REBOTA (§4.2) ────────────────────────────────────
//
// Al revés que todo lo que este servidor construyó en el módulo 02. Un encargo lo tipea alguien
// sentado con red antes de que exista el camión: rebotar no pierde ningún hecho del mundo, y
// dejar entrar 600 bultos o un `attrs` que no cumple su definición sí produce una ruta que no
// se puede cargar. Los dos rebotes van con 0 filas — uno por CHECK y el otro por trigger.
//
// El estado inicial depende del ROL, y es la única regla de la máquina que el maestro fija hoy:
// el `cliente` crea `solicitado` (§4.5) y el operador crea ya `aceptado`, porque la aceptación
// es suya (§3.E1.10). El resto de la máquina es AC-FRUT-03 y espera la pregunta 1 de la spec.

export type Encargo = {
  id: string;
  empresa_cliente_id: string;
  destino_id: string;
  bultos: number;
  fecha_servicio: string;
  estado: string;
};

export type AltaDeEncargo =
  | { tipo: "ok"; encargo: Encargo; repetido: boolean }
  | { tipo: "empresa_no_existe" }
  | { tipo: "destino_no_existe" }
  | { tipo: "bultos_fuera_de_rango" }
  | { tipo: "attrs_invalidos"; detalle: string };

/** Códigos de PostgreSQL que este alta traduce a un rebote tipado en vez de a un 500. */
const CHECK_VIOLATION = "23514";

const COLUMNAS = `id::text as id, empresa_cliente_id::text as empresa_cliente_id,
                  destino_id::text as destino_id, bultos,
                  to_char(fecha_servicio, 'YYYY-MM-DD') as fecha_servicio, estado::text as estado`;

export async function crearEncargo(
  pool: Pool,
  sesion: Sesion,
  datos: {
    empresaClienteId: string;
    destinoId: string;
    bultos: number;
    fechaServicio: string | null;
    attrs: Record<string, unknown>;
    clientUuid: string | null;
  },
): Promise<AltaDeEncargo> {
  // El rango se juzga antes de llegar a la base para poder devolver un error tipado con el
  // límite adentro; el CHECK de la tabla es la red que no se puede saltar (§4.2).
  if (!Number.isInteger(datos.bultos) || datos.bultos < 1 || datos.bultos > 500) {
    return { tipo: "bultos_fuera_de_rango" };
  }

  try {
    return await enActo(pool, async (c) => {
      const { rows: empresa } = await c.query("select 1 from empresas_cliente where id = $1", [
        datos.empresaClienteId,
      ]);
      if (empresa.length === 0) return { tipo: "empresa_no_existe" };
      const { rows: destino } = await c.query("select 1 from destinos where id = $1", [
        datos.destinoId,
      ]);
      if (destino.length === 0) return { tipo: "destino_no_existe" };

      // El §4.5 y el §3.E1.10: el encargo del contratante nace `solicitado` y es editable por
      // él solo hasta que el operador lo acepte. El que crea el operador ya pasó por eso.
      const estado = sesion.rol === "cliente" ? "solicitado" : "aceptado";

      const { rows } = await c.query<Encargo>(
        `insert into encargos
           (empresa_cliente_id, destino_id, bultos, fecha_servicio, attrs, estado, client_uuid)
         values ($1, $2, $3, coalesce($4::date, (now() at time zone 'America/Santiago')::date),
                 $5::jsonb, $6::encargo_estado, $7)
           on conflict (tenant_id, client_uuid) do nothing
         returning ${COLUMNAS}`,
        [
          datos.empresaClienteId,
          datos.destinoId,
          datos.bultos,
          datos.fechaServicio,
          JSON.stringify(datos.attrs),
          estado,
          datos.clientUuid,
        ],
      );

      if (!rows[0]) {
        // Ya estaba: la misma importación reintentada (centinela 1). Se devuelve la fila que
        // hay, sin evento nuevo — un segundo aviso haría creer que se pidió dos veces.
        const { rows: previo } = await c.query<Encargo>(
          `select ${COLUMNAS} from encargos where client_uuid = $1`,
          [datos.clientUuid],
        );
        return { tipo: "ok", encargo: previo[0]!, repetido: true };
      }

      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.encargo_creado,
        objetoTabla: "encargos",
        objetoId: rows[0].id,
        sesion,
        payload: { bultos: datos.bultos, estado },
      });
      return { tipo: "ok", encargo: rows[0], repetido: false };
    });
  } catch (error) {
    // El trigger de `attrs` del §4.9 rebota con `check_violation`, igual que el CHECK de
    // bultos. Se distinguen por el mensaje porque son dos causas que quien tipea arregla de
    // formas distintas: una es un número, la otra un campo del vertical.
    const e = error as { code?: string; message?: string };
    if (e.code === CHECK_VIOLATION) {
      if ((e.message ?? "").includes("bultos")) return { tipo: "bultos_fuera_de_rango" };
      return { tipo: "attrs_invalidos", detalle: e.message ?? "" };
    }
    throw error;
  }
}

/** La bandeja del día: lo que el operador tiene para armar rutas (§5.2-F1). */
export async function listarEncargos(pool: Pool, fecha: string | null): Promise<Encargo[]> {
  const { rows } = await pool.query<Encargo>(
    `select ${COLUMNAS} from encargos
      where fecha_servicio = coalesce($1::date, (now() at time zone 'America/Santiago')::date)
      order by creado_en desc`,
    [fecha],
  );
  return rows;
}
