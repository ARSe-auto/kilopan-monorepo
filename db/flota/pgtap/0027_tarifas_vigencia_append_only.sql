-- pgTAP: vigencia append-only de tarifas — UPDATE rebota, vigencia solapada rebota. [AC-FTAR-02]
--
-- El 422 con su mensaje vive en el servidor que traduce `check_violation` (mismo patrón que
-- AC-FRUT-01 y AC-FTAR-01: acá va lo de la base). Dos guardarraíles: (a) cualquier UPDATE
-- sobre `tarifas`, con el rol de app, rebota con `check_violation` y deja la fila intacta —
-- corregir un precio es INSERT, jamás UPDATE; (b) una segunda vigencia del mismo
-- empresa+concepto con `vigente_desde` <= la última ya registrada rebota igual (centinela 5,
-- §9.3.5) y deja la tabla sin la fila solapada.

select no_plan();

-- RUT de la lista congelada (§7.8, AC-FIDN-21): la MISMA empresa contratante que ya usa
-- `0026_tarifas_por_empresa.sql` — se comparte a propósito, cada suite en su propia
-- transacción aislada que pgTAP revierte al terminar.
insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba');
create temporary table e_id as select id as empresa from empresas_cliente limit 1;

-- ─── UPDATE de vigencia ⇒ RAISE, 0 cambios (§3.E1.8, §4.5) ──────────────────────────────

insert into tarifas (empresa_cliente_id, concepto, precio_clp)
  select empresa, 'por_entrega', 3500 from e_id;

select throws_ok(
  $$ update tarifas set precio_clp = 4000
      where concepto = 'por_entrega'
        and empresa_cliente_id = (select empresa from e_id) $$,
  '23514', null,
  'UPDATE de precio_clp sobre una vigencia ya registrada rebota — corregir es INSERT (§3.E1.8)'
);
select is(
  (select precio_clp from tarifas
    where concepto = 'por_entrega' and empresa_cliente_id = (select empresa from e_id)),
  3500::bigint,
  'el precio original queda intacto tras el UPDATE rebotado (0 cambios)'
);

select throws_ok(
  $$ update tarifas set creado_en = now()
      where concepto = 'por_entrega'
        and empresa_cliente_id = (select empresa from e_id) $$,
  '23514', null,
  'el UPDATE rebota sobre CUALQUIER columna, no solo precio_clp: la fila completa es la vigencia'
);

-- ─── Corregir SÍ es un INSERT con vigente_desde mayor, y no cuenta como solape ──────────
--
-- `vigente_desde` explícito y adelantado: dentro de esta transacción única de pgTAP, dos
-- DEFAULT `clock_timestamp()` sucesivos alcanzan a quedar demasiado cerca para distinguirlos
-- con certeza — el guardarraíl en sí no depende de eso, solo el fixture del test.
insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
  select empresa, 'por_entrega', 3800, clock_timestamp() + interval '1 minute' from e_id;
select is(
  (select count(*)::int from tarifas
    where concepto = 'por_entrega' and empresa_cliente_id = (select empresa from e_id)),
  2,
  'corregir el precio con un INSERT nuevo (vigente_desde mayor) entra sin rebotar'
);
select is(
  (select precio_clp from tarifas
    where concepto = 'por_entrega' and empresa_cliente_id = (select empresa from e_id)
    order by vigente_desde desc limit 1),
  3800::bigint,
  'la vigencia más reciente es la corrección, no la original'
);

-- ─── Vigencia solapada ⇒ 422, 0 filas (centinela 5, §9.3.5) ─────────────────────────────

select throws_ok(
  $$ insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
     select empresa, 'por_entrega', 5000, (select min(vigente_desde) from tarifas
                                             where concepto = 'por_entrega'
                                               and empresa_cliente_id = e_id.empresa)
       from e_id $$,
  '23514', null,
  'una vigencia con vigente_desde IGUAL a la más antigua ya registrada del mismo concepto solapa'
);
select throws_ok(
  $$ insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde)
     select empresa, 'por_entrega', 5000, (select max(vigente_desde) from tarifas
                                             where concepto = 'por_entrega'
                                               and empresa_cliente_id = e_id.empresa) - interval '1 second'
       from e_id $$,
  '23514', null,
  'una vigencia BACKDATED (anterior a la última registrada) del mismo concepto solapa'
);
select is(
  (select count(*)::int from tarifas
    where concepto = 'por_entrega' and empresa_cliente_id = (select empresa from e_id)),
  2,
  'ninguna vigencia solapada dejó fila: siguen exactamente las 2 legítimas'
);

-- Un concepto DISTINTO en la misma empresa no compite por vigencia — cada concepto tiene su
-- propia línea de tiempo.
insert into tarifas (empresa_cliente_id, concepto, precio_clp)
  select empresa, 'por_bulto', 500 from e_id;
select is(
  (select count(*)::int from tarifas where empresa_cliente_id = (select empresa from e_id)),
  3,
  'un concepto nuevo entra sin comparar su vigencia contra la de otro concepto'
);

select finish();
