-- 0027 — `energy_entry`: el cierre de una sesión de recarga. [AC-FVEH-08]
--
-- El §3.E1.4 dice que la recarga es PLAN **y** CAPTURA, y las dos mitades tienen conductas
-- opuestas: como plan es un bloque de agenda y rebota por solape (0021, AC-FVEH-07); como
-- captura, el cierre de la sesión JAMÁS rebota. El vehículo ya se cargó — negarle la fila al
-- chofer no descarga la batería.
--
-- ─── EL ENUM VA COMPLETO AUNQUE `fuel` NO TENGA FLUJO ──────────────────────────────
--
-- El §4.6 lo escribe `type fuel|charge` y así queda. `fuel` no tiene flujo en E1 —la flota es
-- eléctrica— pero el enum es del maestro y no de este módulo: agregarle un valor después
-- obliga a un `ALTER TYPE` en producción sobre una tabla append-only, y ese día alguien va a
-- proponer «mientras tanto guardémoslo como charge».
--
-- ─── CERO CAMPOS MONETARIOS EN EL FLUJO DEL CHOFER (§4.8) ──────────────────────────
--
-- `costo_clp` es NULLABLE y el chofer nunca lo manda: lo completa el trigger desde
-- `parametros.tarifa_kwh_clp`, o el operador a mano. La diferencia con «que el chofer no lo
-- vea en la pantalla» es todo el §4.8: acá el dato no le llega, porque la RLS RESTRICTIVE
-- FOR SELECT se lo saca de toda consulta (centinela 10 §9.3).
--
-- Y la RLS es SOLO de SELECT, no de INSERT. Es la parte contraintuitiva y la que el §4.8 pide
-- con todas las letras: el chofer TIENE que poder escribir su sesión de recarga —es su
-- captura— y lo que no puede es leer el monto que el trigger le puso después.
--
-- ─── LA ENERGÍA EN Wh ENTEROS (§0) ────────────────────────────────────────────────
--
-- Nada de kWh decimales: el §0 fija Wh `int` para toda la plataforma. Un `numeric` acá sería
-- el primer total de kilovatios que no cuadra por un redondeo, y el reporte de ahorro vs
-- diésel del Anexo A se calcula sobre esta columna.

create type energia_tipo as enum ('fuel', 'charge');

create table energy_entry (
  id             uuid         not null default uuidv7(),
  tenant_id      uuid         not null default tenant_actual() check (tenant_id = tenant_actual()),
  vehiculo_id    uuid         not null,
  turno_id       uuid,
  type           energia_tipo not null,
  -- Energía cargada, en Wh enteros (§0). El nombre lleva la unidad para que nadie tenga que
  -- adivinar si son kWh: la mitad de los errores de energía son de factor mil.
  wh             int          not null,
  soc_inicial    smallint,
  soc_final      smallint,
  -- El chofer JAMÁS lo manda (§4.8). Lo completa el trigger desde `parametros.tarifa_kwh_clp`,
  -- o el operador a mano cuando la boleta dice otra cosa.
  costo_clp      bigint,
  ts_dispositivo timestamptz  not null,
  tz_offset_min  int          not null,
  record_time    timestamptz  not null default now(),
  client_uuid    uuid,
  primary key (id),
  unique (tenant_id, id),
  -- Idempotencia del replay del outbox (centinela 1 §9.3).
  unique (tenant_id, client_uuid),
  foreign key (tenant_id, vehiculo_id) references vehiculos (tenant_id, id),
  foreign key (tenant_id, turno_id) references turnos (tenant_id, id),
  constraint energy_entry_wh_positivo check (wh > 0),
  constraint energy_entry_soc_en_rango check (
    (soc_inicial is null or soc_inicial between 0 and 100)
    and (soc_final is null or soc_final between 0 and 100)
  ),
  constraint energy_entry_costo_no_negativo check (costo_clp is null or costo_clp >= 0)
);
create index energy_entry_tenant_vehiculo_idx on energy_entry (tenant_id, vehiculo_id, record_time desc);
create index energy_entry_tenant_turno_idx on energy_entry (tenant_id, turno_id);

comment on table energy_entry is
  'CAPTURA — cierre de una sesión de recarga (§3.E1.4, §4.6). Jamás rebota al sincronizar: el '
  'vehículo ya se cargó. El chofer no manda ni ve el costo (§4.8, centinela 10 §9.3).';

comment on column energy_entry.wh is
  'Energía en Wh ENTEROS (§0). El nombre lleva la unidad porque la mitad de los errores de '
  'energía son de factor mil, y el ahorro vs diésel del Anexo A se calcula sobre esta columna.';

create trigger energy_entry_append_only
  before update or delete on energy_entry
  for each row execute function rechazar_mutacion_de_hecho();
create trigger energy_entry_append_only_truncate
  before truncate on energy_entry
  for each statement execute function rechazar_mutacion_de_hecho();

/**
 * Completa el costo desde la tarifa del tenant, si hay tarifa y si nadie lo mandó.
 *
 * Corre BEFORE INSERT y no en el servidor por una razón concreta del §4.8: el costo tiene que
 * quedar escrito en la MISMA transacción que la captura, y el flujo que la escribe es el del
 * chofer — que no puede leer montos. Si el cálculo viviera en el servidor, la app tendría que
 * leer la tarifa para escribirla, y esa lectura es exactamente la que la RLS le niega.
 *
 * `round_clp` es la única forma de llegar a un peso en esta base (§0, §4.8): en CLP no hay
 * centavos, y el decimal aparece recién en el primer total que no cuadra.
 */
create or replace function costo_de_energia() returns trigger
  language plpgsql as $$
  declare
    v_tarifa bigint;
  begin
    if new.costo_clp is not null then
      return new;
    end if;
    select tarifa_kwh_clp into v_tarifa from parametros;
    if v_tarifa is null then
      -- Sin tarifa configurada el costo queda NULO, y eso es correcto: un cero se sumaría a los
      -- totales como si la energía hubiera sido gratis. Lo completa el operador con la boleta.
      return new;
    end if;
    new.costo_clp := round_clp((new.wh::numeric / 1000) * v_tarifa);
    return new;
  end
  $$;

comment on function costo_de_energia() is
  'Completa `energy_entry.costo_clp` desde `parametros.tarifa_kwh_clp` (§4.8). Corre en la BD '
  'porque la escritura la hace el chofer, que no puede LEER la tarifa (centinela 10).';

create trigger energy_entry_costo
  before insert on energy_entry
  for each row execute function costo_de_energia();

-- La RLS de dinero del §4.8, con el patrón que AC-FTEN-21 dejó en una función: RESTRICTIVE
-- FOR SELECT únicamente. El chofer escribe su sesión y no ve el monto que el trigger le puso.
select aplicar_rls_de_dinero('energy_entry');

insert into evento_tipo (codigo, descripcion) values
  ('energia.sesion_cerrada', 'Se cerró una sesión de recarga con su energía declarada');
