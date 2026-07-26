-- Corrige ALTA #10 y #18 de la auditoría (docs/AUDITORIA_NAVEGACION.md): el POD
-- solo sabía registrar "se entregó exactamente lo pedido" — no existía la entrega
-- parcial (menos gramos que lo pedido) ni la entrega fallida (cliente cerrado,
-- dirección no encontrada, rechazo). `gramos_entregados` y `foto_sha256`/`lat`/`lng`
-- ya aceptaban lo necesario sin tocar el esquema (0 g es válido, foto y GPS siguen
-- exigiéndose en los dos casos — se capturan ANTES de saber si la entrega va a
-- fracasar, así que pedir menos ahí no simplifica nada). Lo que faltaba era la regla
-- que ata motivo_rechazo a los otros dos campos, para que quede en la BD y no solo en
-- api/sync/route.ts.
--
-- cerrada=false en la fallida (no true) a propósito: `entregas_una_vigente_por_pedido`
-- (0004) es un índice único parcial `where cerrada and supersede_id is null`. Si una
-- fallida se insertara con cerrada=true, un reintento exitoso al día siguiente
-- chocaría contra ese índice y exigiría encadenar supersede_id para algo que ni
-- siquiera llegó a cerrar el pedido. Con cerrada=false, la fallida queda como
-- evidencia del intento sin bloquear el próximo.
alter table pan.entregas add constraint entregas_fallida_consistente
  check (motivo_rechazo is null or (gramos_entregados = 0 and not cerrada));
