-- 0050 — El tipo de evento con el que queda dicho que una captura de POD llegó con el reloj
-- desfasado [AC-FPOD-05] — §4.2, §4.6, §0, §9.3 centinela 4.
--
-- Cero DDL: solo el catálogo, igual que 0044 para custodia. El §4.6 pide que el tipo de evento
-- esté CATALOGADO y no que sea un enum, para que un caso nuevo sea una fila y no una migración
-- de esquema (§4.9).
--
-- No es un rechazo: la entrega es CAPTURA (§4.2), el chofer ya tocó «Entregado» y ya se fue de
-- la parada. El evento existe porque la captura entró IGUAL, con el reloj del aparato fuera de
-- `RELOJ.drift_max_minutos` (§0), y alguien tiene que poder mirarlo después en «Por revisar».

insert into evento_tipo (codigo, descripcion) values
  ('entrega.reloj_desfasado',
   'La captura de una parada de POD llegó con el reloj del aparato fuera de la tolerancia del §0; entró igual');
