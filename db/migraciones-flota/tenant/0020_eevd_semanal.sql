-- 0020 — `eevd_semanal`: la variable norte de la plataforma. [AC-FVEH-20]
--
-- **Entregas con Evidencia por Vehículo-Día** (§2). Nace acá porque este es el primer módulo
-- OPERATIVO: es el que tiene turnos, y el turno ES el vehículo-día. Esta migración es el
-- CREADOR ÚNICO de la vista en todo el conjunto de specs — el exportador del módulo 00, el
-- panel del 05 y el test de fixture del 08 la CONSUMEN y la declaran en sus dependencias
-- apuntando acá. Una segunda definición sería una segunda EEVD, y la métrica que gobierna el
-- producto dejaría de tener un solo valor.
--
-- ─── SE COMPUTA DE HECHOS APPEND-ONLY, JAMÁS DE CONTADORES ──────────────────────────
--
-- El §2 lo pide con esas palabras y el motivo es concreto: un contador mutable es un número
-- que alguien puede corregir a mano, y el día que la EEVD baje va a haber una razón muy buena
-- para corregirlo. Acá el denominador sale de `turnos` y el numerador de `eventos`, las dos
-- append-only (§4.6, §7.4): la única forma de mover la métrica es que ocurran hechos distintos.
--
-- ─── EL NUMERADOR TODAVÍA NO EXISTE, Y ESO SE NOTA SIN MENTIR ───────────────────────
--
-- Las entregas con evidencia son del módulo de POD (hitos d/e). No se pone un `0` literal: se
-- cuenta el evento `entrega.con_evidencia`, que hoy no está en el catálogo y por eso da cero
-- por sí solo. La diferencia importa — un cero literal habría que ir a borrarlo un día, y ese
-- día alguien se olvida; este cero se convierte en el número de verdad en cuanto el hito e
-- siembre su tipo de evento y lo emita, sin tocar una línea de esta vista.
--
-- ─── QUÉ ES UN VEHÍCULO-DÍA ─────────────────────────────────────────────────────────
--
-- Un par (vehículo, día de APERTURA del turno), contado una sola vez. El día es el de Chile:
-- la app está cableada a un solo país (§0), así que no hay huso por tenant que elegir, y usar
-- UTC pondría todo turno abierto después de las 20:00 en el día siguiente — media jornada de
-- reparto vespertino contada mañana.
--
-- Un turno que cruza medianoche cuenta en el día en que ABRIÓ: es la lectura literal de
-- «vehículos-día con turno abierto» del §2, y evita que una jornada larga sume dos.
--
-- ─── TURNO ANULADO ──────────────────────────────────────────────────────────────────
--
-- No suma. Es la interpretación de «turno abierto» que la spec 02 declara en su §1.5, y la
-- misma que sostiene el `WHERE estado <> 'anulado'` del EXCLUDE (§4.5): un turno anulado no
-- ocupó el día del vehículo, así que tampoco lo trabajó. Sigue siendo la **pregunta 7** al
-- dueño; si responde lo contrario, cambian juntos esta vista y su test.

create or replace view eevd_semanal as
  with vehiculos_dia as (
    select date_trunc('week', (t.abierto_en at time zone 'America/Santiago'))::date as semana,
           t.vehiculo_id,
           (t.abierto_en at time zone 'America/Santiago')::date as dia
      from turnos t
     where t.estado <> 'anulado'
     group by 1, 2, 3
  ),
  denominador as (
    select semana, count(*)::bigint as vehiculos_dia
      from vehiculos_dia
     group by semana
  ),
  numerador as (
    select date_trunc('week', (e.event_time at time zone 'America/Santiago'))::date as semana,
           count(*)::bigint as entregas_con_evidencia
      from eventos e
      join evento_tipo tipo on tipo.id = e.tipo_id
     where tipo.codigo = 'entrega.con_evidencia'
     group by 1
  )
  select tenant_actual()                              as tenant_id,
         coalesce(d.semana, n.semana)                 as semana,
         coalesce(n.entregas_con_evidencia, 0)::bigint as entregas_con_evidencia,
         coalesce(d.vehiculos_dia, 0)::bigint          as vehiculos_dia,
         -- NULL y no cero cuando no hubo vehículos-día: una semana sin operación no tiene una
         -- EEVD de 0, no tiene EEVD. Un cero ahí arrastraría hacia abajo cualquier promedio y
         -- haría ver como caída lo que fue un feriado.
         round(
           coalesce(n.entregas_con_evidencia, 0)::numeric
             / nullif(d.vehiculos_dia, 0)::numeric,
           2
         )                                            as eevd
    from denominador d
    full outer join numerador n on n.semana = d.semana;

comment on view eevd_semanal is
  'La variable norte del §2: entregas con evidencia por vehículo-día, por semana. Creador '
  'ÚNICO — los módulos 00 (exportador), 05 (panel) y 08 (fixture) la consumen sin re-crearla. '
  'Computada de `turnos` y `eventos`, append-only las dos: jamás de contadores mutables.';
