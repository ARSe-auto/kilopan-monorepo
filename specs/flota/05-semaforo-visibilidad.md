# 05 — Semáforo de visibilidad (verde/amarillo/rojo) para dueño de operación y para e-auto

Fuente: §5.6 (semáforo en la GUI) · Anexo B (taxonomía seed de `signal_rule`) · §10 (client_metric, telemetría de producto y panel interno SaaS) · §2 (EEVD) — y, transversales al módulo: §0 (constantes Semáforo · HTTP · Formatos · Cifra operativa), §3.E1.11 y §3-FUERA (alcance E1), §3.E2 (criterio de entrada evaluado «en el panel»), §4.1 (plano de control y exportador), §4.2 (regla de oro), §4.4 (`parametros`, terminología), §4.5 (`otd_comprometido_pct`, `turnos`, `paradas`), §4.6 (`eventos` · `client_metric` · `review_queue` · `audit_trail`), §4.7 (secuencia por dispositivo), §4.9 (ganchos DDL-only), §5.1/§5.5/§5.7 (Miga, contracción, estados y AA), §5.2-F6, §7 (guardrails), §9.2/§9.3 (oráculos, suite autogenerada y centinelas). Todas las referencias resuelven contra `docs/PROMPT_MAESTRO_FLOTA.md`.

Módulo del hito §9.1-(e) («POD offline + semáforo»). Gestión por excepción para el
dueño del tenant («Hoy» = home, ≤5 min/día, §5.2-F6) y visibilidad cross-tenant para
e-auto como dueño de la plataforma (solo agregados técnicos/adopción, decisión 6 del
encabezado del maestro).

## 1. Objeto y fronteras

Dos planos, un solo lenguaje semafórico (verde/amarillo/rojo con histéresis, §0):

- **Plano A — tablero «Hoy» del dueño de la operación** (por tenant, dentro de SU BD):
  máx 6 tarjetas-dominio, drill-down de 3 niveles, cola «Por revisar» con ack/resolve
  (§3.E1.11, §5.6).
- **Plano B — vista cross-tenant de e-auto**: lee EXCLUSIVAMENTE de la BD `control`
  (agregados empujados por el job exportador, §4.1); jamás datos comerciales de ningún
  tenant (§5.6, decisión 6).

**Fuera de este módulo** (pertenecen a otros, se citan para deslindar):
- El semáforo de energía del chofer «Alcanza / No alcanza — recarga antes» (F3, §5.2)
  y el tablero «Listos para salir» del operador (F1): son del módulo EV (§3.E1.12); la
  fórmula única de rango del §0 vive allá. Este módulo solo CONSUME sus proyecciones
  para el dominio Flota/EV.
- Torre de control en vivo y mapa de puntitos: FUERA de E1 y anti-ancla (§3, §6).
- WebSockets/SSE: prohibidos en v1 (§5.6-refresco); upgrade path SSE por-canal queda
  documentado, no construido.
- Push: el FUERA del §3 excluye textualmente «**push como dependencia**» (no push a
  secas) y §7.6 solo lo admite como mejora progresiva con degradación; §5.6-N2 sí
  especifica el push de un rojo. Como la lista cerrada §3.E1.11 NO incluye push,
  esta spec no construye push alguno en E1 — decisión CONDICIONADA a la respuesta
  de la pregunta 7 (misma técnica que la señal de ETA con la pregunta 4): si el
  dueño quiere el aviso, el push de rojo entra como mejora progresiva
  jamás-dependencia (§7.6) con deep-link a N2. El deep-link al nivel 2 queda vivo
  desde E1 (§5.6-N2); ningún flujo del módulo depende de push.

## 2. Plano A — Tablero «Hoy» del dueño del tenant

### 2.1 Nivel 0 — tablero (0 toques, §5.6-N0)

- Máximo **6** tarjetas-dominio (constante de `constants.ts`, fila Semáforo del §0;
  grep-gate si el número aparece hardcodeado): **Entregas vs plan · Turnos/conductores
  · Flota/energía EV · Datos/sync · Caja/custodia/liquidación** (+ **SLA por contrato**
  SOLO en modo `daas`, §3.E1.11).
- La tarjeta SLA existe únicamente si hay ≥1 empresa cliente con
  `otd_comprometido_pct NOT NULL`; con NULL no se muestra para esa empresa y su
  `signal_rule` no evalúa (§4.5).
- **Verde = SOLO agregado** («34/40 · en plan»), jamás notifica ni crea excepciones
  (§5.6-N0; benchmark Andon/Datadog §6: verde no comunica). **Amarillo/rojo =
  contador + la excepción más antigua** (antigüedad por `record_time` del servidor —
  la secuencia monotónica por tenant es el orden autoritativo, §4.6; el drift de reloj
  del dispositivo >5 min es flag, jamás rebote, §0).
- La cifra principal de cada tarjeta usa el token de cifra operativa de `miga`
  (96px/700/`tabular-nums`, §0 — test de miga que falla si falta) y formato es-CL (§0).

### 2.2 Nivel 1 — peek (1 toque, §5.6-N1)

- Bottom-sheet **sin navegar** (por eso el drill-down de 3 niveles respeta el máximo
  de 2 niveles de profundidad de §5.1: el peek no es un nivel de navegación).
- Lista ordenada por **severidad × antigüedad**; cada fila = quién/qué/cuánto/desde
  cuándo + **acción sugerida (playbook de 1 línea**, texto de la fila `signal_rule`).
- Swipe o botón (targets ≥48px, §0) = **reconocer**: transición
  `nueva→reconocida` en `review_queue`, registrando al actor como dueño
  (`asignado_a`) salvo reasignación explícita en nivel 2 (§4.6, §5.6-mecánica;
  patrón ack→resolve de PagerDuty, §6). Aquí termina el amarillo típico.

### 2.3 Nivel 2 — detalle (1 toque más; el rojo lo exige, §5.6-N2)

- URL estable **deep-linkeable** por excepción (prerrequisito del push de rojo de
  §5.6-N2; en E1 no se construye push — la lista cerrada §3.E1.11 no lo incluye y
  §3-FUERA excluye «push como dependencia» —, condicionado a la pregunta 7).
- Contenido: **timeline de eventos + evidencia completa** (foto, GPS estático, curva
  SOC, registros de sync) — cada tipo de evidencia es mejora progresiva: si falta
  (GPS off por defecto, foto opcional, §7.8), la sección degrada sin hueco ni error.
- Acciones: **llamar / reasignar / resolver con nota** (`reconocida→resuelta` con nota
  obligatoria). «El rojo lo exige» (§5.6-N2) se aplica como conducta de UI: el peek
  N1 no ofrece la acción de resolver para excepciones rojas (solo reconocer); la
  amarilla puede morir reconocida en N1 (§5.6). Una regla dura de servidor
  equivalente se definiría en términos de ESTADO (p. ej. la roja exige pasar por
  `reconocida` antes de `resuelta`), jamás del origen del request — el maestro no
  la fija: pregunta 9.
- Ack/resolve/reasignar son mutaciones del lado PLANIFICACIÓN de la regla de oro
  (§4.2): validan online y REBOTAN con error tipado 422 (transición ilegal, nota
  vacía, excepción de otro tenant ⇒ 404 §0). No son capturas de terreno: sin outbox,
  sin undo 8 s.

### 2.4 Mecánica de señales (§5.6-mecánica, §0)

- **Señales como FILAS**: `signal_rule`(dominio, umbral_amarillo, umbral_rojo,
  `umbral_recuperacion` **DISTINTO** — histéresis exigida por CHECK —, playbook).
  Umbrales editables por tenant (Anexo B); toda edición queda en `audit_trail`
  (§4.6). Playbook obligatorio: **toda señal amarilla/roja es accionable o no
  existe** (§5.6).
