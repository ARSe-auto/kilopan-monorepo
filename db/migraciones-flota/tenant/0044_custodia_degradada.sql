-- 0044 — Los eventos de la captura de custodia que entra degradada. [AC-FRUT-10]
--
-- Cero DDL: solo el catálogo. El §4.6 pide que el tipo de evento esté CATALOGADO y no que sea un
-- enum, justamente para que un caso nuevo sea una fila y no una migración de esquema (§4.9).
--
-- ─── UNO POR FLAG, Y NO UNO GENÉRICO ──────────────────────────────────────────────
--
-- Podría haber un solo `custodia.degradada` con el flag en el payload. Sería más corto y haría
-- imposible la consulta que de verdad se hace: «cuántas cargas salieron sin documento este mes»
-- (art. 55 DL 825) es una pregunta distinta de «cuántos teléfonos tienen la hora corrida», y con
-- un código único las dos obligan a abrir el jsonb de cada evento. La bandeja «Por revisar» del
-- §5.6 se lee por origen, y el origen tiene que decir QUÉ pasó.
--
-- ─── NINGUNO DE ESTOS ES UN RECHAZO ───────────────────────────────────────────────
--
-- La custodia está en la lista CAPTURA del §4.2: cuando esto llega, el camión ya se cargó y ya
-- salió. Cada uno de estos cinco eventos existe porque la captura ENTRÓ igual y alguien tiene que
-- mirarla después — no porque se haya rebotado nada.

insert into evento_tipo (codigo, descripcion) values
  ('custodia.manifiesto_incompleto',
   'El sub-manifiesto se confirmó sin contar todo lo declarado; entró igual (§7.6)'),
  ('custodia.item_sin_dte',
   'La carga se traspasó con ítems sin documento asociado ni bajada explícita (art. 55 DL 825)'),
  ('custodia.reloj_desfasado',
   'La captura de custodia llegó con el reloj del aparato fuera de la tolerancia del §0'),
  ('custodia.modulo_apagado',
   'Llegó una captura de custodia con el módulo apagado en la config del turno; entró igual'),
  ('custodia.sha256_mismatch',
   'El binario de la foto no re-hasheó como el sha256 que viajó antes en la mutación (§4.6)');
