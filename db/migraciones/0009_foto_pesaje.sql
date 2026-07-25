-- AC-PES-04 (decisión #1, nivel 1): cerrar el circuito de la foto de pesaje.
--
-- Las columnas `foto_sha256` / `foto_estado` existían en pan.pesajes desde 0002, y el
-- toggle `pesaje_foto_obligatoria` existía en /admin desde 0005 — pero nada las
-- escribía nunca: ni la API de pesajes las aceptaba, ni la pantalla abría la cámara.
-- El control del dueño sobre su operación estaba, en los hechos, apagado.
--
-- Acá va el único permiso que faltaba: que pan_app pueda confirmar que el JPEG llegó,
-- exactamente igual que ya lo hace con las entregas (0004). Sigue SIN poder tocar
-- `foto_sha256`: el hash se fija al insertar el pesaje y es inmutable, porque si la app
-- pudiera reapuntarlo la evidencia no probaría nada.

grant update (foto_estado) on pan.pesajes to pan_app;

-- Un pesaje con foto declarada tiene que tener estado, y uno sin foto no puede
-- tenerlo. Sin esto, un 'subida' con foto_sha256 nulo sería una evidencia fantasma:
-- la conciliación mostraría el pesaje como respaldado sin que exista imagen alguna.
alter table pan.pesajes
  add constraint pesajes_foto_coherente
  check ((foto_sha256 is null) = (foto_estado is null));

-- Buscar el pesaje por hash al recibir el binario en /api/fotos. Sin índice esto es un
-- seq scan sobre toda la tabla de pesajes en cada subida de foto — y en una panadería
-- con foto obligatoria eso es una vez por bandeja, todo el amanecer.
create index if not exists pesajes_foto_sha256_idx
  on pan.pesajes (foto_sha256)
  where foto_sha256 is not null;
