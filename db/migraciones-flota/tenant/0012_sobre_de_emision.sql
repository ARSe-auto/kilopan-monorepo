-- 0012 — El sobre con que el secreto llega al aparato (§4.3, §5.4 F-C). [AC-FIDN-04]
--
-- POR QUÉ HACE FALTA UNA COLUMNA. El dueño aprueba desde SU teléfono y el trabajador espera
-- en el suyo, mirando «Esperando aprobación» (§5.4). El §7.6 prohíbe depender de push, así
-- que el aparato del trabajador PREGUNTA — y para que haya algo que responder, lo que la
-- aprobación selló tiene que esperarlo en algún lado.
--
-- POR QUÉ NO CONTRADICE «EN BD QUEDA SOLO `secreto_hash`». Lo que se guarda acá no es el
-- secreto: es el secreto cifrado contra la clave pública del aparato, y la privada que lo
-- abre nunca salió de ese teléfono (`src/dominio/secretos.ts`). Ni con la base entera en la
-- mano se saca nada de esta columna. La credencial sigue viviendo como hash en `dispositivos`
-- y en ningún otro lugar.
--
-- Y ES DE UN SOLO USO: al retirarlo se vacía la columna. Eso es lo que hace literal el «UNA
-- vez» del §4.3 — un sobre que se pudiera retirar dos veces sería un secreto que viaja dos
-- veces, y la segunda por un canal que ya nadie está mirando.

alter table solicitudes_acceso
  add column sobre jsonb,
  add column sobre_retirado_en timestamptz;

comment on column solicitudes_acceso.sobre is
  'Secreto del dispositivo cifrado contra la clave pública de la solicitud (AC-FIDN-04). '
  'Opaco sin la privada del aparato. De un solo uso: se vacía al retirarlo.';

-- Un sobre retirado no puede seguir ahí, y una fecha de retiro sin sobre previo no significa
-- nada. El CHECK deja UNA sola lectura posible de las dos columnas: o hay sobre esperando, o
-- ya se retiró, o nunca hubo — jamás «hay sobre y además dice que se retiró», que sería la
-- forma de que un secreto se entregue dos veces sin que nada se ponga rojo.
alter table solicitudes_acceso
  add constraint solicitudes_sobre_de_un_solo_uso
  check (sobre is null or sobre_retirado_en is null);
