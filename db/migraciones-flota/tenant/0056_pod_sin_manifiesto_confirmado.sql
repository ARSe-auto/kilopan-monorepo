-- 0056 — El tipo de evento con el que queda dicho que un POD aterrizó sin el manifiesto de su
-- carga confirmado [AC-FRUT-23] — KR-29 (criterio congelado, decisión del dueño 08-ago-2026 D1),
-- §4.2 (CAPTURA), §7.3 (DTE-gate del manifiesto, art. 55 DL 825), §9.3.4.
--
-- Cero DDL: solo el catálogo, igual que 0044 (custodia), 0050 (reloj desfasado) y 0051 (módulo
-- apagado). El §4.6 pide que el tipo de evento esté CATALOGADO y no que sea un enum, para que un
-- caso nuevo sea una fila y no una migración de esquema (§4.9).
--
-- ─── POR QUÉ ESTE FLAG NO DUPLICA `custodia.manifiesto_incompleto` ────────────────
--
-- Aquel es del ANDÉN: el responsable de carga confirmó un sub-manifiesto al que le faltaban
-- ítems, y el hecho es de la parada de CARGA. Este es de la ENTREGA, y su sujeto es otro: una
-- entrega que se cerró en la calle cuando la carga que la abastece nunca se confirmó. Contarlos
-- con un código único obligaría a abrir el jsonb de cada evento para responder «cuántas entregas
-- salieron sin manifiesto», que es justo la pregunta que el DTE-gate del §7.3 necesita mirar.
--
-- ─── Y POR QUÉ ENTRA IGUAL ───────────────────────────────────────────────────────
--
-- El candado bloqueante vive en el CLIENTE (§4.2, AC-FRUT-22): la tarjeta no ofrece «Llegué».
-- Cuando aun así llega un POD por el motor de sync —una PWA vieja, un reloj corrido, un aparato
-- que capturó antes de que alguien bajara el ítem del manifiesto— el mundo físico YA ocurrió: el
-- pan está entregado. Rebotarlo no devuelve la parada, la borra (§9.3.4: rechazos = 0). Lo que
-- corresponde es dejarlo dicho, con severidad ALTA porque acá lo que quedó sin respaldo es el
-- ancla documental del art. 55 DL 825, no la hora de un teléfono.

insert into evento_tipo (codigo, descripcion) values
  ('entrega.sin_manifiesto_confirmado',
   'Un POD aterrizó por el motor de sync sin el sub-manifiesto por empresa de su parada de carga confirmado (KR-29); entró igual, con severidad alta en «Por revisar»');
