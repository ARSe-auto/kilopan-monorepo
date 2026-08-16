-- 0006 — La feature que hace rebotar la planificación con documentos vencidos. [AC-FVEH-03]
--
-- El §4.5 dice que un documento vencido «REBOTA planificación si el feature está ON», y el §4.4
-- pone el catálogo de features en `control` como FILAS: «un vertical o un plan nuevo son filas,
-- jamás una migración». Esta es la fila del módulo 02.
--
-- NACE APAGADA, y eso no es un default tímido: es la conducta que el AC pide verificar. La
-- feature no se agrega a ningún plan acá porque QUÉ PLAN la trae es una decisión comercial del
-- hito (g) —la pantalla «Funciones» del §5.5—, no del módulo que la implementa. Con `features`
-- poblada y `plan_features` sin la fila, `entitlement_efectivo` resuelve `false` por la vía
-- literal del §4.4 (`override ?? plan`), que es exactamente el caso «con feature OFF no rebota
-- nada».
--
-- El `lookup_key` lo fija este módulo porque el maestro nombra la conducta y no la clave. Se
-- eligió describiendo lo que HACE y no lo que es —`documentos_vencidos_bloquean` y no
-- `compliance_documentos`— para que quien lo lea en la pantalla de toggles entienda qué se le
-- va a romper al operador si lo enciende un martes.

insert into features (lookup_key, module) values
  ('documentos_vencidos_bloquean', 'vehiculos')
  on conflict (lookup_key) do nothing;
