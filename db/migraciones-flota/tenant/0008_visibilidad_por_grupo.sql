-- 0008 — Visibilidad por grupos jerárquicos: el MECANISMO (§3.E1.1, §4.4). [AC-FTEN-27]
--
-- Estuvo bloqueado hasta el 09-ago-2026, cuando el dueño cerró las cuatro partes que faltaban
-- (Pregunta 12) y el AC se reescribió antes de implementarse, como la propia spec exigía:
--
--   (a) se adscriben a un grupo VEHÍCULOS y USUARIOS, nada más;
--   (b) filtran por grupo el tablero «Hoy», la bandeja de encargos y el inventario;
--   (c) compone con el rol por INTERSECCIÓN — el rol define QUÉ acciones, el grupo QUÉ filas;
--   (d) un usuario pertenece a UN grupo y ve su nodo Y TODOS SUS DESCENDIENTES.
--
-- Este módulo entrega el mecanismo, no las pantallas: ninguna de las tres superficies existe
-- en el hito (a). Las tablas adscribibles tampoco —`vehiculos` es del hito c y `usuarios` del
-- b—, así que lo que nace acá es la función de alcance y una política aplicable con UNA línea,
-- igual que `aplicar_rls_de_dinero()` de AC-FTEN-21. Los módulos que creen esas tablas la
-- enganchan y corren su e2e.

/**
 * El alcance de un grupo: su nodo Y todos sus descendientes (§4.4, respuesta P12(d)).
 *
 * Recursiva hacia ABAJO. El árbol ya no puede tener ciclos —lo impide el trigger de
 * AC-FTEN-12—, pero el `union` de un `with recursive` corta igual por duplicados, así que un
 * árbol corrupto haría que esto termine en vez de colgarse.
 */
create or replace function grupos_en_alcance(p_grupo uuid) returns setof uuid
  language sql stable
  as $$
    with recursive rama as (
      select id from grupos where id = p_grupo
      union
      select g.id from grupos g join rama r on g.padre_id = r.id
    )
    select id from rama
  $$;

comment on function grupos_en_alcance(uuid) is
  'El nodo y todos sus descendientes (§4.4). Es lo que hace que la visibilidad HEREDE hacia '
  'abajo: un usuario del nodo norte ve norte y todo lo que cuelga de él.';

/**
 * EL PATRÓN DE VISIBILIDAD POR GRUPO, aplicable a cualquier tabla con `grupo_id` con una línea.
 *
 * Tres decisiones que están en la política y conviene leer antes que el SQL:
 *
 *  1. **Una fila SIN grupo la ve cualquiera.** El grupo acota, no esconde: si adscribir fuera
 *     obligatorio para ser visible, el día que alguien crea un vehículo sin asignarle grupo el
 *     vehículo desaparece del inventario y nadie entiende por qué. La falla no puede ser
 *     perder datos de vista.
 *  2. **Una transacción que NO declaró su grupo no ve filas adscritas.** El §7.2 obliga a
 *     declarar el contexto en CADA transacción con `set_config(..., true)`; no declararlo es
 *     un bug, y ante un bug el filtro se aplica en vez de desaparecer. Es la misma falla hacia
 *     el cierre que la RLS de dinero de AC-FTEN-21.
 *  3. **Es RESTRICTIVE y FOR SELECT.** Restrictiva porque se compone por AND con lo que ya
 *     haya —la intersección con el rol del punto (c) es literalmente eso— y solo de lectura
 *     porque el grupo define QUÉ FILAS se ven, no qué acciones se pueden hacer: eso es del
 *     rol. Una restrictiva total rebotaría la captura de un chofer sobre un vehículo de otro
 *     grupo, y el flujo del terreno jamás rebota (§4.2).
 */
create or replace function aplicar_visibilidad_por_grupo(tabla regclass) returns void
  language plpgsql as $$
  begin
    execute format('alter table %s enable row level security', tabla);
    execute format(
      'create policy grupo_base on %s as permissive for all using (true) with check (true)',
      tabla);
    execute format(
      $politica$
      create policy grupo_alcance on %s
        as restrictive
        for select
        using (
          grupo_id is null
          or grupo_id in (
            select grupos_en_alcance(
              nullif(current_setting('app.current_grupo', true), '')::uuid))
        )
      $politica$, tabla);
  end
  $$;

comment on function aplicar_visibilidad_por_grupo(regclass) is
  'Aplica la visibilidad por grupo del §4.4 a una tabla con `grupo_id`: RESTRICTIVE FOR SELECT, '
  'herencia hacia los descendientes, y las filas sin grupo visibles para cualquiera.';
