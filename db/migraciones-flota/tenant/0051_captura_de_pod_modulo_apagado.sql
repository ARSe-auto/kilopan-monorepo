-- 0051 — El tipo de evento con el que queda dicho que una captura de POD llegó con el módulo de
-- encargos apagado en la config CONGELADA del turno [AC-FPOD-06] — §0 HTTP, §5.5, §4.4.
--
-- Cero DDL: solo el catálogo, igual que 0044 (custodia) y 0050 (reloj desfasado del POD). El
-- §4.6 pide que el tipo de evento esté CATALOGADO y no que sea un enum, para que un caso nuevo
-- sea una fila y no una migración de esquema (§4.9).
--
-- No es un rechazo: la entrega es CAPTURA (§4.2). El dueño apagó el módulo desde el panel «
-- Funciones» con el turno ya corriendo, y el §4.4 dice que ESE turno sigue entero con la
-- versión que tenía al abrir — la captura entra igual, con este flag, para que alguien la mire
-- después en «Por revisar» sabiendo con qué `config_version_id` se juzgó.

insert into evento_tipo (codigo, descripcion) values
  ('entrega.modulo_apagado',
   'La captura de una parada de POD llegó con el módulo de encargos apagado en la config congelada del turno; entró igual');
