-- 0049 — El tipo de evento con el que aterriza la captura del POD [AC-FPOD-03]
--
-- Fuente: §4.2 (regla de oro del motor de sync), §4.6 (los hechos aterrizan en `eventos`
-- append-only, con doble reloj y `client_uuid`), §5.2 F4 (100% offline), §3.E1.7.
--
-- ─── POR QUÉ ESTO ES UNA FILA Y NO UNA TABLA ──────────────────────────────────────
--
-- «El replay vacía la cola» solo es verdad si del otro lado hay algo que de verdad guarda la
-- captura. Un endpoint que contesta 2xx y la tira es el mismo antipatrón de la foto del POD que
-- «subía» hasheando un texto: la cola se vacía y el hecho no existe en ninguna parte.
--
-- La fila donde el POD aterriza con su detalle completo es `entregas_pod`, y su DDL es de AC-FPOD-11
-- —este archivo no la crea ni la adelanta—. Lo que este AC necesita para ser verdad es lo
-- mínimo del §4.6: que el hecho quede en `eventos`, que es el ORDEN AUTORITATIVO del tenant y
-- de donde se proyecta todo estado visible. Y para eso `registrarEvento` exige que el código
-- esté en el catálogo: rebota a propósito —deshaciendo el acto entero— si no lo encuentra
-- (§3.E1.14), que es lo que impide que un evento sin tipo quede huérfano en la tabla.
--
-- ─── UN SOLO CÓDIGO, Y NO UNO POR VARIANTE ────────────────────────────────────────
--
-- `entrega.pod_capturada` cubre las cuatro salidas de F4 (feliz, parcial, no entregada, dejada
-- en el punto): el `resultado` y el `metodo_entrega` de la máquina del §4.5 viajan en el payload
-- porque son ATRIBUTOS del mismo hecho —la parada se cerró en terreno—, no hechos distintos. Es
-- la diferencia con los flags de `lectura.*`, donde cada código responde una pregunta propia:
-- acá «cuántas paradas cerró el terreno hoy» se contesta con un `count(*)` sobre un tipo, y el
-- desglose por resultado sale del jsonb sin tener que unir cinco catálogos.
insert into evento_tipo (codigo, descripcion) values
  ('entrega.pod_capturada',
   'El terreno cerró una parada de entrega y su captura aterrizó por el motor de sync');
