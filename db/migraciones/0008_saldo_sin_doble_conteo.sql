-- Corrección de pan.saldo_cliente: NO contar dos veces la misma deuda.
--
-- Bug encontrado consolidando de verdad, no leyendo la vista: al agrupar una guía de
-- $19.800 en una factura de $19.800, el saldo del cliente saltaba a $39.600. La vista
-- sumaba la guía Y la factura que la reemplaza. Para un panadero que usa esto para
-- saber cuánto le deben, mostrar el doble es peor que no mostrar nada.
--
-- Regla correcta: una guía consolidada YA NO representa deuda propia — la deuda la
-- lleva su factura. Se cuenta la guía solo mientras esté suelta.

create or replace view pan.saldo_cliente as
select c.id as cliente_id,
       c.rut,
       c.razon_social,
       coalesce(sum(d.monto_total) filter (
         where d.estado_pago = 'pendiente'
           and d.estado = 'registrado'
           and d.consolidado_en_id is null   -- <- la corrección
           and d.tipo_dte <> 61              -- las notas de crédito no son deuda
       ), 0)::integer as saldo_pendiente_clp
  from pan.clientes c
  left join pan.pedidos p on p.cliente_id = c.id
  left join pan.documento_tributario d on d.pedido_id = p.id
 group by c.id, c.rut, c.razon_social;

grant select on pan.saldo_cliente to pan_app;
