-- 0054 — La secuencia monotónica por dispositivo [AC-FPOD-10] — §4.7.
--
-- `secuencia_maxima` es la más alta que `servidor/capturas.ts::aterrizarCapturas` dejó aterrizar
-- para este dispositivo. Vive en `dispositivos` y no en una tabla aparte porque es un atributo
-- DEL APARATO: la misma fila que ya guarda su `secreto_hash` y su `revocado_at` (mismo criterio
-- que evitó una tabla satélite para POD, §4.9). Nullable: `null` es «este dispositivo todavía no
-- aterrizó ninguna captura con secuencia», el punto de partida que `esHuecoDeSecuencia`
-- (dominio/pod-sync.ts) nunca marca como hueco.
alter table dispositivos add column secuencia_maxima bigint;

insert into evento_tipo (codigo, descripcion) values
  ('entrega.secuencia_hueco',
   'La secuencia monotónica del dispositivo saltó un número al aterrizar una captura de POD — '
   'evicción del outbox o manipulación; la captura entró igual, con severidad de revisión (§4.7)');
