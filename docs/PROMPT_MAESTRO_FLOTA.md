# PROMPT MAESTRO — Plataforma FLOTA *(codename provisional)*

**Plataforma SaaS multi-tenant de transporte de carga para vehículos eléctricos: PWA
táctil en extremo sencilla, white-label, offline-first, con dos modos de operación
(«Mi flota» y «DaaS»), visibilidad por semáforo, custodia multi-empresa con evidencia,
tarificación/facturación/cobro, y verticales que entran insertando filas — no código.**

Documento auto-suficiente, método «El Elíxir» (10 secciones). No hay decisiones abiertas:
donde dice «se hace X», se hace X. Si algo no está aquí ni en `specs/`, no existe.
Sintetizado el 02-ago-2026 por 10 investigadores de benchmarks + panel de 5 expertos +
1 adversario (16 ataques dirimidos) + verificación final de 3 refutadores (27 hallazgos
aplicados) + 6 decisiones del dueño (Alexis, 02-ago-2026): (1) la plataforma ABSORBE a
KiloRuta · (2) variable norte = EEVD · (3) piloto con 2 tenants (e-auto DaaS +
operadora de pan) · (4) codename provisional · (5) **bases de datos SEPARADAS por
tenant — cero cruce entre compañías de ninguna especie** · (6) visibilidad de e-auto en
dos planos: COMPLETA sobre su propia operación DaaS (como admin de su tenant) y
limitada a agregados técnicos/adopción sobre los demás tenants (como dueño de la
plataforma — jamás datos comerciales ajenos).

> **SUPERSESIÓN:** este prompt REEMPLAZA a `PROMPT_MAESTRO_KILORUTA.md`. KiloRuta ya no
> es una app propia: es el **primer vertical configurado** de esta plataforma (pack
> `vertical-panaderia` + tenant seed). Sus criterios de diseño (sistema Miga, regla de
> oro, POD inmutable, EV declarado, identidad RUT+PIN, liquidación=evidencia) quedan
> incorporados aquí como criterios DE PLATAFORMA.

> **HECHO VERIFICADO (corrección crítica del adversario):** KiloRuta existe SOLO como
> spec en disco — no hay código, pantallas ni schema previos. La plataforma se
> construye **greenfield contra este prompt**. La compatibilidad se demuestra con una
> lista CONGELADA: como primer ítem del hito (a) se extraen UNA vez los criterios de la
> spec a `docs/criterios-kiloruta.txt` con IDs cerrados `KR-01…KR-NN` y N total
> explícito (Alexis aprueba la lista); `docs/matriz-kiloruta.md` es una tabla MD con
> columnas `ID | tabla/constraint | test (ruta::nombre)`; el gate verifica tres cosas
> mecánicas: count(filas)==N, cada ID aparece exactamente una vez, y cada test
> referenciado existe en el repo.

---

## 0. TABLA CANÓNICA DE CONSTANTES (fuente única; `constants.ts` + `constants.md` generado)

Una sola familia de constantes para componentes Y tests. Grep-gate: número mágico de
esta familia hardcodeado fuera del archivo canónico ⇒ build rojo.

| Constante | Valor único |
|---|---|
| PK de toda tabla de dominio | **UUIDv7 generado en servidor** (jamás bigint, jamás v4) |
| Idempotencia de mutación offline | `client_uuid` UUIDv7 + `UNIQUE(tenant_id, client_uuid)` + `ON CONFLICT DO NOTHING` |
| Tenancy | **UNA base de datos por tenant** (`t_<slug>`, cluster compartido, credenciales propias por tenant; instancia dedicada = opción del plan Empresa, documentada no construida) |
| tenant_id | uuid NOT NULL en TODA tabla de dominio, con CHECK = constante de la BD (habilita FKs compuestas y consolidación/extracción futura) |
| Roles (enum FIJO, los packs no crean roles) | `admin_tenant` · `operador` · `chofer` · `responsable_carga` · `responsable_tecnico` · `cliente` |
| Dinero | CLP `bigint`, entero en unidad menor, `round_clp()` |
| Energía / temperatura / humedad / SOC | Wh `int` / centésimas de °C `int` / décimas de % `int` / `smallint` 0–100 CHECK |
| Targets táctiles | operativos **≥48px CSS** · teclas **≥64px** · botón primario **56px** full-width anclado abajo · piso WCAG 24px |
| Cifra operativa | 96px / 700 / `tabular-nums` (test que falla si falta) |
| Undo | 8 s (única confirmación de capturas; semántica §4.7) |
| Labels renombrables | navegación **≤12** caracteres · títulos ≤24 · descripciones ≤40 · singular+plural obligatorios · prohibidos `# $ % ; < = >` |
| HTTP | recurso de otro tenant = **404 siempre** (nunca 403) · módulo apagado = **403** SOLO en endpoints de planificación/lectura · sync de captura = **2xx siempre** (si el módulo se apagó con turno abierto, la captura entra con flag `modulo_apagado` + Por revisar — manda `turno.config_version_id`) |
| Capacidad (oráculo del k6 semanal) | 2.000 dispositivos con turno abierto y 5.000 usuarios concurrentes por célula · 100 replays/s sostenidos · p95 bootstrap <400 ms · p95 sync <250 ms |
| Drift de reloj | >5 min ⇒ flag, jamás rebote |
| PIN | 4 dígitos, argon2id, lockout 5 intentos **por usuario** (jamás por dispositivo), backoff server-side |
| EV (fórmula ÚNICA de energía) | `rango_efectivo = autonomia_nominal × SOH × factor_consumo (0,85; override en parametros)` — SIN reserva; la reserva (15%) se resta en UN solo lugar: semáforo Alcanza/No alcanza y `max_distance = SOC% × rango_efectivo − reserva_km` · umbrales de alerta 30/20/15/10% · máx 3 capturas de SOC por turno |
| SOC | CHECK 0–100 SOLO en la proyección `vehiculos.soc` (trigger clampa + flag); `reading.valor_int` NO lleva CHECK de rango — la captura fuera de rango entra con flag (§4.2) |
| Semáforo | dos umbrales (amarillo/rojo) + umbral de recuperación DISTINTO (histéresis) · máx 6 tarjetas |
| Invitación de enrolamiento | multi-uso, expira 7 días, revocable en 1 toque |
| Grant de soporte | 24 h o 7 días, expiración automática, apagado por defecto |
| Plazos legales | pago default 30 días (Ley 21.131) · reclamo de factura 8 días (Ley 19.983) · disputa de liquidación 7 días |
| Tarifas | catálogo de **5 conceptos**, máx **4 activos** por empresa cliente · zonas máx 5 |
| Formatos | es-CL: `$12.500`, `dd-mm-aaaa`, RUT `12.345.678-5`; grep: cero strings visibles en inglés |

---

## 1. ROL Y PANEL

Actúas como panel permanente: **arquitecto de plataforma multi-tenant** (preside y
dirime), **PM de producto SaaS logístico**, **diseñador de producto iOS (HIG)** dueño
del sistema Miga y de la operación en terreno (guantes, frío, sol, apuro), **arquitecto
de datos Postgres**, **auditor de seguridad/QA adversarial** (aislamiento multi-tenant,
anti-falsificación, Ley 21.719) y un **adversario** que intenta romper lo que los demás
den por bueno.

Reglas de desempate, en orden:
1. **Regla del presidente** para toda decisión estructural: *«¿sirve a KiloRuta hoy sin
   bifurcar código Y a un tenant o vertical nuevo mañana sin migrar esquema?»* — si una
   propuesta exige fork, columna por vertical o deploy por cliente, se rechaza sin debate.
2. **Regla del PM** para todo empate de producto: ¿mueve la EEVD? Si dos opciones la
   mueven igual, gana la que sea configuración por filas en vez de código.
3. Ante duda normativa chilena (SII, MINSAL, 21.719), manda el auditor.

## 2. OBJETIVO ESTRATÉGICO

**Variable norte: EEVD — Entregas con Evidencia por Vehículo-Día activo** (decisión del
dueño). Definida EN TÉRMINOS DEL ESQUEMA §4.5 (los nombres `entregado/no_entregado`
son alias de UI, jamás de esquema): numerador = paradas tipo `entrega` con
`estado='done'` y `resultado IN ('exito','parcial')` que tengan ≥1 fila válida en
`evidence`; denominador = vehículos-día con turno abierto; las `cancelled` no cuentan
en ninguno de los dos. El `fallo` con evidencia se reporta aparte como «paradas
cerradas con evidencia» (métrica de disciplina — un día de puros fallos documentados
NO sube la norte). Se computa de una vista SQL sobre eventos append-only, jamás de
contadores mutables:

```sql
-- vista eevd_semanal(tenant_id, semana, entregas_con_evidencia, vehiculos_dia, eevd)
-- nace en E1 junto al primer módulo operativo; misma fuente que la liquidación.
```

**Régimen dual (corrección del adversario — la EEVD es incomputable sin tenants):**
- **Durante la construcción y con <5 tenants activos:** el arbitraje usa gates proxy
  100% ejecutables en CI — presupuesto de toques por flujo (e2e que cuenta eventos de
  toque), replay doble ⇒ 1 fila, wizard de alta completable por script en <15 min
  contra el stack local de CI (docker-compose: Postgres + app en modo producción; NO
  existe «staging» en este prompt), cero fugas cross-tenant.
- **Desde n≥5 tenants activos:** gobierna la EEVD, con meta POR VERTICAL almacenada
  como columna de `vertical_template` (una ruta de pan hace 20+ paradas; una mudanza, 2
  — jamás una meta global en prosa). Ningún criterio de etapa referencia metas EEVD
  antes de ese umbral.

**Métricas de plataforma obligatorias (todas medibles):** (1) alta de tenant
self-service → primera ruta tocable <15 min con datos demo; (2) tiempo alta→primera
entrega real con evidencia p50 <4 h, p90 <24 h; (3) rebrand de un tenant = 1 UPDATE,
cero deploys; (4) activar un vertical = INSERT de filas, cero migraciones; (5) cero
incidentes de fuga cross-tenant (gate en CI); (6) captura con 0 señal y replay doble ⇒
exactamente 1 fila; (7) offboarding = entrega al tenant de SU base de datos completa
(`pg_dump` de su BD — portabilidad 21.719 y argumento de venta).

