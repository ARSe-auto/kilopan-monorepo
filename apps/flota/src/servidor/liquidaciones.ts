import type { Pool } from "pg";
import { enLectura } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { entitlementVigente, FEATURES } from "./config.ts";

// Lectura de liquidaciones y su drill-down línea→evidencia [AC-FTAR-07] — spec 06 §9, §3.E1.9.
//
// SOLO LECTURA. El devengo (AC-FTAR-03), la máquina de estados (AC-FTAR-05) y la disputa
// (AC-FTAR-06) ya existen en la BD; este módulo no agrega ninguna mutación nueva, solo las
// dos consultas que la pantalla del operador/admin necesita: la liquidación con sus líneas, y
// la evidencia completa de UNA línea.
//
// ─── POR QUÉ SOLO `entrega_pod` TRAE DETALLE ─────────────────────────────────────────────
//
// El catálogo de `evidencia_tipo` tiene cuatro valores (§4.5), pero hoy solo `entrega_pod`
// tiene forma: `cierre_turno` está BLOQUEADO por la Pregunta 12 de la spec (sin atribución
// turno→empresa, AC-FTAR-14 no crea líneas de ese tipo) y `sesion_recarga` no tiene regla de
// devengo cerrada (Pregunta 2) — ninguno de los dos puede aparecer todavía en una liquidación
// real. `devolucion` sí devenga, pero su tabla es de otro módulo (AC-FRUT-21) y mostrarla acá
// sin que ningún AC lo pida sería inventar alcance. Los tres quedan con un detalle mínimo
// (tipo + id) en vez de un 500: la evidencia EXISTE, solo que este drill-down no la despliega.
//
// ─── POR QUÉ NO HAY FOTO PARA MOSTRAR ────────────────────────────────────────────────────
//
// `evidence.archivo_url` nunca se escribe (AC-FPOD-19: el servidor solo guarda el sha256 que
// re-hashea, la foto es mejora progresiva §7.6 y su transporte de binario no persiste el
// archivo en ningún storage todavía). El drill-down muestra lo que sí existe — que se capturó,
// de qué tipo, y cuándo — sin fingir una imagen que la base no tiene.

const ROLES_CON_ACCESO = new Set(["admin_tenant", "operador"]);

export function puedeVerLiquidaciones(rol: string): boolean {
  return ROLES_CON_ACCESO.has(rol);
}

// ─── La contracción por modo/entitlement de ESTE módulo [AC-FTAR-18] — §3 selector, §5.5, §0 ──
//
// El rol y el entitlement responden dos preguntas distintas y por eso conviven: `puedeVerLiquidaciones`
// dice si ESTA PERSONA puede mirar dinero (§8: el chofer jamás ve CLP), y esto dice si el TENANT
// compró el módulo. Un admin de un tenant `mi_flota` pasa el primero y tiene que rebotar en el
// segundo — si no, el módulo estaría «oculto» en la navegación y contestando por la API, que es
// la forma exacta en que una contracción se vuelve decorativa.
//
// ESTRICTO —«sin entrada en el snapshot» cuenta APAGADO— y no `moduloVigenteEncendido`. Es el
// mismo criterio que ya usan las otras dos puertas del grupo DaaS: `portalClienteEncendido`
// (`servidor/portal.ts`, AC-FPOR-04) y `modulosNavegables` (`dominio/manifest.ts`, AC-FPOR-03,
// `entitlements[clave] === true`). El default al revés es el de los MÓDULOS del §5.5, que nacen
// prendidos porque son el tamaño del producto tal como lo compraron; el grupo DaaS nace apagado
// porque es lo que un tenant `mi_flota` NO contrató — encenderlo por omisión le pondría las
// tarifas de sus clientes delante a una flota propia que nunca las tuvo.
//
// La feature es `liquidacion_por_cliente` y no `tarifas` porque es la del módulo al que estas dos
// puertas pertenecen. Para el caso del MODO da lo mismo —`modo_recorte` apaga las cuatro juntas
// en `mi_flota` (0003)— pero para un override por feature del hito (g) no: apagar «tarifas» no
// puede cerrar la liquidación que el contratante ya tiene devengada.
//
// Conexión suelta y no `enLectura`: `versionVigente` SELLA la primera `config_version` del tenant
// si todavía no hay ninguna, y esa escritura no cabe en una transacción `read only` (mismo motivo
// por el que `/api/manifiesto` usa `enActo`). `config_version` no lleva política de fila.
export async function moduloDeLiquidacionEncendido(pool: Pool, slug: string): Promise<boolean> {
  const cliente = await pool.connect();
  try {
    return await entitlementVigente(cliente, slug, FEATURES.liquidacion_por_cliente);
  } finally {
    cliente.release();
  }
}

