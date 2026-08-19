-- 0075 — `posiciones` termina de nacer como CAPTURA del §4.6: idempotencia, caja de Chile,
-- doble reloj y fuente. [AC-FTEL-02]
--
-- Fuente: §4.6 (toda captura viaja con `client_uuid` y doble reloj, y el outbox drena en orden),
-- §4.2 (la regla de oro: una CAPTURA jamás rebota al sincronizar), §4 «Invariantes EN LA BD»
-- (`lat/lng Chile`, `capturas jamás rebotan`) y §11 / spec 09 §1, que describe la tabla entera.
--
-- La 0074 hizo nacer `posiciones` con lo MÍNIMO para que la privacidad del §7.8 fuera real desde
-- la primera fila, y dejó por escrito lo que le faltaba: «`client_uuid` único por tenant
-- (idempotencia del replay), `precision_m`, doble reloj (`tz_offset_min`), `fuente` enum, caja de
-- Chile — esas seis invariantes son AC-FTEL-02, con su propio pgTAP». Esto es exactamente eso.
--
-- ─── POR QUÉ ES UN ALTER Y NO UNA TABLA NUEVA ────────────────────────────────────────
--
-- `posiciones` ya vive en `tenant_template` y en cada `t_<slug>` desde la 0074 (la carpeta
-- `tenant/` se aplica a la plantilla Y a cada base de tenant, `db/migraciones-flota/LEEME.md`).
-- Recrearla sería una migración destructiva sobre filas que ya son hechos capturados; el §7.4 no
-- lo permite y el AC no lo pide: pide que la tabla de la plantilla TENGA las seis invariantes.
--
-- ─── POR QUÉ NINGUNA COLUMNA NUEVA SE RELLENA CON UPDATE ─────────────────────────────
--
-- Es la invariante 2 mordiéndose la cola, y conviene dejarlo escrito porque el próximo que agregue
-- una columna acá se va a topar con lo mismo: `posiciones` es append-only con TRIGGER, no solo con
-- REVOKE, así que un `update posiciones set …` de relleno rebota 42501 también para el migrador
-- (y para el superusuario). Toda columna NOT NULL nueva llega, entonces, con DEFAULT —que Postgres
-- resuelve en el ALTER, sin disparar triggers de fila— y las que no pueden tener un default honesto
-- llegan NULL para las filas viejas: `tz_offset_min` y `precision_m` son del TELÉFONO, y el
-- servidor no tiene de dónde inventarlos para una posición que ya aterrizó.

-- ─── 6ª invariante: la fuente es un enum CERRADO ─────────────────────────────────────
--
-- Hoy la única implementación viva es el teléfono del chofer (§11: «primero lo que no necesita
-- hardware»). El enum cerrado es lo que hace que una fuente nueva —OBD/OEM— sea una decisión
-- explícita con su `ALTER TYPE`, y no una cadena cualquiera que alguien escribe distinto en dos
-- lugares. QUÉ implementación está activa se resuelve por datos en el registro de
-- `ProveedorTelemetria` (AC-FTEL-06); esto es el tipo del dato, no el interruptor.
create type posicion_fuente as enum ('telefono_gps');

alter table posiciones
  -- Idempotencia del replay (§4.6). Nullable como en `devoluciones` (0046), `entregas` (0055) y
  -- `manifiestos` (0041): la fila que nace en el servidor no tiene client_uuid, y dos NULL no
  -- chocan en un UNIQUE. Quien lo trae es el outbox del teléfono, y ese es AC-FTEL-03.
  add column client_uuid   uuid,
  -- Precisión reportada por el GPS, en metros. Sin CHECK de máximo a propósito: precisión mala
  -- NUNCA bloquea (§4, «el pan no espera»); una posición imprecisa entra igual y es la torre de
  -- control quien decide qué hacer con ella (AC-FTEL-04).
  add column precision_m   double precision,
  -- Doble reloj, mitad del teléfono: el huso con el que ese aparato fechó la captura.
  add column tz_offset_min int,
  -- Doble reloj, mitad del servidor: cuándo aterrizó de verdad. Es el reloj que manda para
  -- negocio (§4), y el único que un teléfono con la hora adulterada no puede mover.
  add column recibida_en   timestamptz not null default now(),
  add column fuente        posicion_fuente not null default 'telefono_gps';