- **Excepciones = filas de `review_queue`** (origen = la señal/dominio, severidad,
  `asignado_a`, sla, estado `nueva→reconocida→resuelta` con nota — el ciclo de §4.6
  es exactamente el que §5.6 exige para «cada excepción tiene dueño y estado»). La
  cola «Por revisar» (§3.E1.11) es la vista transversal de `review_queue` — incluye
  también las capturas degradadas por la regla de oro (flag + evento + fila, §4.2) y
  las post-revocación (§4.3); las tarjetas filtran por su dominio. **La cola tiende a
  cero cada día** (métrica, §5.6/§10).
- **Evaluación server-side sobre proyecciones de eventos append-only +
  `client_metric`** — jamás contadores mutables (§2, §4.6: el estado visible es
  proyección; los paneles de §10 leen SOLO de `client_metric` y eventos).
- El DDL de `review_queue` lo crea el módulo 00 en `tenant_template` (AC-FTEN-24); la
  ESCALA de `review_queue.severidad` y las filas que nacen por degradación las fija el
  módulo 04 (hito e); este módulo exige poder proyectar esa escala a {amarillo, rojo}
  sin ambigüedad (las capturas post-revocación tardías llegan con severidad alta,
  §4.3 ⇒ rojo).

### 2.5 Taxonomía seed por dominio (Anexo B; filas editables por tenant) y sus fuentes E1

| Dominio (tarjeta) | Amarillo (seed) | Rojo (seed) | Fuente E1 (todo declarado) |
|---|---|---|---|
| Entregas vs plan | ETA proyectada + tolerancia (mín. 15 min) excede ventana comprometida en ≥1 parada · ruta con 5–10% no-entregas | compromiso vencido sin entrega · >10% no-entregas | `paradas` (estado/resultado/`promesa_original` congelada vs ETA vivo, §4.5) — la señal de ETA queda sujeta a la pregunta 4 |
| Turnos/conductores | sin eventos 30–45 min en turno · turno sin cerrar >1 h tras fin del bloque | sin señal >2 h · turno abierto cruzando medianoche | `eventos` + `turnos` + `bloques_agenda` (§4.5, §4.6) |
| Flota/energía EV | SOC proyectado al fin del bloque < reserva + 5 pp | SOC actual < consumo estimado del tramo restante · retorno proyectado <15% · «no quedó enchufado» a la hora límite | proyecciones del módulo EV (fórmula única §0; `reserva_pct` de `parametros` §4.4; `turnos.enchufado_confirmado` §4.5); hora límite = parámetro del tenant (§4.4 «umbrales»; valor seed en pregunta 5) |
| Datos/sync | dispositivo con pendientes >30–60 min en turno | sin sync >3–4 h con turno abierto · entrega sin evidencia tras sync · hueco de secuencia | `client_metric` (outbox_profundidad, outbox_edad_max, sync_error, pwa_version, latencia_ms §4.6) + `eventos` (huecos §4.7) + `paradas`×`evidence` |
| Caja/custodia/liquidación | discrepancia de custodia pendiente · liquidación observada (semántica: pregunta 11) | descuadre confirmado sin evidencia · línea disputada (**dinero disputado siempre es rojo**) | `cierres_ruta` (§4.5) + estados de liquidación/disputa (§3.E1.9); con liquidación OFF esas señales no evalúan (§5.5) |
| DaaS/SLA (solo `daas`) | OTD del contrato bajo el comprometido −2 pp proyectado | SLA incumplido en el período | `paradas` cerradas vs ventana × `otd_comprometido_pct` del contrato (§4.5) |

- El seed viaja en `tenant_template` (§4.1): un tenant nuevo nace con la taxonomía
  completa; un vertical/tenant ajusta umbrales por UPDATE de fila, cero código (§4.9,
  espíritu «vertical = INSERT»).
- **Cero señales de frío/farma en E1**: `alarm_rule`/`thermal_profile` son DDL-only
  (§4.9); ninguna fila seed del semáforo referencia temperatura/humedad. El CHECK de
  la matriz de honestidad (§7.7) queda intacto.

### 2.6 Refresco (§5.6-refresco)

- **Polling HTTP del digest cada 15–30 s** SOLO con pestaña visible (Page
  Visibility); pestaña oculta ⇒ cero requests. Intervalo desde `constants.ts` (§0,
  grep-gate).
- **ETag/304**: digest sin cambios ⇒ 304 sin body. Pull-to-refresh de respaldo.
- **Nada de WebSockets/SSE en v1** (grep del módulo); upgrade path SSE por-canal
  documentado en el código como comentario, no construido.
- Offline: la pantalla «Hoy» muestra el estado «sin conexión» con contador real de
  cola (§5.7) y el último digest recibido marcado con su antigüedad — jamás un verde
  fingido con datos viejos sin decirlo.

### 2.7 Contracción por modo y entitlements (§5.5, §3-selector)

- Manifest server-side (entitlements × rol): el tablero «Hoy» es núcleo E1 del panel
  del dueño (F6) — no es un feature apagable; sus TARJETAS y señales sí se contraen.
- Feature OFF (p. ej. liquidación en `mi_flota`) ⇒ sus `signal_rule` no evalúan, no
  nacen excepciones de ese origen, y el dominio que quede sin NINGUNA señal activa no
  renderiza tarjeta — sin huecos, candados ni parpadeo (derivado de §5.5 y del
  precedente SLA-NULL de §4.5; confirmación en pregunta 8).
- Modo `mi_flota` (tenant C demo): 5 tarjetas máx (sin SLA); custodia sigue viva
  (empresa implícita, §3). Conmutar de modo jamás pierde filas (centinela 11 —
  incluidas `signal_rule` y `review_queue`).
- Un toggle aplica al próximo bootstrap; los turnos abiertos terminan con su config
  congelada (`turno.config_version_id`, §4.4/§5.5).

### 2.8 Roles

El tablero es del **dueño** (`admin_tenant`; F6 §5.2). `chofer`, `responsable_carga`
y `cliente` no lo reciben en su manifest (§5.5); además la tarjeta
Caja/custodia/liquidación contiene CLP, invisible a chofer/responsable_carga por RLS
(§4.8) y el rol `cliente` jamás ve rutas completas ni telemetría EV (§3.E1.10). El
acceso del rol `operador` no está cerrado en el maestro (pregunta 1); esta spec
activa SOLO `admin_tenant`: mientras la pregunta 1 esté abierta, `operador` y
`responsable_tecnico` tampoco reciben el tablero en su manifest y su GET al digest
⇒ 403 (verificado en AC-FSEM-09).

## 3. Plano B — Vista cross-tenant de e-auto (§5.6-vista e-auto)

- Lee **EXCLUSIVAMENTE** de la BD `control` (§4.1): agregados técnicos/adopción
  empujados por el job exportador — **actividad vs media móvil · errores de sync ·
  backlog · versión de PWA · latencia p95 por tenant · EEVD agregada** (§2 define la
  EEVD; la meta por vertical NO gobierna con <5 tenants — régimen dual §2).
- **JAMÁS** ingresos/tarifas/clientes de ningún tenant: garantizado por separación
  física + schema fijo testeado del exportador (centinela 14, §9.3). Prohibido que el
  código de este plano abra conexiones a BDs `t_<slug>` (§4.1-prohibido, §7.2).
- Señales cross-tenant como filas `signal_rule` en `control` (misma mecánica §5.6,
  histéresis incluida), seed Anexo B: amarillo = actividad −30% vs media 7d · errores
  sync 1–5% · backlog creciente 2 intervalos · >20% dispositivos en PWA vieja; rojo =
  tenant sin eventos un día hábil · errores >5% por 15 min · cola >4 h · **sospecha
  de fuga de aislamiento = rojo máximo siempre** (fuente E1: el canario de
  aislamiento contra producción, §10, en fallo) — no degradable por histéresis ni
  edición de umbral.
