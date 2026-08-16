-- 0053 — El undo que llega DESPUÉS del replay, y el métrico de gaming que lo excluye
-- [AC-FPOD-08] — §4.7 (undo 8 s, semántica cerrada), §10 (% PODs supersedidos), §2, §4.6.
--
-- ─── DOS FILAS, Y LA PRIMERA INTACTA ────────────────────────────────────────────────
--
-- El §4.7 cierra el undo en dos ramas y solo dos: dentro de la ventana la captura todavía no
-- salió del aparato y se cancela sin dejar rastro; si el replay YA ocurrió, el hecho está en el
-- orden autoritativo del tenant y borrarlo sería reescribir el pasado (§7.4 REVOKE UPDATE/DELETE).
-- La corrección es una fila NUEVA que supersede a la anterior con motivo `undo`: quedan dos
-- filas, y la original se puede seguir leyendo tal como el terreno la mandó.
--
-- ─── POR QUÉ EL MOTIVO ES UNA COLUMNA DEL MÉTRICO Y NO UNA NOTA ─────────────────────
--
-- El §10 mira «% PODs supersedidos» como señal de GAMING: un operador que corrige entregas a
-- mano después de que el chofer las cerró. El undo de 8 s es lo contrario — es el chofer
-- arreglando su propio dedo antes de caminar a la parada siguiente, y el §4.7 lo declara
-- EXCLUIDO por definición. Excluirlo en el código de cada panel sería tener la definición
-- repetida en tantos lugares como paneles: acá vive una sola vez, en SQL, y quien consulte el
-- métrico no puede olvidarse del filtro porque no lo escribe.
--
-- Cero DDL de tablas: el tipo de evento y la vista. La fila `entregas_pod` con su
-- `UNIQUE(encargo) WHERE cerrada AND supersede IS NULL` es AC-FPOD-11 — cuando exista, esta
-- vista suma su supersede por el mismo criterio de motivo, sin cambiar de definición.

insert into evento_tipo (codigo, descripcion) values
  ('entrega.pod_deshecha',
   'Una captura de POD ya replicada quedó supersedida por otra fila con su motivo; con motivo «undo» es el deshacer de 8 s del chofer y NO cuenta en el métrico de gaming del §10');

-- El métrico de gaming del §10, computado de `eventos` append-only (§2: jamás de contadores
-- mutables). `supersedidos` cuenta solo las correcciones que NO son el undo del chofer; el undo
-- se expone aparte para que se pueda mirar como lo que es —una señal de UX, no de fraude— sin
-- que nadie tenga que reconstruir el filtro.
create or replace view pods_supersedidos_semanal as
  with capturas as (
    select date_trunc('week', (e.event_time at time zone 'America/Santiago'))::date as semana,
           count(*)::bigint as pods
      from eventos e
      join evento_tipo tipo on tipo.id = e.tipo_id
     where tipo.codigo = 'entrega.pod_capturada'
     group by 1
  ),
  supersedes as (
    select date_trunc('week', (e.event_time at time zone 'America/Santiago'))::date as semana,
           count(*) filter (where e.payload ->> 'motivo' is distinct from 'undo')::bigint as supersedidos,
           count(*) filter (where e.payload ->> 'motivo' = 'undo')::bigint as deshechos_por_undo
      from eventos e
      join evento_tipo tipo on tipo.id = e.tipo_id
     where tipo.codigo = 'entrega.pod_deshecha'
     group by 1
  )
  select tenant_actual()                                as tenant_id,
         coalesce(c.semana, s.semana)                   as semana,
         coalesce(c.pods, 0)::bigint                    as pods,
         coalesce(s.supersedidos, 0)::bigint            as supersedidos,
         coalesce(s.deshechos_por_undo, 0)::bigint      as deshechos_por_undo,
         -- NULL y no cero cuando no hubo PODs: una semana sin operación no tiene un 0 % de
         -- supersedidos, no tiene el métrico (mismo criterio que `eevd_semanal`).
         round(
           coalesce(s.supersedidos, 0)::numeric / nullif(c.pods, 0)::numeric,
           4
         )                                              as pct_supersedidos
    from capturas c
    full outer join supersedes s on s.semana = c.semana;

-- Los privilegios de QUIEN CONSULTA, no del dueño (0035, AC-FVEH-13): la vista lee `eventos`,
-- que tiene RLS, y sin esto devolvería filas que el rol de app no puede ver por sí mismo.
alter view pods_supersedidos_semanal set (security_invoker = true);

comment on view pods_supersedidos_semanal is
  'El métrico de gaming del §10: % de PODs supersedidos por semana. El undo de 8 s (motivo '
  '«undo», §4.7) queda EXCLUIDO del numerador por definición SQL y se expone aparte en '
  '`deshechos_por_undo`. Computada de `eventos` append-only, jamás de contadores mutables.';
