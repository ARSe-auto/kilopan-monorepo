-- 0018 — `turnos`: el vehículo-día del §4.5, con su EXCLUDE de solape. [AC-FVEH-06]
--
-- Es la tabla de la que sale el DENOMINADOR de la EEVD (§2): vehículos-día con turno abierto.
-- Y es la que congela la configuración con la que corre una jornada entera (§4.4).
--
-- ─── POR QUÉ EL SOLAPE SE IMPIDE EN LA BASE Y NO EN UN `SELECT` PREVIO ───────────────
--
-- El centinela 5 del §9.3 pide que el solape de agenda REBOTE. Un chequeo en el servidor
-- —«¿hay otro turno abierto de este vehículo?»— es una carrera: dos aperturas simultáneas
-- pasan las dos por el hueco y el vehículo queda con dos jornadas vivas, dos odómetros y dos
-- vehículos-día para la EEVD. El EXCLUDE lo decide PostgreSQL, que es el único que ve las dos.
--
-- ─── EL RANGO ES ABIERTO HACIA ADELANTE MIENTRAS EL TURNO NO CIERRE ─────────────────
--
-- `periodo` se genera de `abierto_en`/`cerrado_en`: con el cierre en NULL el rango llega hasta
-- el infinito, así que un turno abierto bloquea cualquier otro del mismo vehículo hasta que se
-- cierre. Es la conducta correcta y no un efecto colateral: un camión con jornada abierta no
-- puede empezar otra, y el §5.6 tiene una señal propia —«turno sin cerrar»— justamente porque
-- eso pasa y hay que resolverlo (KR-41, AC-FVEH-22), no taparlo dejando abrir el siguiente.
--
-- ─── LO QUE ESTE AC NO CIERRA, Y NO SE INVENTA ──────────────────────────────────────
--
-- La pregunta 6 de la spec 02 sigue abierta: el §4.2 no lista `turnos` ni en PLANIFICACIÓN ni
-- en CAPTURA, y si la apertura del chofer pudiera ocurrir OFFLINE, un solape detectado recién
-- al sincronizar tendría que decidir entre rebotar (planificación) o entrar con flag (captura).
-- Acá se construye SOLO la vía online, que es la que el maestro sí cierra con el centinela 5;
-- la clase declarada es PLANIFICACIÓN por el EXCLUDE, y el día que el dueño responda, la
-- cláusula del sync se agrega con su propio AC. Nada de este DDL prejuzga esa respuesta: un
-- turno que entrara por sync con flag usaría esta misma tabla.

-- El EXCLUDE mezcla igualdad de uuid con solape de rango, y eso lo hace GiST — que sin esta
-- extensión no sabe comparar uuid por igualdad. `btree_gist` es confiable (trusted) desde
-- PostgreSQL 13, así que la instala el rol `migrator` sin superusuario, y viaja a cada BD de
-- tenant con el `CREATE DATABASE … TEMPLATE` de la provisión (§4.1).
create extension if not exists btree_gist;

-- Los tres estados que este AC necesita. El cierre forzado del KR-41 (AC-FVEH-22) agrega el
-- suyo cuando llegue: tiene que ser DISTINGUIBLE de un cierre real para liquidación y
-- reportes, y meterlo hoy sería fabricar la mitad de un acto que todavía no existe.
create type turno_estado as enum ('abierto', 'cerrado', 'anulado');

-- El semáforo de salida del §5.2-F3, persistido con el turno. Los dos primeros son los del
-- maestro, literales («Alcanza / No alcanza — recarga antes»); el tercero es el que exige la
-- degradación del AC-FVEH-12 — un vehículo sin datos EV cargados no da «no alcanza», da un
-- estado vacío accionable, y confundirlos haría que la pantalla mintiera sobre un camión que
-- quizás llega de sobra. Quién lo escribe y con qué fórmula es de AC-FVEH-10.
create type semaforo_de_salida as enum ('alcanza', 'no_alcanza', 'sin_datos');

