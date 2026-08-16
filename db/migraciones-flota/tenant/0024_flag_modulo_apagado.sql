-- 0024 — El evento del flag `modulo_apagado`. [AC-FVEH-18]
--
-- El §0, en su fila de HTTP, lo escribe con estas letras: «si el módulo se apagó con turno
-- abierto, la captura entra con flag `modulo_apagado` + Por revisar — manda
-- `turno.config_version_id`». Es el caso donde la regla de oro del §4.2 se ve más clara: el
-- dueño apagó algo en una oficina y el chofer ya había tecleado el dato en la calle. La captura
-- entra, se marca, y alguien lo mira después.

insert into evento_tipo (codigo, descripcion) values
  ('lectura.modulo_apagado', 'Llegó una lectura con el módulo apagado en la config del turno; entró igual');