**Piloto (decisión del dueño):** DOS primeros tenants reales en paralelo — **e-auto
DaaS** (vehículos propios EV48 prestando transporte a 1..N empresas contratantes; en E1
opera con rutas manuales y maestras, las rutas optimizadas entran con E2) y **la
operadora de reparto de pan** (ex-KiloRuta: consolidación multi-panadería de madrugada,
rutas maestras fijas). Juntos validan el modo daas, los dos esquemas de ruteo y el
aislamiento con datos reales; el modo `mi_flota` se valida con el tenant demo C del
seed (§10) + el test centinela 11.

**Filtro único de alcance** (tres partes, las TRES deben ser SÍ para entrar al core):
*«¿Hace que un tenant logre MÁS entregas con evidencia por vehículo-día, SIN exigir
hardware ni tecnología de captura obligatoria, y puede activarse/apagarse por filas de
configuración en vez de código por vertical?»* Falla 1 → fuera del roadmap. Falla solo
2 → catálogo de integraciones opcionales. Falla solo 3 → se rediseña como configuración.
Aplica también —y especialmente— a los pedidos de los tenants piloto.

## 3. QUÉ HACE (ALCANCE POR ETAPAS — listas cerradas)

### El selector de modo (pedido del dueño, decisión cerrada)

`tenants.modo ∈ {mi_flota, daas}` — un botón al crear la operación, conmutable después
desde el panel admin. Los modos son **presets del mismo sistema de entitlements**, no
código distinto:
- **«Mi flota»**: la empresa administra su flota para sí. Existe UNA empresa_cliente
  implícita (= la propia, creada por trigger); tarifas, liquidación por cliente, portal
  del contratante y facturación quedan OFF y ocultos. Queda lo operativo puro.
- **«DaaS»** (delivery-as-a-service; caso e-auto): 1..N empresas contratantes, carga
  consolidada, tarifas/contratos, liquidación con evidencia, portal del contratante con
  visibilidad dual, facturación y cobro.
Cambiar de modo es **aditivo, jamás destructivo** (test centinela: conmutar
mi_flota→daas→mi_flota no pierde ni una fila).

### E1 — MVP (lista cerrada SÍ)

1. **Núcleo multi-tenant:** BD-por-tenant provisionada desde `tenant_template` en el
   wizard + plano de control + credenciales por tenant (§4.1), resolución por
   subdominio (`*.plataforma.cl`), `tenant_theme`, `tenant_terminology`, entitlements
   (3 tablas), roles fijos, grupos jerárquicos de visibilidad, selector de modo.
2. **Identidad y enrolamiento gobernado por el dueño** (§5.4): invitación QR/link por
   rol vía WhatsApp/SMS, solicitud→aprobación en 1 toque, dispositivo enrolado
   (secreto emitido UNA vez contra clave pública del aparato), dispositivo compartido
   de andén, re-enrolamiento como flujo normal, revocación soft con efecto inmediato,
   soporte sin god-mode (grant del dueño con expiración).
3. **Vehículos:** alta en <2 min (patente + tipo; resto progresivo), documentos con
   vencimiento (revisión técnica, permiso, SOAP) con recordatorios, EV de primera clase
   (batería Wh, autonomía nominal, SOH), inspecciones pre/post con defectos como filas
   (cadena Fleetio: chequeo → defecto → issue → resolución), lecturas en tabla `reading`
   genérica con `fuente='declarada'`.
4. **Agenda:** bloques por vehículo (`ruta|recarga|mantencion|descanso`) con EXCLUDE
   por solape; la recarga es plan (rebota) Y captura al cierre (jamás rebota);
   «duplicar semana» clona los bloques reales de 7 días atrás.
5. **Encargos → paradas → ítems:** encargo en <10 s (empresa + destino + bultos;
   `fecha_servicio` default hoy); «duplicar encargos de ayer»; paradas tipo
   carga/entrega; entrega parcial de primera clase por ítem; motivos de catálogo por
   tenant; agrupación de encargos de N empresas al mismo destino en UNA parada.
6. **Rutas:** manuales y **rutas maestras** editables (drag & drop solo en escritorio).
   El VRP es E2. Custodia multi-empresa: sub-manifiestos por parada de carga, firma por
   PIN, DTE asociado antes de abandonar la parada (con vía «bajar del manifiesto»),
   ecuación de cierre por empresa (cargado = entregado + devuelto + faltante declarado).
7. **POD offline-first** (núcleo): ≤4 toques, foto/GPS como mejoras progresivas (jamás
   dependencias), `dejado_en_punto` de primera clase, no-entrega = motivo + estado,
   100% offline con outbox idempotente, undo 8 s con semántica cerrada (§4.7).
8. **Tarificación:** rate card por empresa cliente, catálogo cerrado de **5 conceptos**
   (`por_entrega`, `por_bulto`, `por_bloque_horas`, `por_devolucion`,
   `por_intento_fallido`), máx 4 activos; zonas (≤5, por comunas) y recargo horario como
   MODIFICADORES de por_entrega, no conceptos; append-only con `vigente_desde`;
   cotización = rate card en borrador + volúmenes hipotéticos → al aceptar es la v1
   (quote = contrato, cero re-digitación).
9. **Liquidación línea=evidencia:** cada línea nace de exactamente UNA evidencia
   (`entrega_pod|cierre_turno|devolucion|sesion_recarga`), `UNIQUE(tenant, tipo, id)`,
   cero líneas manuales por construcción; estados abierta→cerrada→pagada; disputa por
   línea con motivo tipado (ventana 7 días); drill-down línea→evidencia a 1 clic.
10. **Portal del contratante** (modo DaaS; visibilidad dual): rol `cliente` scoped por
    `empresa_cliente_id`, namespace `/cliente/*` en la misma PWA, 4 pantallas: Hoy ·
    Encargos (con evidencia) · Nuevo/Importar CSV (nace `solicitado`; el operador
    acepta/programa; editable solo hasta aceptación) · Liquidación (línea por línea con
    disputa). JAMÁS ve: otras empresas, rutas completas, telemetría EV, economía del
    operador.
11. **Semáforo «Hoy»** (§5.6): 5 tarjetas-dominio (+1 de SLA por contrato en modo daas;
    máx 6, §0) + cola «Por revisar» con ack/resolve; polling 15–30 s con ETag;
    drill-down 3 niveles.
12. **EV declarado completo:** SOC en 3 momentos, semáforo «Alcanza/No alcanza» con la
    fórmula ÚNICA del §0 (`rango_efectivo` sin reserva; la reserva se resta solo en el
    semáforo y en `max_distance`), bloque de recarga, alerta «no quedó enchufado»,
    tablero «Listos para salir», reporte ahorro vs diésel en CLP (argumento de venta
    n°1; el chofer jamás lo ve).
13. **Onboarding self-service:** wizard 4 pasos ≤15 min (empresa+vertical siembra
    plantilla completa con demo tocable → vehículo+chofer real → paradas CSV/manual →
    primera parada completada).
14. **Eventos append-only** + audit_trail + sha256 write-once en binarios + supersede +
    doble reloj + secuencia monotónica por tenant. Los **10 ganchos de extensión**
    SOLO como esquema donde la tabla del §4.9 diga DDL-only.
15. **Cumplimiento 21.719 desde E1:** tabla `personas` separada con ID opaco,
    anonimización sin tocar el ledger, argon2id, RUT enmascarado en logs, minimización
    (GPS off por defecto, fotos opcionales), DPA en términos del tenant, export ARCO,
    `retention_policy`, bitácora de accesos del admin.

**FUERA de E1 (explícito):** optimizador VRP · facturación DTE y pagos · tracking
público del destinatario · billing SaaS (Stripe) · webhooks/API pública · telemetría
OBD/OCPP/API OEM e integración de loggers · UI de cadena de frío y disposición farma
(solo esquema) · apps nativas · barcode (módulo opcional post-MVP) · push como
dependencia · custom domains · multi-idioma · IA/agentes · torre de control en vivo y
mapa de puntitos · form-builders y campos custom por usuario · marketplace de turnos ·
remuneraciones · emisión de DTE por la app (PROHIBIDA siempre, §7).

### E2 — DaaS completo + venta self-service
Módulo **VRP** (VROOM ≥1.14 + OSRM self-hosted, extract Chile, tras interfaz
`RouteOptimizer`; toggle por operación; pickup&delivery con capacidad en bultos;
EV como `max_distance = SOC% × rango_efectivo − reserva`; 1 clic «Optimizar día»,
propuesta SIEMPRE editable, re-optimización parcial solo sobre pendientes; geocoding
Google con pin confirmado; sin lat/lng confiable ⇒ fuera del solver, orden manual) ·
**Facturación** vía puerto `EmisorDTE` con credenciales POR TENANT (adapter #1
Openfactura/Haulmer — $360.000+IVA/año DTE ilimitados, Idempotency-Key, sandbox;
adapter #2 SimpleAPI para tenants chicos; registro manual de folio como camino paralelo
permanente): liquidación cerrada → pre-factura inmutable → emisión → folio+XML+PDF →
estado SII (webhook + polling); **IVA 19% afecto, DTE 33** (verificado: la exención
art. 13 DL 825 es solo pasajeros); anulación solo por nota de crédito · **Pagos:**
emitida→parcial→pagada (vencida = flag derivado), registro manual con parciales, aging
0-30/31-60/61+, recordatorio manual con botón, bloqueo suave opcional (solo NUEVAS
órdenes, >15 días vencido tras 2 avisos, decisión humana; JAMÁS rutas en curso, carga
retenida ni portal cerrado) · tracking público por token firmado por-encargo (expira,
solo lectura, brandeable) · billing SaaS Stripe + página pública de precios ·
webhooks firmados por tenant · reportes OTIF y Pareto de motivos · integridad etapa 2:
`event_id` = hash SHA-256 canónico del evento.
**Criterio de entrada (lo evalúa Alexis en el panel, no el motor):** tenant B (pan) con
14 días consecutivos en producción con ≥95% de entregas con evidencia + tenant A
(e-auto) con 7 días operando con rutas manuales y ≥90% de entregas con evidencia (el
VRP no puede tener como prerequisito el éxito pleno de la operación que lo necesita) +
suite de aislamiento verde en CI.

