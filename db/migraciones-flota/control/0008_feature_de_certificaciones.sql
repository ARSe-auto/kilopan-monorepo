-- 0008 — La feature que hace rebotar la planificación con certificaciones vencidas. [AC-FVEH-14]
--
-- El §4.9 pone `instrument` y `vehicle_certification` entre los ganchos VIVOS, con una nota que
-- es la que importa: «rebote de planificación activo SOLO con feature ON». Es el mismo patrón
-- que los documentos del vehículo (AC-FVEH-03) y por eso lleva la misma forma: una fila de
-- catálogo, sin plan que la traiga, y por lo tanto apagada para todos hasta que el hito (g)
-- siembre los planes.
--
-- Son DOS features y no una porque son dos decisiones distintas. Una empresa puede querer que
-- un permiso de circulación vencido detenga el camión y que una certificación de instrumento
-- vencida no lo haga — la primera es de la ley, la segunda es de su propio proceso de calidad.

insert into features (lookup_key, module) values
  ('certificaciones_vencidas_bloquean', 'vehiculos')
  on conflict (lookup_key) do nothing;
