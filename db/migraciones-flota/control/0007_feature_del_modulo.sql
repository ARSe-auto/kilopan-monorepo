-- 0007 — La feature que ENCIENDE el módulo de vehículos. [AC-FVEH-18]
--
-- El §5.5 tiene dos conductas distintas para un módulo apagado y la diferencia es todo el
-- diseño de la app:
--
--   · los endpoints de PLANIFICACIÓN y de lectura responden **403**;
--   · los de SYNC de captura responden **2xx SIEMPRE**, con flag `modulo_apagado` y fila en
--     «Por revisar», mandando `turno.config_version_id` (§0, fila HTTP).
--
-- El motivo es el del §4.2: una captura es un hecho del terreno que ya ocurrió. Si el dueño
-- apagó un módulo mientras un chofer tenía el turno abierto, el odómetro que esa persona ya
-- tecleó no puede desaparecer porque cambió una configuración en una oficina.
--
-- Nace ENCENDIDA para nadie —no se agrega a ningún plan— por la misma razón que la feature de
-- documentos: qué plan trae qué módulo es decisión comercial del hito (g). Pero acá el default
-- importa al revés, así que hay que decirlo: con la feature ausente del plan, el módulo se lee
-- como APAGADO, y por eso las puertas de planificación de este módulo NO consultan esta
-- feature todavía — hacerlo hoy dejaría la app entera en 403 hasta que el hito (g) siembre los
-- planes. Lo que sí la consulta es el flag de captura, que es aditivo: marca y deja pasar.

insert into features (lookup_key, module) values
  ('modulo_vehiculos', 'vehiculos')
  on conflict (lookup_key) do nothing;