### E3 — Retail última milla + frío básico
PIN del destinatario como `stop_requirement` · UI de frío (lectura manual, indicador
go/no-go, excursión derivada, disposición firmada por `responsable_tecnico`,
transferencia de custodia) · registro reforzado de guía 52 del cliente (Res. Ex.
154/2025: folio por entrega + RUT transportista y patente por ruta expuestos) ·
conciliación bancaria/botón de pago (ETpay con tope 0,069 UF antes que % sin tope) ·
recordatorios automáticos T-3/T+1/T+7 · integridad etapa 3: hash encadenado por tenant
+ ancla diaria exportada fuera de la plataforma.
**Criterio de entrada:** ≥10 tenants con actividad semanal o 1 tenant pagando del
vertical; con EEVD ≥ meta en los existentes SI n≥5 tenants, o gates proxy verdes
(toques, replay, aislamiento) si n<5 (§2, régimen dual). Además E3 entrega el **módulo
opcional de barcode** (captura por cámara como mejora progresiva; fallback SIEMPRE:
digitación manual del código — el tipo `escaneo_codigo` existe en `evidence` desde E1
como DDL).

### E4 — Farma + telemetría
Pack NT 208 (cadencia, retención, calificación de vehículo — cifras confirmadas contra
el Dto. Ex. 48/2019 ANTES de codificarlas) · `ProveedorTelemetria` implementaciones
reales (smartcar|geotab|ocpp) · ingesta de loggers nube/archivo · MKT · EPCIS 2.0.
**Criterio de entrada:** contrato o LOI firmada de cliente farma/frío regulado — JAMÁS
construir compliance sin cliente.

## 4. MODELO DE DATOS (Postgres — canónico, resuelve el panel; correcciones del adversario aplicadas)

### 4.1 Contrato multi-tenant (innegociable) — AISLAMIENTO FÍSICO POR TENANT
**Decisión del dueño (02-ago-2026, revierte la recomendación pool+RLS del panel y
queda registrada): las bases de datos se separan por tenant. Cero cruce entre
compañías, de ninguna especie.**

- **Una base de datos por tenant** (`t_<slug>`) en un cluster Postgres gestionado
  compartido, creada al alta desde **`tenant_template`** (`CREATE DATABASE …
  TEMPLATE` — segundos, dentro del wizard; la plantilla es un artefacto versionado del
  repo y es la 4ª vida de todo cambio de esquema). Plan Empresa puede comprar
  INSTANCIA dedicada (misma plantilla, otro host) — documentado, no construido en MVP.
- **Credenciales propias por tenant:** rol `app_t_<slug>` (NOSUPERUSER, NOBYPASSRLS,
  sin ownership) con `CONNECT` SOLO a su BD. Un bug de routing no puede cruzar datos:
  la conexión de A físicamente no alcanza la BD de B. Test de privilegios en CI.
- **Plano de control** (BD `control`, sin datos operativos de dominio): registro de
  tenants (slug→BD, plan, modo, estado), entitlements/billing SaaS, invitaciones de
  tenant nuevo, grants de soporte, y **agregados técnicos empujados por un job
  exportador** desde cada BD tenant (salud, adopción, EEVD agregada, backlog de sync).
  La vista cross-tenant de e-auto lee SOLO de `control`: la separación física
  garantiza estructuralmente que e-auto no ve datos comerciales del tenant. El payload
  del exportador tiene schema fijo testeado: cero columnas de dinero/tarifas/clientes.
- **Ruteo:** subdominio → lookup en `control` → pool de conexiones de SU BD (PgBouncer
  multi-database, límite de pool POR tenant para que uno no agote el cluster).
- **Dentro de cada BD tenant:** `tenant_id uuid NOT NULL` persiste en toda tabla de
  dominio con `CHECK (tenant_id = (SELECT id FROM tenant_info))` — conserva las FKs
  compuestas `(tenant_id, id)`, el `client_uuid` único y deja abiertas ambas vías
  futuras (consolidar tenants chicos o extraer uno gigante) sin migrar dominio. RLS
  queda para las políticas **de ROL** (dinero invisible a chofer/responsable_carga
  §4.8; rol `cliente` confinado a su `empresa_cliente_id` — el aislamiento ENTRE
  EMPRESAS CONTRATANTES del mismo operador sigue siendo por política en BD + vistas).
  `set_config('app.current_role', $2, true)` por transacción (SET LOCAL siempre).
- **Migraciones ×N como código:** runner que itera todas las BD tenant — primero el
  tenant canario sintético `t_canary`, luego el resto; `schema_migrations` por BD; el
  deploy NO se declara verde con alguna BD rezagada (gate). Rol `migrator` separado.
- **Prohibido:** consultas cross-database en runtime del producto; toda agregación
  cross-tenant pasa por el exportador a `control` (agregados, jamás filas de dominio);
  cache keys, colas, jobs, logs y backups SIEMPRE segregados por tenant.

### 4.2 Regla de oro (contrato del motor de sync, implementado UNA vez en el core)
- **PLANIFICACIÓN** (agenda, tarifas, certificaciones vigentes, estados de documentos,
  asignaciones): valida online y REBOTA con error tipado (422).
- **CAPTURA** (chequeos, lecturas, POD, devoluciones, cierres de recarga, respuestas de
  checklist, custodia): el mundo físico ya ocurrió — **JAMÁS rebota al sincronizar**
  (2xx siempre): degrada a flag + evento + fila en `review_queue`. La validación
  bloqueante corre en el CLIENTE contra el snapshot. Clasificación explícita
  `COMMENT ON TABLE` (PLANIFICACIÓN|CAPTURA) exigida por el linter de migraciones.

### 4.3 Identidad, enrolamiento y actores (tabla actor→rol cerrada)
- **personas**(id, tenant_id, nombre, rut UNIQUE por tenant CHECK módulo 11, contacto,
  anonimizada_en NULL) — separada de todo hecho operativo; los eventos referencian ID
  opaco (Ley 21.719: supresión = anonimizar la fila sin tocar el ledger).
- **usuarios**(persona_id, rol enum FIJO — mapeo cerrado: dueño=`admin_tenant`,
  responsable de carga=`responsable_carga` (rol propio del enum, decisión cerrada),
  QF/calidad=`responsable_tecnico`, contratante=`cliente` con `empresa_cliente_id NOT
  NULL` —, pin_hash argon2id, intentos_fallidos, bloqueado_hasta, activo).
  Matriz rol × ve-dinero × firma: chofer y responsable_carga JAMÁS ven CLP;
  cliente ve SOLO su liquidación vía vistas; firmas con significado según rol.
- **invitaciones**(rol, token_hash, expira_at +7d, revocada_at, multi-uso) — dan
  derecho a SOLICITAR, jamás a entrar.
- **solicitudes_acceso**(persona propuesta, dispositivo huella pública, estado
  pendiente→aprobada|rechazada) — la aprobación del dueño (1 toque) empareja
  usuario+dispositivo+rol y RECIÉN AHÍ emite el secreto contra la clave pública.
- **dispositivos**(tipo personal|anden, secreto_hash emitido una vez, storage_persisted
  bool, **is_standalone bool** — el enrolamiento NO se completa sin display-mode
  standalone Y persist() concedido (corrección del adversario) —, enrolado_por,
  revocado_at soft). 1 dispositivo personal activo por operario; re-enrolamiento =
  flujo de primera clase que revoca el anterior en el mismo acto. Capturas offline de
  dispositivo revocado que llegan ≤72 h: cuarentena con flag `post_revocacion`; >72 h:
  igual sincronizan 2xx con flag `post_revocacion_tardia` + review_queue severidad alta
  + evento. La distinción es solo severidad de la revisión — JAMÁS se descartan ni
  rebotan.
- **firmas** append-only(persona, dispositivo, objeto_ref, significado enum
  {recibio_conforme, libero, rechazo, verifico, aprobo}, ts_servidor) — la firma
  puntual por PIN en dispositivo ajeno NO abre sesión ni desplaza la del propio.
- **grants_soporte**(otorgado_por dueño, alcance solo-lectura|módulos, expira 24h|7d,
  begin/end en auditoría visible del tenant) — soporte de la plataforma SIN god-mode:
  cero visibilidad por defecto, sin endpoint de impersonación; break-glass solo con
  doble control + notificación forzosa + registro inmutable.

### 4.4 Configuración por tenant
**control.tenants**(slug=subdominio, bd, plan_id, modo mi_flota|daas, estado) +
**tenant_info**(fila única en cada BD tenant: id, slug) · **tenant_theme**
(logo_url, accent_color RECHAZADO si <4.5:1, extras) · **tenant_terminology**
(term_key, singular, plural; CHECK de largo POR TIPO de term_key: navegación ≤12;
términos de sistema/auditoría excluidos por CHECK) · **features**(lookup_key, module) ·
**plan_features** · **tenant_feature_overrides**(enabled, motivo) — entitlement
efectivo = override ?? plan; límites cuantitativos como columnas del plan ·
**vertical_template**(vertical, terminologia, motivos[], checklists[], cargo_types[],
config_ev, **meta_eevd**) · **grupos**(padre_id) árbol único de visibilidad ortogonal
al rol · **parametros** por tenant (reserva_pct, factores, umbrales, tarifa_kwh_clp,
precio_diesel_litro_clp, bultos_max_sin_receptor…).
**Toda la config viaja VERSIONADA y CONGELADA en el snapshot del turno**
(`turno.config_version_id`): un turno corre entero con UNA versión; cambios aplican al
turno siguiente.

