-- Tanda 4 de la auditoría: la idempotencia del sistema era una isla — bien hecha en
-- ventas/pesajes/sync (client_uuid + on conflict) y ausente en cierre de caja y rutas,
-- que hasta acá dependían solo de que el operador no hiciera doble clic.

-- Cerrar caja dos veces para el mismo vendedor, medio de pago y día duplicaba la fila:
-- el segundo cierre no era idempotente, era otro cierre completo sumado al anterior.
-- El endpoint ahora hace el insert dentro de una transacción y este unique lo protege
-- también si dos pestañas mandan el mismo cierre a la vez.
alter table pan.cierres_caja
  add constraint cierres_caja_un_cierre_por_dia unique (fecha, medio_pago, vendedor_id);

-- "Armar ruta y salir" crea una ruta con TODOS los pedidos confirmados del día en un
-- solo clic (no hay flujo para armar rutas parciales). Un doble clic —común con mala
-- señal, cuando el operador no ve la respuesta a tiempo— creaba una segunda ruta con
-- los mismos pedidos, duplicando el reparto. Una ruta no cerrada por repartidor y día
-- alcanza para expresar esa regla sin tocar la UI.
create unique index rutas_una_activa_por_repartidor_dia
  on pan.rutas (repartidor_id, fecha)
  where estado <> 'cerrada';
