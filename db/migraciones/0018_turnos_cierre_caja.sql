-- P0-4 (auditoría 1-ago-2026, decisión del dueño 1-ago-2026: "por turno, con apertura
-- explícita"): el cierre de caja calculaba lo ESPERADO por (dispositivo, día completo)
-- pero la unicidad del cierre —qué evita cerrar dos veces— era por (fecha, medio_pago,
-- VENDEDOR). Las dos mitades no hablan del mismo sujeto: con dos turnos en la misma
-- tablet el mismo día, a quien cierra en la tarde se le exige responder también por lo
-- que vendió la mañana, y si alguien cierra temprano, el segundo cierre del mismo
-- equipo quedaba sin cobertura real (mismo vendedor_id distinto = otra fila, con el
-- MISMO esperado del día completo otra vez).
--
-- "pan.turnos" da el sujeto correcto a los dos lados: lo esperado se acota a la VENTANA
-- del turno (desde que se abrió, en ESE dispositivo), y el cierre se llavea por el
-- mismo turno_id. No se toca pan.ventas: no hace falta saber qué turno vendió cada
-- línea individual para que la ventana de tiempo + dispositivo cierre el agujero — el
-- turno_id por venta (para trazabilidad fina) queda para cuando exista la pantalla de
-- apertura (Ola 2, docs/PROMPT_CORRECTIVO.md §5).
create table pan.turnos (
  id uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references pan.dispositivos (id),
  vendedor_id uuid not null references pan.usuarios (id),
  abierto_at timestamptz not null default now(),
  cerrado_at timestamptz,
  fondo_inicial_clp integer not null check (fondo_inicial_clp >= 0)
);

-- Un solo turno abierto por dispositivo a la vez — el mismo espíritu que
-- sesiones_operador (EXCLUDE) y rutas_una_activa_por_repartidor_dia: la BD, no la app,
-- es quien no deja abrir dos.
create unique index turnos_uno_abierto_por_dispositivo
  on pan.turnos (dispositivo_id)
  where cerrado_at is null;

create index turnos_dispositivo_abierto_at_idx on pan.turnos (dispositivo_id, abierto_at);

-- Mismo trigger que ya protege pan.ventas y pan.cierres_caja (0003, 0014): sin sesión
-- de operador viva no hay INSERT, y no solo porque la ruta llame exigirRol antes.
create trigger trg_turnos_exige_sesion
  before insert on pan.turnos
  for each row execute function pan.trg_exige_sesion('vendedor_id');

alter table pan.cierres_caja add column turno_id uuid references pan.turnos (id);

-- Reemplaza el índice de 0011: la unicidad ahora es por TURNO, no por (fecha,
-- vendedor) — dos turnos del mismo vendedor en dos días distintos son filas distintas
-- igual que antes, pero ahora un segundo turno el MISMO día (cambio de operador en la
-- tablet) tiene su PROPIO turno_id y por lo tanto su propia fila válida, en vez de
-- pisar la unicidad de quien cerró antes.
drop index if exists pan.cierres_caja_un_cierre_por_dia;
create unique index cierres_caja_un_cierre_por_turno
  on pan.cierres_caja (turno_id, medio_pago)
  where not anulado and turno_id is not null;

grant insert, update (cerrado_at) on pan.turnos to pan_app;
grant select on pan.turnos to pan_app;
grant update (turno_id) on pan.cierres_caja to pan_app; -- ya tenía insert de 0003/0011

-- Reversión:
-- drop index pan.cierres_caja_un_cierre_por_turno;
-- create unique index cierres_caja_un_cierre_por_dia on pan.cierres_caja (fecha, medio_pago, vendedor_id) where not anulado;
-- alter table pan.cierres_caja drop column turno_id;
-- drop table pan.turnos;
