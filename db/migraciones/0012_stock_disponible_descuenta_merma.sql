-- Corrige hallazgo ALTA #13 de la auditoría (docs/AUDITORIA_NAVEGACION.md): stock
-- fantasma. pan.stock_disponible() (0003) restaba lo vendido pero no la merma: un
-- maestro pesaba pan a mostrador, después re-pesaba parte de eso como destino='merma'
-- (pesaje SEPARADO, mismo producto_id) y esos gramos seguían contando como
-- disponibles en /vender.
--
-- Se descuenta TODA la merma del producto, sin importar estado_merma. Incluye
-- 'recuperada_con_venta' a propósito: pan.conciliacion_diaria (0005) reclasifica esos
-- gramos al casillero de venta reescribiendo el propio pesaje (comentario ahí: "sus
-- gramos se mueven al casillero de venta"), pero nunca inserta una fila real en
-- venta_lineas para esa recuperación — no hay nada más en el sistema que la reste. Si
-- stock_disponible dejara de descontarla al marcarla recuperada, ese pan volvería a
-- aparecer como disponible aunque ya se vendió con descuento. Ver AC-MERM-01 (0002) y
-- AC-MERM-01 cerrado (0005) para el mismo patrón de decisión.
create or replace function pan.stock_disponible(p_producto_id uuid) returns integer
language sql stable as $$
  select coalesce(
    (select sum(p.gramos) from pan.pesajes p
      where p.producto_id = p_producto_id and p.destino = 'mostrador'), 0
  ) - coalesce(
    (select sum(vl.gramos) from pan.venta_lineas vl
      where vl.producto_id = p_producto_id and vl.gramos is not null), 0
  ) - coalesce(
    (select sum(p.gramos) from pan.pesajes p
      where p.producto_id = p_producto_id and p.destino = 'merma'), 0
  );
$$;
