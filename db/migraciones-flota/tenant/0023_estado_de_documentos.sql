-- 0023 — «Por vencer» y «vencido»: el recordatorio obligado de E1. [AC-FVEH-17]
--
-- El §3.E1.3 pide «documentos con vencimiento (revisión técnica, permiso, SOAP) con
-- RECORDATORIOS». La superficie mínima que cierra esa conducta es que el vehículo diga, en
-- texto, que un documento está por vencer antes de que venza — porque un aviso el día después
-- no es un recordatorio, es una notificación de que ya es tarde.
--
-- ─── LA ANTICIPACIÓN YA TENÍA NOMBRE ────────────────────────────────────────────────
--
-- La pregunta 1 de la spec 02 preguntaba «¿con qué nombre de fila en `parametros`?». Ya estaba
-- respondida en otro lado: la P5 de la spec 00 (respuesta de Alexis del 09-ago-2026) cerró la
-- lista de claves de `parametros` para E1 e incluyó `anticipacion_vencimiento_dias`. Acá se la
-- consume tal cual. Lo que sigue abierto de la pregunta 1 es el VALOR del seed y el canal
-- adicional (¿`signal_rule`? ¿cola Por revisar?), y ninguna de las dos cosas se inventa acá.
--
-- ─── SIN ANTICIPACIÓN CONFIGURADA NO HAY «POR VENCER», Y ESO ES CORRECTO ────────────
--
-- La columna es NULL hasta que el seed del hito (g) le ponga un número. Con NULL, esta función
-- devuelve `vigente` o `vencido` y nunca `por_vencer`. La alternativa —inventar acá un default
-- de treinta días «para que se vea algo»— sería fabricar la respuesta a una pregunta abierta y
-- dejarla fabricada sin que nadie lo note: el día que el dueño diga «quince», la app ya estaría
-- avisando con treinta y nadie recordaría de dónde salió ese número.

create or replace function estado_de_documento(p_vence_el date) returns text
  language sql stable as $$
    select case
      -- El día del vencimiento el documento TODAVÍA vale: `<` y no `<=` (§4.5, migración 0022).
      when p_vence_el < (now() at time zone 'America/Santiago')::date then 'vencido'
      when (select anticipacion_vencimiento_dias from parametros) is not null
       and p_vence_el <= (now() at time zone 'America/Santiago')::date
                         + (select anticipacion_vencimiento_dias from parametros)
      then 'por_vencer'
      else 'vigente'
    end
  $$;

comment on function estado_de_documento(date) is
  'El estado de un documento con la anticipación configurada del tenant (§3.E1.3, §4.4). Sin '
  '`parametros.anticipacion_vencimiento_dias` no existe «por vencer»: inventar un default acá '
  'sería fabricar la respuesta a la pregunta 1 y dejarla fabricada sin que nadie lo note.';
