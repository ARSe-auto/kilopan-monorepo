-- AC-ADM-05 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md; PROMPT_MAESTRO §3):
-- anular una venta desde /arreglar. El dueño tiene que poder deshacer una venta mal
-- registrada sin entrar a la base por SQL. Regla transversal de la sección: la anulación
-- se confirma escribiendo el MOTIVO —jamás una casilla— y deja su evento en pan.eventos
-- con quién, cuándo y en qué equipo. Ese evento lo escribe el endpoint (como parametros),
-- no un trigger; acá vive la columna que lo respalda y la regla de la BD.
--
-- anulada_at: NULL = vigente; timestamp = cuándo se anuló. Igual que saldado_at (0017),
-- NO se borra la venta ni se reescribe su monto — se marca encima (append-only, como el
-- POD con supersede_id). La venta anulada deja de sumar al arqueo porque las consultas de
-- lo esperado (GET y POST /api/cierre-caja) suman solo `where anulada_at is null`.
-- anulada_motivo queda en la fila además del evento: el arqueo de auditoría del dueño lee
-- la venta, no el log de eventos.
alter table pan.ventas add column anulada_at timestamptz;
alter table pan.ventas add column anulada_motivo text;

-- La regla «se confirma escribiendo el motivo» vive en la BD, no solo en el endpoint:
-- una anulación exige motivo no vacío, y sin anulación no puede haber motivo colgando.
-- Así el CHECK respalda al servidor en vez de confiar en que la pantalla obligue a escribir.
alter table pan.ventas add constraint ventas_anulada_exige_motivo
  check (
    (anulada_at is null and anulada_motivo is null)
    or (anulada_at is not null and anulada_motivo is not null and length(btrim(anulada_motivo)) > 0)
  );

grant update (anulada_at, anulada_motivo) on pan.ventas to pan_app;

-- Reversión:
-- alter table pan.ventas drop constraint ventas_anulada_exige_motivo;
-- alter table pan.ventas drop column anulada_motivo;
-- alter table pan.ventas drop column anulada_at;