- La fila «webhook pactado caído» (Anexo B) **no se siembra en E1**: los webhooks son
  E2 (§3-FUERA) y una señal sin fuente viola «toda señal es accionable o no existe»
  (§5.6). Entra con E2.
- La alarma churn del panel SaaS (EEVD −30% semana/semana, §10) se implementa como
  señal roja/amarilla sobre la EEVD agregada de `control` (mismo mecanismo de filas).
- **Panel interno SaaS (§10) — vive en este plano.** Ningún otro módulo del índice
  (00–08) lo reclama, y el maestro lo presupone operativo al cierre de E1: el
  criterio de entrada a E2 «lo evalúa Alexis en el panel» (§3.E2) y el DONE-adopción
  se mide «en el panel» (§10). Además de los 6 agregados de arriba y la alarma
  churn, muestra:
  - **EEVD agregada y POR TENANT con tendencia 4 semanas** (§10): el exportador
    empuja el valor semanal por tenant desde la vista `eevd_semanal` (§2) de cada
    BD tenant — vista CREADA por el módulo 02 (AC-FVEH-20); este plano solo la
    consume vía el exportador.
  - **Embudo de activación p50/p90 alta→primera entrega** (§10; métricas de
    plataforma 1 y 2 del §2): fecha de alta del registro de tenants de `control`
    (§4.1) + hito de primera entrega real con evidencia empujado por el exportador
    como agregado de adopción.
  - **Tenants activos y % de vehículos con turno** (§10; agregados de
    salud/adopción del exportador, §4.1).
  - **Calidad de la norte:** % de paradas sin evidencia y % de PODs supersedidos
    **EXCLUYENDO motivo=`undo`** (§10; el undo post-replay queda excluido por
    definición SQL del métrico de gaming, §4.7).
  - **Contador de exenciones de la suite** con tendencia (creciente = bandera roja,
    §10). Su fuente NO son las BDs tenant: es el gate CI (§9.2, exenciones
    «justificadas por escrito y contadas»); el mecanismo de ingesta al panel no
    está definido en el maestro — pregunta 10.
  - Los agregados nuevos (EEVD semanal por tenant, hito de primera entrega, %
    vehículos con turno, % paradas sin evidencia, % PODs supersedidos sin `undo`)
    se suman al **schema fijo del exportador** (módulo 00) manteniendo el centinela
    14 verde: cero columnas de dinero/tarifas/clientes (§4.1, §9.3). AC: AC-FSEM-22.
- Presentación: lista por tenant con estado semafórico + los agregados de arriba,
  dentro de los tokens Miga (§5.1); verde no comunica; el detalle de un tenant
  muestra SOLO lo que `control` contiene. Autenticación/montaje del panel: pregunta 2.

## 4. Contratos HTTP y datos (nombres indicativos; el manifiesto de rutas manda, §9.2)

- `GET  /api/semaforo/digest` — estado por tarjeta (color, agregado, contador,
  excepción más antigua), ETag/304. Lectura de planificación: módulo/rol no
  habilitado ⇒ 403; recurso de otro tenant ⇒ 404 siempre (§0-HTTP).
- `GET  /api/semaforo/excepciones?dominio=` — filas N1 (severidad × antigüedad).
- `GET  /api/semaforo/excepciones/:id` — detalle N2 (timeline + referencias de
  evidencia). Deep-linkeable.
- `POST /api/semaforo/excepciones/:id/reconocer | /resolver {nota} | /reasignar` —
  422 tipado ante transición ilegal; 404 cross-tenant; `audit_trail` por trigger.
- Todas las rutas entran a la suite HTTP A-contra-B autogenerada (§9.2) — cero
  exenciones para este módulo.
- El módulo NO crea tablas nuevas fuera de `signal_rule` (tenant y `control`): reusa
  `review_queue`, `eventos`, `client_metric`, `evidence` (§4.6). `signal_rule` lleva
  `tenant_id` + CHECK de constante + índice + COMMENT de clase PLANIFICACIÓN, como
  toda tabla de dominio (§4.1, §4.2 linter).

## 5. Telemetría del propio módulo (§10)

- **Digest del semáforo** emitido a telemetría de producto (oráculo producción).
- **Minutos del dueño en el panel ≤5/día** — medición pendiente de la pregunta 6
  (el enum cerrado de `client_metric` §4.6 no trae tipo de tiempo-en-panel);
  AC-FSEM-23.
- **Cola al cierre del día tiende a cero** (conteo de `review_queue` no resuelta).
- Toques del drill-down a `client_metric` tipo `toques_flujo` (§5.3, §4.6).
- **«Hints re-mostrados = bug» (§10):** obligación de telemetría de producto que
  ninguna spec del conjunto reclamaba y cuyo concepto de «hint» no existe en el
  producto especificado; la reclama este módulo por ser dueño de la telemetría de
  producto y del panel §10, y queda BLOQUEADA por la Pregunta al dueño 12 — el enum
  CERRADO de `client_metric` (§4.6) no trae tipo para hints, igual que ocurre con
  «minutos del dueño en el panel» (AC-FSEM-23). Entregable: AC-FSEM-25.

## Criterios de aceptación

- [x] (P1) Nivel 0 completo: con seed A (daas, farmacia `otd_comprometido_pct=95`) el tablero «Hoy» del `admin_tenant` renderiza exactamente 6 tarjetas (las 5 fijas + SLA) y con seed C (`mi_flota`) exactamente 5, sin hueco donde iría SLA; el máximo 6 sale de `constants.ts` (grep-gate al hardcodeo); verde muestra SOLO agregado «N/M» es-CL con token cifra operativa (96/700/tabular-nums) y no genera notificación ni fila de excepción; tarjeta amarilla/roja muestra contador + la excepción más antigua por `record_time` — oráculo: CI [AC-FSEM-01]
  - Probado: `semaforo.test.ts` (unit, selección/resumen de tarjetas) + `e2e/hoy-nivel-0.spec.ts` (6/6 verde, playwright en primer plano) sobre las semillas A/C de `semaforo-fixtures.ts`; la evaluación server-side de `signal_rule` contra datos reales queda para AC-FSEM-02/06/07+ (dependen de tablas del módulo 00, sesión supervisada).
- [x] (P1) Histéresis por señal: CHECK en `signal_rule` exige `umbral_recuperacion` distinto del de disparo (INSERT con umbral igual ⇒ rebota); test de secuencia: métrica cruza `umbral_amarillo` ⇒ amarillo; retrocede a zona intermedia (entre recuperación y disparo) ⇒ SIGUE amarillo; cruza `umbral_recuperacion` ⇒ verde; misma mecánica para rojo→amarillo — oráculo: CI [AC-FSEM-02]
  - Probado en las dos mitades. **BD:** la migración `db/migraciones-flota/tenant/0058_signal_rule_con_histeresis.sql` crea `signal_rule` con el CHECK `signal_rule_histeresis` (`umbral_recuperacion` distinto del amarillo Y del rojo — los dos son umbrales de disparo), y el pgTAP `db/flota/pgtap/0023_histeresis_de_senales.sql` lo ejerce contra el canario (15/15): el INSERT con recuperación igual al amarillo rebota 23514, igual al rojo también, y el UPDATE que borra la banda rebota lo mismo que el INSERT — la vía real, porque el tenant edita umbrales sin deploy (§2.5); el positivo (banda válida) y la edición que conserva la banda pasan, así un CHECK que rechazara cualquier fila no daría verde. La edición queda en `audit_trail`. **Lógica:** `transicionColor` (`apps/flota/src/dominio/semaforo-histeresis.ts`) con la secuencia paso a paso en su unit (9/9). El CHECK NO exige `umbral_recuperacion < umbral_amarillo`: el sentido de la desigualdad depende de la dirección de la métrica (peor-es-mayor en % de no-entregas, peor-es-menor en SOC) y los valores seed de recuperación siguen en la pregunta 5b — hornear una dirección en el esquema fijaría una decisión que el maestro no toma. Los umbrales seed y el playbook poblado son AC-FSEM-03.