create table turnos (
  id                   uuid         not null default uuidv7(),
  tenant_id            uuid         not null default tenant_actual() check (tenant_id = tenant_actual()),
  vehiculo_id          uuid         not null,
  -- NOT NULL y no «se llena después»: el §4.4 dice que un turno corre entero con UNA versión.
  -- Un turno sin versión es un turno cuyas reglas nadie puede reconstruir mañana.
  config_version_id    uuid         not null,
  estado               turno_estado not null default 'abierto',
  abierto_en           timestamptz  not null default now(),
  cerrado_en           timestamptz,
  semaforo_salida      semaforo_de_salida,
  -- «¿Quedó enchufado?» del cierre F5 (§5.2-F5). NULL mientras el turno no cierre: no es lo
  -- mismo «no lo dejó enchufado» que «todavía no se preguntó», y el rojo del Anexo B se
  -- apoya en esa diferencia.
  enchufado_confirmado boolean,
  periodo              tstzrange    not null
    generated always as (tstzrange(abierto_en, cerrado_en)) stored,
  primary key (id),
  unique (tenant_id, id),
  foreign key (tenant_id, vehiculo_id) references vehiculos (tenant_id, id),
  foreign key (tenant_id, config_version_id) references config_version (tenant_id, id),
  -- El cierre y el estado no pueden contarse dos historias distintas.
  constraint turnos_cierre_coherente check (
    (estado = 'abierto' and cerrado_en is null)
    or (estado = 'cerrado' and cerrado_en is not null and cerrado_en > abierto_en)
    or (estado = 'anulado' and (cerrado_en is null or cerrado_en > abierto_en))
  ),
  -- El centinela 5, en la base. El `WHERE` es el del §4.5, literal: un turno ANULADO no ocupa
  -- el día del vehículo — si lo ocupara, un error de apertura dejaría al camión sin poder
  -- trabajar esa jornada y la única salida sería borrar un hecho, que el §7.4 prohíbe.
  constraint turnos_sin_solape exclude using gist (
    tenant_id with =, vehiculo_id with =, periodo with &&
  ) where (estado <> 'anulado')
);

-- Los dos índices que las FK compuestas necesitan por su cuenta: PostgreSQL no indexa una FK
-- sola, y sin esto cada desactivación de vehículo o cada lectura de una versión de config
-- haría un scan completo de los turnos.
create index turnos_tenant_vehiculo_idx on turnos (tenant_id, vehiculo_id, abierto_en desc);
create index turnos_tenant_config_idx on turnos (tenant_id, config_version_id);
-- Y el que sirve al denominador de la EEVD: los turnos de una semana, por estado.
create index turnos_tenant_abierto_idx on turnos (tenant_id, abierto_en desc, estado);

comment on table turnos is
  'PLANIFICACIÓN — el vehículo-día del §4.5. La apertura ONLINE rebota 422 con 0 filas si '
  'solapa con otro turno vivo del mismo vehículo (centinela 5 §9.3). La vía OFFLINE queda '
  'abierta en la pregunta 6 de la spec 02 y no se prejuzga acá.';

comment on column turnos.periodo is
  'Rango generado de `abierto_en` a `cerrado_en`. Con el cierre en NULL llega al infinito: un '
  'turno abierto bloquea el siguiente del mismo vehículo hasta que alguien lo cierre.';

create trigger turnos_auditar
  after insert or update or delete on turnos
  for each row execute function auditar();

-- El acto de abrir una jornada es del terreno, no del panel del dueño, así que su evento no
-- lleva el prefijo `gobierno.`: la auditoría de accesos del §3.E1.15 filtra por ese prefijo y
-- mezclarlos ahogaría los actos de gobierno bajo un turno por vehículo y por día.
insert into evento_tipo (codigo, descripcion) values
  ('turno.abierto', 'Se abrió el turno de un vehículo para la jornada');
