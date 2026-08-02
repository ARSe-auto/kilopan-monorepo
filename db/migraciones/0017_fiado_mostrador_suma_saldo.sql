-- P0-3 (auditoría 1-ago-2026, verificado a mano): pan.saldo_cliente solo sumaba
-- documento_tributario vía pedidos. Una venta de mostrador con medio_pago='fiado' no
-- genera ni pedido ni documento tributario — api/ventas/route.ts:40 lo comenta como
-- "usa el mismo cliente y el mismo saldo que el fiado mayorista", pero eso nunca fue
-- cierto: el fiado del mesón NUNCA entraba en el saldo de nadie. Cada "anótamelo"
-- quedaba como venta registrada y CERO deuda visible del cliente.
--
-- saldado_at: la venta al mesón fiada no tenía ningún concepto de "esto ya se pagó" —
-- a diferencia del fiado mayorista, que sí lo tiene en documento_tributario.estado_pago.
-- Sin esta columna, sumar el fiado del mesón al saldo lo dejaría como deuda ETERNA
-- (nunca se puede saldar), que es un bug distinto pero igual de real. NULL = pendiente,
-- timestamp = cuándo se saldó (jamás se borra la venta ni se reescribe el monto).
alter table pan.ventas add column saldado_at timestamptz;

-- La vista se reescribe agregando cada fuente de deuda en su PROPIA subconsulta,
-- agrupada antes de combinar — un LEFT JOIN directo entre pedidos+documento_tributario
-- y ventas multiplicaría cada fila contra la otra (fan-out) y sobrecontaría exactamente
-- el mismo tipo de bug que 0008 ya corrigió una vez para pedidos/documentos.
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
     group by v.cliente_id
  ) deuda_mesa on deuda_mesa.cliente_id = c.id;

grant select on pan.saldo_cliente to pan_app;
grant update (saldado_at) on pan.ventas to pan_app;

-- Reversión:
-- create or replace view pan.saldo_cliente as <definición de 0008>;
-- alter table pan.ventas drop column saldado_at;