- [x] (P1) Seed Anexo B como filas: tenant provisionado desde `tenant_template` nace con los 6 dominios tenant poblados (umbral_amarillo, umbral_rojo, umbral_recuperacion, playbook NOT NULL — playbook vacío rebota: toda señal accionable o no existe); UPDATE de umbral por el tenant aplica sin deploy y queda en `audit_trail`; cero filas seed que referencien temperatura/humedad (frío = DDL-only §4.9) y cero fila «webhook pactado caído» en E1 — oráculo: CI [AC-FSEM-03]
  - Probado: `db/migraciones-flota/tenant/0059_seed_anexo_b_semaforo.sql` siembra `tenant_template` con 1 señal por dominio (la mejor especificada del Anexo B, sin invadir preguntas abiertas: ETA vivo, hora límite EV, semántica de liquidación observada) y el pgTAP `db/flota/pgtap/0024_seed_anexo_b_semaforo.sql` lo ejerce contra `t_canary` (8/8): los 6 dominios exactos poblados, playbook nunca vacío, histéresis real en cada fila, cero frío/humedad y cero «webhook», y el UPDATE de un umbral sembrado deja rastro en `audit_trail` con el valor nuevo adentro. Hallazgo adversarial durante la construcción: sembrar con el trigger de auditoría encendido dejaba filas de `audit_trail` con el tenant_id CENTINELA en la plantilla, y como `audit_trail` es append-only (§7.4) la adopción de CUALQUIER tenant nuevo (`db/flota/provisionar.mjs`) rebotaba para siempre al intentar reasignarlas — se reprodujo el rebote real provisionando `t_ruteo_activo` antes del ajuste. La migración apaga `signal_rule_auditada` para las 6 filas del seed (nace con la plantilla, nadie lo "editó") y lo vuelve a encender; el runner ×N y `apps/flota/e2e/preparar-tenants.mjs` quedaron verdes de nuevo.
- [x] (P1) Peek N1: 1 toque abre bottom-sheet sin navegación (la pila de navegación no crece); filas ordenadas por severidad × antigüedad, cada una con quién/qué/cuánto/desde cuándo + playbook de 1 línea; swipe o botón ≥48px reconoce (`nueva→reconocida`, `asignado_a`=actor); re-reconocer una ya reconocida ⇒ 422 tipado y 0 filas cambiadas — oráculo: CI [AC-FSEM-04]
  - Probado: `dominio/peek-n1.ts` (orden severidad × antigüedad — el rango de severidad decide antes que la antigüedad — y descarte de filas crudas sin los campos del peek) con su unit `peek-n1.test.ts`; `POST /api/semaforo/excepciones/[id]/reconocer` (`servidor/review-queue.ts`) transiciona `nueva→reconocida` contra `review_queue` real con `estado='nueva'` en el WHERE del UPDATE (el segundo toque nunca gana la carrera) y rebota 422 tipado con 0 filas cambiadas al re-reconocer; `guardia()` deja el endpoint solo a `admin_tenant` (§2.8) con 403/404 para el resto. `e2e/peek-n1.spec.ts` (11/11, corrido en primer plano) cubre las dos mitades: el contrato de servidor contra una fila real de `review_queue` (200/422/404/403) y la mecánica de UI del bottom-sheet (`hoy/peek-n1.tsx`, montado desde `hoy/tablero-de-hoy.tsx` como estado local — jamás navegación) sobre las semillas de AC-FSEM-01: orden, playbook visible, objetivo táctil ≥48px y la transición visual al tocar «Reconocer». `check.sh --full --app=flota` verde.
- [x] (P1) Detalle N2: 1 toque desde el peek (rojo→detalle ≤2 toques desde «Hoy», e2e que cuenta acciones y emite `toques_flujo` a `client_metric`); URL estable deep-linkeable (abrirla directo autenticado rinde el detalle); timeline de eventos + evidencia degradando sin hueco cuando no hay foto/GPS/curva SOC; resolver exige nota (`reconocida→resuelta`; sin nota ⇒ 422); e2e: el bottom-sheet N1 NO renderiza la acción de resolver para excepciones rojas (solo reconocer) y la amarilla sí puede quedar solo reconocida — el endpoint de resolver no lleva parámetro de origen, así que la restricción del rojo se verifica en la UI; una regla dura de servidor en términos de ESTADO queda sujeta a la pregunta 9 — oráculo: CI [AC-FSEM-05]
  - Probado y verde en `check.sh --full --app=flota` + `npx playwright test e2e/detalle-n2.spec.ts` (16/16). **Servidor:**
    `resolverExcepcion` (`servidor/review-queue.ts`) transiciona `reconocida→resuelta` con
    nota obligatoria contra `review_queue` REAL (el WHERE lleva `estado='reconocida'`, así
    que resolver desde `nueva` o re-resolver una `resuelta` es tan ilegal como no traer
    nota); `POST /api/semaforo/excepciones/[id]/resolver` devuelve 422 tipado
    (`nota_requerida`/`transicion_ilegal`), 404 cross-tenant, 403 fuera de `admin_tenant`.
    **UI:** `dominio/detalle-n2.ts` arma el detalle (timeline + los 4 tipos de evidencia
    SIEMPRE presentes, marcados `presente:false` cuando degradan — nunca un hueco), con su
    unit `detalle-n2.test.ts` (4/4); `hoy/excepciones/page.tsx` recibe el `id` como
    parámetro de CONSULTA (mismo criterio que `/api/agenda`, porque mientras AC-FSEM-06/09
    no exista ese `id` es literal de `semaforo-fixtures.ts`) y es deep-linkeable de verdad;
    `hoy/peek-n1.tsx` suma el enlace «Ver detalle» y jamás un botón «Resolver», ni para
    severidad roja ni amarilla. **Toques del drill-down (§5, §5.3, §4.6):** el camino
    tarjeta→peek→«Ver detalle» es EXACTAMENTE 2 toques, y el e2e de UI
    (`rojo→detalle en 2 toques desde «Hoy»`) lo recorre y cuenta las acciones sobre la
    excepción roja `exc-sync-1` de la semilla A. La emisión a `client_metric` es un
    contrato de SERVIDOR real y separado, mismo criterio que reconocer/resolver mientras
    `/hoy` siga sin sesión de tenant (AC-FSEM-06/09): `registrarToquesDrillDown`
    (`servidor/review-queue.ts`) inserta una fila `tipo='toques_flujo'` en `client_metric`
    real (precedente de `servidor/entorno.ts` para métricas puntuales fuera del lote de
    sync) vía `POST /api/semaforo/excepciones/[id]/toques` — 422 tipado si `toques` no es
    entero ≥1, 404 cross-tenant, 403 fuera de `admin_tenant`; declarado en
    `rutas/manifiesto.json` (`recurso` sobre `review_queue`) y cubierto por la suite
    A-contra-B autogenerada (`e2e/cruce-tenant.spec.ts`).
