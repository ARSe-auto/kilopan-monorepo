#!/usr/bin/env node
// Job exportador de agregados técnicos a `control` (§4.1). [AC-FTEN-20]
//
// Es la ÚNICA vía por la que un dato sale de la BD de un tenant, y por eso el §4.1 la escribe
// con tanto cuidado: la vista cross-tenant de e-auto lee SOLO de `control`, y lo que llega a
// `control` es lo que este script decide llevar. Salud, adopción, EEVD agregada y backlog de
// sync. Cero dinero, cero tarifas, cero clientes (centinela 14, verificado en AC-FTEN-04).
//
// CÓMO SE HONRA LA PROHIBICIÓN DE CROSS-DATABASE. El §4.1/§7.2 prohíbe consultas
// cross-database en el runtime del PRODUCTO. Acá no hay ninguna: este job abre DOS conexiones
// separadas —una a la base del tenant, otra a `control`—, lee de la primera y escribe en la
// segunda. Ninguna consulta ve las dos bases a la vez, que es exactamente lo que un dblink o
// un FDW harían y lo que el maestro no quiere. Y no es runtime: es un job.
//
// Cadencia: `EXPORTADOR.cadencia_min` de la familia de constantes (§0), dictada por el dueño
// el 09-ago-2026. La ventana se ALINEA al reloj, así que dos corridas dentro del mismo tramo
// actualizan la misma fila en vez de crear dos.
import { pathToFileURL } from "node:url";
import { con, BD_CONTROL, bdDeTenant, slugDeBd } from "./conectar.mjs";
import { basesDeTenant } from "./provisionar.mjs";
import { EXPORTADOR } from "../../packages/nucleo-comun/src/constants.ts";

/** El tramo de reloj al que pertenece un instante. PURA: es la mitad que se puede probar sola. */
export function ventanaDe(instante, minutos = EXPORTADOR.cadencia_min) {
  const ms = minutos * 60_000;
  const inicio = new Date(Math.floor(instante.getTime() / ms) * ms);
  return { inicio, fin: new Date(inicio.getTime() + ms) };
}

/**
 * Los agregados de UNA base de tenant. Todo sale de `client_metric` y `eventos`, que son las
 * dos tablas que el §4.6 declara como fuente de los paneles del §10 — y de ninguna otra.
 *
 * Los campos sin fuente operativa al cierre del hito (a) quedan en NULL DECLARADO: un cero
 * diría «medido y da cero», que es una afirmación distinta y falsa.
 */
export async function agregadosDe(bd, { inicio, fin }) {
  return con(bd, async ({ sql }) => {
    const [salud] = await sql(
      `select
         (select count(*)::int from eventos where record_time > now() - interval '1 hour')
           as eventos_ultima_hora,
         (select count(*)::int from client_metric
           where tipo = 'sync_error' and record_time >= $1 and record_time < $2)
           as errores,
         (select count(*)::int from client_metric where record_time >= $1 and record_time < $2)
           as metricas`,
      [inicio, fin],
    );
    const [adopcion] = await sql(
      `select
         (select count(distinct dispositivo_id)::int from client_metric
           where dispositivo_id is not null and record_time >= $1 and record_time < $2)
           as dispositivos_activos,
         (select count(distinct actor_id)::int from eventos
           where actor_id is not null and record_time >= $1 and record_time < $2)
           as usuarios_activos,
         (select min(valor_int)::text from client_metric
           where tipo = 'pwa_version' and record_time >= $1 and record_time < $2)
           as pwa_version_min`,
      [inicio, fin],
    );

    return {
      eventos_ultima_hora: salud.eventos_ultima_hora,
      // Sin ninguna métrica en la ventana el porcentaje NO es cero: es que no se midió.
      errores_sync_pct: salud.metricas === 0 ? null : (salud.errores * 100) / salud.metricas,
      dispositivos_activos: adopcion.dispositivos_activos,
      usuarios_activos: adopcion.usuarios_activos,
      pwa_version_min: adopcion.pwa_version_min,
      // Pendientes hasta su hito, declarados en `EXPORTADOR.pendientes_hasta_su_hito`.
      eevd_semanal: null,
      backlog_sync_max_min: null,
    };
  });
}

/**
 * Empuja los agregados de todos los tenants REGISTRADOS en `control`.
 *
 * Se recorre el registro y no las bases del cluster: una base que existe pero no está
 * registrada no es un tenant —es un resto de algo—, y exportar sus datos sería inventarle un
 * dueño en el panel cross-tenant.
 */
export async function exportar({ ahora, minutos = EXPORTADOR.cadencia_min } = {}) {
  const ventana = ventanaDe(ahora ?? new Date(), minutos);
  const registrados = await con(BD_CONTROL, ({ sql }) =>
    sql("select id::text as id, slug, bd from tenants where estado = 'activo' order by slug"),
  );
  const vivas = new Set(await basesDeTenant());

  const empujados = [];
  const omitidos = [];
  for (const t of registrados) {
    if (!vivas.has(t.bd)) {
      omitidos.push(`${t.slug}: registrado en control pero su base ${t.bd} no existe`);
      continue;
    }
    const a = await agregadosDe(t.bd, ventana);
    await con(BD_CONTROL, ({ sql }) =>
      sql(
        `insert into agregados_tecnicos
           (tenant_id, ventana_inicio, ventana_fin, eventos_ultima_hora, errores_sync_pct,
            dispositivos_activos, usuarios_activos, pwa_version_min, eevd_semanal,
            backlog_sync_max_min)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (tenant_id, ventana_inicio) do update set
           ventana_fin          = excluded.ventana_fin,
           empujado_en          = now(),
           eventos_ultima_hora  = excluded.eventos_ultima_hora,
           errores_sync_pct     = excluded.errores_sync_pct,
           dispositivos_activos = excluded.dispositivos_activos,
           usuarios_activos     = excluded.usuarios_activos,
           pwa_version_min      = excluded.pwa_version_min,
           eevd_semanal         = excluded.eevd_semanal,
           backlog_sync_max_min = excluded.backlog_sync_max_min`,
        [
          t.id,
          ventana.inicio,
          ventana.fin,
          a.eventos_ultima_hora,
          a.errores_sync_pct,
          a.dispositivos_activos,
          a.usuarios_activos,
          a.pwa_version_min,
          a.eevd_semanal,
          a.backlog_sync_max_min,
        ],
      ),
    );
    empujados.push(t.slug);
  }

  return { ventana, empujados, omitidos };
}

// --- CLI -------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportar()
    .then(({ ventana, empujados, omitidos }) => {
      console.log(
        `exportar: ventana ${ventana.inicio.toISOString()} (+${EXPORTADOR.cadencia_min} min) · ` +
          `${empujados.length} tenant(s) empujado(s)`,
      );
      // Nunca en silencio: un tenant que no se exportó se nombra (§10, «no silent caps»).
      for (const o of omitidos) console.error(`GATE: ${o}`);
      process.exit(omitidos.length > 0 ? 1 : 0);
    })
    .catch((e) => {
      console.error(`exportar: ${e.message}`);
      process.exit(1);
    });
}
