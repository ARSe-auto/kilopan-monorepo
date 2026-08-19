-- 0029 — La certificación vencida, y la FK que el hito (c) le debía a la 0006. [AC-FVEH-14]
--
-- La 0006 creó `vehicle_certification` sin FK a `vehiculos` y lo dejó escrito: «La FK a
-- `vehiculos` la completa el hito c: la tabla existe acá porque §4.9 la pone entre los ganchos
-- vivos y toda tabla nace en la plantilla». Este es el hito c y esta es la FK.
--
-- Sin ella, una certificación podía apuntar a un vehículo que no existe, y el rebote de
-- planificación de más abajo habría detenido camiones por certificaciones huérfanas.

alter table vehicle_certification
  add constraint vehicle_certification_vehiculo_fkey
    foreign key (tenant_id, vehiculo_id) references vehiculos (tenant_id, id);

/**
 * ¿Tiene este vehículo alguna certificación vencida hoy?
 *
 * Misma forma que `tiene_documentos_vencidos` de la 0022, y por la misma razón: la consultan
 * dos puertas de planificación y va a consultarla una tercera cuando llegue la asignación a
 * rutas del hito (d). El día del vencimiento la certificación TODAVÍA vale, y el día es el de
 * Chile (§0) — las dos cosas iguales que en los documentos, porque una diferencia de un día
 * entre las dos reglas sería imposible de explicarle a quien mira la pantalla.
 */
create or replace function tiene_certificaciones_vencidas(p_vehiculo uuid) returns boolean
  language sql stable as $$
    select exists (
      select 1 from vehicle_certification
       where vehiculo_id = p_vehiculo
         and vence_el < (now() at time zone 'America/Santiago')::date
    )
  $$;

comment on function tiene_certificaciones_vencidas(uuid) is
  'Si el vehículo tiene alguna certificación vencida hoy en Chile (§4.9). El rebote de '
  'planificación que la consume se activa SOLO con su feature ON.';
