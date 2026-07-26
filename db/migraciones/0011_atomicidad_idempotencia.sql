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

-- Pero el índice no puede nacer sobre datos que el propio bug ya ensució: en producción
-- había 3 rutas del mismo repartidor y la misma fecha sin cerrar, justo lo que esta
-- migración viene a impedir. Crear el índice sin sanear primero deja el contenedor en
-- crash-loop (el Dockerfile encadena `migrar.mjs && server.js`), así que el saneo es
-- parte de la migración y no un paso manual que alguien tiene que acordarse de correr.
--
-- De cada grupo duplicado sobrevive UNA ruta: la que de verdad se usó. El orden de
-- preferencia es actividad real primero (entregas hechas, luego paradas asignadas),
-- después qué tan avanzada está, y al final el id para que el desempate sea
-- determinista y la migración dé el mismo resultado en cualquier réplica.
with ranking as (
  select r.id,
         row_number() over (
           partition by r.repartidor_id, r.fecha
           order by (select count(*) from pan.ruta_paradas rp
                       join pan.entregas e on e.pedido_id = rp.pedido_id
                      where rp.ruta_id = r.id) desc,
                    (select count(*) from pan.ruta_paradas rp where rp.ruta_id = r.id) desc,
                    case r.estado when 'en_curso' then 3 when 'cargando' then 2 else 1 end desc,
                    r.id
         ) as puesto
    from pan.rutas r
   where r.estado <> 'cerrada'
)
update pan.rutas set estado = 'cerrada'
 where id in (select id from ranking where puesto > 1);

create unique index rutas_una_activa_por_repartidor_dia
  on pan.rutas (repartidor_id, fecha)
  where estado <> 'cerrada';
