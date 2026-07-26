-- Hallazgo de la auditoría: pan.cierres_caja tiene vendedor_id/dispositivo_id igual
-- que pan.ventas, pero nunca se le puso el trigger trg_exige_sesion que sí tienen
-- pesajes, hornadas, ventas, entregas, pedidos y dte (0002-0004) — un cierre de caja
-- podía insertarse a nombre de una sesión ya vencida o de un dispositivo distinto al
-- que hizo el POST, sin que la BD lo rechazara (solo la capa de API lo comprobaba).
create trigger trg_cierres_caja_exige_sesion
  before insert on pan.cierres_caja
  for each row execute function pan.trg_exige_sesion('vendedor_id');
