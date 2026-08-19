-- 0077 — `telefono_gps` entra al registro por datos de ProveedorTelemetria (§4.9, §11). [AC-FTEL-06]
--
-- E1 admitía UNA sola implementación: `declarada` (el chofer tecleando SOC/odómetro,
-- `EV.fuente_por_defecto`). La enmienda §11 (E1.5, 18-ago-2026) suma `telefono_gps` como
-- segunda implementación REAL: el teléfono del chofer ya trae GPS y no exige hardware, a
-- diferencia de OBD/OEM que sigue como punto de extensión (§3-FUERA) hasta que el dueño elija
-- proveedor (Pregunta 1 de la spec 09).
--
-- El mecanismo es el mismo del §4.9: un vertical —acá, una implementación— es una FILA, jamás
-- una migración ni un cambio de pantalla. `activo` es la palanca: activar o desactivar una
-- implementación es un UPDATE de esta tabla, cero código de pantalla tocado (§4.6).
--
-- El `codigo` va con CHECK cerrado a las DOS implementaciones que E1.5 admite, a propósito: es
-- la misma frontera que vigila `db/flota/gate-ganchos-e1.mjs` del lado del código-fuente, para
-- que OBD/OCPP/api_fabricante/sonda_vehiculo no entren «por la puerta de atrás» ni siquiera como
-- una fila inactiva.

create table proveedor_telemetria (
  id        uuid    not null default uuidv7(),
  tenant_id uuid    not null default tenant_actual() check (tenant_id = tenant_actual()),
  codigo    text    not null check (codigo in ('declarada', 'telefono_gps')),
  nombre    text    not null,
  activo    boolean not null default false,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, codigo)
);
create index proveedor_telemetria_tenant_codigo_idx on proveedor_telemetria (tenant_id, codigo);
comment on table proveedor_telemetria is
  'PLANIFICACIÓN — el registro por datos de las implementaciones de ProveedorTelemetria (§4.9, '
  '§11). Activar/desactivar una es un UPDATE de `activo`, jamás un cambio de pantalla.';

-- Las dos implementaciones nacen sembradas y activas: `declarada` porque ya es la fuente en uso
-- desde E1 (servidor/lecturas.ts), y `telefono_gps` porque la enmienda §11 la admite como real
-- desde el día uno de E1.5 — el chofer ya trae el GPS encendido en turno (AC-FTEL-01..05).
insert into proveedor_telemetria (codigo, nombre, activo) values
  ('declarada', 'Declarada por el chofer', true),
  ('telefono_gps', 'GPS del teléfono', true);
