-- 0056 — El tipo de evento con el que queda dicho que el binario de una evidencia del POD no
-- re-hasheó como el sha256 que viajó ANTES en la mutación [AC-FPOD-19] — §4.6, §9.3 centinela 4.
--
-- Cero DDL: solo el catálogo, igual que 0044 (el mismo contrato para la foto de custodia) y 0050
-- (el primer flag de esta captura). `evidence.sha256`/`archivo_url` ya existen desde la 0002
-- (AC-FTEN-24) con el CHECK `evidence_binario_con_sha256`: lo que faltaba era la CONDUCTA del
-- servidor al recibir el binario, no una columna nueva.
--
-- No es un rechazo: la foto es mejora progresiva (§7.6), jamás dependencia. Un binario cortado a
-- mitad de subida en el andén no puede invalidar la entrega, que ya se cerró. La evidencia entra
-- igual, con el hash REAL de los bytes que efectivamente llegaron, y esto deja dicho que alguien
-- tiene que mirarla.

insert into evento_tipo (codigo, descripcion) values
  ('entrega.sha256_mismatch',
   'El binario de una evidencia de POD no re-hasheó como el sha256 que viajó antes en la mutación; entró igual con el hash real');
