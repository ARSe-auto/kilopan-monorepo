-- 0034 — El reporte de energía, acotado a lo que hoy se puede afirmar. [AC-FVEH-13]
--
-- El §3.E1.12 y el Anexo A piden «ahorro vs diésel en CLP», y el AC lo acota él mismo: la
-- aserción NUMÉRICA del ahorro es incomputable sin el rendimiento diésel de referencia —cuántos
-- km por litro— que la **pregunta 3** deja abierta. Sin ese dato, comparar sería inventar el
-- número que el argumento de venta n°1 de la empresa va a usar delante de un cliente.
--
-- Lo que SÍ se puede afirmar hoy, y es lo que esta vista entrega: cuánta energía consumió la
-- flota y cuánto costó, en CLP ENTERO calculado por la BD. El día que el dueño responda, el
-- ahorro es una resta más en esta misma vista — con `precio_diesel_litro_clp`, que ya está en
-- `parametros`, y el rendimiento que falte.
--
-- POR QUÉ EL CÁLCULO VIVE ACÁ Y NO EN EL SERVIDOR (§4.8): los montos se calculan en la base
-- para que la RLS del §4.8 los pueda esconder. Un total sumado en la app sería un total que la
-- política de rol ya no puede filtrar — el chofer recibiría el número aunque no viera las filas.

create or replace view energia_semanal as
  select tenant_actual()                                                   as tenant_id,
         date_trunc('week', (e.record_time at time zone 'America/Santiago'))::date as semana,
         count(*)::bigint                                                  as sesiones,
         sum(e.wh)::bigint                                                 as wh,
         -- CLP entero, siempre (§0, §4.8). `sum` sobre bigint no necesita `round_clp`, pero el
         -- costo de cada fila ya pasó por él en el trigger de la 0027.
         sum(e.costo_clp)::bigint                                          as costo_clp,
         -- Cuántas sesiones quedaron SIN costo. Se cuenta y se muestra en vez de sumarlas como
         -- cero: un total que ignora en silencio las filas sin tarifa dice de menos, y quien lo
         -- lee no tiene forma de saberlo.
         count(*) filter (where e.costo_clp is null)::bigint               as sesiones_sin_costo
    from energy_entry e
   where e.type = 'charge'
   group by 2;

comment on view energia_semanal is
  'Energía y costo de la flota por semana, en CLP entero calculado por la BD (§4.8). El AHORRO '
  'vs diésel espera el rendimiento de referencia de la pregunta 3: sin él, comparar sería '
  'inventar el número que la empresa va a mostrarle a un cliente (Anexo A).';
