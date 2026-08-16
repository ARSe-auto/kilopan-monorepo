-- 0062 — Vigencia append-only de tarifas: UPDATE ⇒ RAISE, vigencia solapada ⇒ 422. [AC-FTAR-02]
--
-- El §3.E1.8/§4.5 exige que corregir un precio sea SIEMPRE una fila nueva con `vigente_desde`
-- mayor, jamás un UPDATE — 0061 solo declaró la columna. Acá van los dos guardarraíles:
-- (a) cualquier UPDATE sobre `tarifas` rebota — corregir es INSERT, no UPDATE; (b) una
-- vigencia nueva con `vigente_desde` <= la última ya registrada para la misma
-- empresa+concepto es una tarifa SOLAPADA (dos precios reclamando el mismo instante) y
-- rebota con el mismo `errcode` que el resto del módulo, que el servidor traduce a 422
-- (centinela 5, §9.3.5).
--
-- ─── POR QUÉ EL DEFAULT PASA DE `now()` A `clock_timestamp()` ──────────────────────────
--
-- `now()` es el instante de INICIO de la transacción: fijo durante TODA ella (§0). La suite
-- pgTAP corre el archivo entero como una única transacción (`db/flota/pgtap.mjs`), así que
-- dos INSERT sucesivos del mismo concepto —exactamente la corrección de precio que ya
-- ejercita AC-FTAR-01 en `db/flota/pgtap/0026_tarifas_por_empresa.sql`— recibirían el MISMO
-- `vigente_desde` con `now()`, y el guardarraíl (b) los rebotaría por solapados aunque sean
-- una corrección legítima. `clock_timestamp()` es el reloj real, avanza en cada llamada
-- dentro de la misma transacción, y es lo que necesita una columna cuyo propósito es
-- ordenar vigencias sucesivas.

alter table tarifas alter column vigente_desde set default clock_timestamp();

/**
 * Vigencia append-only (§3.E1.8, §4.5): corregir un precio es una fila nueva, jamás un
 * UPDATE. Bloquea CUALQUIER UPDATE sobre `tarifas` —no solo `precio_clp`— porque la fila
 * completa ES la vigencia; tocar cualquier columna de una vigencia ya registrada reescribe
 * historia.
 */
create or replace function tarifas_vigencia_append_only() returns trigger
  language plpgsql as $$
  begin
    raise exception
      'tarifas es append-only (§3.E1.8): corregir un precio es un INSERT con vigente_desde '
      'nuevo, jamás un UPDATE'
      using errcode = 'check_violation';
  end;
  $$;

create trigger tarifas_vigencia_append_only
  before update on tarifas
  for each row execute function tarifas_vigencia_append_only();

/**
 * Tarifa solapada (§9.3.5 centinela 5): una vigencia nueva con `vigente_desde` <= la última
 * ya registrada para la misma empresa+concepto reclama un instante que otra vigencia ya
 * reclamó — el devengo (AC-FTAR-03, «mayor vigente_desde ≤ event_time») necesita que cada
 * concepto tenga UNA sola vigencia activa por instante. Se compara por (tenant, empresa,
 * concepto): la primera fila de un concepto nuevo entra sin comparar contra nada (MAX sobre
 * cero filas es NULL, y NEW.vigente_desde <= NULL nunca es verdadero).
 */
create or replace function tarifas_vigencia_no_solapada() returns trigger
  language plpgsql as $$
  declare
    v_ultima timestamptz;
  begin
    select max(vigente_desde) into v_ultima
      from tarifas
     where tenant_id = new.tenant_id
       and empresa_cliente_id = new.empresa_cliente_id
       and concepto = new.concepto;
    if v_ultima is not null and new.vigente_desde <= v_ultima then
      raise exception
        'la empresa % ya tiene una vigencia de % desde %: una vigencia nueva solapada '
        'rebota (§9.3.5 centinela 5)', new.empresa_cliente_id, new.concepto, v_ultima
        using errcode = 'check_violation';
    end if;
    return new;
  end;
  $$;

create trigger tarifas_vigencia_no_solapada
  before insert on tarifas
  for each row execute function tarifas_vigencia_no_solapada();
