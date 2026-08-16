-- 0071 — el OTD comprometido con cada empresa contratante, como dato y no como número suelto. [AC-FTAR-13]
--
-- El semáforo del §3.E1.11 muestra una tarjeta SLA «solo en modo daas» que compara el
-- cumplimiento real contra lo COMPROMETIDO con esa empresa. Hasta acá el lado de LECTURA ya
-- estaba construido y verde (`apps/flota/src/dominio/semaforo-daas-sla.ts`, AC-FSEM-08), pero
-- leía un porcentaje que no existía en ninguna parte: `empresas_cliente` nace en la 0036 y ni
-- la 0039 ni ninguna posterior le agregó dónde guardarlo.
--
-- POR QUÉ LA COLUMNA Y NO UN NÚMERO EN TypeScript
-- ------------------------------------------------
-- El AC pide explícitamente que la BD RECHACE un valor fuera de rango, no que la pantalla lo
-- valide: un compromiso contractual que solo vive en el código de la UI se puede escribir por
-- cualquier otro camino —una carga masiva, un fixture, una migración futura— y nadie se entera
-- hasta que el cliente reclama con el contrato en la mano. Es la misma lección de la foto del
-- POD que hasheaba texto (AGENTS.md, Aprendizajes): la regla vive donde el dato vive.
--
-- POR QUÉ NULL ES VÁLIDO Y POR QUÉ EL PISO ES 50
-- -----------------------------------------------
-- NULL = «no hay OTD comprometido con esta empresa», que es el caso de toda operación en
-- `mi_flota` (la empresa implícita del §3 no se compromete nada a sí misma) y el de cualquier
-- contratante cuyo contrato todavía no lo fije. La tarjeta SLA entonces no se renderiza, que es
-- lo que el §4.5 ya hace con el precedente SLA-NULL. El rango 50–100 no es cosmético: un OTD
-- comprometido bajo el 50% no es un compromiso, es un error de tipeo (un «9» donde iba «90»),
-- y sobre 100 no existe. El CHECK atrapa las dos puntas.

alter table empresas_cliente
  add column otd_comprometido_pct smallint
    check (otd_comprometido_pct between 50 and 100);

comment on column empresas_cliente.otd_comprometido_pct is
  'OTD comprometido con esta empresa contratante, en porcentaje entero [AC-FTAR-13]. NULL = sin '
  'compromiso pactado: la tarjeta SLA del semáforo no se renderiza (precedente SLA-NULL, §4.5), '
  'que es el caso de la empresa implícita de `mi_flota` (§3). El CHECK 50-100 rechaza en la BD el '
  'error de tipeo -- un 9 por un 90 -- porque el AC exige que el rebote sea de la base y no de la '
  'pantalla: un compromiso contractual escrito por una carga masiva o un fixture tiene que '
  'rebotar igual (§4.2, §7.5).';
