-- 0033 — El evento del cierre normal del turno. [AC-FVEH-21]
--
-- El cierre forzado ya tenía el suyo (0030) y el normal no, porque hasta ahora nadie cerraba un
-- turno desde la app. En la auditoría los dos tienen que verse DISTINTOS: uno lo hizo el chofer
-- al terminar su jornada y el otro lo hizo un operador desde la oficina sobre algo que quedó
-- colgado. Contarlos juntos borraría exactamente la diferencia que el KR-41 pide sostener.

insert into evento_tipo (codigo, descripcion) values
  ('turno.cerrado', 'El chofer cerró su turno, con la respuesta de si quedó enchufado');
