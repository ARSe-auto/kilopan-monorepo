-- AC-ADM-06 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md; PROMPT_MAESTRO §3):
-- corregir un cierre de turno desde /arreglar. pan.cierres_caja (0003) guarda una fila
-- por medio de pago cuando se cierra un turno (0018); si el vendedor declaró mal un
-- monto, hoy no hay forma de arreglarlo sin SQL directo, y editar la fila original
-- dejaría un arqueo que cambia sin dejar rastro — indistinguible de un faltante tapado.
--
-- Mismo patrón que pan.entregas (POD, 0004): la corrección es una fila NUEVA que apunta
-- a la original con supersede_id, jamás un UPDATE. Ambas quedan legibles.
alter table pan.cierres_caja add column supersede_id uuid references pan.cierres_caja (id);
alter table pan.cierres_caja add column correccion_motivo text;

-- Misma regla que ventas_anulada_exige_motivo (0020): la corrección se confirma
-- ESCRIBIENDO el motivo, respaldado en la BD, no solo en el endpoint.
alter table pan.cierres_caja add constraint cierres_caja_correccion_exige_motivo
  check (
    (supersede_id is null and correccion_motivo is null)
    or (supersede_id is not null and correccion_motivo is not null and length(btrim(correccion_motivo)) > 0)
  );

-- Un cierre corregido admite UNA sola corrección encima (no dos ediciones sueltas
-- corrigiendo lo mismo a ciegas una de otra): doble-tap sobre /api/cierre-caja/corregir
-- rebota acá, igual que cierres_caja_un_cierre_por_turno rebota el doble cierre.
create unique index cierres_caja_una_correccion_por_original
  on pan.cierres_caja (supersede_id) where supersede_id is not null;

-- cierres_caja_un_cierre_por_turno (0018) exigía una fila por (turno, medio_pago) sin
-- saber que ahora una segunda fila del mismo turno y medio puede ser una CORRECCIÓN, no
-- un cierre duplicado. Se agrega "supersede_id is null" para que la unicidad siga
-- protegiendo solo contra dos cierres originales del mismo turno, y una corrección pueda
-- convivir con la fila que corrige.
drop index pan.cierres_caja_un_cierre_por_turno;
create unique index cierres_caja_un_cierre_por_turno
  on pan.cierres_caja (turno_id, medio_pago)
  where not anulado and turno_id is not null and supersede_id is null;

-- Inmutable una vez insertada: ni el cierre original ni una corrección se editan o
-- borran después. Mismo patrón que trg_pod_inmutable (0004).
create or replace function pan.trg_cierre_caja_inmutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'delete' then
    raise exception 'un cierre de caja jamás se borra: corregir es insertar otra fila con supersede_id (AC-ADM-06)';
  end if;
  raise exception 'el cierre de caja % ya existe: corregir es insertar otra fila con supersede_id, no editar esta (AC-ADM-06)', old.id;
end;
$$;
create trigger trg_cierres_caja_inmutable
  before update or delete on pan.cierres_caja
  for each row execute function pan.trg_cierre_caja_inmutable();

-- Reversión:
-- drop trigger trg_cierres_caja_inmutable on pan.cierres_caja;
-- drop function pan.trg_cierre_caja_inmutable();
-- drop index pan.cierres_caja_un_cierre_por_turno;
-- create unique index cierres_caja_un_cierre_por_turno on pan.cierres_caja (turno_id, medio_pago) where not anulado and turno_id is not null;
-- drop index pan.cierres_caja_una_correccion_por_original;
-- alter table pan.cierres_caja drop constraint cierres_caja_correccion_exige_motivo;
-- alter table pan.cierres_caja drop column correccion_motivo;
-- alter table pan.cierres_caja drop column supersede_id;
