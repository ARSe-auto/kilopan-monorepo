-- 0005 — `parametros` completa: la lista CERRADA de 8 claves para E1. [AC-FTEN-12]
--
-- La Pregunta al dueño 5 («claves de `parametros` para E1») estaba abierta cuando se escribió
-- la 0003, así que esa migración solo puso las cinco claves que el §4.4 nombra literalmente.
-- Alexis la respondió el 09-ago-2026 (`docs/respuestas-dueno-2026-08-09.md` §P5) dictando la
-- lista completa y declarándola CERRADA para E1. Acá se la completa.
--
-- Los VALORES no van en el DDL: son seeds del hito (g). Lo que sí va son las columnas, sus
-- tipos y los invariantes que el dueño fijó en el mismo acto.

alter table parametros
  add column anticipacion_vencimiento_dias smallint,
  add column tolerancia_eta_minutos        smallint,
  -- Único con default en el DDL porque el dueño lo dictó así: «parámetro POR TENANT, con
  -- semanal de default». Sin conjunto cerrado: el dueño dio el default, no la lista, y esta
  -- migración no inventa las otras periodicidades.
  add column periodicidad_liquidacion      text not null default 'semanal';

-- CONSECUENCIA 3 de P5: la tolerancia dictada es 20 min, no el mínimo de 15 del Anexo B, y
-- «la regla del maestro (mín. 15 min) se respeta como CHECK de la columna, no como valor
-- sembrado». O sea: el piso vive en el esquema y el valor vive en el seed.
alter table parametros
  add constraint parametros_tolerancia_minima
    check (tolerancia_eta_minutos is null or tolerancia_eta_minutos >= 15);

alter table parametros
  add constraint parametros_anticipacion_positiva
    check (anticipacion_vencimiento_dias is null or anticipacion_vencimiento_dias > 0);

-- CONSECUENCIA 1 de P5: `bultos_max_sin_receptor` es «cuántos bultos se pueden dejar SIN
-- encuadre», y el dueño lo fijó en CERO — siempre foto. El CHECK de la 0003 exigía > 0 y
-- habría rebotado el valor dictado: la semántica cambió de «cuántos como máximo» a «cuántos
-- se perdonan», y el cero es un valor legítimo, no un vacío.
alter table parametros drop constraint parametros_bultos_positivo;
alter table parametros
  add constraint parametros_bultos_no_negativo
    check (bultos_max_sin_receptor is null or bultos_max_sin_receptor >= 0);

-- `smallint` como el resto de las claves de conteo: la lista dictada lo declara así.
alter table parametros alter column bultos_max_sin_receptor type smallint;

comment on column parametros.anticipacion_vencimiento_dias is
  'Con cuántos días de anticipación se avisa un vencimiento (certificaciones, documentos).';
comment on column parametros.tolerancia_eta_minutos is
  'Tolerancia de la ETA antes de marcar atraso. Piso de 15 min por el Anexo B, en el CHECK.';
comment on column parametros.periodicidad_liquidacion is
  'Ritmo de cierre de liquidaciones del tenant. Por TENANT, no por empresa cliente: todas '
  'las empresas de un mismo operador cierran al mismo ritmo (P5, 09-ago-2026).';
