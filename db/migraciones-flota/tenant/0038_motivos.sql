-- 0038 — El catálogo de motivos: la guarda del borrado, el sembrado y su FK. [AC-FRUT-13]
--
-- La tabla ya existe: nació en la 0030 con el cierre forzado, porque ahí se la necesitó primero
-- (AC-FVEH-22). Lo que aquel AC dejó escrito en un comentario —«se apagan, jamás DELETE»— es lo
-- que este completa: una regla que solo vive en prosa se rompe el martes que alguien escriba la
-- consulta equivocada.
--
-- ─── POR QUÉ EL DELETE TIENE QUE ESTAR PROHIBIDO DE VERDAD ─────────────────────────
--
-- Un motivo no es una opción de un menú: es la explicación que quedó escrita en un acto que ya
-- ocurrió. Borrar «local cerrado» del catálogo porque este año no se usa deja sin sentido todas
-- las no-entregas del año pasado que lo referencian — y esas filas son las que sostienen la
-- disputa cuando el cliente reclama, el devengo de la línea `por_devolucion` (§3.E1.9) y la señal
-- de custodia del semáforo.
--
-- No alcanza con un REVOKE, y por eso va un trigger: el catálogo lo administra el propio tenant y
-- necesita UPDATE para apagar una fila, así que la puerta queda abierta y lo único que hay que
-- cerrar es el borrado.
--
-- ─── `require_notes` SE EXIGE EN EL CLIENTE, Y NO ES UNA CONCESIÓN ────────────────
--
-- El §4.2 es la regla de oro: la validación bloqueante corre en el CLIENTE contra el snapshot, y
-- la CAPTURA jamás rebota al sincronizar. Un motivo que exige nota se pide en la pantalla, con el
-- camión detenido y la persona ahí; si esa captura igual llega sin nota por sync —porque el
-- aparato venía de antes de que se encendiera la exigencia—, entra 2xx con su flag. El mundo
-- físico ya ocurrió: rebotarlo sería perder la única constancia de que la entrega falló.
--
-- Por eso acá NO se agrega un CHECK que exija la nota. No es un olvido: es la regla.

/**
 * El DELETE de un motivo se rechaza, siempre y para todos.
 *
 * El mensaje nombra la vía correcta porque quien intenta borrar quiere sacarlo de la lista, y eso
 * sí se puede: `activo = false` lo saca de los flujos nuevos y deja la historia entera intacta.
 */
create or replace function rechazar_borrado_de_motivo() returns trigger
  language plpgsql as $$
  begin
    raise exception 'un motivo se APAGA (activo = false), jamás se borra: los actos que lo '
                    'referencian se quedarían sin explicación (§4.5)'
      using errcode = 'insufficient_privilege';
  end;
  $$;

create trigger motivos_no_se_borran
  before delete on motivos
  for each row execute function rechazar_borrado_de_motivo();

/**
 * Siembra el catálogo desde `vertical_template.motivos[]` (§4.4).
 *
 * Idempotente por código: el alta de un tenant y el cambio de vertical la llaman más de una vez,
 * y una segunda corrida no puede duplicar la lista ni pisar el orden que el tenant ya ajustó.
 *
 * Un motivo que el vertical ya NO trae no se toca. Es la misma razón del trigger: si desapareciera
 * al resembrar, los actos que lo referencian se quedarían sin explicación. Se apaga a mano, que es
 * la vía que hay.
 *
 * La etiqueta nace del código, con la primera letra en mayúscula y los guiones bajos en espacios:
 * `local_cerrado` se ve «Local cerrado». No es una traducción —el tenant puede después ponerle el
 * nombre que use su operación— pero es legible desde el primer día, y una lista de códigos crudos
 * en la pantalla de quien está en la calle se elige al azar.
 *
 * `estado_asociado` se siembra en `parada_fallida`: es lo que significa un motivo del catálogo de
 * un vertical de reparto (§4.5) y lo que el módulo 04 va a consultar. Los del cierre forzado los
 * escribe su propio flujo con su propio estado.
 */
create or replace function sembrar_motivos(el_vertical text) returns int
  language plpgsql as $$
  declare
    sembrados int;
  begin
    with del_vertical as (
      select codigo, row_number() over () as n
        from vertical_template v, unnest(v.motivos) as codigo
       where v.vertical = el_vertical
    )
    insert into motivos (codigo, etiqueta, estado_asociado, orden)
    select codigo,
           upper(left(replace(codigo, '_', ' '), 1)) || substr(replace(codigo, '_', ' '), 2),
           'parada_fallida',
           n
      from del_vertical
      on conflict (tenant_id, codigo) do nothing;
    get diagnostics sembrados = row_count;
    return sembrados;
  end;
  $$;

comment on function sembrar_motivos(text) is
  'Copia `vertical_template.motivos[]` al catálogo del tenant (§4.4). Idempotente: una segunda '
  'corrida no duplica ni reordena, y jamás borra un motivo que el vertical dejó de traer.';

-- La FK que `paradas` dejó anotada en la 0037 («sin FK todavía: `motivos` es AC-FRUT-13»).
alter table paradas
  add constraint paradas_motivo_fk
  foreign key (tenant_id, motivo_id) references motivos (tenant_id, id);

-- El índice que esa FK necesita: sin él, apagar un motivo escanearía las paradas de la historia
-- entera (§9.2).
create index paradas_tenant_motivo_idx on paradas (tenant_id, motivo_id);

comment on column motivos.require_notes is
  'La nota se exige en el CLIENTE contra el snapshot (§4.2). NO hay CHECK a propósito: una '
  'captura que llegue sin nota entra igual con su flag — el mundo físico ya ocurrió.';

comment on column motivos.activo is
  'Apagado sale de los flujos NUEVOS y deja la historia intacta (§4.5). El DELETE lo rechaza el '
  'trigger `motivos_no_se_borran`, también para el rol de la app.';

insert into evento_tipo (codigo, descripcion) values
  ('motivo.apagado',   'Se apagó un motivo del catálogo: sale de los flujos nuevos'),
  ('motivo.encendido', 'Se volvió a encender un motivo del catálogo');
