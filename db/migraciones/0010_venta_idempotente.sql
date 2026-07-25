-- La venta era la única mutación del sistema sin clave de idempotencia.
--
-- Salió a la luz al conectar el primer Postgres hospedado: pesajes y entregas nacieron
-- con `client_uuid` porque se diseñaron sabiendo que el reparto opera sin señal, pero
-- la venta de mesón se escribió bajo el supuesto viejo de que el mesón siempre tiene
-- wifi de la panadería. Operando por datos móviles ese supuesto no existe, y sin esta
-- columna un reintento de la cola cobra dos veces la misma marraqueta.
--
-- El default es solo para las filas que ya están; toda venta nueva trae el uuid que
-- generó el teléfono, que es el punto entero: lo genera QUIEN vende, una sola vez, y
-- sobrevive al reintento.
alter table pan.ventas
  add column if not exists client_uuid uuid not null default gen_random_uuid();

alter table pan.ventas
  add constraint ventas_client_uuid_unico unique (client_uuid);

-- Que el default no se vuelva la norma: si el servidor deja de exigirlo, cada reintento
-- generaría un uuid distinto y volvería el cobro doble, en silencio.
alter table pan.ventas alter column client_uuid drop default;

grant insert (client_uuid) on pan.ventas to pan_app;

-- El precio de venta ya no lo decide el cliente HTTP (ver /api/ventas): lo resuelve el
-- servidor contra esta lista. Esta función es la fuente única, para que la pantalla y
-- el servidor no puedan divergir en cuánto vale un kilo de pan.
create or replace function pan.precio_vigente(p_producto_id uuid, p_lista text)
returns integer
language sql stable as $$
  select precio_clp
    from pan.precios
   where producto_id = p_producto_id
     and lista = p_lista
     and vigente_desde <= current_date
   order by vigente_desde desc
   limit 1;
$$;
