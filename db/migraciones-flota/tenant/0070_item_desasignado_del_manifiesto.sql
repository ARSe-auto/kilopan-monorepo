-- 0070 — el ítem bajado del manifiesto desasigna su encargo, sin borrar la fila. [AC-FRUT-24]
--
-- La sub-decisión de Alexis del 11-ago-2026 (pregunta 1 de la spec 03): un ítem que se BAJA del
-- manifiesto sin DTE (AC-FRUT-08) no es una entrega fallida — la mercadería sigue en el andén, es
-- un contratiempo operativo. Su encargo NO cierra `no_entregado`; vuelve a la bandeja del día y es
-- re-planificable el MISMO día, sin `reintento_de` (eso queda para cuando el camión SALIÓ y no
-- entregó).
--
-- El problema es que `items` no se puede borrar una vez que tiene manifiesto: `manifiesto_items`
-- lo referencia y es append-only (§7.4, 0041), y el trigger `items_devuelven_su_encargo` de la
-- 0048 escucha `after delete on items`. Bajar del manifiesto no puede pasar por ahí sin destruir
-- la fila que el propio manifiesto necesita para conservar su historia completa (§4.5, §7.4).
--
-- La salida es una columna que MARCA el ítem fuera de la parada sin borrarlo, y una segunda mitad
-- del mismo trigger que reacciona a esa marca en vez de al DELETE.

alter table items add column desasignado_en timestamptz;

comment on column items.desasignado_en is
  'Cuándo se bajó el ítem del manifiesto sin DTE (AC-FRUT-08). NO se borra la fila -- '
  '`manifiesto_items` la referencia y es append-only (§7.4) -- se marca. Un ítem desasignado no '
  'cuenta como ítem vivo del encargo: dispara la misma vuelta a la bandeja que un DELETE '
  '(AC-FRUT-24).';

-- El trigger de la 0048 solo miraba si QUEDABAN filas para el encargo tras un DELETE. Ahora
-- también hay que excluir las marcadas desasignadas -- para el DELETE (la ruta se borró) esa fila
-- ya no existe y el filtro no cambia nada; para el UPDATE nuevo de abajo, la fila que se acaba de
-- marcar ya tiene `desasignado_en` puesto cuando el trigger AFTER corre, así que el `exists` la
-- excluye sola.
create or replace function encargo_devuelto_a_la_bandeja() returns trigger
  language plpgsql as $$
  begin
    if exists (
      select 1 from items where encargo_id = old.encargo_id and desasignado_en is null
    ) then
      return null;
    end if;
    update encargos set estado = 'aceptado'::encargo_estado
      where id = old.encargo_id and estado::text in ('asignado', 'publicado');
    return null;
  end
  $$;

-- La segunda mitad del gancho: el ítem que se marca desasignado devuelve su encargo a la bandeja,
-- igual que el DELETE de la 0048 -- misma función, mismo criterio, sin duplicar la lógica.
create trigger items_desasignados_devuelven_su_encargo
  after update of desasignado_en on items
  for each row
  when (old.desasignado_en is null and new.desasignado_en is not null)
  execute function encargo_devuelto_a_la_bandeja();
