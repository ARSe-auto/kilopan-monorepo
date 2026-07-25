-- Hito 7 — Conciliación diaria y TCK (la variable norte). Fuente: PROMPT_MAESTRO.md §2.
-- La métrica se calcula SIEMPRE desde eventos, JAMÁS desde snapshots: es la regla que
-- hace que el número sea auditable y que nadie pueda "arreglar" la TCK a mano.
-- AC-DASH-01, AC-DASH-02, AC-DASH-03, AC-MERM-01 (cierre), AC-PERF-01.

-- Parámetros editables por admin, con su fuente declarada (§4 del prompt maestro).
create table pan.parametros (
  clave text primary key,
  valor integer not null,
  descripcion text not null
);

insert into pan.parametros (clave, valor, descripcion) values
  ('clp_km_combustible', 140, 'CLP por km en furgón a combustión (panel GTM, jul-2026)'),
  ('clp_km_ev', 35, 'CLP por km en van eléctrica (panel GTM, jul-2026)'),
  ('co2_g_km_evitado', 150, 'gramos de CO2 evitados por km al cambiar a eléctrico'),
  ('rutas_minimas_tarjeta_flota', 20, 'rutas cerradas antes de mostrar la tarjeta Tu flota'),
  ('pesaje_foto_obligatoria', 0, 'AC-PES-04 (decisión #1): 1 = exigir foto en cada pesaje');

-- Leads: e-auto (van propia) y KiloRuta (que otro reparta). Simétricos a propósito —
-- AC-DASH-03: medir demanda de KiloRuta sin depender del contrato técnico del Anexo B.
create table pan.lead_eauto (
  id uuid primary key default gen_random_uuid(),
  km_mes integer not null,
  ahorro_estimado_clp integer not null,
  contacto text not null,
  consentimiento boolean not null,
  creado_at timestamptz not null default now(),
  constraint lead_eauto_exige_consentimiento check (consentimiento)
);

create table pan.lead_kiloruta (
  id uuid primary key default gen_random_uuid(),
  km_mes integer not null,
  paradas_mes integer not null,
  contacto text not null,
  consentimiento boolean not null,
  creado_at timestamptz not null default now(),
  constraint lead_kiloruta_exige_consentimiento check (consentimiento)
);

-- ---------------------------------------------------------------------------
-- TCK — Tasa de Conciliación de Kilos.
-- (venta + entregado con POD + merma tipificada + devolución) / pesados
--
-- AC-MERM-01 (decisión #6) cerrado acá: una merma 'recuperada_con_venta' NO cuenta
-- como merma — sus gramos se mueven al casillero de venta. La fórmula no cambia; el
-- kilo simplemente aterriza donde corresponde, y el dueño ve por separado lo que se
-- perdió de verdad de lo que se recuperó vendiendo más barato.
-- ---------------------------------------------------------------------------
create or replace view pan.conciliacion_diaria as
with pesado as (
  select capturado_at::date as fecha, sum(gramos)::bigint as g_pesados
    from pan.pesajes group by 1
),
mostrador as (
  select capturado_at::date as fecha,
         sum(gramos) filter (where destino = 'mostrador')::bigint as g_a_mostrador,
         -- merma que de verdad se perdió
         sum(gramos) filter (
           where destino = 'merma' and coalesce(estado_merma, 'pendiente') <> 'recuperada_con_venta'
         )::bigint as g_merma_tipificada,
         -- merma que volvió a venderse con descuento: cuenta como venta, no como pérdida
         sum(gramos) filter (
           where destino = 'merma' and estado_merma = 'recuperada_con_venta'
         )::bigint as g_merma_recuperada
    from pan.pesajes group by 1
),
vendido as (
  select v.creado_at::date as fecha, sum(vl.gramos)::bigint as g_venta
    from pan.ventas v join pan.venta_lineas vl on vl.venta_id = v.id
   where vl.gramos is not null
   group by 1
),
entregado as (
  select capturado_at::date as fecha, sum(gramos_entregados)::bigint as g_pod_ok
    from pan.entregas
   where cerrada and supersede_id is null
   group by 1
)
select f.fecha,
       coalesce(p.g_pesados, 0) as g_pesados,
       coalesce(v.g_venta, 0) + coalesce(m.g_merma_recuperada, 0) as g_venta,
       coalesce(e.g_pod_ok, 0) as g_pod_ok,
       coalesce(m.g_merma_tipificada, 0) as g_merma_tipificada,
       coalesce(m.g_merma_recuperada, 0) as g_merma_recuperada,
       case
         when coalesce(p.g_pesados, 0) = 0 then null
         else round(
           (coalesce(v.g_venta, 0) + coalesce(m.g_merma_recuperada, 0)
            + coalesce(e.g_pod_ok, 0) + coalesce(m.g_merma_tipificada, 0))::numeric
           / p.g_pesados, 4)
       end as tck
  from (
    select fecha from pesado
    union select fecha from vendido
    union select fecha from entregado
  ) f
  left join pesado p on p.fecha = f.fecha
  left join mostrador m on m.fecha = f.fecha
  left join vendido v on v.fecha = f.fecha
  left join entregado e on e.fecha = f.fecha;

-- Métricas de flota: el odómetro manual manda para $/km (los GPS del POD son apoyo).
create or replace view pan.metricas_flota as
select r.fecha,
       count(*)::int as rutas_cerradas,
       coalesce(sum(r.km_fin - r.km_inicio), 0)::int as km_totales,
       coalesce(sum(r.km_fin - r.km_inicio), 0)::int
         * (select valor from pan.parametros where clave = 'clp_km_combustible') as costo_combustion_clp,
       coalesce(sum(r.km_fin - r.km_inicio), 0)::int
         * (select valor from pan.parametros where clave = 'clp_km_ev') as costo_ev_clp,
       coalesce(sum(r.km_fin - r.km_inicio), 0)::int
         * (select valor from pan.parametros where clave = 'co2_g_km_evitado') as co2_evitado_g
  from pan.rutas r
 where r.estado = 'cerrada' and r.km_inicio is not null and r.km_fin is not null
 group by r.fecha;

grant select on all tables in schema pan to pan_app;
grant select on pan.conciliacion_diaria to pan_app;
grant select on pan.metricas_flota to pan_app;
grant select on pan.saldo_cliente to pan_app;
grant insert on pan.lead_eauto to pan_app;
grant insert on pan.lead_kiloruta to pan_app;
grant update (valor) on pan.parametros to pan_app; -- admin ajusta valores, nunca claves
