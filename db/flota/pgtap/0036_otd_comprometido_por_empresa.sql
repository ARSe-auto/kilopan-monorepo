-- pgTAP: el OTD comprometido rebota en la BASE, no en la pantalla. [AC-FTAR-13]
--
-- El AC no pide «que la UI valide 50–100»: pide que la BD RECHACE el INSERT fuera de rango. La
-- diferencia importa porque un compromiso contractual entra por más puertas que la pantalla —una
-- carga masiva, un fixture, una migración futura— y una regla que solo vive en TypeScript no las
-- cubre. Por eso el oráculo de este AC es un rebote de constraint y se escribe acá dentro
-- (0071_otd_comprometido_por_empresa.sql).
--
-- Se ejercen las TRES puntas, no solo la feliz:
--   · un valor válido entra;
--   · NULL entra —«sin compromiso pactado», el caso de la empresa implícita de `mi_flota`—;
--   · 49 y 101 rebotan, que son los dos bordes exactos del CHECK.

select no_plan();

-- ─── Un valor legítimo entra y se lee de vuelta igual ───────────────────────────────────

-- RUT de la lista congelada de fixtures (§7.8, §10): jamás un RUT real, ni siquiera acá.
insert into empresas_cliente (rut, razon_social, otd_comprometido_pct)
values ('76.222.333-3', 'Fixture OTD', 95);

select is(
  (select otd_comprometido_pct from empresas_cliente where rut = '76.222.333-3'),
  95::smallint,
  'un OTD comprometido dentro de rango se guarda y se lee igual'
);

-- ─── NULL es válido: «no hay compromiso pactado con esta empresa» ───────────────────────
--
-- Es el caso de toda operación en `mi_flota` (§3): la empresa implícita no se compromete un OTD
-- a sí misma, y la tarjeta SLA del semáforo simplemente no se renderiza (precedente SLA-NULL).

insert into empresas_cliente (rut, razon_social)
values ('76.445.588-6', 'Fixture sin compromiso');

select is(
  (select otd_comprometido_pct from empresas_cliente where rut = '76.445.588-6'),
  null,
  'sin OTD pactado la columna queda NULL, que es un estado legítimo y no un dato faltante'
);

-- ─── Los DOS bordes del CHECK rebotan en la base ────────────────────────────────────────
--
-- 49 es el error de tipeo que el rango existe para atrapar (un «9» donde iba «90» da 9, y
-- cualquier valor bajo 50 no es un compromiso sino un descuido); 101 no existe como porcentaje.

select throws_ok(
  $$insert into empresas_cliente (rut, razon_social, otd_comprometido_pct)
    values ('76.111.222-8', 'Fixture bajo el piso', 49)$$,
  '23514',
  null,
  'un OTD bajo el piso de 50 rebota contra el CHECK, no contra la pantalla'
);

select throws_ok(
  $$insert into empresas_cliente (rut, razon_social, otd_comprometido_pct)
    values ('76.111.222-8', 'Fixture sobre 100', 101)$$,
  '23514',
  null,
  'un OTD sobre 100 rebota contra el CHECK: no existe cumplir más que todo'
);

-- Y ninguno de los dos rechazados dejó fila: el rebote es antes de escribir, no un rollback
-- parcial que deje la empresa creada sin su compromiso.
select is(
  (select count(*) from empresas_cliente where rut = '76.111.222-8'),
  0::bigint,
  'los INSERT rechazados no dejaron la empresa a medio crear'
);

select * from finish();