- [x] (P1) Refresco degradable: polling del digest cada 15–30 s (constante) solo con pestaña visible — con pestaña oculta 0 requests en el intervalo (test con Page Visibility simulada); digest sin cambios ⇒ 304 con ETag y sin body; pull-to-refresh fuerza GET; grep del módulo: cero `WebSocket`/`EventSource`; offline ⇒ estado «sin conexión» con contador real de cola y digest viejo marcado con antigüedad — oráculo: CI [AC-FSEM-06]
  - Probado y verde en `check.sh --full --app=flota` + `npx playwright test e2e/refresco-digest.spec.ts`.
    **Servidor:** `GET /api/semaforo/digest` (`src/app/api/semaforo/digest/route.ts`) sirve el
    Nivel 0 sobre `?seed=a|c` — mismo alcance declarado por `hoy/page.tsx` (AC-FSEM-01): la
    evaluación real de `signal_rule` es AC-FSEM-07+ y la guardia de sesión/rol es AC-FSEM-09.
    El ETag es un sha256 SOLO de `tarjetas` (nunca de un timestamp), así que el mismo seed
    devuelve el mismo ETag entre pedidos frescos y `If-None-Match` calza de verdad: 304 sin
    body cuando coincide, 200 con body si no. **Cliente:** `usar-digest-semaforo.ts` (hook)
    pollea cada `SEMAFORO.polling_segundos.min` (15 s, el piso del rango — el número sale de
    la constante, no está escrito en el hook) SOLO con `document.visibilityState === "visible"`;
    `visibilitychange` arranca/para el temporizador entero (pestaña oculta ⇒ el `setInterval`
    ni existe, 0 requests — probado con Page Visibility simulada vía `Object.defineProperty`,
    igual que pide el AC). `tablero-de-hoy.tsx` suma el botón «Actualizar» (pull-to-refresh de
    respaldo) y el banner «sin conexión» (`banner-sin-conexion`) con el contador REAL de
    intentos fallidos consecutivos (`cola-offline` — «Hoy» no encola capturas de terreno como
    el outbox del chofer, así que lo único que hay de verdad para contar acá son los intentos
    de refresco que no llegaron) y la antigüedad del último digest bueno (`antiguedad-digest`);
    las tarjetas YA cargadas se quedan a la vista, marcadas viejas — jamás un verde fingido.
    Bug real encontrado y corregido durante la construcción: `Response.json` serializa
    `record_time` como texto ISO, y `fechaEsCl`/`horaEsCl` exigen un `Date` real —
    sin revivirlo, la primera tarjeta amarilla/roja que llegaba por el digest reventaba el
    render entero («Application error» en el navegador), tumbando de paso `hoy-nivel-0.spec.ts`,
    `peek-n1.spec.ts` y `detalle-n2.spec.ts`; `revivirFechas` en el hook lo arregla. La ruta
    nueva quedó declarada en `apps/flota/rutas/manifiesto.json` (`sin_recurso`): sin
    identificador ni sesión todavía, la respuesta es literal del fixture — cero dato de tenant
    que un cruce pueda sacar hoy.
- [x] (P1) Dominio Datos/sync desde `client_metric` + eventos: fixture con `outbox_edad_max` 65 min en turno ⇒ amarillo (65 min supera cualquier punto del rango seed «>30–60 min» del Anexo B sin alcanzar el rojo de 3–4 h, así el test no depende de la respuesta a la pregunta 5a); sin sync >4 h con turno abierto ⇒ rojo; parada `done` sin fila en `evidence` tras sync ⇒ rojo; hueco de secuencia por dispositivo (§4.7) ⇒ rojo; la captura degradada que originó el flag entró 2xx (jamás rebotó, §4.2) y aparece como excepción en «Por revisar», no como error del dispositivo; una fila de `review_queue` con severidad alta (captura `post_revocacion_tardia`, §4.3) se proyecta ROJA en la tarjeta Datos/sync (proyección severidad→{amarillo, rojo} sin ambigüedad, §2.4) — oráculo: CI [AC-FSEM-07]
  - Probado: `dominio/semaforo-datos-sync.test.ts` (10/10) contra `dominio/semaforo-datos-sync.ts`,
    función pura `evaluarDatosSync` — sin migración nueva: las tres familias de hechos que
    combina ya existen desde la migración 0002 (módulo 00) y ya las escribe el módulo 04
    (`servidor/capturas.ts::dejarDichoQueDegrado`, AC-FPOD-05/07/10). La edad del outbox pasa por
    `transicionColor` (histéresis, AC-FSEM-02) con los umbrales de la fila `signal_rule` sembrada
    (`outbox_cola_edad_max_min`, migración 0059): fixture 65 min ⇒ amarillo, 4 h+1 min ⇒ rojo,
    robustos a la pregunta 5a (mismo criterio que AC-FSEM-08/11/19); un dispositivo con turno
    cerrado no evalúa. «Parada `done` sin evidence» y «hueco de secuencia» son binarias por Anexo
    B: rojo directo, sin banda amarilla. El hallazgo del AC: `severidadDeFlag("secuencia_hueco")`
    (`dominio/pod-sync.ts`, ya cerrado por AC-FPOD-10) entrega severidad `media` — la proyección
    GENÉRICA severidad→color del §2.4 (`colorDeSeveridad`: `alta`→rojo, el resto→amarillo) por sí
    sola daría amarillo, contradiciendo el «hueco de secuencia ⇒ rojo» explícito del Anexo B y de
    este AC. `colorDeExcepcionReviewQueue` resuelve la conciliación: el hueco de secuencia es la
    excepción documentada a la regla genérica (rojo siempre, por origen), y `post_revocacion_
    tardia` sí sigue la proyección genérica (su severidad ya es `alta`, mismo resultado). Un test
    dedicado prueba que la fila de `review_queue` aparece como una `ExcepcionCruda` más del
    dominio (mismo shape que las demás: playbook, quien, estado) y no como un estado de error
    aparte del dispositivo. `check.sh --full --app=flota` verde. Wiring del endpoint real
    (`/api/semaforo/digest` contra `signal_rule`/`client_metric`/`eventos` reales, hoy sirve
    literales de `semaforo-fixtures.ts` por AC-FSEM-06) queda para un AC posterior: no está en el
    texto de este AC ni su oráculo lo exige (CI, no e2e).
- [x] (P1) Dominio Turnos/conductores (un AC por dominio, §9.2 «un AC por commit»; los demás dominios: AC-FSEM-16 a 19) evalúa según Anexo B sobre proyecciones append-only de `eventos`+`turnos`+`bloques_agenda` (jamás contadores mutables; dependencia 02): fixture sin eventos por 65 min en turno ⇒ amarillo (65 min supera cualquier punto del rango seed «30–45 min» sin alcanzar el rojo de >2 h — robusto a la pregunta 5a, misma técnica de AC-FSEM-07); turno sin cerrar >1 h tras fin de bloque ⇒ amarillo; sin señal >2 h ⇒ rojo (fixture 2,5 h); turno abierto cruzando medianoche ⇒ rojo — oráculo: CI [AC-FSEM-08]
  - Probado: `dominio/semaforo-turnos-conductores.test.ts` (7/7) contra
    `dominio/semaforo-turnos-conductores.ts`, función pura `evaluarTurnosConductores` — sin
    migración nueva: el umbral con histéresis (`sin_senal_minutos`, amarillo 30 min / rojo
    120 min / recuperación 15 min) ya lo siembra la migración 0059 (AC-FSEM-03). Misma
    mecánica que el dominio hermano AC-FSEM-07: la señal de minutos sin evento pasa por
    `transicionColor` (65 min ⇒ amarillo, 2,5 h ⇒ rojo, ambos robustos al rango seed del
    Anexo B) con el qualifier «…en turno» — un turno cerrado con métrica alta no evalúa; las
    otras dos condiciones del Anexo B («turno sin cerrar >1 h tras fin de bloque»,
    «cruzando medianoche») son binarias, ya resueltas como hecho por quien llame (`turnos`
    × `bloques_agenda`), y esta función solo las proyecta a color (amarillo y rojo
    respectivamente) — mismo criterio que `paradasSinEvidencia` en AC-FSEM-07. `check.sh
    --full --app=flota` verde. Wiring del endpoint real contra `eventos`/`turnos`/
    `bloques_agenda` reales queda para un AC posterior, igual que AC-FSEM-07: no está en el
    texto de este AC ni su oráculo lo exige (CI, no e2e).
