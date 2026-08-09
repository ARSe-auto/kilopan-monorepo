-- 0015 — El entorno que el aparato declara al enrolarse (§4.3, §5.4). [AC-FIDN-05]
--
-- LAS DOS CONDICIONES DEL §4.3, y no son cosmética. Un aparato sin `display-mode: standalone`
-- no es la app: es una pestaña que el navegador cierra cuando necesita memoria. Y uno sin
-- `persist()` concedido puede perder su almacenamiento cuando el sistema haga limpieza — o
-- sea, puede perder capturas del terreno que todavía no sincronizaron. Las dos juntas son la
-- diferencia entre un aparato enrolado y uno que va a fallar el día que no haya señal.
--
-- POR QUÉ VIVEN EN LA SOLICITUD Y NO SOLO EN `dispositivos`. El aparato existe recién cuando
-- el dueño aprueba (§4.3, AC-FIDN-04), y las dos condiciones se cumplen ANTES: mientras la
-- persona mira «Esperando aprobación» es cuando sigue la guía A2HS y agrega la app a su
-- pantalla de inicio. Si el estado se guardara solo en el aparato, el dueño estaría aprobando
-- a ciegas —sin saber si lo que va a habilitar sirve para trabajar— y la comprobación se haría
-- después de emitido el secreto, que es tarde.
--
-- SE PUEDEN ACTUALIZAR MIENTRAS LA SOLICITUD ESTÁ PENDIENTE, y esa es la conducta: la primera
-- vez llegan como el aparato esté, y cuando la persona completa la instalación se vuelven a
-- declarar. Una sola foto al momento de solicitar dejaría en `false` a todo el mundo que hizo
-- las cosas bien treinta segundos después.

alter table solicitudes_acceso
  add column is_standalone     boolean not null default false,
  add column storage_persisted boolean not null default false,
  add column entorno_visto_en  timestamptz;

comment on column solicitudes_acceso.is_standalone is
  'El aparato declara correr en display-mode standalone (§4.3, AC-FIDN-05). Sin esto no es la '
  'app: es una pestaña que el navegador cierra cuando necesita memoria.';
comment on column solicitudes_acceso.storage_persisted is
  'El aparato declara `persist()` concedido (§4.3, AC-FIDN-05). Sin esto el sistema puede '
  'evictar su almacenamiento, o sea perder capturas del terreno que no sincronizaron.';
comment on column solicitudes_acceso.entorno_visto_en is
  'Cuándo se declaró el entorno por última vez. NULL = el aparato nunca lo reportó, que no es '
  'lo mismo que reportarlo en falso: distinguirlo evita leer «no instalado» donde hay silencio.';

-- Que el `false` por omisión no se confunda con una medición: un aparato que jamás reportó y
-- otro que reportó las dos condiciones sin cumplir se ven distinto, y el CHECK impide la
-- tercera lectura —«reportó» con las columnas en su valor por omisión y sin fecha— que dejaría
-- las dos anteriores indistinguibles.
alter table solicitudes_acceso
  add constraint solicitudes_entorno_declarado
    check (entorno_visto_en is not null or (not is_standalone and not storage_persisted));
