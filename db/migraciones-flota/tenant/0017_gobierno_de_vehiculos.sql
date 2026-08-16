-- 0017 — Los otros dos actos del dueño sobre un vehículo (§5.4). [AC-FVEH-02]
--
-- El §5.4 reparte el CRUD con nombre y apellido: el `admin_tenant` «da de alta, edita
-- capacidades/documentos y DESACTIVA vehículos»; el `operador` «solo lee y asigna a rutas».
-- El alta ya tiene su código (0016); acá llegan los otros dos.
--
-- LA DESACTIVACIÓN NO ES UN BORRADO CON OTRO NOMBRE. El DELETE de HTTP se materializa como
-- `activo = false` porque el §7.4 prohíbe destruir datos con evidencia asociada, y un vehículo
-- acumula justo eso: lecturas, chequeos, turnos y —cuando lleguen los hitos d y e— entregas.
-- Un borrado físico dejaría esas filas apuntando a un vehículo que no existe, o se llevaría
-- puesta la historia que la EEVD necesita para computarse hacia atrás (§2).
--
-- Y POR ESO HAY UN EVENTO DE REACTIVACIÓN. El §5.4 nombra la desactivación y no su vuelta,
-- pero una desactivación que no se puede deshacer es un borrado con pasos extra: la persona
-- que se equivocó de fila queda sin salida y el vehículo, con toda su historia adentro, sale
-- de la operación para siempre. La edición del §5.4 incluye volver a activarlo, y el acto deja
-- su propio rastro para que en la auditoría se distinga de una edición cualquiera.

insert into evento_tipo (codigo, descripcion) values
  ('gobierno.vehiculo_editado',      'El dueño editó las capacidades o los datos EV de un vehículo'),
  ('gobierno.vehiculo_desactivado',  'El dueño desactivó un vehículo; la fila y su historia siguen enteras'),
  ('gobierno.vehiculo_reactivado',   'El dueño volvió a poner en operación un vehículo desactivado');