- [x] (P1) Aislamiento y roles: la suite HTTP A-contra-B autogenerada cubre TODAS las rutas del módulo ⇒ 404 con body sin centinelas de B y BD de B sin cambios (mutaciones incluidas); manifest de `chofer`/`responsable_carga`/`cliente` no contiene el tablero y sus GET al digest ⇒ 403 con 0 filas; manifest de `operador` y de `responsable_tecnico` TAMPOCO contiene el tablero y sus GET al digest ⇒ 403 (§2.8: esta spec activa solo `admin_tenant`; el aserto del `operador` se revisa al responderse la pregunta 1); ninguna respuesta del módulo entrega CLP a esos roles (RLS §4.8 verificada con el rol de app real) — oráculo: CI [AC-FSEM-09]
  - Probado y verde en `check.sh --full --app=flota` + `npx playwright test e2e/semaforo-roles.spec.ts`
    (11/11, corrido en primer plano). **Guardia:** `GET /api/semaforo/digest`
    (`src/app/api/semaforo/digest/route.ts`) ahora pasa por `guardia()`
    (`servidor/gobierno.ts`, misma puerta que reconocer/resolver/toques de AC-FSEM-04/05):
    sin sesión ⇒ 404 pelado; sesión con rol distinto de `admin_tenant` ⇒ 403 y CERO cuerpo de
    tarjetas. **Los 5 roles vetados exactos del enum** (`chofer`, `responsable_carga`,
    `cliente`, `operador`, `responsable_tecnico` — sale de `ROLES.filter(r => r !==
    "admin_tenant")`, no de una lista escrita a mano que se desincroniza del enum) devuelven
    403 con 0 filas; `admin_tenant` recibe 200 con tarjetas. **Suite A-contra-B (AC-FTEN-26):**
    el digest sigue declarado en `manifiesto.json` con `cruce.tipo="sin_recurso"` — verificado
    en el test, más las 3 rutas de mutación (`reconocer`/`resolver`/`toques`) que ya llevan
    `cruce.tipo="recurso"` desde AC-FSEM-04/05 — así que las 4 rutas del módulo entran a
    `cruce-tenant.spec.ts` sin exención. **Cero CLP:** `review_queue`, `client_metric` y
    `signal_rule` —las únicas tablas que este módulo lee (migraciones 0002 y 0058)— no tienen
    NINGUNA columna de dinero (grep-gate contra las dos migraciones), así que ni siquiera
    `admin_tenant` puede recibir un CLP de este módulo: la RLS de §4.8 no tiene qué esconder
    porque el dato no existe en el schema, y un segundo grep sobre `route.ts`/`dominio/
    semaforo.ts` vigila que ninguna respuesta arme un campo de dinero desde otra fuente. El
    hook `usar-digest-semaforo.ts` pasó de `fetch` directo a `pedir()` (`cliente/aparato.ts`)
    para viajar con el secreto de sesión persistido, y `refresco-digest.spec.ts` (AC-FSEM-06)
    quedó actualizado para enrolar una dueña real y pasar su secreto — sin eso, la guardia
    nueva le habría respondido 404 a esa suite entera.
- [x] (P1) Vista e-auto solo-`control`: el render se verifica a nivel de COMPONENTE/VISTA contra fixtures de `control` (sin depender del montaje/autenticación pendientes de la pregunta 2): muestra por tenant estado semafórico + actividad vs media móvil 7d, errores de sync, backlog, versión PWA, latencia p95 y EEVD agregada; el código del plano cross-tenant no abre conexión a ninguna BD `t_<slug>` (regla estática + test de privilegios); centinela 14: inyectar una columna de dinero/tarifa/cliente al payload del exportador ⇒ el test de schema falla en rojo; el e2e navegado con autenticación queda en AC-FSEM-24 — oráculo: CI [AC-FSEM-10]
  - Probado: `apps/flota/src/dominio/plano-eauto.test.ts` (7/7) contra `dominio/plano-eauto.ts` — la
    forma de dato que este plano consume, sin fetch ni cliente de BD propio. **Centinela 14 a
    nivel de vista:** `validarSchemaAgregadoControl` copia la MISMA lista de columnas
    (`CAMPOS_AGREGADO_CONTROL_CRUDO`, subconjunto de `COLUMNAS_DEL_AGREGADO`) y el MISMO
    vocabulario prohibido que `db/flota/suite-bd/control.test.mjs` (AC-FTEN-04, la autoridad
    real de BD); el test inyecta de verdad `monto_clp`/`tarifa_promedio`/`cliente_principal`/
    `rut_titular`/`factura_pendiente` y confirma el rebote, más una clave inventada que no huele
    a dinero pero tampoco está en el schema fijo (mismo criterio: la BD manda, esta vista no
    inventa columnas). **Regla estática + test de privilegios:** `db/flota/gate-reglas-
    estaticas.mjs` suma la regla `plano-eauto-sin-bd-de-tenant`, de alcance ACOTADO (campo nuevo
    `soloEn`, antes solo existían reglas globales) a `dominio/plano-eauto.ts` y
    `src/plano-eauto/` — el resto de la app sigue pudiendo conectarse a BDs `t_<slug>` para
    operar, que es exactamente lo que esta regla no puede tocar. 3 fixtures nuevos en
    `gate-reglas-estaticas.test.mjs`: dispara con `bdDeTenant(...)`/`poolDe("t_...")`/
    `` `t_${slug}` ``/import de `servidor/conexion`, NO dispara con el mismo texto fuera de su
    alcance (así no rompería el resto de la app, que sí necesita esas llamadas), y un archivo
    conforme pasa limpio. **Fixtures y vista:** `dominio/plano-eauto-fixtures.ts` (3 tenants de
    referencia, verde/amarillo/rojo, uno con `eevd_semanal` NULL declarado) y el componente
    presentacional `src/plano-eauto/tablero-cross-tenant.tsx` (sin `"use client"` con fetch: solo
    recibe `FilaTenantControl[]` ya armadas), no montado bajo ninguna ruta —sin URL, sin caso de
    cruce que declarar en `manifiesto.json` todavía— porque el montaje autenticado es AC-FSEM-24.
    «Actividad vs media móvil 7d» y «latencia p95» quedan en NULL declarado en todo el seed: hoy
    `agregados_tecnicos` no las computa ni las tiene como columna (gap real, no inventado);
    la vista las degrada como «pendiente», mismo tratamiento que `eevd_semanal` antes de su hito
    (AC-FTEN-04). `bash packages/metodo/scripts/check.sh --full --app=flota` verde.
