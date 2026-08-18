-- 0074 — Privacidad del rastreo: `posiciones` nace y SOLO nace con turno abierto [AC-FTEL-01]
--
-- Fuente: §7.8 (Ley 21.719, minimización — la base de licitud es la ejecución del contrato) y
-- §11 (la posición en vivo del teléfono del chofer, spec 09).
--
-- ─── POR QUÉ ES UN TRIGGER Y NO UN CHECK ─────────────────────────────────────────────
--
-- «Solo con turno abierto» compara `posiciones` contra el ESTADO de OTRA fila (`turnos.estado`),
-- y un CHECK de PostgreSQL no puede mirar otra tabla. El AC lo pide con esas palabras — «INSERT
-- con turno cerrado rebota en BD»— así que la guarda tiene que vivir en un trigger BEFORE INSERT,
-- el mismo patrón que ya usan `encargo_guarda_de_estados` (0048) y `liquidacion_guarda_de_estados`
-- (0065) para rebotar contra el estado de una fila relacionada.
--
-- ─── LO QUE ESTE AC NO CONSTRUYE, Y NO SE ADELANTA ───────────────────────────────────
--
-- La spec 09 describe `posiciones` completa —`client_uuid` único por tenant (idempotencia del
-- replay), `precision_m`, doble reloj (`tz_offset_min`), `fuente` enum, caja de Chile— y esas
-- seis invariantes son AC-FTEL-02, con su propio pgTAP. Acá nace solo lo mínimo para que la
-- privacidad del §7.8 sea de verdad desde la primera fila: quién capturó qué punto y cuándo, con
-- el turno que lo autoriza. `entra por el motor de sync existente` (outbox, replay) es AC-FTEL-03
-- y tampoco se adelanta: este AC no toca `/api/sync/capturas`.

create table posiciones (
  id           uuid             not null default uuidv7(),
  tenant_id    uuid             not null default tenant_actual() check (tenant_id = tenant_actual()),
  turno_id     uuid             not null,
  lat          double precision not null,
  lng          double precision not null,
  capturada_en timestamptz      not null default now(),
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, turno_id) references turnos (tenant_id, id)
);

-- El índice que la FK compuesta necesita por su cuenta (Postgres no indexa una FK sola), y de
-- paso el que encabeza con `tenant_id` que pide la exigencia #3 de `LEEME.md`.
create index posiciones_tenant_turno_idx on posiciones (tenant_id, turno_id, capturada_en desc);

comment on table posiciones is
  'CAPTURA — la posición en vivo del §11. Nace SOLO durante un turno abierto (§7.8): el trigger '
  'posiciones_exige_turno_abierto rebota con 0 filas cualquier INSERT contra un turno que no '
  'esté abierto [AC-FTEL-01].';

-- El hecho es append-only, como todo lo que este maestro clasifica CAPTURA (§7.4) — mismo
-- patrón que `reading` (0006): jamás se corrige una posición ya aterrizada, se deja que la
-- siguiente capture la realidad de ahora.
create trigger posiciones_append_only
  before update or delete on posiciones
  for each row execute function rechazar_mutacion_de_hecho();
create trigger posiciones_append_only_truncate
  before truncate on posiciones
  for each statement execute function rechazar_mutacion_de_hecho();

create or replace function posiciones_exige_turno_abierto() returns trigger
  language plpgsql as $$
  declare
    v_estado turno_estado;
  begin
    select estado into v_estado from turnos where tenant_id = new.tenant_id and id = new.turno_id;

    if v_estado is distinct from 'abierto' then
      raise exception
        'posiciones: el turno % no está abierto — la privacidad del rastreo (§7.8) exige turno '
        'abierto para capturar una posición. El chofer deja de ser rastreado en cuanto cierra.',
        new.turno_id
        using errcode = 'check_violation';
    end if;

    return new;
  end
  $$;

comment on function posiciones_exige_turno_abierto() is
  'Guarda de privacidad del §7.8 [AC-FTEL-01]: sin turno abierto, ninguna posición aterriza.';

create trigger posiciones_exige_turno_abierto
  before insert on posiciones
  for each row execute function posiciones_exige_turno_abierto();
