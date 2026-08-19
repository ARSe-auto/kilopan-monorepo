-- 0025 — El evento del flag por exceso de capturas de SOC. [AC-FVEH-19]
--
-- El §0 lo fija en su fila de SOC: máximo tres capturas por turno, y el límite se valida en el
-- CLIENTE contra el snapshot (§4.2). Lo que llega por sync pasando ese máximo entra igual —es
-- CAPTURA— con este flag y su fila en «Por revisar».
--
-- POR QUÉ EL LÍMITE VIVE EN EL CLIENTE Y NO ACÁ. El §4.2 lo dice: «la validación bloqueante
-- corre en el CLIENTE». Un cuarto SOC que llega al servidor ya ocurrió en el mundo físico —la
-- persona lo miró y lo tecleó—, así que rebotarlo perdería el dato sin evitar nada. Lo que el
-- límite protege es otra cosa: que la app no le pida al chofer el SOC diez veces por jornada.
-- Eso se protege en la pantalla, y acá solo se registra cuando el aparato manda de más.

insert into evento_tipo (codigo, descripcion) values
  ('lectura.exceso_de_soc', 'Llegó una captura de carga por sobre el máximo del turno; entró igual con su flag');
