-- 0076 — El contratante jamás ve `posiciones`: 0 filas por política de BD [AC-FTEL-05]
--
-- Fuente: §4.3 (la posición del vehículo es economía operativa del operador; el contratante
-- ve solo su rebanada) y spec 09 §2 («El contratante NO ve el mapa de flota»).
--
-- `posiciones` no lleva `empresa_cliente_id` — una posición es del VEHÍCULO, no de una empresa
-- contratante puntual, y un turno puede cargar encargos de varias empresas a la vez. No hay
-- "su rebanada" que recortar: el §4.3 la excluye ENTERA, mismo caso que `rutas` en la 0040
-- («sin_rutas_para_el_cliente») y no el de `tarifas`/`liquidaciones` («empresa_del_cliente»).
--
-- El aplicativo (`servidor/torre-de-control.ts::puedeVerTorreDeControl`, AC-FTEL-04) ya le
-- cierra la puerta al `cliente` en `/api/torre-de-control` con un 403. Esta migración es la
-- segunda capa, la que no depende de que ningún desarrollador futuro recuerde ese chequeo: una
-- consulta nueva contra `posiciones` que se olvide del rol devuelve cero filas para `cliente`
-- igual, porque la política vive en la tabla, no en el código que la consulta.

alter table posiciones enable row level security;

create policy posiciones_base on posiciones
  as permissive for all using (true) with check (true);

-- RESTRICTIVE y FOR ALL, no solo FOR SELECT: nada que un `cliente` pudiera capturar existe hoy
-- (el chofer es quien inserta, nunca el contratante), pero el patrón del §4.3 es "excluida de
-- frente" y no "excluida de lectura nada más" — igual que `sin_rutas_para_el_cliente` (0040).
create policy sin_posiciones_para_el_cliente on posiciones
  as restrictive
  for all
  using (nullif(current_setting('app.current_role', true), '') is distinct from 'cliente');

comment on table posiciones is
  'CAPTURA — la posición en vivo del §11. Nace SOLO durante un turno abierto (§7.8): el trigger '
  'posiciones_exige_turno_abierto rebota con 0 filas cualquier INSERT contra un turno que no '
  'esté abierto [AC-FTEL-01]. El rol `cliente` (contratante) ve 0 filas por política de BD: el '
  '§4.3 excluye el mapa de flota de frente, sin rebanada propia que mostrarle [AC-FTEL-05].';