### 4.5 Operación
**empresas_cliente**(rut, razón social, direccion_retiro, contacto; en modo mi_flota
existe 1 implícita) · **contratos/tarifas**(concepto CHECK en los 5 del catálogo,
precio_clp, vigente_desde; UPDATE de precio ⇒ RAISE; máx 4 activos; modificadores zona
≤5 por comunas y recargo horario; `otd_comprometido_pct smallint NULL CHECK (BETWEEN
50 AND 100)` — con NULL la tarjeta SLA no se muestra para esa empresa y su signal_rule
no evalúa) · **vehiculos**(patente UNIQUE por tenant, tipo,
capacidad_bultos/kg, bateria_wh, autonomia_nominal_km, wh_por_km_base, soh_pct,
odometro/soc SOLO mantenidos por trigger de chequeos, external_ids jsonb) ·
**vehiculo_documentos**(tipo, vence_el, sha256) — vencido REBOTA planificación si el
feature está ON · **chequeos** sobre `inspectable` polimórfico + **defectos** con ciclo
propio (apto deriva del último chequeo firmado) · **turnos**(EXCLUDE solape con WHERE
estado<>'anulado'; config_version_id; semaforo_salida; enchufado_confirmado) ·
**bloques_agenda**(ruta|recarga|mantencion|descanso) · **encargos**(empresa_cliente_id,
destino_id, cargo_type_id, attrs jsonb validado por trigger, bultos 1–500, estado por
máquina con finales solo-por-trigger, reintento_de, detalle_externo jsonb, estado
`solicitado` cuando lo crea el cliente) · **destinos**(lat/lng NULL CHECK Chile,
geo_confianza rooftop|interpolado|manual|sin_geo, pin_confirmado bool, notas_acceso) ·
**rutas**(origen maestra|optimizada|manual, version, km/min estimados,
km_presupuesto_energia) · **paradas**(tipo carga|entrega|recarga, orden, ventana,
promesa_original CONGELADA aparte del ETA vivo, estado cerrado
pending→…→done|cancelled, resultado exito|fallo|parcial, motivo_id, metodo_entrega) ·
**items**(qty_planificada/entregada/rechazada, motivo_item, uom, lote_id NULL) ·
**manifiestos + manifiesto_items** (sub-manifiesto por parada de carga, DTE gate con
vía «bajar», doble firma o una si misma persona) · **entregas_pod** write-once con
supersede + `UNIQUE(encargo) WHERE cerrada AND supersede IS NULL` · **devoluciones** ·
**cierres_ruta** con ecuación por empresa calculada por función SECURITY DEFINER ·
**motivos** por tenant(estado_asociado, require_notes, orden; se apagan, jamás DELETE).

### 4.6 Hechos, evidencia y lecturas (append-only: REVOKE UPDATE/DELETE + trigger)
**eventos**(UUIDv7, tipo catalogado, objeto, actor, dispositivo, event_time+tz_offset,
record_time, payload, client_uuid, event_hash; prev_hash desde E3; secuencia monotónica
por tenant = orden autoritativo; el estado visible es proyección) · **reading** ÚNICA
para odómetro/SOC/temperatura/humedad (magnitud FK, valor_int, fuente enum
{declarada, archivo_logger, api_fabricante, sonda_vehiculo, obd, ocpp}, contexto, doble
reloj, instrumento?, turno?, parada?; idempotencia doble: client_uuid Y
(instrumento, sensor, ts_dispositivo); monotonicidad del odómetro SUAVE) ·
**evidence** — LA MISMA tabla para POD y verticales (tipo {firma, foto, lectura,
indicador_visual, archivo_logger, documento, pin_destinatario, escaneo_codigo},
sha256 NOT NULL en binarios, write-once; el sha256 viaja en la mutación ANTES del
binario; mismatch al re-hashear ⇒ flag, no rebote) · **client_metric** append-only
(dispositivo_id, tipo enum {toques_flujo, eviccion_idb, persist_denegado,
outbox_profundidad, outbox_edad_max, pwa_version, sync_error, latencia_ms}, flujo NULL,
valor_int, ts, client_uuid UNIQUE) — ingerida en lote por el MISMO endpoint de sync
(2xx siempre); los paneles de §10 leen SOLO de aquí y de eventos · **stop_requirement**(parada, tipo_evidencia,
obligatorio, orden) derivado del cargo_type — el flujo del operario SE ARMA POR DATOS;
cero condicionales por vertical en la UI · **review_queue**(origen, severidad,
asignado_a, sla, estado nueva→reconocida→resuelta con nota) · **audit_trail** por
trigger, retención ≥ la del registro · **custody_transfer**(de, a, sello, firma) ·
**energy_entry** type fuel|charge · **liquidaciones + lineas** (§3.E1.9) ·
**pre_facturas/facturas**(folio, xml, pdf, track_id, estado SII)/**pagos**/
**notas_credito** (E2) · **reference_document**(DTE 33/39/52/61, folio, emisor;
UNIQUE(tipo, folio, emisor); la app JAMÁS emite) y **lot**(tlc, vencimiento) nullables
desde el día 1.

### 4.7 Outbox y undo (correcciones críticas del adversario — semántica cerrada)
- El outbox del cliente se particiona por (tenant, usuario) y **JAMÁS se purga**: al
  autenticarse otra identidad en el mismo dispositivo se purga SOLO el snapshot
  (re-descargable); las capturas de A persisten firmadas por el enrolamiento y se
  replayean aunque B esté autenticado. **Test centinela 9 obligatorio.**
- **Undo 8 s:** la captura se escribe INMEDIATAMENTE al outbox local con estado
  `pending_undo`; undo dentro de 8 s = mutación cancelada ANTES del replay (jamás sale
  del dispositivo); si el replay ya ocurrió, undo = supersede con motivo=`undo`
  EXCLUIDO por definición SQL del métrico de gaming. Tests: (a) captura + kill de la
  app a los 3 s ⇒ al reabrir, la mutación existe y se replayea; (b) undo post-replay ⇒
  2 filas, original intacta, vista de gaming no la cuenta.
- Secuencia monotónica por dispositivo; huecos ⇒ evento + Por revisar (evicción o
  manipulación), nunca pérdida silenciosa. Replay-on-startup y replay-on-online como
  camino PRINCIPAL (Background Sync solo acelerador; Safari no la tiene).

### 4.8 Dinero invisible en la BD
Tablas con montos (tarifas, liquidaciones, líneas, facturas, pagos, costos de energía):
política RLS adicional `AS RESTRICTIVE` **declarada `FOR SELECT` únicamente**
(corrección del adversario: una RESTRICTIVE total rebotaría el INSERT del cierre de
recarga del chofer) que exige `app.current_role NOT IN ('chofer','responsable_carga')`.
El flujo del chofer NUNCA contiene campos monetarios: el cierre de recarga captura solo
SOC/kWh; `costo_clp` lo completa el operador o lo deriva un trigger de
`tarifa_kwh_clp`. Tests: chofer cierra recarga offline+replay ⇒ 2xx, fila con costo
NULL, cero rebotes; chofer SELECT sobre toda tabla de montos ⇒ 0 filas.

### 4.9 Extensión por vertical (los 10 ganchos; qué está VIVO en E1)
Mecanismo: **registro de atributos tipado** (`attribute_definition` versionada +
columna `attrs jsonb` validada por TRIGGER contra la definición vigente) — NI tablas
satélite por vertical NI jsonb libre. Series y datos agregables SIEMPRE a tablas
genéricas (reading, energy_entry, eventos), jamás a jsonb. Un vertical nuevo = INSERT.

| Pieza | E1 |
|---|---|
| cargo_type (raíz de extensión) | **VIVA** |
| attribute_definition + attrs validado | **VIVA** |
| stop_requirement (flujo por datos) | **VIVA** |
| reading para condiciones (temp/hum) | **VIVA** (tabla; sin seeds de frío) |
| thermal_profile / alarm_rule | DDL-only; CHECK vivo: prohibido activar alarm_rule `cumulative` o feature de compliance a tenant cuya única fuente sea `declarada` (matriz de honestidad, §7) |
| excursion (derivada por trigger, recalculable ante backfill) | trigger VIVO pero inerte sin alarm_rules sembradas |
| disposition + auto-release | DDL-only (UI en E3) |
| instrument / vehicle_certification | tablas VIVAS; rebote de planificación activo solo con feature ON |
| lot / reference_document | columnas nullables VIVAS |
| ProveedorTelemetria | interfaz con única implementación `declarada` |

## 5. INTERFAZ (verificable con captura; si no puede fallar, no entra)

### 5.1 Sistema de diseño «Miga» generalizado
Tokens ESTRUCTURALES = constantes de plataforma NO configurables (tabla §0 + system
font stack, escala iOS 34/17/15/13/11pt, grilla 8px, radio 12px tarjetas y cápsula en
controles, una acción primaria por pantalla, máx 2 niveles de profundidad, ningún
estado solo por color, dark mode automático de serie — los turnos parten de madrugada).
El tenant personaliza EXACTAMENTE tres cosas, como filas: logo, UN color de acento (la
plataforma deriva pressed/disabled/dark y lo rechaza si <4.5:1) y el diccionario de
terminología (reglas §0; resolución tenant → vertical → base es-CL en UNA capa de copy;
el admin ve el término canónico entre paréntesis). Arquitectura de tokens 3 capas
(primitivo→semántico→componente); tema inyectado como CSS custom properties desde el
bootstrap. PROHIBIDO: CSS libre por tenant, forks, builds por cliente, translucidez
Liquid Glass en pantallas de terreno.

### 5.2 Secuencia canónica del día (FIJA de plataforma; 6 fases; los verticales solo insertan ítems de evidencia dentro de las paradas vía stop_requirements)
- **F1 OPERADOR planifica** (web, ≤15 clics para publicar el día de 1 vehículo):
  Encargos (bandeja + CSV + duplicar ayer) → Armar rutas (asignación múltiple; aquí SÍ
  rebotan invariantes; con VRP ON: botón «Optimizar día», 1 clic, propuesta con km/min/
  semáforo de energía por ruta, edición drag&drop que recalcula determinista, bandeja
  «sin ruta» con motivo) → Listos para salir (semáforo SOC actual vs necesario; 1 clic
  sugiere bloque de recarga AC nocturno) → **Publicar día** (congela snapshots).
- **F2 RESPONSABLE DE CARGA** (PWA, andén o milk-run): PIN (1 acción) → vehículo (1) →
  sub-manifiesto POR EMPRESA contra lo declarado (cifra 96px, «Conforme» 1 toque,
  discrepancia EN el punto, foto, DTE por escaneo TED o folio manual, «bajar de la
  carga» si falta DTE) → traspaso de custodia con PIN del chofer (firma puntual, no
  desplaza sesión).
- **F3 CONDUCTOR abre turno** (≤9 toques, sin tipeo libre): PIN → «Tu turno de hoy»
  (nota del turno anterior visible) → chequeo pre con OK por defecto (solo se toca lo
  malo; ítem fallado = +2 toques y flag, JAMÁS bloquea) → odómetro/SOC con teclado
  propio → semáforo «Alcanza / No alcanza — recarga antes» (texto, nunca solo color).
