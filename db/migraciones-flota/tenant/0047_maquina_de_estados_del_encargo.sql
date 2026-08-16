-- 0047 — la máquina de estados del encargo: los cuatro valores que faltaban. [AC-FRUT-03]
--
-- La 0036 dejó el enum con DOS valores a propósito y escribió por qué: la pregunta 1 de la spec
-- 03 estaba abierta y los intermedios no salían del maestro. Alexis la respondió el 11-ago-2026
-- (`docs/respuestas-dueno-2026-08-11-spec01-spec03.md`) y la máquina quedó fijada:
--
--     solicitado → aceptado → asignado → publicado → entregado | no_entregado
--
-- CON seguimiento de ruta explícito EN EL PROPIO ENCARGO, y no solo derivable de
-- `paradas`/`items`: el portal del contratante (módulo 07) va a preguntar «¿dónde está mi
-- pedido?» y con esto responde sin unir cuatro tablas. El costo —mantener cada transición
-- sincronizada con lo que de verdad pasa en `rutas` y `paradas`— es el trabajo de la 0048.
--
-- ─── POR QUÉ EL ENUM SE AMPLÍA Y NO SE REEMPLAZA ───────────────────────────────────
--
-- `ALTER TYPE … ADD VALUE` y no un tipo nuevo con `ALTER TABLE … TYPE`: lo segundo reescribe la
-- tabla entera y, sobre todo, tiraría abajo por un momento la columna sobre la que ya hay FKs,
-- índices y una política de fila. Los valores se AGREGAN AL FINAL y no con `BEFORE`/`AFTER`
-- porque el orden que queda —solicitado, aceptado, asignado, publicado, entregado,
-- no_entregado— es exactamente el canónico: los dos que ya estaban son los dos primeros de la
-- máquina. Nada del módulo compara estados por su orden, igual: se comparan por igualdad.
--
-- ─── ESTE ARCHIVO NO USA LOS VALORES QUE AGREGA, Y NO ES ESTILO ────────────────────
--
-- PostgreSQL prohíbe usar un valor de enum en la MISMA transacción en que se agregó
-- («unsafe use of new value of enum type»), y el runner corre cada archivo en una transacción.
-- Por eso los triggers que estampan estos estados viven en la 0048: intentarlos acá haría
-- fallar la migración en el cluster, no en la revisión.

alter type encargo_estado add value if not exists 'asignado';
alter type encargo_estado add value if not exists 'publicado';
alter type encargo_estado add value if not exists 'entregado';
alter type encargo_estado add value if not exists 'no_entregado';

-- ─── QUIÉN LO CREÓ ─────────────────────────────────────────────────────────────────
--
-- El §3.E1.10 dice «editable por SU CREADOR solo hasta la aceptación», y sin esta columna la
-- primera mitad de esa frase no se puede verificar: la política de fila del rol `cliente`
-- (AC-FRUT-12) confina a la EMPRESA, no a la persona, así que dos usuarios del mismo
-- contratante podrían corregirse los pedidos entre ellos. Nullable porque los encargos que ya
-- existen no tienen a quién atribuirse y porque el alta por importación CSV de la casa tampoco
-- necesita atribuirse a una persona para que la regla del contratante se cumpla.
alter table encargos add column creado_por_usuario_id uuid;
alter table encargos add constraint encargos_creador_es_usuario_del_tenant
  foreign key (tenant_id, creado_por_usuario_id) references usuarios (tenant_id, id);
create index encargos_tenant_creador_idx on encargos (tenant_id, creado_por_usuario_id);

comment on column encargos.creado_por_usuario_id is
  'Quién dio de alta el encargo. Es lo que hace verificable el «editable por SU creador» del '
  '§3.E1.10: la política de fila confina a la EMPRESA, y dentro de una empresa hay varias '
  'personas. Nullable: el alta masiva de la casa no se atribuye a nadie en particular.';

comment on column encargos.estado is
  'La máquina completa que Alexis fijó el 11-ago-2026 (pregunta 1 de la spec 03): '
  'solicitado → aceptado → asignado → publicado → entregado | no_entregado. Los dos finales '
  'los estampa SOLO un trigger, desde el hecho que los produce (§4.5); el seguimiento de ruta '
  'es explícito acá y no derivado, para que el portal del contratante responda sin joins.';