export type LineaDeLiquidacion = {
  id: string;
  concepto: string;
  cantidad: number;
  monto_clp: string;
  evidencia_tipo: string;
  evidencia_id: string;
  bloqueada: boolean;
  disputa_estado: string | null;
  creado_en: string;
};

export type LiquidacionConLineas = {
  id: string;
  estado: string;
  periodo_inicio: string;
  periodo_fin: string;
  empresa_razon_social: string;
  empresa_rut: string;
  lineas: LineaDeLiquidacion[];
};

/** La liquidación con sus líneas, o `null` si el id no existe (o pertenece a otro tenant: cada
 *  tenant es su propia base, §4.1, así que un id de B sencillamente no está en esta consulta). */
export async function liquidacionConLineas(
  pool: Pool,
  sesion: Sesion,
  liquidacionId: string,
): Promise<LiquidacionConLineas | null> {
  return enLectura(pool, sesion, async (c) => {
    const { rows: cabecera } = await c.query<{
      id: string;
      estado: string;
      periodo_inicio: string;
      periodo_fin: string;
      empresa_razon_social: string;
      empresa_rut: string;
    }>(
      `select l.id::text as id, l.estado,
              to_char(l.periodo_inicio, 'YYYY-MM-DD') as periodo_inicio,
              to_char(l.periodo_fin, 'YYYY-MM-DD') as periodo_fin,
              e.razon_social as empresa_razon_social, e.rut as empresa_rut
         from liquidaciones l
         join empresas_cliente e on e.id = l.empresa_cliente_id
        where l.id = $1`,
      [liquidacionId],
    );
    const fila = cabecera[0];
    if (!fila) return null;

    const { rows: lineas } = await c.query<LineaDeLiquidacion>(
      `select id::text as id, concepto, cantidad, monto_clp::text as monto_clp,
              evidencia_tipo, evidencia_id::text as evidencia_id, bloqueada,
              disputa_estado, creado_en::text as creado_en
         from liquidacion_lineas
        where liquidacion_id = $1
        order by creado_en`,
      [liquidacionId],
    );

    return { ...fila, lineas };
  });
}

export type EvidenciaDePod = {
  tipo: "entrega_pod";
  resultado: string;
  metodo_entrega: string | null;
  motivo_etiqueta: string | null;
  event_time: string;
  capturas: { tipo: string; capturada_en: string }[];
};

export type EvidenciaDeLinea = {
  linea_id: string;
  evidencia_tipo: string;
  evidencia_id: string;
  detalle: EvidenciaDePod | null;
};

/** La evidencia completa de UNA línea — el drill-down de 1 clic del §3.E1.9. `null` si la
 *  línea no existe. Para `entrega_pod`, junta el hecho (resultado, motivo, cuándo) con las
 *  capturas de `evidence` que colgaron de SU parada (foto, firma — §4.6). */
export async function evidenciaDeLinea(
  pool: Pool,
  sesion: Sesion,
  lineaId: string,
): Promise<EvidenciaDeLinea | null> {
  return enLectura(pool, sesion, async (c) => {
    const { rows: lineaRows } = await c.query<{
      id: string;
      evidencia_tipo: string;
      evidencia_id: string;
    }>(
      `select id::text as id, evidencia_tipo, evidencia_id::text as evidencia_id
         from liquidacion_lineas where id = $1`,
      [lineaId],
    );
    const linea = lineaRows[0];
    if (!linea) return null;

    if (linea.evidencia_tipo !== "entrega_pod") {
      return { linea_id: linea.id, evidencia_tipo: linea.evidencia_tipo, evidencia_id: linea.evidencia_id, detalle: null };
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
      return { linea_id: linea.id, evidencia_tipo: "entrega_pod", evidencia_id: linea.evidencia_id, detalle: null };
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
