import type { Pool } from "pg";
import { enLectura } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// Las cuatro lecturas del portal del contratante bajo `/cliente/*` [AC-FPOR-06] — spec 07 §2,
// §9.3 centinela 3.
//
// SOLO LECTURA, y SOLO estas cuatro formas fijas. Este módulo no agrega pantalla ni mutación —
// eso es AC-FPOR-07/08/10 — su único trabajo es dejar una superficie HTTP mínima y correcta bajo
// el namespace del portal para que la suite de aislamiento (`e2e/portal-aislamiento.spec.ts`)
// tenga algo real que ejercer, con el mismo candado que va a usar el resto del portal después.
//
// CADA función filtra `empresa_cliente_id = $2` A MANO, además de dejar declarado
// `app.current_role`/`app.current_empresa` (`enLectura`, gobierno.ts) para la RLS de la tabla
// base (`aplicar_rls_de_empresa`, 0040/0061/0063). El filtro explícito NO es la redundancia que
// el comentario de 0040 advierte que sobra «hasta la consulta número treinta y uno»: acá SÍ hace
// falta, porque el pool de este servidor conecta como `flota_admin` (`servidor/conexion.ts`), y
// `flota_admin` es superusuario con `rolbypassrls=true` — la política de fila no se evalúa NUNCA
// sobre esta conexión, sin importar qué declare `set_config`. Confirmado con
// `select rolbypassrls from pg_roles where rolname='flota_admin'` (verdadero). Hasta que un AC
// dedicado retire ese privilegio o abra una conexión con un rol restringido para este camino, el
// `where` de acá es la ÚNICA guardia real; la RLS queda como defensa en profundidad para el día
// que ese privilegio se corrija, no como la garantía que 0040 pensó que iba a ser.
//
// El schema de cada retorno es LITERAL — las columnas que se seleccionan son las que salen del
// tipo — a propósito: es lo que hace que "sin columnas de economía interna ni telemetría EV"
// sea una propiedad de la firma, no una promesa. Agregar una columna acá es una decisión visible
// en el diff, nunca un SELECT * que se cuela.

export type EncargoDelCliente = {
  id: string;
  empresa_cliente_id: string;
  destino_id: string;
  bultos: number;
  fecha_servicio: string;
  estado: string;
  reintento_de: string | null;
  creado_en: string;
};

/** El encargo, o `null` si no existe o no es de la empresa de la sesión (RLS de `encargos`,
 *  0040) — las dos causas se ven igual a propósito (§0, centinela 2). */
export async function encargoDelCliente(
  pool: Pool,
  sesion: Sesion,
  id: string,
): Promise<EncargoDelCliente | null> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<EncargoDelCliente>(
      `select id::text as id, empresa_cliente_id::text as empresa_cliente_id,
              destino_id::text as destino_id, bultos,
              to_char(fecha_servicio, 'YYYY-MM-DD') as fecha_servicio, estado::text as estado,
              reintento_de::text as reintento_de, creado_en::text as creado_en
         from encargos where id = $1 and empresa_cliente_id = $2`,
      [id, sesion.empresaClienteId],
    );
    return rows[0] ?? null;
  });
}

/** Las pantallas «Hoy» y «Encargos» del portal [AC-FPOR-07] — spec 07 §2.1, §2.2: TODOS los
 *  encargos de la empresa de la sesión, más recientes primero. Mismo filtro EXPLÍCITO que
 *  `encargoDelCliente` y por el mismo motivo (`flota_admin` hace bypass de RLS). */
export async function encargosDelCliente(pool: Pool, sesion: Sesion): Promise<EncargoDelCliente[]> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<EncargoDelCliente>(
      `select id::text as id, empresa_cliente_id::text as empresa_cliente_id,
              destino_id::text as destino_id, bultos,
              to_char(fecha_servicio, 'YYYY-MM-DD') as fecha_servicio, estado::text as estado,
              reintento_de::text as reintento_de, creado_en::text as creado_en
         from encargos where empresa_cliente_id = $1
        order by creado_en desc`,
      [sesion.empresaClienteId],
    );
    return rows;
  });
}

export type LineaDeLiquidacionCliente = {
  id: string;
  liquidacion_id: string;
  empresa_cliente_id: string;
  evidencia_tipo: string;
  evidencia_id: string;
  concepto: string;
  tarifa_id: string | null;
  cantidad: number;
  precio_base_clp: string;
  modificadores_clp: string;
  monto_clp: string;
  disputa_estado: string | null;
  disputa_motivo_id: string | null;
  disputa_nota: string | null;
  disputa_creado_en: string | null;
  creado_en: string;
};

