-- Tanda 4 de la auditoría: la idempotencia del sistema era una isla — bien hecha en
-- ventas/pesajes/sync (client_uuid + on conflict) y ausente en cierre de caja y rutas,
-- que hasta acá dependían solo de que el operador no hiciera doble clic.

-- Cerrar caja dos veces para el mismo vendedor, medio de pago y día duplicaba la fila:
-- el segundo cierre no era idempotente, era otro cierre completo sumado al anterior.
-- El endpoint ahora hace el insert dentro de una transacción y este unique lo protege
-- también si dos pestañas mandan el mismo cierre a la vez.
--
-- Igual que con las rutas más abajo: la regla no puede nacer sobre los datos que la
-- ausencia de la regla ya ensució. El cierre de caja se manda con TODOS los medios de
-- pago en un POST, así que un solo reintento —el vendedor que no ve respuesta y vuelve
-- a apretar— deja ocho filas duplicadas de una. Un `add constraint unique` valida todo
-- el histórico al crearse, y si rebota el contenedor no arranca.
--
-- Un cierre de caja es evidencia contable: no se borra, se marca. La fila duplicada
-- queda con `anulado`, visible para quien audite, y el índice pasa a ser parcial.
-- Conserva el nombre `cierres_caja_un_cierre_por_dia` a propósito: el endpoint lo
-- busca por nombre en el mensaje de Postgres para devolver un 409 amable en vez de un
-- 500 (apps/kilopan/src/app/api/cierre-caja/route.ts).
alter table pan.cierres_caja
  add column if not exists anulado boolean not null default false;

-- Sobrevive el PRIMER cierre de cada grupo: es el que el vendedor contó de verdad, los
-- siguientes son el reintento. Desempate por id para que dos réplicas den lo mismo.
with ranking as (
  select id,
         row_number() over (
           partition by fecha, medio_pago, vendedor_id
           order by cerrado_at, id
         ) as puesto
    from pan.cierres_caja
   where not anulado
)
update pan.cierres_caja set anulado = true
 where id in (select id from ranking where puesto > 1);

create unique index cierres_caja_un_cierre_por_dia
  on pan.cierres_caja (fecha, medio_pago, vendedor_id)
  where not anulado;

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
-- De cada grupo duplicado sobrevive UNA ruta: la que de verdad se usó.
--
-- La actividad se mide por pan.ruta_paradas.estado, que es POR RUTA. Contar entregas
-- no sirve: pan.entregas se ata al pedido, no a la ruta, y las rutas duplicadas nacen
-- justamente con los MISMOS pedidos — todas contarían la misma entrega y el criterio
-- empataría siempre, dejando que decida el estado y cerrando quizá la ruta que sí
-- repartió. Una parada que ya no está 'pendiente' solo puede haberla movido el
-- repartidor de ESA ruta.
--
-- Después de la actividad va el tamaño, luego qué tan avanzada está, y al final el id
-- para que el desempate sea determinista y la migración dé el mismo resultado en
-- cualquier réplica.
with ranking as (
  select r.id,
         row_number() over (
           partition by r.repartidor_id, r.fecha
           order by (select count(*) from pan.ruta_paradas rp
                      where rp.ruta_id = r.id and rp.estado <> 'pendiente') desc,
                    (select count(*) from pan.ruta_paradas rp where rp.ruta_id = r.id) desc,
                    case r.estado when 'en_curso' then 3 when 'cargando' then 2 else 1 end desc,
                    r.id
         ) as puesto
    from pan.rutas r
   where r.estado <> 'cerrada'
)
update pan.rutas set estado = 'cerrada'
 where id in (select id from ranking where puesto > 1);

-- Cerrar la ruta no alcanza: el pedido que iba en ella quedó en 'en_ruta' y ahí se
-- queda para siempre. No vuelve a ofrecerse para armar ruta (la consulta de rutas pide
-- 'confirmado') y tampoco puede recibir POD, o sea que el cliente simplemente no recibe
-- su pan y nadie se entera. La app ya sabe deshacer esto cuando una entrega falla
-- (api/sync devuelve el pedido a 'confirmado'); acá se aplica el mismo criterio a los
-- que quedaron huérfanos: sin ninguna ruta viva y sin ninguna entrega registrada.
-- Va como sentencia aparte y no como CTE encadenado a propósito: dentro de UNA sentencia
-- los CTE que modifican datos ven todos la misma foto previa, y las rutas recién cerradas
-- todavía figurarían abiertas.
update pan.pedidos p set estado = 'confirmado'
 where p.estado = 'en_ruta'
   and not exists (
     select 1 from pan.ruta_paradas rp
       join pan.rutas r on r.id = rp.ruta_id
      where rp.pedido_id = p.id and r.estado <> 'cerrada')
   and not exists (select 1 from pan.entregas e where e.pedido_id = p.id);

create unique index rutas_una_activa_por_repartidor_dia
  on pan.rutas (repartidor_id, fecha)
  where estado <> 'cerrada';