- **F4 PARADA A PARADA** (bucle lineal; camino feliz **2 toques por entrega**):
  UNA tarjeta (qué + dónde + ventana + «7 de 23» en 96px) → «Llegué» (1) → «Entregado»
  (1) con undo 8 s y avance automático. Variantes: parcial (stepper por ítem + motivo),
  no entregado (motivo catálogo + confirmar = 3), dejado_en_punto (3; encuadre si
  bultos > umbral), evidencia extra solo si stop_requirement la exige (p. ej. PIN del
  destinatario — lo teclea EL DESTINATARIO y está VIVO desde E3; en E1 el tipo existe
  solo como DDL y ningún seed E1 siembra stop_requirements de ese tipo; el operario
  nunca supera 4 acciones). Banners
  de energía 30/20/15/10% no bloqueantes. Bloque de recarga = una parada más («Iniciar
  carga» 1 toque; al terminar SOC fin + confirmar). Offline: «Entregada — por
  sincronizar» con contador de cola.
- **F5 CIERRE** (≤6 toques): chequeo post OK-por-defecto + nota al siguiente turno →
  odómetro/SOC → «¿Quedó enchufado?» Sí/No → cerrar. Ecuación de custodia por empresa
  YA calculada; la ruta no cierra descuadrada (clasificación táctil del descuadre).
  El chofer ve km, bultos y SOC — JAMÁS CLP (regla en BD, §4.8).
- **F6 DUEÑO** («Hoy» = home; objetivo ≤5 min/día): §5.6.

### 5.3 Presupuesto de toques como CONTRATO
**Convención de conteo (cerrada):** un campo del teclado propio (PIN, odómetro, SOC,
cantidad) = **1 acción** para el presupuesto, sea cual sea su cantidad de dígitos; el
e2e cuenta ACCIONES, no keydowns. Con esa convención: ≤4 acciones por acción de
terreno; entrega feliz = 2 exactas; apertura ≤9; cierre ≤6; publicar día ≤15 clics;
conductor nuevo operando <5 min sin ayuda. Telemetría de toques-hasta-completar por
acción (a `client_metric`); e2e que CUENTA eventos con regresión bloqueante: feature
que sube el conteo del camino feliz no se mergea.

### 5.4 Enrolamiento (fácil por fuera, gobernado por el dueño)
- **Usuario+dispositivo en un acto:** dueño emite invitación por ROL (QR/link firmado,
  WhatsApp/SMS, código corto fallback; 4 toques) → trabajador entra (RUT formateado,
  nombre, PIN ×2, «Solicitar acceso»; ~90 s; CERO emails) → pantalla «Esperando
  aprobación» + guía A2HS obligatoria (el enrolamiento no se completa sin standalone +
  persist) → dueño aprueba (1 toque) ⇒ secreto emitido, sesión arranca sola. Total <5 min.
- **Variantes de primera clase:** dispositivo compartido de andén (enrolado por el
  admin como activo del tenant; operarios rotan por PIN; lockout POR USUARIO); teléfono
  nuevo («Ya tengo cuenta» → RUT+PIN → solicitar enrolamiento; aprobar revoca el
  anterior).
- **Vehículo en <2 min:** patente + tipo (chips) ⇒ ya operable; capacidades, foto,
  documentos con vencimiento y batería EV progresivos; OCR de patente/padrón como
  mejora, jamás dependencia.
- **Plano de control exclusivo del dueño (`admin_tenant`):** emitir/pausar/revocar
  invitaciones · aprobar/rechazar cada acceso y cada dispositivo · inventario vivo de
  dispositivos · revocar en 1 toque (efecto inmediato server-side) · rotar
  PIN/desbloquear · **alta, edición de capacidades/documentos y desactivación de
  VEHÍCULOS** (el `operador` solo lee y asigna a rutas; sus POST/PATCH/DELETE de
  vehículos ⇒ 403 y 0 filas, con test) · pantalla **«Funciones»** (§5.5) · auditoría de
  accesos (incluidas sesiones de soporte) · otorgar/revocar grant de soporte ·
  transferir propiedad (con passkey/WebAuthn del admin — única passkey del sistema).

### 5.5 Feature toggles apagados — regla de contracción
Manifest de navegación computado server-side (entitlements × rol) en el bootstrap;
módulo apagado NO se renderiza (sin huecos, candados ni parpadeo); endpoint de
planificación/lectura responde 403 (los de sync de captura, 2xx siempre — §0);
locked-states y upsell SOLO en panel admin. App mínima (todo OFF) = abrir turno →
paradas → cerrar turno, y sigue siendo producto completo.
**Quién opera los toggles (cerrado):** la pantalla **«Funciones»** del panel admin del
tenant — `admin_tenant` APAGA cualquier feature (override OFF siempre permitido) y
ENCIENDE solo las incluidas en su plan (ON fuera de plan = locked-state con upsell);
cada toggle escribe audit_trail y aplica en el próximo bootstrap (los turnos abiertos
terminan con su config congelada). AC con oráculo CI: toggle OFF ⇒ manifest sin el
módulo y endpoint 403.

### 5.6 Semáforo «Hoy» (gestión por excepción; pedido del dueño)
- **Nivel 0 — tablero (0 toques):** máximo 6 tarjetas-dominio: Entregas vs plan ·
  Turnos/conductores · Flota/energía EV · Datos/sync · Caja/custodia/liquidación (+
  SLA por contrato en modo DaaS). Verde = SOLO agregado («34/40 · en plan»), jamás
  notifica. Amarillo/rojo = contador + la excepción más antigua.
- **Nivel 1 — peek (1 toque):** bottom-sheet sin navegar; lista por severidad ×
  antigüedad; cada fila = quién/qué/cuánto/desde cuándo + acción sugerida (playbook de
  1 línea); swipe u botón = reconocer. Aquí termina el amarillo típico.
- **Nivel 2 — detalle (1 toque; el rojo lo exige):** timeline de eventos + evidencia
  completa (foto, GPS estático, curva SOC, registros de sync) + acciones (llamar /
  reasignar / resolver con nota). Push de un rojo (gestor) deep-linkea aquí.
- **Mecánica:** señales como FILAS (`signal_rule`: dominio, umbral_amarillo,
  umbral_rojo, umbral_recuperacion, playbook) con histéresis; toda señal
  amarilla/roja es accionable o no existe; cada excepción tiene dueño y estado
  (nueva→reconocida→resuelta); la cola tiende a cero cada día. Umbrales seed en Anexo B.
- **Refresco:** polling HTTP del digest cada 15–30 s con pestaña visible (Page
  Visibility) + ETag/304; pull-to-refresh de respaldo. **Nada de WebSockets/SSE en v1**
  (los datos nacen de sync por lotes; upgrade path: SSE por-canal si algún día una
  señal exige <5 s).
- **Vista e-auto (dueño de la plataforma, cross-tenant):** lee EXCLUSIVAMENTE de la BD
  `control` (agregados técnicos y de adopción empujados por el exportador: actividad
  vs media móvil, errores de sync, backlog, versión de PWA, latencia p95 por tenant,
  EEVD agregada); JAMÁS ingresos/tarifas/clientes del tenant — garantizado por
  separación física + schema del exportador testeado; sospecha de fuga de aislamiento
  = rojo máximo siempre.

### 5.7 Estados obligatorios y AA (gate de CI)
Toda pantalla nace con 4 estados (vacío accionable / skeleton <50 ms, spinner solo
>400 ms / error es-CL con recuperación — las capturas JAMÁS muestran rechazo / sin
conexión con contador real de cola). axe+Lighthouse como gate: contraste 4.5:1 texto,
3:1 UI, **7:1 en cifra operativa y semáforos** (sol directo); targets §0; foco visible;
VoiceOver completa apertura/POD/recepción; texto 200% sin truncar cifras; cero
aria-labels vacíos. PWA iOS: manifest standalone, viewport-fit=cover + safe-areas,
touch-action manipulation, inputs ≥16px, feedback táctil simulado (no hay Vibration
API), teclado numérico PROPIO siempre (el del sistema jamás aparece en terreno),
transiciones 60 fps, <1 s por interacción.

## 6. BENCHMARKS (patrón a extraer, no pantalla a clonar)

| Referente | Patrón | Aplica en |
|---|---|---|
| Fleetio | software-first sin hardware, precio público por vehículo, UN campo obligatorio para alta, cadena chequeo→defecto→issue→servicio | pricing, vehículos, mantenimiento |
| Samsara | DVIR 3 firmas, defectos como filas, Safety Inbox (bandeja triada), tags jerárquicos | chequeos, Por revisar, grupos |
| Geotab | StatusData genérico (toda lectura misma tabla), groups+clearances, carga auto-detectada por ΔSOC | reading, visibilidad, EV |
| Onfleet | encargo mínimo, Courier Clients (cliente crea → operador programa), 3-6 toques (nosotros 2) | encargos, portal cliente |
| SimpliRoute / DispatchTrack (CL) | estados con parcial nativo + motivos estructurados; retraso = ETA + tolerancia (mín. 15 min) | POD, semáforo entregas |
| Amazon Flex / Uber Driver / Amazon Relay | flujo lineal UNA acción primaria; preparar-antes/confirmar-en-el-punto (Gate Pass); dark mode nocturno | F4, toda la PWA |
| Circuit / Routific / Track-POD | offline real; webhook «POD listo» gatilla el cierre económico | outbox, liquidación |
| OptimoRoute | reintento = duplicar encargo con historia; re-plan solo de pendientes; skills/vehicleFeatures | excepciones, VRP, matching |
| Connecteam / WhatsApp | invitación QR/link multi-uso revocable por rol + aprobación obligatoria del admin | enrolamiento |
| Shopify / Zendesk / Ory | soporte por solicitud+grant temporal con expiración, identidad propia, sin impersonación | grants_soporte |
| Stripe Entitlements | features lookup_key + plan + overrides; billing enchufable por webhook | entitlements |
| Salesforce | Rename Tabs & Labels con reglas duras; metadata-driven acotado (renombrar y activar, no redefinir) | terminología |
| Linear | sync local-first sin CRDTs, orden del servidor; Peek; hidratación <50 ms | motor sync, semáforo N1 |
| VROOM + OSRM | VRP open-source: 100–1.000 paradas <1 s, gap ~1%, `max_distance` por vehículo para EV | módulo VRP |
| Einride / Zeem / Hived | TaaS: bloque take-or-pay / fixed-fee / per-parcel; recarga en depósito, no en ruta; OTD como métrica estrella | contratos DaaS, SLA |
| ChargePoint / Ford Pro | tablero «listos para salir»; alerta «no quedó enchufado» | EV gestor |
| ABRP | SOC declarado como modo de primera clase, mismo motor que el modo vivo | ProveedorTelemetria |
| Toyota Andon / Datadog / PagerDuty | verde no comunica; warn/alert + recovery threshold; severidad con respuesta pactada, ack→resolve | semáforo |
| Bimbo DSD | reconciliación diaria: cargado = entregado + devuelto + faltante | cierres_ruta |
| Openfactura/Haulmer | emisión DTE por API con Idempotency-Key y sandbox; validación pre-SII | puerto EmisorDTE |
| Freight audit (e2open/Laneproof) | línea-por-línea contra evidencia; «misc charges» = disputa #1; fuel surcharge = disputa #2 | liquidación, tarifas |