const COLUMNAS_LINEA = `id::text as id, liquidacion_id::text as liquidacion_id,
  empresa_cliente_id::text as empresa_cliente_id, evidencia_tipo, evidencia_id::text as evidencia_id,
  concepto, tarifa_id::text as tarifa_id, cantidad, precio_base_clp::text as precio_base_clp,
  modificadores_clp::text as modificadores_clp, monto_clp::text as monto_clp,
  disputa_estado, disputa_motivo_id::text as disputa_motivo_id, disputa_nota,
  disputa_creado_en::text as disputa_creado_en, creado_en::text as creado_en`;

export type LiquidacionDelCliente = {
  id: string;
  empresa_cliente_id: string;
  periodo_inicio: string;
  periodo_fin: string;
  estado: string;
  creado_en: string;
  lineas: LineaDeLiquidacionCliente[];
};

/** La liquidación con sus líneas, vía `liquidacion_cliente`/`liquidacion_lineas_cliente` (0067)
 *  — la vía sancionada del §4.3, jamás `liquidaciones`/`liquidacion_lineas` en crudo. `null` si
 *  no existe o es de otra empresa. */
export async function liquidacionDelCliente(
  pool: Pool,
  sesion: Sesion,
  id: string,
): Promise<LiquidacionDelCliente | null> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<Omit<LiquidacionDelCliente, "lineas">>(
      `select id::text as id, empresa_cliente_id::text as empresa_cliente_id,
              to_char(periodo_inicio, 'YYYY-MM-DD') as periodo_inicio,
              to_char(periodo_fin, 'YYYY-MM-DD') as periodo_fin,
              estado::text as estado, creado_en::text as creado_en
         from liquidacion_cliente where id = $1 and empresa_cliente_id = $2`,
      [id, sesion.empresaClienteId],
    );
    const cabecera = rows[0];
    if (!cabecera) return null;

    const { rows: lineas } = await c.query<LineaDeLiquidacionCliente>(
      `select ${COLUMNAS_LINEA} from liquidacion_lineas_cliente
        where liquidacion_id = $1 and empresa_cliente_id = $2 order by creado_en`,
      [id, sesion.empresaClienteId],
    );
    return { ...cabecera, lineas };
  });
}

/** La pantalla «Liquidación» del portal [AC-FPOR-07] — spec 07 §2.4: SOLO las cabeceras (sin
 *  líneas — el drill-down línea→evidencia de esta lista es AC-FPOR-10, todavía abierto), de la
 *  empresa de la sesión, más recientes primero. */
export async function liquidacionesDelCliente(
  pool: Pool,
  sesion: Sesion,
): Promise<Omit<LiquidacionDelCliente, "lineas">[]> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<Omit<LiquidacionDelCliente, "lineas">>(
      `select id::text as id, empresa_cliente_id::text as empresa_cliente_id,
              to_char(periodo_inicio, 'YYYY-MM-DD') as periodo_inicio,
              to_char(periodo_fin, 'YYYY-MM-DD') as periodo_fin,
              estado::text as estado, creado_en::text as creado_en
         from liquidacion_cliente where empresa_cliente_id = $1
        order by creado_en desc`,
      [sesion.empresaClienteId],
    );
    return rows;
  });
}

/** Una línea sola, vía `liquidacion_lineas_cliente` — el recurso «líneas» del §9.3 centinela 3
 *  con su propio identificador, sin pasar por la cabecera. `null` si no existe o es ajena. */
export async function lineaDelCliente(
  pool: Pool,
  sesion: Sesion,
  id: string,
): Promise<LineaDeLiquidacionCliente | null> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<LineaDeLiquidacionCliente>(
      `select ${COLUMNAS_LINEA} from liquidacion_lineas_cliente where id = $1 and empresa_cliente_id = $2`,
      [id, sesion.empresaClienteId],
    );
    return rows[0] ?? null;
  });
}

export type EvidenciaDelCliente = { id: string; tipo: string; capturada_en: string };

/** Una evidencia (`evidence`, §4.6), confinada por `exists` contra `items` vía `paradas` —
 *  `evidence` no tiene columna `empresa_cliente_id` propia, así que el filtro va por el mismo
 *  camino que la RLS de `paradas` (0040) usa para decidir de quién es una parada compartida. */
export async function evidenciaDelCliente(
  pool: Pool,
  sesion: Sesion,
  id: string,
): Promise<EvidenciaDelCliente | null> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<EvidenciaDelCliente>(
      `select ev.id::text as id, ev.tipo::text as tipo, ev.capturada_en::text as capturada_en
         from evidence ev
         join paradas p on p.id = ev.objeto_id
        where ev.objeto_tabla = 'paradas' and ev.id = $1
          and exists (
            select 1 from items i where i.parada_id = p.id and i.empresa_cliente_id = $2
          )`,
      [id, sesion.empresaClienteId],
    );
    return rows[0] ?? null;
  });
}
