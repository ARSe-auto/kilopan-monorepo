-- Auditoría de experiencia (ALTA): dentro de un galpón, en un subterráneo o con la
-- ubicación recién activada, el GPS no fija. Como lat/lng eran NOT NULL, el repartidor
-- no podía registrar NADA: ni la entrega ni siquiera el intento fallido — el botón
-- «No se pudo entregar» también quedaba gris. Resultado: el pan se entregaba igual
-- pero no quedaba en el sistema, la conciliación no cuadraba y no había POD.
--
-- Se libera la exigencia SOLO para la entrega fallida (motivo_rechazo not null): ahí
-- no se está afirmando "dejé el pan en tal punto", se está registrando "vine y no se
-- pudo", y la foto sigue siendo la evidencia. La entrega EXITOSA mantiene el GPS
-- obligatorio: es la prueba de que el pan llegó a la dirección correcta, y eso no se
-- negocia (AC-POD-01).
alter table pan.entregas alter column lat drop not null;
alter table pan.entregas alter column lng drop not null;
alter table pan.entregas alter column precision_m drop not null;

-- Los CHECK de rango de Chile (lat between -56 and -17, lng between -76 and -66)
-- siguen vigentes: con NULL evalúan a `unknown`, que no viola el constraint, así que
-- una coordenada FUERA de Chile sigue rebotando igual que antes.
alter table pan.entregas add constraint entregas_gps_obligatorio_si_exitosa
  check (motivo_rechazo is not null or (lat is not null and lng is not null and precision_m is not null));