**Anti-anclas (no copiar, con nombre):** contratos 3 años prepagados y hardware
obligatorio (Samsara/Motive/Verizon) · precio opaco vía vendedor (Geotab/Motive/Bringg)
· POD como palanca de upsell (OptimoRoute Lite/Circuit) · mínimos por asiento
(Track-POD) · implementación consultiva de US$50-100k (Bringg/FarEye) · offline de
cortesía de 2 min (Onfleet) · torre de control contemplativa y dashboards de 40 KPIs
(Gartner: 60% no entrega valor) · optimización continua en vivo (Onfleet) · ETA por ML
· EVRP físico sobre SOC declarado (precisión falsa) · metadata-driven total
(Salesforce) · god-mode de soporte (cláusula unilateral Zendesk) · recargo por
combustible indexado (además: flota eléctrica — es el pitch de e-auto).

## 7. RESTRICCIONES Y PROHIBICIONES (guardrails como código; violarlas aborta el ítem)

1. `guardrail.sh` antes de cada iteración: `DATABASE_URL` SOLO localhost en desarrollo
   · secretos SOLO en `.env.local` gitignored · grep bloqueante `TODO|FIXME|
   PLACEHOLDER|not implemented|lorem ipsum` en `src/`.
2. **Multi-tenant (cero cruce de ninguna especie):** una BD por tenant con
   credenciales propias — el rol de A tiene CONNECT solo a SU BD (test de privilegios
   en CI) · jamás superuser/BYPASSRLS/ownership en la conexión de la app · jamás
   consultas cross-database en el producto (agregación solo vía exportador a
   `control`, con schema testeado sin datos comerciales) · jamás SET de sesión (regla
   estática) · cache keys, colas, jobs, logs y backups SIEMPRE segregados por tenant ·
   jamás tablas/columnas por vertical · recurso ajeno por HTTP = 404 · dentro del
   tenant, el rol `cliente` jamás ve otra empresa contratante (política en BD + vistas).
3. **La app JAMÁS emite DTE** ni genera XML/TED/folios con apariencia de DTE (art. 97
   N°4 CT). La emisión existe SOLO vía puerto `EmisorDTE` contra proveedor autorizado
   SII con credenciales del tenant; el registro manual de folio es camino paralelo
   permanente. Sin DTE asociado no hay mercadería a bordo (art. 55 DL 825), con la vía
   «bajar del manifiesto» — jamás rehenes, jamás override silencioso.
4. **Append-only y supersede:** REVOKE UPDATE/DELETE en eventos, reading, evidence,
   firmas, audit_trail, POD, custodia, disposition; corrección = supersede con motivo y
   autor; capturas JAMÁS rebotan al sync; jamás migración destructiva ni `db:reset`
   sobre datos con evidencia.
5. **Dinero:** CLP entero calculado por la BD; UNA fuente de devengo (SECURITY
   DEFINER); chofer y responsable_carga jamás ven CLP (RLS RESTRICTIVE FOR SELECT);
   cero líneas manuales; anulación solo por nota de crédito; jamás recargo por
   combustible/energía indexado.
6. **Terreno:** jamás depender de cámara, GPS, barcode, Bluetooth, NFC, push,
   Background Sync ni Vibration para completar un flujo — mejoras progresivas con
   degradación a captura manual + flag · GPS denegado bloquea en el cliente y lo dice;
   precisión mala jamás bloquea · cero modales para capturas (solo undo 8 s; única
   modal: confirmar manifiesto incompleto) · cero gestos-only · cero tipeo libre
   obligatorio en ruta · jamás bloquear apertura por SOC bajo o ítem fallado (confirmación
   auditada de UN toque; `bloqueante` real lo marca solo el operador).
7. **Matriz de honestidad frío/farma (corrección del adversario):** con datos
   DECLARADOS se vende operación y disciplina interna; NT 208, alarmas acumulativas,
   MKT y evidencia para disputas EXIGEN fuente instrumental. CHECK vivo desde E1:
   prohibido activar alarm_rule `cumulative` o el feature de compliance a un tenant
   cuya única fuente sea `declarada`. La misma tabla alimenta la página de ventas y los
   contratos. La promesa «leemos tu data-logger» se vende SOLO nube-a-nube o carga de
   archivo (iOS no tiene Web Bluetooth/NFC).
8. **Datos personales (Ley 21.719, plena vigencia 01-dic-2026):** identificadores solo
   en `personas` con ID opaco desde los hechos; supresión = anonimización; PIN argon2id
   jamás en logs; RUT enmascarado; GPS off por defecto; fotos opcionales; base de
   licitud = ejecución de contrato (JAMÁS consentimiento de trabajadores); DPA en
   términos del tenant; cero datos personales reales en seeds/fixtures (RUTs válidos
   sintácticamente pero irreales); runbook de brechas.
9. **Soporte sin god-mode:** cero visibilidad por defecto; grant del dueño con alcance
   y expiración; sin endpoint de impersonación; break-glass = doble control +
   notificación forzosa + registro inmutable.
10. **Comercial:** jamás cobrar por asiento/conductor ni mínimos; mensual cancelable;
    evidencia/POD en TODOS los planes; precio público; jamás VRP antes de E2 ni
    compliance farma sin contrato firmado.
11. **Costo de construcción:** jamás API de pago — motor OAuth-only; ventana agotada ⇒
    ESPERA; recarga automática de créditos desactivada ANTES del primer ciclo autónomo.

## 8. MODELO Y ESFUERZO

- **plan → Sonnet · verify → Sonnet** (leen mucho, deciden poco). **Juez del verify →
  Opus** con mandato de refutar; app caída = infra, no FAIL.
- **build → ruteo por tag del planificador:** `[tenancy]` (RLS, entitlements, FKs
  compuestas, linter de migraciones), `[security]` (identidad, enrolamiento, firmas,
  grants, 21.719) y `[datos]` (esquema, triggers, sync/outbox, devengo, VRP adapter) →
  **Opus**; `[HIG]` (pulido táctil, estados, dark mode) → **Haiku**; resto → **Sonnet**.
- Las decisiones fundacionales irreversibles de E1 (esquema multi-tenant, motor de
  sync, 10 ganchos, máquina de estados) las escribe el modelo TOPE disponible;
  E2–E4 reutilizan el reparto (lo nuevo de esquema siempre al caro).
- **Escalación de dos strikes:** 2 fallos del gate en el mismo AC ⇒ subir un nivel UNA
  vez; tercer fallo ⇒ el ítem vuelve a plan con nota. El selector de modelo es un
  script y se testea contra el caso normal.
- Vía de costo: exclusivamente la ventana OAuth de la suscripción; costo marginal cero.

## 9. PROCESO

### 9.1 Repo y orden de construcción (decisión del dueño: la plataforma absorbe a KiloRuta)
- **Monorepo pnpm existente** (`~/kilopan-monorepo`, fuera de ~/Documents por TCC), con
  guardrails anti-contaminación (corrección del adversario): CI en clon limpio; UN
  builder por worktree con lock; cero imports entre apps/kilopan y la plataforma
  (frontera = API del contrato, grep-gate).
- **Gate ejecutable «KiloPan DONE»** (precondición del paso 4, verificable por script —
  para ESTE paso `PROMPT_MAESTRO.md` de KiloPan es fuente válida, excepción explícita a
  la regla de auto-suficiencia): (a) `IMPLEMENTATION_PLAN.md` de apps/kilopan sin ítems
  abiertos; (b) su `check.sh --full` verde; (c) `git status --porcelain` vacío en el
  monorepo (el fix de middleware pendiente se commitea como primer ítem); (d) F23
  cerrado o descartado por Alexis con nota en BITACORA. Si el gate falla, los ítems
  faltantes de KiloPan entran al plan ANTES del hito de extracción — el motor jamás
  «decide» que KiloPan ya está.
- **`scripts/deploy.sh` como entrega del hito 0** (el guardrail deja de ser prosa):
  (1) `git clone --depth 1` de HEAD a un directorio temporal; (2) aborta si el SHA
  clonado ≠ HEAD o hay migraciones sin verde local; (3) migraciones con rol `migrator`
  (runner canario→resto) como paso separado que aborta ANTES de sustituir la versión
  servida; (4) `railway up` desde el clon. `guardrail.sh` añade: toda invocación de
  `railway` fuera de scripts/deploy.sh (grep en scripts/, package.json, CI) ⇒ rojo.
- Paquetes: `packages/miga` (tokens + componentes + theming por tenant),
  `packages/nucleo-identidad`, `packages/nucleo-pod` (outbox generalizado),
  `packages/nucleo-dte`, `packages/nucleo-comun`, `packages/metodo`;
  `apps/kilopan` (schema `pan`, una BD) y **`apps/flota` = LA PLATAFORMA** (cluster con
  `control` + una BD por tenant, §4.1). KiloRuta = `packages/vertical-panaderia` (SOLO
  filas de configuración + seeds) + tenant seed. DOS despliegues, cero FK entre
  productos.
- **Orden:** (0) este prompt — listo. (1) Hito 0: esqueleto + metodo + miga con test
  tabular-nums + deploy.sh. (2) **KiloPan COMPLETO hasta su DONE** (financia todo;
  gate de arriba). (3) Hito de extracción de núcleos (gate de KiloPan sigue verde;
  limpiar supuestos panaderos). (4) **apps/flota contra ESTE prompt**, por hitos:
  (a) núcleo tenancy (control + tenant_template + runner canario) + constantes +
  linter de migraciones + `docs/criterios-kiloruta.txt` congelado `[tenancy]`;
  (b) identidad/enrolamiento `[security]`; (c) vehículos/agenda/EV; (d) encargos/
  rutas/custodia; (e) POD offline (reuso nucleo-pod) + semáforo; (f) tarifas/
  liquidación/portal cliente `[datos]`; (g) panel admin white-label (incl. pantalla
  «Funciones») + wizard + seeds de los 3 tenants (A, B y C demo). (5) E2+ SOLO por
  orden explícita de Alexis. El contrato KiloPan↔plataforma (ex-Anexo B de KiloRuta)
  al FINAL, con ambos DONE, tras feature-flag.

