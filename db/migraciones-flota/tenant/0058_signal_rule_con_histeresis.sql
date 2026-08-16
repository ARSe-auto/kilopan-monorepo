-- 0058 — `signal_rule`: la señal como FILA, con la histéresis exigida por CHECK. [AC-FSEM-02]
-- Spec 05 §2.4 · Fuente: §5.6-mecánica, Anexo B, §0 (fila Semáforo), §4.1/§4.2 (linter).
--
-- El pgTAP 0018 (`datos_fuente_de_senales`, módulo 02) dejó anotado que «el motor de evaluación
-- con histéresis, el DDL de `signal_rule` y la tarjeta son del hito (e)». Este es el hito (e) y
-- esta es esa tabla: la mitad de BD de AC-FSEM-02, cuya otra mitad —la mecánica de transición—
-- vive pura en `apps/flota/src/dominio/semaforo-histeresis.ts`.
--
-- ─── POR QUÉ LA HISTÉRESIS SE EXIGE EN EL ESQUEMA Y NO EN LA APLICACIÓN ──────────────
--
-- Los umbrales los edita el TENANT, sin deploy (§2.5, «vertical = INSERT»). Una fila con el
-- umbral de recuperación igual al de disparo no es una configuración pobre: es una señal que
-- prende y apaga en cada poll de 15–30 s (§2.6), y con ella la cola «Por revisar» se llena de
-- excepciones que nacen y mueren solas — exactamente lo que §5.6 prohíbe cuando dice que toda
-- señal amarilla o roja es accionable o no existe. Validarlo en la pantalla de umbrales sería
-- teatro: el UPDATE también llega por el panel admin (módulo 08) y por el seed. La BD es la
-- autoridad, así que rebota acá.
--
-- ─── QUÉ EXIGE EL CHECK, EXACTAMENTE, Y QUÉ NO ──────────────────────────────────────
--
-- Exige lo que el §2.4 escribe: `umbral_recuperacion` DISTINTO del de disparo. Los umbrales de
-- disparo son dos —amarillo y rojo—, así que el CHECK los cubre a los dos: una recuperación
-- igual al rojo dejaría al rojo oscilando aunque el amarillo tuviera su banda.
--
-- NO exige `umbral_recuperacion < umbral_amarillo`, y eso es una decisión. El sentido de la
-- desigualdad depende de la DIRECCIÓN de la métrica: en «% de no-entregas» o «minutos sin
-- sync» peor es mayor y la recuperación va debajo; en «SOC» o «retorno proyectado» peor es
-- menor y va encima (por eso `transicionColor` pide que el dominio que la llame normalice a
-- métrica ascendente antes). Hornear una dirección acá fijaría en el esquema una decisión que
-- el maestro no toma y que la pregunta 5b de la spec todavía tiene abierta —los valores seed
-- de recuperación no están—, y sería además la clase de default inventado que la 0023 rechaza
-- explícitamente para `anticipacion_vencimiento_dias`.
create table signal_rule (
  id                  uuid        not null default uuidv7(),
  tenant_id           uuid        not null default tenant_actual() check (tenant_id = tenant_actual()),
  -- El dominio-tarjeta al que la señal alimenta. Lista cerrada del Anexo B (§2.5): la tarjeta
  -- SLA es la única condicionada (modo `daas` + empresa con `otd_comprometido_pct`, §4.5).
  -- El tenant edita UMBRALES, no inventa dominios: una tarjeta nueva es una tarjeta más en el
  -- tablero, y el tope lo fija `SEMAFORO.tarjetas_max`.
  dominio             text        not null check (dominio in (
                        'entregas_vs_plan', 'turnos_conductores', 'flota_energia_ev',
                        'datos_sync', 'caja_custodia_liquidacion', 'daas_sla')),
  -- El nombre estable de ESTA señal dentro de su dominio: un dominio tiene varias (el Anexo B
  -- le da dos condiciones amarillas a Entregas vs plan). Es por donde el seed la reconoce para
  -- no duplicarla y por donde el tenant la edita.
  codigo              text        not null,
  -- `numeric` y no entero: los umbrales del Anexo B son porcentajes y minutos, y algunos traen
  -- fracción («−2 pp», «5%»). No es dinero ni peso — esos sí son enteros por el §0 — así que
  -- acá el decimal exacto es la forma correcta, y jamás un float.
  umbral_amarillo     numeric     not null,
  umbral_rojo         numeric     not null,
  umbral_recuperacion numeric     not null,
  -- «Toda señal amarilla/roja es accionable o no existe» (§5.6): la fila de N1 muestra este
  -- texto como acción sugerida de una línea. Sin playbook la señal no se puede mostrar, así
  -- que la columna es NOT NULL y el vacío rebota (el seed que la puebla es AC-FSEM-03).
  playbook            text        not null check (btrim(playbook) <> ''),
  creada_en           timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, codigo),
  -- La histéresis del §0/§2.4, exigida por el esquema. Vale igual para el INSERT del seed y
  -- para el UPDATE con el que el tenant ajusta su umbral.
  constraint signal_rule_histeresis check (
    umbral_recuperacion <> umbral_amarillo and umbral_recuperacion <> umbral_rojo
  )
);
create index signal_rule_tenant_dominio_idx on signal_rule (tenant_id, dominio);
comment on table signal_rule is
  'PLANIFICACIÓN — la señal del semáforo como fila editable por el tenant (§5.6, Anexo B). Se '
  'opera con red y rebota: un umbral inválido NO es una captura de terreno. La histéresis la '
  'exige el CHECK `signal_rule_histeresis`, no la pantalla.';

comment on column signal_rule.umbral_recuperacion is
  'El umbral que hay que cruzar para VOLVER a verde, distinto del de disparo (§2.4). La zona '
  'entre recuperación y disparo es pegajosa: la señal sigue en su color de alarma. La mecánica '
  'vive en `transicionColor` (apps/flota/src/dominio/semaforo-histeresis.ts).';

-- Toda edición de umbral queda en `audit_trail` (§2.4, §4.6): el día que una señal deje de
-- avisar, la pregunta es quién le movió el umbral y cuándo.
create trigger signal_rule_auditada
  after insert or update or delete on signal_rule
  for each row execute function auditar();