- [ ] (P1) Señales cross-tenant con fixtures en `control`: tenant sin eventos un día hábil ⇒ rojo; actividad −30% vs media 7d ⇒ amarillo; errores de sync en 5% exacto ⇒ amarillo (5% cae dentro de la banda seed «1–5%» cualquiera sea su punto y no supera el rojo «>5%» — robusto a la pregunta 5a) y errores >5% sostenidos 15 min ⇒ rojo; >20% dispositivos en PWA vieja ⇒ amarillo; cola de sync >4 h ⇒ rojo; la señal «backlog creciente 2 intervalos» ⇒ amarillo queda CONDICIONADA a la pregunta 3 (sin cadencia del exportador, «intervalo» no tiene semántica cerrada — mismo tratamiento que la señal de ETA en AC-FSEM-19); canario de aislamiento en fallo ⇒ rojo máximo que NO se degrada por histéresis ni por edición de umbral (test que intenta ambas); alarma churn EEVD −30% semana/semana dispara sobre la EEVD agregada — oráculo: CI [AC-FSEM-11]
- [ ] (P1) AA y estados de pantalla: ningún estado del semáforo comunicado solo por color (texto/ícono siempre, verificable apagando CSS de color); contraste ≥7:1 en indicadores semafóricos y cifra operativa en tema claro Y oscuro (axe/Lighthouse en gate); los 4 estados obligatorios de «Hoy» (vacío accionable con CTA, skeleton <50 ms, error es-CL con recuperación, sin conexión con contador real); snapshot 375px con términos del tenant B al máximo largo sin truncar cifras; la e2e del módulo corre DOS veces (terminología base y extrema) sin cambiar un selector (data-testid/term_key) — oráculo: CI [AC-FSEM-12]
- [ ] (P1) Contracción sin residuos: apagar el feature de liquidación ⇒ sus `signal_rule` dejan de evaluar en el próximo bootstrap (el turno abierto termina con su config congelada, `turno.config_version_id`) y no nacen excepciones nuevas de ese origen; e2e tenant C: 5 tarjetas, cero CLP de tarifas visible, semáforo operativo; conmutar `mi_flota→daas→mi_flota` conserva todas las filas de `signal_rule` y `review_queue` (centinela 11 aplicado al módulo); la conducta «dominio sin ninguna señal activa no renderiza tarjeta» NO se asevera aquí — está pendiente de la pregunta 8 y vive en AC-FSEM-21 — oráculo: CI [AC-FSEM-13]
- [ ] (P2) Telemetría del módulo en producción con el piloto: digest del semáforo emitido a telemetría de producto; métrica de cola al cierre del día tendiendo a cero visible en el panel §10 (la medición de minutos del dueño vive en AC-FSEM-23, condicionada a la pregunta 6 — este AC queda completable con el piloto) — oráculo: producción [AC-FSEM-14]
- [ ] (P2) Validación en vivo del hito: revisión adversarial del hito (e) sin hallazgos críticos sobre el semáforo (datos malformados, doble-tap en ack/resolve, red cortada a mitad de drill-down, tenant A contra B); Alexis valida con capturas el camino dorado: tarjeta SLA demostrable con la farmacia del seed A, tablero del tenant B con terminología extrema, semáforo del tenant C en `mi_flota` — oráculo: humano [AC-FSEM-15]
- [ ] (P1) Dominio Flota/energía EV (partición de AC-FSEM-08 por §9.2) consumiendo las proyecciones del módulo 02 (fórmula única del §0 — este módulo no la re-especifica): SOC proyectado al fin del bloque < reserva+5 pp ⇒ amarillo; SOC actual < consumo estimado del tramo restante ⇒ rojo (fixture: SOC 20% con consumo restante proyectado equivalente a 30%); retorno proyectado <15% ⇒ rojo (fixture: retorno proyectado 10%); «no quedó enchufado» a la hora límite ⇒ rojo — el fixture fija la fila de `parametros` de la hora límite explícitamente; su default seed sigue en la pregunta 5c — oráculo: CI [AC-FSEM-16]
- [ ] (P1) Dominio Caja/custodia/liquidación (partición de AC-FSEM-08; dependencias 03 y 06): discrepancia de custodia pendiente ⇒ amarillo (fixture del módulo 03: discrepancia registrada sin resolver); liquidación observada ⇒ amarillo — cláusula CONDICIONADA a la pregunta 11 (§3.E1.9 solo define abierta→cerrada→pagada + disputa por línea; el maestro no fija qué marca deja «observada»); descuadre confirmado sin evidencia ⇒ rojo; línea disputada ⇒ rojo (dinero disputado siempre es rojo, Anexo B); con liquidación OFF esas señales no evalúan (§5.5) — oráculo: CI [AC-FSEM-17]
- [ ] (P1) Dominio DaaS/SLA (partición de AC-FSEM-08; solo modo `daas`, seed A con farmacia `otd_comprometido_pct=95`): OTD proyectado < comprometido −2 pp ⇒ amarillo; SLA incumplido en el período ⇒ rojo (fixture: OTD del período cerrado 90% contra 95 comprometido, computado de `paradas` cerradas vs ventana × `otd_comprometido_pct`, §4.5); empresa con `otd_comprometido_pct` NULL ⇒ su `signal_rule` no evalúa y sin tarjeta SLA para esa empresa (§4.5) — oráculo: CI [AC-FSEM-18]
- [ ] (P1) Dominio Entregas vs plan (partición de AC-FSEM-08; dependencia 03) sobre `paradas`: ruta con 10% exacto de no-entregas ⇒ amarillo (10% cae en la banda seed «5–10%» cualquiera sea su punto y no supera el rojo «>10%» — robusto a la pregunta 5a) y ruta con 12% ⇒ rojo; compromiso vencido sin entrega ⇒ rojo, computado de `promesa_original` CONGELADA (§4.5) con ventana vencida y parada sin entrega — NO depende del ETA vivo; la señal amarilla «ETA proyectada + tolerancia (mín. 15 min) excede ventana» sigue condicionada a la pregunta 4 — oráculo: CI [AC-FSEM-19]
- [ ] (P1) Reasignar y llamar en N2: reasignar transfiere `asignado_a` a otro usuario del tenant con `audit_trail` por trigger (PLANIFICACIÓN §4.2: valida online y rebota); reasignar sobre una excepción resuelta ⇒ 422 tipado y 0 filas cambiadas; reasignar con id de otro tenant ⇒ 404 (§0-HTTP); el detalle N2 renderiza la acción «llamar» (§5.6-N2; aserción de presencia en el e2e) — oráculo: CI [AC-FSEM-20]
- [ ] (P1) Tarjeta de dominio sin señales activas — CONDICIONADO a la pregunta 8: si el dueño confirma la derivación (§5.5 + precedente SLA-NULL §4.5), un dominio cuyas señales quedan todas apagadas no renderiza tarjeta, sin huecos ni candados fuera del panel admin (e2e con fixture de entitlements); si resuelve otra conducta (p. ej. tarjeta informativa), este AC se reescribe ANTES de implementarse — el gate no congela la conducta mientras la pregunta esté abierta — oráculo: CI [AC-FSEM-21]
- [ ] (P1) Panel interno SaaS (§10) a nivel de componente/vista contra fixtures de `control` (sin depender de la pregunta 2): EEVD agregada y POR TENANT con tendencia 4 semanas (4 valores semanales por tenant empujados por el exportador desde `eevd_semanal`); embudo de activación p50/p90 alta→primera entrega (métricas 1 y 2 del §2); tenants activos y % de vehículos con turno; calidad de la norte — % paradas sin evidencia y % PODs supersedidos EXCLUYENDO motivo=`undo` (fixture: un supersede con motivo=`undo` NO cuenta, §4.7); los agregados nuevos viajan en el schema fijo del exportador y el centinela 14 sigue verde (cero columnas de dinero/tarifas/clientes); el contador de exenciones de la suite se renderiza con tendencia — su ingesta desde el gate CI (§9.2) queda condicionada a la pregunta 10 — oráculo: CI [AC-FSEM-22]
- [ ] (P2) Minutos del dueño en el panel ≤5/día (§10) — CONDICIONADO a la pregunta 6: el enum cerrado de `client_metric` (§4.6) no trae tipo de tiempo-en-panel; el AC se activa con el mecanismo que fije la respuesta y se mide con el piloto — oráculo: producción [AC-FSEM-23]
- [ ] (P2) E2e autenticado del panel cross-tenant de e-auto — CONDICIONADO a la pregunta 2 (autenticación y montaje): navegar al panel, lista por tenant con estado semafórico y detalle de un tenant mostrando SOLO lo que `control` contiene — oráculo: CI [AC-FSEM-24]
- [ ] (P2) BLOQUEADO por la Pregunta al dueño 12 — «hints re-mostrados = bug» (§10, telemetría de producto): el concepto de hint no existe en ninguna de las 9 specs del conjunto y el enum CERRADO de `client_metric` (§4.6) no trae tipo para medirlo (misma situación que AC-FSEM-23); este módulo, dueño de la telemetría de producto y del panel §10, la reclama para que la obligación no quede huérfana y NO construye hints, ni amplía el enum, ni inventa una superficie de guía hasta la respuesta. Resuelta, el AC se reescribe ANTES de implementarse con su oráculo (fuente de la métrica + indicador en el panel §10, con «re-mostrado» como condición de alerta) — oráculo: producción (condicionado a la Pregunta 12) [AC-FSEM-25]