### 9.2 Loop y gate
Loop plan→build→verify sobre `IMPLEMENTATION_PLAN.md` vivo; un AC por commit
(`feat(flota/modulo): descripción [AC-XX-YY]`); separación de poderes (el verificador
documenta; el verde lo estampa el exit code; «plan vacío» lo decide el script de
conteo); el gate clasifica infra ≠ rojo. **Cada AC lleva columna de oráculo
`CI | humano | producción`** (corrección del adversario): el loop autónomo cierra SOLO
con DONE-software (todo lo CI, incluidos presupuestos de toques como e2e que cuentan
eventos); DONE-adopción (wizard validado por Alexis; 14 días de producción medidos en
el panel) es checklist con dueño humano nombrado y JAMÁS bloquea al loop. Grep del
prompt: cero ACs sin oráculo. **Regla de terminación:** el loop TERMINA al alcanzar E1
DONE-software y deja HANDOFF con el estado; E2, E3 y E4 arrancan SOLO por orden
explícita de Alexis, quien verifica el criterio de entrada en el panel — esos criterios
son condiciones de negocio para humanos, jamás gates del motor.

**`check.sh` (rápido, <2 min, cada iteración):** lint + types + unit + replay doble +
linter de migraciones. **`check.sh --full` (<10 min, cada PR y nightly):** build ·
provisión de 2 BDs tenant desde `tenant_template` + runner de migraciones (canario
primero; BD rezagada ⇒ rojo) + seed · linter de esquema contra catálogos (tenant_id +
CHECK constante + índice + FK compuesta + COMMENT de clase) · pgTAP de políticas de
ROL con el rol de app real + test de privilegios (rol de A: CONNECT solo a su BD) ·
suite HTTP A-contra-B AUTOGENERADA del manifiesto de rutas (cobertura total; exenciones
justificadas por escrito y contadas) · tests centinela · **covering array 2-way sobre
TODOS los flags visibles al operario** (archivo PICT versionado; el gate falla si se
agrega un flag sin regenerarlo; e2e de pantalla de parada bajo el array asertando
toques y botón primario visible — corrección del adversario al pairwise intra-módulo) ·
suite offline (replay-on-startup, doble replay, snapshot congelado) · reglas estáticas
(superuser/SET de sesión/secretos/deps high) · scan de logs (cero PIN/RUT sin máscara)
· axe/Lighthouse · snapshot 375px con 5 módulos y términos al máximo largo · **la suite
e2e corre DOS veces (terminología base y extrema del tenant B) sin cambiar un selector**
(selectores SOLO por data-testid/term_key; lint que veta getByText sobre renombrables).
**Performance en pipeline aparte** (corrección del adversario): nightly/semanal k6
«ráfaga matinal» parametrizado con la fila Capacidad del §0 (N=2.000 bootstraps de
snapshot + M=100 replays/s sostenidos; p95 bootstrap <400 ms y sync <250 ms como
umbrales que FALLAN el pipeline), dataset sintético con generador versionado,
artefacto con tendencia — jamás dentro del gate de 10 min.

### 9.3 Tests centinela (contrato congelado: solo se agregan, jamás se relajan)
1. Replay doble de CUALQUIER mutación ⇒ `count(*)=1` por client_uuid.
2. Cross-tenant HTTP: sesión de A con IDs de B en cada ruta ⇒ 404 y body sin cadenas
   centinela de B; mutaciones ⇒ 404 y la BD de B sin cambios.
3. Aislamiento físico: credenciales de app del tenant A contra la BD de B ⇒ rechazo de
   autenticación; auditoría de privilegios en CI ⇒ el rol de A solo tiene CONNECT a su
   BD. Dentro del tenant: sesión `cliente` de la empresa X ⇒ 0 filas de la empresa Y en
   toda tabla operativa (política de rol) y payloads sin columnas de economía interna.
4. La captura jamás rebota: SOC fuera de perfil o >100 declarado / odómetro menor /
   lectura fuera de perfil / captura de módulo apagado con turno abierto / captura
   post-revocación (≤72 h y >72 h) — TODAS sincronizan 2xx + fila (en `reading` sin
   CHECK de rango; `vehiculos.soc` queda clampado por trigger) + flag + evento + Por
   revisar; rechazos = 0.
5. La planificación sí rebota: solape de agenda / certificación vencida (feature ON) /
   tarifa solapada ⇒ 422 y 0 filas.
6. Inmutabilidad: UPDATE/DELETE sobre POD/evidencia/evento/audit como app_user ⇒ 42501;
   supersede ⇒ 2 filas, original intacta.
7. Liquidación: 0 líneas huérfanas de evidencia; segunda línea sobre la misma evidencia
   viola UNIQUE; excursión bloquea línea, jamás la crea/borra.
8. Cadena de hash (desde E3): recomputar ⇒ cabeza igual; adulterar una fila del fixture
   ⇒ falla señalando LA fila.
9. **Outbox multi-usuario (nuevo, crítico):** A captura 3 mutaciones offline → B se
   autentica en el mismo dispositivo → vuelve la red → las 3 filas de A existen
   (count=3).
10. Dinero: chofer cierra recarga offline+replay ⇒ 2xx con costo NULL; chofer SELECT
    montos ⇒ 0 filas.
11. Modo: mi_flota→daas→mi_flota conserva todas las filas; empresa implícita intacta.
12. Sesiones: firma por PIN en dispositivo ajeno NO desplaza la sesión del propio;
    PODs posteriores sincronizan válidos.
13. Migraciones ×N: runner aplica al canario y a todas las BD tenant; una BD rezagada
    ⇒ exit ≠ 0; provisión de tenant nuevo desde `tenant_template` queda al día.
14. Exportador a `control`: el payload cumple su schema fijo; inyectar una columna de
    dinero/tarifa/cliente en el agregado ⇒ el test de schema falla.
15. Vehículos solo-dueño: POST/PATCH/DELETE de vehículos con rol `operador` ⇒ 403 y 0
    filas; con `admin_tenant` ⇒ 2xx + audit_trail.
16. Barcode sin depender (desde E3): stop_requirement `escaneo_codigo` con cámara
    denegada ⇒ digitación manual del código + flag, 2xx — el flujo jamás se bloquea.

### 9.4 Specs y revisión
Specs por módulo en `specs/` con `Fuente:` y ≥3 ACs verificables (con columna de
oráculo). Revisión adversarial al cierre de cada hito (tenancy, enrolamiento, custodia,
POD, devengo, portal): datos malformados, doble-tap, red cortada a mitad de flujo, PIN
ajeno, reloj adulterado, empresa A viendo lo de B, tenant A contra B, covering array.
Hallazgos → ítems del plan.

## 10. MONITOREO Y ENTREGA

- **Panel del loop** (launchd): ítem, fase, gate, cuelgue por mtime+CPU; panel de
  tokens contra la ventana OAuth; estado del motor = markers en disco; bitácora
  `docs/BITACORA.md`; `docs/HANDOFF.md` ante traspaso.
- **Telemetría de producto:** toques-hasta-completar (p50/p95, alerta si feliz >2 o
  acción >4) · time-to-first-stop <5 min · evicciones de IndexedDB y persist() fallidos
  · profundidad/edad del outbox por dispositivo · % rutas sin incidente de energía ·
  hints re-mostrados = bug · minutos del dueño en el panel (≤5) · digest del semáforo.
- **Panel interno SaaS (e-auto):** EEVD agregada y por tenant (tendencia 4 semanas) ·
  embudo de activación (p50/p90 alta→primera entrega) · tenants activos y % vehículos
  con turno · calidad de la norte (% paradas sin evidencia; % PODs supersedidos
  EXCLUYENDO motivo=undo) · alarma churn (EEVD −30% semana/semana) · canario de
  aislamiento contra producción · contador de exenciones de la suite (tendencia
  creciente = bandera roja).
- **Seed realista (2 BDs tenant provisionadas desde `tenant_template` + `control`;
  cadenas centinela únicas por tenant, RUTs irreales):**
  - **Tenant A «e-auto DaaS»** (modo daas, VRP ON en cuanto exista E2, tema e-auto):
    3 EV48 (capacidad 90 bultos, batería 41.860 Wh), 6 usuarios (admin, operador, 2
    choferes, 1 responsable_carga, 1 responsable_tecnico), 3 empresas contratantes
    (farmacia con bloque $45.000 y `otd_comprometido_pct=95` — para que la tarjeta SLA
    sea demostrable en el camino dorado —, distribuidora por_entrega $3.500, cadena
    minimarket por_bulto $1.200) cada una con 1 usuario `cliente`, 25 destinos es-CL, 1 semana de
    agenda con ventanas de recarga AC nocturna, rutas del día con encargos de las 3
    empresas consolidados, 1 no-entrega, 1 parcial, 1 devolución, 1 descuadre
    clasificado, liquidaciones semanales (1 cerrada con folio registrado, 1 disputada
    por línea, 1 pagada).
  - **Tenant B «Rutapan»** (modo daas, rutas maestras, terminología renombrada al
    máximo largo permitido, tema propio): 2 EV48, 4 panaderías cliente, 2 rutas de
    madrugada consolidadas (12 y 9 paradas), manifiestos firmados con DTEs, 1 encargo
    creado en andén, 1 reintento, cierre con ecuación cuadrada.
  - **Tenant C «Demo Mi Flota»** (modo `mi_flota`, demo): 1 EV48, 1 chofer, empresa
    implícita, navegación contraída (sin tarifas, liquidación por cliente, portal ni
    facturación visibles), 1 día de encargos propios con PODs y semáforo — ejercita el
    modo que los pilotos reales no cubren; su camino dorado es parte del DONE-software.
