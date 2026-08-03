-- AC-ADM-05, corrección de sesión supervisada (3-ago-2026). La migración 0020 la escribió
-- el motor autónomo violando docs/PROMPT_CORRECTIVO.md §7; al revisarla a mano aparecieron
-- dos huecos que el AC daba por cubiertos. Ambos comprobados corriendo las migraciones
-- reales bajo `set role pan_app`, no leyendo el SQL.
--
-- HUECO 1 — anular una venta fiada NO bajaba la deuda del cliente.
-- pan.saldo_cliente (0017) suma el fiado del mesón con `medio_pago='fiado' and
-- saldado_at is null`, y nunca se le agregó la anulación. Medido: venta fiada de $12.000,
-- se anula, el arqueo baja a 0 y el cliente SEGUÍA debiendo $12.000. Peor: la única forma
-- de limpiarlo sin esta migración era marcarla `saldado_at`, o sea registrar en falso que
-- el cliente pagó — corromper la auditoría para tapar un bug. El AC existe para deshacer
-- un error de operación sin SQL, y lo deshacía a medias.
--
-- Se reescribe la vista completa (0017 con `and v.anulada_at is null` en deuda_mesa). Las
-- otras dos ramas no se tocan: la deuda por DTE ya tiene su propio camino de anulación
-- (nota de crédito, tipo_dte 61) y no pasa por pan.ventas.
create or replace view pan.saldo_cliente as
select c.id as cliente_id,
       c.rut,
       c.razon_social,
       (coalesce(deuda_dte.monto, 0) + coalesce(deuda_mesa.monto, 0))::integer as saldo_pendiente_clp
  from pan.clientes c
  left join (
    select p.cliente_id, sum(d.monto_total) as monto
      from pan.pedidos p
      join pan.documento_tributario d on d.pedido_id = p.id
     where d.estado_pago = 'pendiente'
       and d.estado = 'registrado'
       and d.consolidado_en_id is null   -- 0008: una guía consolidada no es deuda propia
       and d.tipo_dte <> 61              -- las notas de crédito no son deuda
     group by p.cliente_id
  ) deuda_dte on deuda_dte.cliente_id = c.id
  left join (
    select v.cliente_id, sum(v.total_clp) as monto
      from pan.ventas v
     where v.medio_pago = 'fiado'
       and v.saldado_at is null
       and v.anulada_at is null          -- 0021: una venta anulada no es deuda de nadie
     group by v.cliente_id
  ) deuda_mesa on deuda_mesa.cliente_id = c.id;

grant select on pan.saldo_cliente to pan_app;

-- HUECO 2 — la anulación era reversible, justo lo contrario de lo que 0020 declara.
-- 0020 dice en su cabecera «append-only, como el POD con supersede_id», pero su
-- `grant update (anulada_at, anulada_motivo)` deja a pan_app devolver ambas a NULL: la
-- venta revive en el arqueo y en la deuda, y en pan.eventos queda un `venta_anulada`
-- huérfano que afirma que se anuló algo que hoy está vigente — la auditoría diciendo lo
-- contrario del dato. Medido: el update pasó y el arqueo volvió de 0 a $12.000.
--
-- El grant no alcanza porque la MISMA columna tiene que poder escribirse una vez (anular)
-- y nunca más. Eso es un trigger, igual que trg_entregas_inmutable (0004) para el POD y
-- trg_correlativo_inmutable (0004) para el correlativo: el mismo patrón que el resto del
-- esquema ya usa para «se pone una vez y nadie lo reescribe».
create or replace function pan.trg_anulacion_inmutable() returns trigger
language plpgsql as $$
begin
  if old.anulada_at is not null
     and (new.anulada_at is distinct from old.anulada_at
          or new.anulada_motivo is distinct from old.anulada_motivo) then
    raise exception 'la anulación de la venta % es inmutable: no se des-anula ni se reescribe su motivo (AC-ADM-05)', old.id;
  end if;
  return new;
end;
$$;

create trigger trg_ventas_anulacion_inmutable
  before update on pan.ventas
  for each row execute function pan.trg_anulacion_inmutable();

-- Reversión:
-- drop trigger trg_ventas_anulacion_inmutable on pan.ventas;
-- drop function pan.trg_anulacion_inmutable();
-- create or replace view pan.saldo_cliente as <definición de 0017>;