## Dependencias

La numeración final la fija el índice de módulos del orquestador; lo vinculante es el
hito del maestro citado en cada línea.

- **00 · Núcleo multi-tenant y plano de control (hito §9.1-a):** `tenant_template`
  (siembra de `signal_rule`), BD `control` + **job exportador** (§4.1 — fuente única
  del plano e-auto; su schema fijo es el centinela 14; este módulo le exige además
  los agregados de adopción/calidad del panel §10: EEVD semanal por tenant, hito de
  primera entrega, % vehículos con turno, % paradas sin evidencia y % PODs
  supersedidos sin `undo`, dentro del mismo schema fijo), `constants.ts` (fila
  Semáforo, polling, formatos), linter de migraciones y el GENERADOR de la suite HTTP
  A-contra-B autogenerada del manifiesto de rutas (AC-FTEN-26, §9.2), que además emite
  como artefacto del pipeline el contador de exenciones con tendencia — la fuente del
  indicador del panel §10; su INGESTA al panel sigue siendo la Pregunta al dueño 10 de
  esta spec.
- **01 · Identidad y enrolamiento (hito §9.1-b):** roles del enum fijo, sesiones y
  manifest × rol (§5.5), actor de ack/resolve/reasignar, dispositivos (origen de
  `client_metric` y de las capturas post-revocación que caen a «Por revisar»).
- **02 · Vehículos/agenda/EV (hito §9.1-c):** `turnos` (`config_version_id`,
  `semaforo_salida`, `enchufado_confirmado`), `bloques_agenda` (fin de bloque),
  proyecciones SOC/rango de la fórmula única §0 que consume el dominio Flota/EV.
- **03 · Encargos/rutas/custodia (hito §9.1-d):** `paradas`
  (estado/resultado/`promesa_original`/ETA vivo), `motivos`, `cierres_ruta` y
  ecuación por empresa (dominios Entregas y Caja/custodia).
- **04 · POD offline y outbox (hito §9.1-e):** `evidence` (señal «entrega sin
  evidencia»), `review_queue` (tabla y escala de severidad — este módulo la consume y
  transiciona), `client_metric` ingerida por el MISMO endpoint de sync (2xx siempre,
  §4.6), secuencia por dispositivo (§4.7).
- **06 · Tarifas/liquidación (hito §9.1-f):** estados de liquidación
  (observada/disputada) y `otd_comprometido_pct` del contrato para los dominios Caja
  y SLA; en su ausencia esos dominios se contraen (§5.5) — el semáforo no los
  bloquea.
- **08 · Panel admin white-label (hito §9.1-g):** pantalla «Funciones» cuyos toggles
  contraen tarjetas/señales, edición de umbrales por tenant, seeds A/B/C con los que
  corren los e2e del módulo (§10).

No depende del 07 (portal del contratante): el rol `cliente` jamás ve este semáforo
(§3.E1.10).

## Preguntas al dueño

1. **Roles del tablero «Hoy»:** F6 lo asigna al DUEÑO y §5.6-N2 habla de «gestor» sin
   mapearlo al enum §0. ¿Solo `admin_tenant`, o también `operador` (y con qué
   permisos de reconocer/resolver)? La spec activa solo `admin_tenant` mientras
   tanto.
2. **Acceso de e-auto al plano cross-tenant:** el enum de roles es por-tenant y no
   existe rol de plataforma; el maestro no define cómo se autentica e-auto ante
   `control` ni dónde se monta el panel interno SaaS (§10). ¿Mecanismo y URL?
3. **Cadencia del job exportador a `control`** → pregunta canónica: spec
   `00-modelo-datos-tenancy.md`, pregunta 8.
4. **ETA vivo en E1** → pregunta canónica: spec `03-encargos-rutas-custodia.md`,
   pregunta 4.
5. **Valores exactos del seed:** (a) punto que toma el seed dentro de los rangos del
   Anexo B («30–45 min», «30–60 min», «3–4 h», «5–10%»); (b) umbrales de
   recuperación seed (el Anexo B no trae valores y §0 los exige distintos);
   (c) «hora límite» del «no quedó enchufado» → *ver pregunta 8 de
   `02-vehiculos-energia-agenda.md`, que es la canónica (ese módulo es dueño de
   `turnos.enchufado_confirmado`); este plano solo consume su respuesta*;
   (d) valores de `review_queue.sla` por severidad (§4.6 declara la
   columna sin valores).
6. **Medición de «minutos del dueño en el panel» (§10):** el enum cerrado de
   `client_metric` (§4.6) no trae un tipo de tiempo-en-panel. ¿Se deriva de
   `eventos`, se reutiliza `toques_flujo`, o se amplía el enum (cambio de esquema que
   tocaría al módulo 04/00)?
7. **Aviso de rojo en E1:** §5.6-N2 dice «push de un rojo (gestor) deep-linkea aquí»,
   pero push está FUERA de E1 como dependencia (§3, §7.6). La spec deja el deep-link
   vivo y cero push en E1 — ¿correcto, o se quiere algún aviso no-push (p. ej. badge
   en el panel) mientras tanto?
8. **Contracción de tarjeta sin señales activas:** derivé de §5.5 (módulo apagado no
   se renderiza, sin huecos) y del precedente SLA-NULL (§4.5) que un dominio cuyas
   señales están todas apagadas no renderiza tarjeta. ¿Se confirma esa derivación?
   (Mientras esté abierta, la conducta vive solo en AC-FSEM-21, condicionado.)
9. **Regla de servidor para resolver rojas:** «el rojo lo exige» (§5.6-N2) se aplica
   en esta spec como conducta de UI (N1 no ofrece resolver para rojas, AC-FSEM-05);
   el endpoint de resolver no lleva —ni debe llevar— origen del request. ¿Se quiere
   además una regla dura de servidor en términos de ESTADO (p. ej. una roja exige
   pasar por `reconocida` antes de `resuelta` ⇒ 422 si se salta)? El maestro no la
   fija.
10. **Ingesta del contador de exenciones al panel (§10):** su fuente es el gate CI
   (§9.2: exenciones «justificadas por escrito y contadas»), no las BDs tenant ni
   el exportador de §4.1. ¿Cómo llega al panel interno SaaS (artefacto del pipeline
   leído por el panel, push del CI a `control`, u otro mecanismo)?
11. **Semántica de «liquidación observada» (Anexo B, amarillo de Caja)** → pregunta
   canónica: spec `06-tarifas-liquidacion-facturacion.md`, pregunta 6 (afecta
   AC-FSEM-17).
12. **«Hints re-mostrados = bug» (§10):** ¿existen hints en E1 y dónde (¿guía A2HS del
   enrolamiento §5.4, demo tocable del wizard §3.E1.13, primeras pasadas de un flujo
   de terreno?), o el ítem entra recién cuando exista una superficie de guía? Si
   existen: la medición exige un tipo nuevo en el enum CERRADO de `client_metric`
   (§4.6) — cambio de esquema que tocaría a los módulos 00 (DDL) y 04 (ingesta) — o
   derivarla de `eventos`. ¿Qué vía se cablea?