alter table posiciones
  -- Centinela 1 (§9.3.1): el replay doble del outbox deja EXACTAMENTE una fila por client_uuid.
  add constraint posiciones_client_uuid_unico unique (tenant_id, client_uuid),
  -- La caja de Chile (§4, invariantes EN LA BD; misma caja que `destinos` en la 0036).
  --
  -- Sí, es un CHECK que puede rebotar una captura, y el §4.2 dice que una captura jamás rebota.
  -- No hay contradicción y vale la pena el párrafo: lo que el §4.2 protege es el HECHO del mundo
  -- físico —la entrega ocurrió, el turno se abrió con poca batería— para que el chofer no tenga
  -- que decidir nada. Un punto en (0,0) no es un hecho del mundo físico: es la isla nula, el
  -- valor que un GPS sin fix devuelve por defecto, y aterrizarlo pondría al furgón en el golfo de
  -- Guinea en el mapa del gestor. El maestro lo pone en su lista de invariantes de BD con esas
  -- palabras («lat/lng Chile», y en `entregas`: «(0,0) rebota»), así que acá se cumple igual.
  add constraint posiciones_dentro_de_chile check (
    lat between -56.0 and -17.0 and lng between -110.0 and -66.0
  ),
  -- Una precisión negativa no es «mala precisión», es un dato roto.
  add constraint posiciones_precision_no_negativa check (precision_m is null or precision_m >= 0),
  -- El huso, acotado a los que existen en la Tierra (UTC−12 … UTC+14). Chile continental manda
  -- −240 (o −180 en horario de verano), pero el rango no se cierra a Chile: quien fecha es el
  -- APARATO, y un teléfono recién llegado del extranjero con el huso todavía sin actualizar
  -- captura igual — el §4.2 no deja que eso rebote, y el offset guardado es justo el dato que
  -- permite reconstruir después qué hora marcaba esa pantalla.
  add constraint posiciones_huso_de_la_tierra check (
    tz_offset_min is null or tz_offset_min between -720 and 840
  );

comment on column posiciones.client_uuid is
  'Idempotencia del replay (§4.6, centinela 1 del §9.3.1): el mismo punto reenviado por el outbox '
  'deja UNA fila. Lo genera el teléfono; NULL en las filas que nacen en el servidor. [AC-FTEL-02]';
comment on column posiciones.precision_m is
  'Precisión del GPS en metros, tal como la reportó el aparato. Sin techo: precisión mala jamás '
  'bloquea ni rebota (§4) — se muestra, no se castiga. [AC-FTEL-02]';
comment on column posiciones.capturada_en is
  'Doble reloj (§4.6), mitad del TELÉFONO: cuándo dijo el aparato que estaba ahí. Su DEFAULT '
  'sobrevive de la 0074 y es el puente mientras el motor de sync (AC-FTEL-03) no mande el reloj '
  'del teléfono en el lote. Un reloj adelantado NO rebota: es una captura (§4.2). [AC-FTEL-02]';
comment on column posiciones.recibida_en is
  'Doble reloj (§4.6), mitad del SERVIDOR: cuándo aterrizó. Es el que manda para negocio (§4) y '
  'el que la torre de control usa para la antigüedad del dato (AC-FTEL-04). [AC-FTEL-02]';
comment on column posiciones.tz_offset_min is
  'Huso con el que el teléfono fechó `capturada_en`, en minutos respecto de UTC (Chile: −240, o '
  '−180 en horario de verano). Sin él, `capturada_en` no se puede leer de vuelta. [AC-FTEL-02]';
comment on column posiciones.fuente is
  'De dónde salió el punto. Enum CERRADO: hoy solo el teléfono del chofer (§11). OBD/OEM entra '
  'con su ALTER TYPE el día que el dueño elija proveedor. [AC-FTEL-02]';