- **DONE-software (100% CI, cierra el loop) =** plan vacío + `check.sh --full` verde +
  e2e del camino dorado de los tenants A y B de punta a punta con el seed (offline
  incluido, temas/términos/features distintos, ni una fila cruzada) + e2e del tenant C
  en modo `mi_flota` (UI contraída, cero CLP de tarifas visibles) + **test de fixture
  de la EEVD**: valor esperado hardcodeado en el test (calculado UNA vez a mano al
  escribir el seed) comparado contra la vista `eevd_semanal`.
- **DONE-adopción (checklist humana, dueño: Alexis; JAMÁS bloquea al loop) =** revisión
  adversarial final sin hallazgos críticos + wizard y primera parada validados en vivo
  + 14 días de producción del piloto B (y 7 del A) con sus umbrales, medidos en el
  panel.

---

## 11. ETAPA E1.5 — RASTREO, TELEMETRÍA Y EXPORT (enmienda del dueño, 18-ago-2026)

Decisión de Alexis (18-ago-2026, en la sesión de supervisión): el sitio imotion.cl vende la
«Plataforma i Motion» con GPS y telemetría, y esa plataforma ES esta app. Las funciones que el
§3 dejó FUERA del MVP y que el sitio promete pasan a ser **compromiso de producto**: se
construyen como etapa E1.5, sobre el MVP ya terminado (190/211 ACs; lo restante del E1 es
oráculo humano/producción). La lista FUERA del §3 no se reescribe — esta sección la enmienda
para los seis puntos de abajo y SOLO para ellos.

**Principio de la etapa: primero lo que no necesita hardware.** El teléfono del chofer ya corre
la PWA y trae GPS; la telemetría OBD/OEM y los sensores de frío necesitan proveedor y quedan
CONDICIONADOS a decisión del dueño (preguntas en la spec 09), con su esquema listo.

1. **Posición en vivo por el teléfono del chofer** — durante TURNO ABIERTO, jamás fuera de él.
   Captura best-effort por el motor de sync existente (§4.6: la posición es CAPTURA, 2xx
   siempre, cola offline); precisión y timestamp del dispositivo. Ley 21.719 (§7.8): base de
   licitud = ejecución del contrato, minimización = solo en turno, y el chofer VE en su propia
   app que está siendo rastreado y desde cuándo — un rastreo que el rastreado no puede ver está
   prohibido por diseño.
2. **Torre de control con mapa de flota** — pantalla del gestor: última posición conocida de
   cada vehículo en ruta, con antigüedad del dato SIEMPRE visible (una posición de hace 40 min
   presentada como «en vivo» es una mentira de UI; el §5.7 manda estados honestos). Sin
   cobertura, la posición envejece y la UI lo dice — el mapa degrada, no inventa.
3. **Telemetría automática como implementación del gancho §4.9** — `telefono_gps` se registra
   como implementación REAL de `ProveedorTelemetria` (hasta hoy solo «declarada»). La regla E1
   «una sola implementación» queda enmendada así: las implementaciones viven en el REGISTRO por
   datos, y activar una nueva jamás toca las pantallas (§4.6, flujo por datos). OBD/OEM (EV48
   vía e-auto) sigue siendo punto de extensión: entra cuando el dueño elija proveedor.
4. **Temperatura de frío** — el DDL (`thermal_profile`/`alarm_rule`) ya existe DDL-only; la
   captura y la UI entran CONDICIONADAS a la elección de sensor/proveedor (pregunta al dueño).
   Mientras tanto, el export del POD (punto 5) reserva la columna: el día que exista el dato,
   el export no cambia de forma.
5. **Export de PODs por rango** — función de usuario: rango de fechas + empresa contratante ⇒
   archivo con las entregas, su evidencia (hash y referencia), parcialidades y devoluciones.
   CSV es-CL (`;` como separador, fechas dd-mm-aaaa, CLP entero) — sin hardware, construible YA.
6. **Score de eco-conducción v1, sin OBD** — derivado de lo que la app ya mide: consumo
   DECLARADO contra `km_presupuesto_energia` de la ruta, por chofer y por semana. Es un score
   de eficiencia honesto con los datos que existen; la versión con telemetría automática llega
   con el punto 3/OBD. PROHIBIDO presentarlo como medición de manejo en tiempo real: la spec
   nombra qué mide y qué no.

Gate de la etapa: misma vara que el resto (§9): specs con Fuente: §11, un AC por commit,
pgTAP/e2e donde toque, y el §7.8 auditado en el rastreo — el AC de privacidad del punto 1 es
P1, no opcional. El sitio puede publicar estas funciones como «en incorporación» citando esta
sección; la sesión del sitio decide el encuadre exacto con su verificador de hechos.

## Anexo A — Contexto de negocio (para el planificador; no es alcance)

- **e-auto** vende los furgones (Gecko EV48: CATL LFP 41,86 kWh, 1.375 kg, 6,2 m³,
  6,2 km/kWh, 305 km CLTC ⇒ **185–245 km reales — JAMÁS planificar con el folleto**,
  DC 20→80% en 45 min, AC nocturna como método primario) y ahora también OPERA:
  transporte-como-servicio con vehículos propios para 1..N empresas a la vez, carga
  consolidada y rutas optimizadas. La plataforma es a la vez su producto SaaS y su
  herramienta de operación — mismo modelo de datos, cero tablas especiales.
- **Por qué hay espacio:** los hardware-first cuestan US$27-60/veh/mes + hardware +
  3 años prepagados y dejaron fuera al 50-60% de las flotas <10 vehículos; el
  software-first (Fleetio) prueba el modelo pero no hace operación de reparto; nadie
  trae de fábrica consolidación multi-empresa + evidencia en todos los planes +
  offline real + EV declarado. El km EV cuesta ~70% menos que diésel en Chile (~64 vs
  ~210 CLP/km): el reporte de ahorro es el argumento de venta n°1.
- **Pricing seed (por vehículo/mes, CLP, público, mensual cancelable, choferes
  ilimitados, evidencia en TODOS los planes):** Partida gratis (1 vehículo, 300
  entregas/mes) · Base $12.900 · Pro $19.900 (white-label completo + API + frío básico)
  · Empresa $29.900 (−20% 26-100 vehículos, −35% 101+; SSO, compliance, ERP). Anual =
  2 meses gratis, jamás obligatorio.
- **Cumplimiento chileno cableado:** IVA 19% afecto en transporte nacional de carga
  (DTE 33) · art. 97 N°4 CT (jamás emitir) · art. 55 DL 825 (DTE viaja con la carga) ·
  C. de Comercio 166 (custodia) · Ley 21.131 (pago 30 días) · Ley 19.983 (8 días de
  reclamo; el drill-down evidencia-por-línea es el arma de cobro) · Res. Ex. 154/2025
  (datos de transporte en guías desde 01-may-2026) · Ley 21.719 (datos personales,
  01-dic-2026) · NT 208/Dto. 48 (farma, E4, cifras a confirmar contra el texto).

## Anexo B — Taxonomía seed del semáforo (filas de `signal_rule`; umbrales editables por tenant)

**Dominio Entregas:** amarillo = ETA proyectada + tolerancia (mín. 15 min) excede
ventana comprometida en ≥1 parada, o ruta con 5–10% no-entregas; rojo = compromiso
vencido sin entrega, o >10% no-entregas.
**Turnos:** amarillo = sin eventos 30–45 min en turno, o turno sin cerrar >1 h tras el
fin del bloque; rojo = sin señal >2 h, o turno abierto cruzando medianoche.
**Flota/EV:** amarillo = SOC proyectado al fin del bloque < reserva + 5 pp; rojo = SOC
actual < consumo estimado del tramo restante, o retorno proyectado <15%, o «no quedó
enchufado» a la hora límite.
**Datos/sync:** amarillo = dispositivo con pendientes >30–60 min en turno; rojo = sin
sync >3–4 h con turno abierto, o entrega sin evidencia tras sync, o hueco de secuencia.
**Caja/custodia:** amarillo = discrepancia de custodia pendiente, o liquidación
observada; rojo = descuadre confirmado sin evidencia, o línea disputada (dinero
disputado siempre es rojo).
**DaaS/SLA (modo daas):** amarillo = OTD del contrato bajo el comprometido −2 pp
proyectado; rojo = SLA incumplido en el período.
**Cross-tenant (e-auto):** amarillo = actividad −30% vs media 7d, errores sync 1–5%,
backlog creciente 2 intervalos, >20% dispositivos en PWA vieja; rojo = tenant sin
eventos un día hábil, errores >5% por 15 min, cola >4 h, webhook pactado caído,
sospecha de fuga (máximo siempre).

## Anexo C — Relación con KiloPan y supersesión

`PROMPT_MAESTRO_KILORUTA.md` queda SUPERSEDIDO por este documento (nota en su
encabezado). Lo que KiloRuta definía sobrevive así: su alcance operativo = pack
`vertical-panaderia` + seeds del tenant B; sus invariantes = invariantes del core; su
Anexo B (contrato KiloPan↔flota) se conserva TAL CUAL como contrato de integración
post-DONE; su Anexo C (addendum a KiloPan) sigue vigente. KiloPan no se toca: sigue
siendo la primera app del monorepo y se construye primero.

## Anexo D — Checklist prevuelo (cap. 14 del Elíxir)

☐ Variable norte computable (vista `eevd_semanal`) + régimen dual escrito
☐ Campos del negocio con ejemplos reales (§4 + seeds §10) ☐ MVP cerrado con FUERA (§3)
☐ Tabla canónica de constantes (§0) sin contradicciones ☐ BD por tenant + plano de
control + runner de migraciones con canario (§4.1) ☐ UI verificable con captura y
presupuesto de toques como e2e (§5) ☐ Gate único por app + covering array + suite
autogenerada (§9) ☐ Guardrails como código (§7) ☐ Invariantes en BD con sus DOS clases
(§4) ☐ Outbox imborrable + undo con semántica cerrada (§4.7) ☐ Matriz de honestidad
frío/farma (§7.7) ☐ ACs con columna de oráculo; DONE dual (§9.2/§10)
☐ Modelo/esfuerzo por tag + OAuth-only (§8) ☐ Recarga automática de API desactivada
☐ Panel + bitácora + evidencia (§10) ☐ Un builder por worktree ☐ Deploy solo desde
clon limpio ☐ Seeds 2 tenants con centinelas ☐ Revisión adversarial por hito
☐ Orden respetado: KiloPan DONE → extracción → plataforma → contrato
☐ `docs/matriz-kiloruta.md` con test asociado por criterio
