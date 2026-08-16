import type { Pool } from "pg";
import { enActo, enLectura } from "./gobierno.ts";
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

// ─── Disputa por línea y su drill-down [AC-FPOR-10] — spec 07 §2.4, spec 06 §6 ───────────────
//
// El motor entero ya vive en la BD desde AC-FTAR-06 (`disputar_linea()`, 0066): catálogo de
// motivos, ventana de 7 días medida desde el evento `liquidacion.cerrada`, idempotencia por
// `disputa_client_uuid`. Lo que faltaba era la superficie HTTP del portal — acá abajo.

export type MotivoDeDisputa = { id: string; codigo: string; etiqueta: string };

/** El catálogo de motivos de disputa, y SOLO ese: `motivos` es una tabla compartida por todo
 *  el tenant (no-entrega, disputa, y lo que venga), así que filtrar por
 *  `estado_asociado = 'liquidacion_linea_disputada'` es lo que evita que el portal del
 *  contratante le muestre a un cliente el catálogo de motivos de no-entrega del terreno. */
export async function motivosDeDisputa(pool: Pool, sesion: Sesion): Promise<MotivoDeDisputa[]> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<MotivoDeDisputa>(
      `select id::text as id, codigo, etiqueta from motivos
        where estado_asociado = 'liquidacion_linea_disputada' and activo
        order by orden`,
    );
    return rows;
  });
}

export type EvidenciaDePodCliente = {
  tipo: "entrega_pod";
  resultado: string;
  metodo_entrega: string | null;
  motivo_etiqueta: string | null;
  event_time: string;
  capturas: { tipo: string; capturada_en: string }[];
};

export type EvidenciaDeLineaCliente = {
  linea_id: string;
  evidencia_tipo: string;
  evidencia_id: string;
  detalle: EvidenciaDePodCliente | null;
};

/** El drill-down línea→evidencia del portal, mismo criterio que
 *  `servidor/liquidaciones.ts::evidenciaDeLinea` (AC-FTAR-07) pero confinado a la empresa de la
 *  sesión: PRIMERO se confirma que la línea es SUYA vía `liquidacion_lineas_cliente` —la RLS de
 *  la tabla base no se evalúa sobre este pool, cabecera del archivo— y solo entonces se lee el
 *  detalle de `entregas_pod`, que no tiene columna de empresa propia (la línea ya la confinó). */
export async function evidenciaDeLineaDelCliente(
  pool: Pool,
  sesion: Sesion,
  lineaId: string,
): Promise<EvidenciaDeLineaCliente | null> {
  return enLectura(pool, sesion, async (c) => {
    const { rows: lineaRows } = await c.query<{
      id: string;
      evidencia_tipo: string;
      evidencia_id: string;
    }>(
      `select id::text as id, evidencia_tipo, evidencia_id::text as evidencia_id
         from liquidacion_lineas_cliente where id = $1 and empresa_cliente_id = $2`,
      [lineaId, sesion.empresaClienteId],
    );
    const linea = lineaRows[0];
    if (!linea) return null;

    if (linea.evidencia_tipo !== "entrega_pod") {
      return {
        linea_id: linea.id,
        evidencia_tipo: linea.evidencia_tipo,
        evidencia_id: linea.evidencia_id,
        detalle: null,
      };
    }

    const { rows: podRows } = await c.query<{
      resultado: string;
      metodo_entrega: string | null;
      parada_id: string;
      event_time: string;
      motivo_etiqueta: string | null;
    }>(
      `select ep.resultado::text as resultado, ep.metodo_entrega,
              ep.parada_id::text as parada_id, ep.event_time::text as event_time,
              m.etiqueta as motivo_etiqueta
         from entregas_pod ep
         left join motivos m on m.id = ep.motivo_id
        where ep.id = $1`,
      [linea.evidencia_id],
    );
    const pod = podRows[0];
    if (!pod) {
      return {
        linea_id: linea.id,
        evidencia_tipo: "entrega_pod",
        evidencia_id: linea.evidencia_id,
        detalle: null,
      };
    }

    const { rows: capturas } = await c.query<{ tipo: string; capturada_en: string }>(
      `select tipo::text as tipo, capturada_en::text as capturada_en
         from evidence
        where objeto_tabla = 'paradas' and objeto_id = $1
        order by capturada_en`,
      [pod.parada_id],
    );

    return {
      linea_id: linea.id,
      evidencia_tipo: "entrega_pod",
      evidencia_id: linea.evidencia_id,
      detalle: {
        tipo: "entrega_pod",
        resultado: pod.resultado,
        metodo_entrega: pod.metodo_entrega,
        motivo_etiqueta: pod.motivo_etiqueta,
        event_time: pod.event_time,
        capturas,
      },
    };
  });
}

