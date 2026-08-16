-- 0019 — Odómetro y SOC entran por `reading`, y la proyección la mueve un trigger. [AC-FVEH-05]
--
-- El §4.5 dice que `vehiculos.odometro`/`soc` se mantienen SOLO por trigger de chequeos y
-- lecturas. La 0016 dejó la puerta cerrada —toda escritura de esas dos columnas rebota— y esta
-- migración escribe la llave: el ÚNICO camino a la proyección pasa por una fila de `reading`.
--
-- ─── DE QUÉ VEHÍCULO ES UNA LECTURA ─────────────────────────────────────────────────
--
-- `reading` no tiene `vehiculo_id`, y no es un olvido: el §4.6 la define genérica, con
-- `instrumento?`, `turno?` y `parada?`. Una lectura de odómetro o de SOC llega al vehículo por
-- el TURNO, que es el vehículo-día (§4.5). La consecuencia hay que decirla: una lectura de
-- estas magnitudes sin turno entra igual —jamás rebota, es CAPTURA (§4.2)— pero no mueve
-- ninguna proyección, porque no hay a quién moverla. Quien la ingresa se entera por el flag.
--
-- ─── MONOTONICIDAD SUAVE, APLICADA A UNA PROYECCIÓN ─────────────────────────────────
--
-- El §4.6 la pide «SUAVE»: un odómetro menor al anterior ENTRA, con flag, jamás rebota. Eso es
-- sobre la SERIE. En la proyección la decisión es otra y hay que tomarla: `vehiculos.odometro`
-- se queda con el MÁXIMO declarado, no con el último. Un odómetro físico no retrocede, así que
-- un valor menor es casi siempre un dígito de menos tipeado con una mano en el volante —y
-- dejar que la proyección lo siguiera haría que el próximo tramo de kilómetros se calculara
-- contra un número que nadie recorrió. La fila con el valor menor queda intacta en `reading`
-- con su flag: la serie guarda lo que la persona declaró, la proyección guarda lo que el
-- vehículo recorrió.
--
-- ─── EL CLAMP DEL SOC ────────────────────────────────────────────────────────────────
--
-- `reading.valor_int` no lleva CHECK de rango (§0 fila SOC) y `vehiculos.soc` sí. El trigger
-- CLAMPA antes de escribir: sin eso, un 150 declarado haría rebotar el CHECK de la proyección
-- y —peor— tumbaría la transacción de una CAPTURA, que es exactamente lo que el §4.2 prohíbe.

-- ─── Las dos magnitudes de PLATAFORMA ────────────────────────────────────────────────
--
-- La 0006 nace con `magnitud` vacía y dice «cero seeds»: se refiere a los seeds de VERTICAL —
-- frío, tipos de carga—, que son filas que el pack de cada vertical siembra. Estas dos son
-- otra cosa: el §4.6 nombra a `reading` como la tabla «para odómetro/SOC/temperatura/humedad»
-- y el §4.5 hace de esas dos una proyección de la plataforma. Sin ellas, un tenant recién
-- provisionado no puede registrar un odómetro hasta que alguien se acuerde de insertar una
-- fila, y el trigger de acá abajo no tendría contra qué resolver la magnitud.
--
-- La unidad del odómetro es el kilómetro: el Anexo A razona la autonomía en km y el §0 fija
-- SOC como porcentaje. La energía en Wh y las condiciones de frío las siembra quien las use.
insert into magnitud (codigo, unidad) values
  ('odometro', 'km'),
  ('soc', '%');

comment on column vehiculos.odometro is
  'PROYECCIÓN del odómetro: el MÁXIMO declarado, no el último (§4.6 monotonicidad suave). Un '
  'odómetro no retrocede, así que un valor menor es casi siempre un dígito de menos tipeado; '
  'la fila queda en `reading` con su flag y la proyección no sigue el error.';

/**
 * Mueve la proyección del vehículo desde una lectura recién insertada [AC-FVEH-05].
 *
 * Enciende `flota.proyectando` porque es EL proyector: el guardián de la 0016 rebota a
 * cualquier otro. El GUC es local a la transacción y se apaga al salir — no queda una puerta
 * abierta para el resto del acto.
 *
 * Devuelve NULL: es un trigger AFTER, y lo que devuelva no se usa.
 */
create or replace function proyectar_lectura() returns trigger
  language plpgsql as $$
  declare
    v_codigo    text;
    v_vehiculo  uuid;
  begin
    select codigo into v_codigo from magnitud where id = new.magnitud_id;
    if v_codigo is null or v_codigo not in ('odometro', 'soc') then
      return null;
    end if;
    if new.turno_id is null then
      return null;
    end if;
    select vehiculo_id into v_vehiculo from turnos where id = new.turno_id;
    if v_vehiculo is null then
      return null;
    end if;

    perform set_config('flota.proyectando', 'si', true);
    if v_codigo = 'soc' then
      update vehiculos
         set soc = least(100, greatest(0, new.valor_int))
       where id = v_vehiculo;
    else
      update vehiculos
         set odometro = greatest(coalesce(odometro, new.valor_int), new.valor_int)
       where id = v_vehiculo;
    end if;
    perform set_config('flota.proyectando', '', true);

    return null;
  end
  $$;

comment on function proyectar_lectura() is
  'Trigger AFTER que mueve `vehiculos.odometro`/`soc` desde `reading` (§4.5, §4.6). Es el '
  'ÚNICO camino a esas dos columnas: el guardián de la 0016 rebota cualquier otra escritura.';

create trigger reading_proyecta_vehiculo
  after insert on reading
  for each row execute function proyectar_lectura();

-- Los flags del centinela 4 (§9.3), como eventos del terreno. No llevan prefijo `gobierno.`:
-- son del camión, no del panel del dueño, y mezclarlos ahogaría la auditoría de accesos.
insert into evento_tipo (codigo, descripcion) values
  ('lectura.registrada',            'Se registró una lectura declarada de odómetro o carga'),
  ('lectura.soc_fuera_de_rango',    'Llegó una carga declarada fuera de 0–100; entró igual y la proyección quedó acotada'),
  ('lectura.odometro_retrocedido',  'Llegó un odómetro menor al anterior; entró igual y la proyección no lo siguió'),
  ('lectura.reloj_desfasado',       'El reloj del aparato se apartó del servidor más de lo tolerado; la lectura entró igual'),
  ('lectura.sin_turno',             'Llegó una lectura de vehículo sin turno: entró, pero no hay proyección que mover');
