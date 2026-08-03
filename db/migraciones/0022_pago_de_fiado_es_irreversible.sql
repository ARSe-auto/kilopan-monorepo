-- AC-PAG-02, auditoría de sesión supervisada (3-ago-2026). La 0021 arregló `anulada_at`
-- después de descubrir que agregar una columna de estado a `pan.ventas` (0020) sin revisar
-- a TODOS sus consumidores dejaba la deuda del cliente mal contada y la marca reversible.
-- `saldado_at` (0017) tiene EXACTAMENTE la misma forma —NULL = pendiente, timestamp =
-- saldado, con `grant update (saldado_at) on pan.ventas to pan_app`— y nunca se auditó
-- igual. Se auditó ahora, y tenía tres huecos. Los tres medidos corriendo las migraciones
-- reales bajo `set role pan_app`, no leyendo el SQL.
--
-- HUECO 1 — el pago del fiado era REVERSIBLE: se podía resucitar una deuda ya pagada.
-- Medido: venta fiada de $12.000 → `pan.saldo_cliente` marca $12.000; se marca saldada →
-- $0; `update pan.ventas set saldado_at = null` PASA y el saldo vuelve a $12.000. Peor que
-- el caso de la anulación: la anulación al menos deja su `venta_anulada` en `pan.eventos`,
-- así que des-anular dejaba un evento huérfano que delataba la maniobra. Marcar saldada NO
-- escribe ningún evento (medido: 0 filas en `pan.eventos` para esa venta), así que
-- `saldado_at` es el ÚNICO registro de que el cliente pagó — devolverlo a NULL borra el
-- pago SIN DEJAR RASTRO y le vuelve a cobrar al cliente algo que ya pagó.
--
-- HUECO 2 — la fecha del pago era reescribible. Medido: `update ... set saldado_at =
-- '2020-01-01'` PASA sobre una venta creada en 2026 — el pago queda fechado seis años
-- antes de que la venta existiera. Cuándo pagó el cliente es dato de cobranza, no adorno.
--
-- El grant column-level no alcanza para ninguno de los dos, por el mismo motivo que en la
-- 0021: la MISMA columna tiene que poder escribirse una vez (cobrar) y nunca más. Eso es
-- un trigger — el patrón que el esquema ya usa en `trg_entregas_inmutable` (0004),
-- `trg_correlativo_inmutable` (0004) y `trg_anulacion_inmutable` (0021).
--
-- HUECO 3 — se podía marcar pagada una venta ANULADA. Medido con la sentencia EXACTA de
-- `PATCH /api/ventas` (`route.ts:258`, que filtra `medio_pago='fiado' and saldado_at is
-- null` pero no `anulada_at`): pasa sobre una venta anulada y la fila queda `anulada_at`
-- Y `saldado_at` puestas a la vez — «esta venta no existe» y «el cliente la pagó»
-- afirmadas en la misma fila. Es literalmente el falso registro contra el que advierte la
-- cabecera de la 0021 («registrar en falso que el cliente pagó — corromper la auditoría
-- para tapar un bug»), que quedó cerrado como camino de limpieza y siguió abierto como
-- camino del endpoint.
--
-- Al revés SÍ se permite y es a propósito: anular una venta que el cliente ya pagó es el
-- caso real de la devolución con reembolso, y prohibirlo dejaría a la dueña sin forma de
-- deshacer una venta mal registrada sin entrar por SQL — justo lo que AC-ADM-05 existe
-- para evitar. Por eso esto es un trigger y no un CHECK de exclusión mutua: la regla
-- depende de la DIRECCIÓN del cambio, y un CHECK no ve la dirección.
create or replace function pan.trg_saldado_inmutable() returns trigger
language plpgsql as $$
begin
  if old.saldado_at is not null and new.saldado_at is distinct from old.saldado_at then
    raise exception 'el pago de la venta % es inmutable: no se des-salda ni se re-fecha (AC-PAG-02)', old.id;
  end if;
  if new.saldado_at is distinct from old.saldado_at
     and (old.anulada_at is not null or new.anulada_at is not null) then
    raise exception 'la venta % está anulada: no se le registra un pago (AC-PAG-02)', old.id;
  end if;
  return new;
end;
$$;

create trigger trg_ventas_saldado_inmutable
  before update on pan.ventas
  for each row execute function pan.trg_saldado_inmutable();

-- HUECO 4 (menor) — la BD aceptaba marcar saldada una venta que NO es fiado. Medido: el
-- update pasa sobre una venta en 'efectivo', que ya se cobró en el mesón y nunca fue deuda.
-- Hoy no corrompe el saldo de nadie sólo porque `pan.saldo_cliente` filtra además
-- `medio_pago = 'fiado'`; o sea, la única defensa es que el consumidor se acuerde de
-- filtrar — exactamente la clase de suposición que produjo los huecos de la 0020. La regla
-- baja a la BD, como `ventas_fiado_requiere_cliente` (0003) y `ventas_anulada_exige_motivo`
-- (0020): sólo lo que se fió puede saldarse.
alter table pan.ventas add constraint ventas_saldado_solo_fiado
  check (saldado_at is null or medio_pago = 'fiado');

-- Reversión:
-- alter table pan.ventas drop constraint ventas_saldado_solo_fiado;
-- drop trigger trg_ventas_saldado_inmutable on pan.ventas;
-- drop function pan.trg_saldado_inmutable();