export type DisputaDeLinea =
  | { tipo: "ok"; lineaId: string; repetida: boolean }
  | { tipo: "no_existe" }
  | { tipo: "liquidacion_no_cerrada" }
  | { tipo: "fuera_de_ventana" }
  | { tipo: "motivo_invalido" }
  | { tipo: "ya_disputada" };

/** El código con que Postgres rebota los CHECK de `disputar_linea()` (§4.2: PLANIFICACIÓN
 *  rebota) — mismo criterio que `servidor/encargos.ts`. */
const CHECK_VIOLATION = "23514";

/**
 * Disputa una línea propia. `disputar_linea()` (0066, AC-FTAR-06) NO lleva `SECURITY DEFINER`
 * a propósito: corre con la RLS de quien invoca para que el confinamiento del rol `cliente` sea
 * una garantía de la BD. Pero ESTE pool conecta como `flota_admin` (`rolbypassrls=true`,
 * cabecera del archivo) — la RLS no se evalúa nunca sobre esta conexión, así que sin el `where`
 * explícito de acá cualquier `cliente` podría disputar la línea de cualquier empresa con solo
 * adivinar el id. El `select 1 ... where` ANTES de invocar la función es esa guardia real.
 */
export async function disputarLineaDelCliente(
  pool: Pool,
  sesion: Sesion,
  lineaId: string,
  datos: { motivoId: string; nota: string | null; clientUuid: string },
): Promise<DisputaDeLinea> {
  try {
    return await enActo(
      pool,
      async (c) => {
        const { rows: propia } = await c.query(
          `select 1 from liquidacion_lineas_cliente where id = $1 and empresa_cliente_id = $2`,
          [lineaId, sesion.empresaClienteId],
        );
        if (propia.length === 0) return { tipo: "no_existe" };

        const { rows } = await c.query<{ id: string; repetida: boolean }>(
          `select id::text as id, repetida from disputar_linea($1, $2, $3, $4, $5)`,
          [lineaId, datos.motivoId, datos.nota, sesion.usuarioId, datos.clientUuid],
        );
        const fila = rows[0];
        if (!fila) return { tipo: "no_existe" };
        return { tipo: "ok", lineaId: fila.id, repetida: fila.repetida };
      },
      sesion,
    );
  } catch (error) {
    // Los cuatro rebotes de `disputar_linea()` llegan como `check_violation` con un mensaje
    // reconocible (0066): se distinguen por texto porque cada uno lo arregla el cliente de una
    // forma distinta — no es lo mismo llegar tarde que elegir un motivo que no existe.
    const e = error as { code?: string; message?: string };
    if (e.code === CHECK_VIOLATION) {
      const msg = e.message ?? "";
      if (msg.includes("fuera de la ventana")) return { tipo: "fuera_de_ventana" };
      if (msg.includes("catálogo")) return { tipo: "motivo_invalido" };
      if (msg.includes("ya tiene una disputa")) return { tipo: "ya_disputada" };
      if (msg.includes("solo una liquidación cerrada")) return { tipo: "liquidacion_no_cerrada" };
    }
    throw error;
  }
}
