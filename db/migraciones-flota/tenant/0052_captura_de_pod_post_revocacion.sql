-- 0052 — El tipo de evento con el que queda dicho que una captura de POD llegó de un aparato
-- revocado hace más de `REVOCACION.ventana_horas` [AC-FPOD-07] — §4.3.
--
-- Cero DDL: solo el catálogo, igual que 0044 (custodia), 0050 (reloj desfasado del POD) y 0051
-- (módulo apagado del POD).
--
-- Solo la TARDÍA tiene evento propio. La que llega DENTRO de la ventana (flag `post_revocacion`)
-- se explica por falta de señal: se marca en el acuse y no abre rastro (`dominio/revocacion.ts`,
-- AC-FIDN-09; `dominio/pod-sync.ts::dejaRastro`) — un evento por cada aparato que pasó la noche
-- sin cobertura ahogaría el que sí importa mirar. Ninguna de las dos clases rechaza la captura
-- (§4.2, centinela 4 §9.3): la distinción es solo severidad de revisión.

insert into evento_tipo (codigo, descripcion) values
  ('entrega.post_revocacion_tardia',
   'La captura de una parada de POD llegó de un aparato revocado hace más de la ventana de cuarentena; entró igual, con severidad alta en «Por revisar»');
