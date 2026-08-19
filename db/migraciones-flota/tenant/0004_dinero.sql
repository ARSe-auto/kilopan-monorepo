-- 0004 — Dinero: redondeo único y el patrón de RLS del §4.8. [AC-FTEN-09] [AC-FTEN-21]
--
-- Ninguna tabla de montos nace en este módulo (§4.8: tarifas, liquidaciones, líneas, facturas,
-- pagos y costos de energía son de los hitos c y f). Lo que nace acá es lo que TODAS ellas
-- van a usar, una sola vez: la función de redondeo y la política, aplicable con una línea.

-- LA función de redondeo (§0 fila Dinero). Todo monto es CLP entero en unidad menor: no hay
-- centavos en Chile, así que un `numeric` con decimales en una columna de dinero no es
-- precisión, es un bug esperando el primer total que no cuadra.
--
-- Redondea alejándose del cero en el 0,5 —lo que hace `round()` de Postgres con `numeric`, y
-- lo que espera cualquiera que mire una boleta—, y es la ÚNICA: si mañana aparece un segundo
-- redondeo, dos partes del sistema dejan de coincidir por un peso y nadie sabe cuál manda.
create or replace function round_clp(monto numeric) returns bigint
  language sql immutable strict parallel safe
  as $$ select round(monto)::bigint $$;

comment on function round_clp(numeric) is
  'La ÚNICA función de redondeo de dinero del sistema (§0). CLP entero, sin decimales.';

-- EL PATRÓN DE RLS DE DINERO (§4.8), aplicable a cualquier tabla de montos con una línea.
--
-- Dos políticas, y las dos hacen falta:
--   · una PERMISSIVE de base, porque RLS sin ninguna política permisiva niega todo y la tabla
--     quedaría invisible para todo el mundo, no solo para el chofer;
--   · la RESTRICTIVE del §4.8, declarada `FOR SELECT` ÚNICAMENTE. Esto último es una
--     corrección explícita del maestro: una RESTRICTIVE total rebotaría el INSERT del cierre
--     de recarga del chofer, y el flujo del terreno JAMÁS rebota (§4.2). El chofer inserta su
--     captura con `costo_clp` NULL; el monto lo completa después el operador o un trigger.
--
-- El rol efectivo viaja en `app.current_role`, puesto con `set_config(..., true)` — SET LOCAL,
-- por transacción, jamás de sesión (§4.1, §7.2): en un pool, un SET de sesión se lo lleva la
-- siguiente transacción de otro usuario.
--
-- LA FALLA VA HACIA EL CIERRE, y hay que escribirlo: `app.current_role NOT IN (…)` a secas es
-- VERDADERO cuando nadie declaró el rol, así que una transacción que se olvidó de declararlo
-- vería todos los montos. El §7.2 obliga a declararlo en CADA transacción, o sea que no
-- declararlo es un bug — y ante un bug, una política de dinero niega. Además `current_setting`
-- devuelve CADENA VACÍA (no NULL) después de que la transacción que hizo el SET LOCAL
-- termina, así que el `nullif` sobre '' no es adorno: sin él, la transacción siguiente del
-- pool heredaría el permiso.
create or replace function aplicar_rls_de_dinero(tabla regclass) returns void
  language plpgsql as $$
  begin
    execute format('alter table %s enable row level security', tabla);
    execute format(
      'create policy dinero_base on %s as permissive for all using (true) with check (true)',
      tabla);
    execute format(
      $politica$
      create policy dinero_sin_chofer on %s
        as restrictive
        for select
        using (nullif(current_setting('app.current_role', true), '') is not null
           and nullif(current_setting('app.current_role', true), '')
               not in ('chofer', 'responsable_carga'))
      $politica$, tabla);
  end
  $$;

comment on function aplicar_rls_de_dinero(regclass) is
  'Aplica el patrón de RLS de dinero del §4.8 a una tabla de montos: RESTRICTIVE FOR SELECT '
  'únicamente, para que el chofer no VEA montos pero su captura con costo NULL igual entre.';
