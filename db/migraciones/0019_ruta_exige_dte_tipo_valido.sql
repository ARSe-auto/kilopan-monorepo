-- P0-5 (auditoría 1-ago-2026, verificado a mano): el trigger del art. 55 DL 825 sólo
-- comprobaba que existiera una fila 'registrado' en pan.documento_tributario para el
-- pedido, sin mirar tipo_dte. pan.documento_tributario permite tipo_dte=61 (nota de
-- crédito), y specs/kilopan/06-registro-dte.md la describe explícitamente como "NC 61
-- como anulación" — es lo contrario de un respaldo de despacho. Asociar una nota de
-- crédito al pedido dejaba pasar la ruta a en_curso sin guía ni factura real: el furgón
-- sale sin el documento que exige la ley (multa 10%-200% de 1 UTA, retención del
-- vehículo).
create or replace function pan.trg_ruta_exige_dte() returns trigger
language plpgsql as $$
declare
  sin_dte integer;
begin
  if new.estado = 'en_curso' and old.estado is distinct from 'en_curso' then
    select count(*) into sin_dte
      from pan.ruta_paradas rp
     where rp.ruta_id = new.id
       and not exists (
         select 1 from pan.documento_tributario d
          where d.pedido_id = rp.pedido_id
            and d.estado = 'registrado'
            and d.tipo_dte in (33, 39, 52) -- factura, boleta o guía; NUNCA nota de crédito (61)
       );
    if sin_dte > 0 then
      raise exception 'no se puede salir a ruta: % pedido(s) sin DTE asociado (art. 55 DL 825)', sin_dte;
    end if;
  end if;
  return new;
end;
$$;

-- Reversión: create or replace function pan.trg_ruta_exige_dte() <definición de 0004>;
