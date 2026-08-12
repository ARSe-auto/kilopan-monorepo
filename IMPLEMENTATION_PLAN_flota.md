# IMPLEMENTATION_PLAN — Plataforma FLOTA · E1 (apps/flota)

Fuente única: `docs/PROMPT_MAESTRO_FLOTA.md`. Este plan ordena los **195 ACs** de las 9
specs (`specs/flota/00…08`) por los hitos (a)→(g) del §9.1(4) del maestro. Un AC por
commit (`feat(flota/modulo): descripción [AC-XX-YY]`, §9.2). **Exactamente un checkbox
por AC** y **ningún AC de las specs falta** (cualquiera de las dos cosas pone el gate en
rojo). TODOS los ítems parten en `[ ]`: nada está hecho.

Reparto por módulo (suma 197): 00 = 28 · 01 = 21 · 02 = 22 · 03 = 22 · 04 = 24 ·
05 = 25 · 06 = 15 · 07 = 17 · 08 = 23. Los dos ACs por sobre los 195 originales nacen
de la firma de la lista congelada de criterios KiloRuta el 08-ago-2026 (AC-FTEN-18):
AC-FVEH-22 (KR-41, cierre forzado del turno) y AC-FRUT-22 (KR-29, candado
entrega←manifiesto).

**Precondiciones de proceso (criterio de entrada de E1, §9.1 — NO son ítems de este
plan y el motor no puede saltárselas):** (0) hito 0 entregado (esqueleto +
`packages/metodo` + `packages/miga` con test tabular-nums + `scripts/deploy.sh`);
(1) gate ejecutable «KiloPan DONE» verde — si falla, los ítems faltantes de KiloPan
entran ANTES del hito de extracción; (2) hito de extracción de núcleos
(`packages/nucleo-*`) con el gate de KiloPan aún verde. Recién entonces arranca el
hito (a). El único AC de spec que pertenece al hito 0 es AC-FMIG-01 (`packages/miga`
declara «entrega del hito 0, §9.1»): se lista primero porque los hitos (c)–(g) lo
consumen; el resto de la spec 08 vive en el hito (g).

**Reglas de ejecución:** régimen proxy de la EEVD durante la construcción (§2: gates
100% CI, cero metas EEVD); los ACs con oráculo humano/producción son DONE-adopción
(dueño humano: Alexis) y JAMÁS bloquean al loop (§9.2/§10) — se listan en su hito solo
para trazabilidad; los ACs marcados «bloqueado/condicionado por pregunta N» ejecutan
hoy su parte verificable y cierran la cláusula pendiente cuando el dueño responda. El
loop TERMINA en E1 DONE-software; E2+ solo por orden explícita de Alexis (§9.2).

**Dependencias entre hitos (§9.1(4)):** (a) es raíz — entrega `tenant_template` (donde
nacen TODAS las tablas de dominio, incluido el DDL transversal del §4.6 y los ganchos
VIVOS `lot`/`reference_document`), constantes, linter, `guardrail.sh` y la suite HTTP
autogenerada; (b) consume (a); (c) consume (a)+(b) y crea la vista `eevd_semanal`
(denominador, creador ÚNICO); (d) consume (a)–(c) y le devuelve a (c)
`rutas.km_presupuesto_energia`; (e) consume (a)–(d), completa el numerador de la EEVD y
pone la CONDUCTA sobre el DDL del §4.6; (f) consume (a)–(e); (g) orquesta y siembra
sobre todos los anteriores.

**Ítems condicionados o bloqueados por una decisión del dueño** (ejecutan hoy su parte
verificable; la cláusula pendiente se cierra al responder la pregunta indicada de SU
spec): AC-FIDN-01 (p. 8), AC-FIDN-03 (p. 5/10), AC-FIDN-06 (p. 9), AC-FIDN-11 (p. 7),
AC-FIDN-15 (p. 8), AC-FIDN-18 (p. 7 — BLOQUEADO entero), AC-FMIG-06 (p. 11), AC-FMIG-15
(p. 10), AC-FMIG-22 (p. 12), AC-FMIG-23 (p. 4 de la spec 04 — numerador fuera del gate
hasta la respuesta), AC-FPOR-09 (p. 4), AC-FPOR-10 (p. 3), AC-FRUT-02 (p. 6),
AC-FRUT-21 (p. 9), AC-FSEM-05 (p. 9), AC-FSEM-07 (p. 5), AC-FSEM-08 (p. 5), AC-FSEM-09
(p. 1), AC-FSEM-10 (p. 2), AC-FSEM-11 (p. 3/5), AC-FSEM-13 (p. 8), AC-FSEM-14 (p. 6),
AC-FSEM-16 (p. 5), AC-FSEM-17 (p. 11), AC-FSEM-19 (p. 4/5), AC-FSEM-21 (p. 8 —
BLOQUEADO entero), AC-FSEM-22 (p. 2/10), AC-FSEM-23 (p. 6 — BLOQUEADO entero),
AC-FSEM-24 (p. 2 — BLOQUEADO entero), AC-FSEM-25 (p. 12 — BLOQUEADO entero), AC-FTAR-01
(p. 9), AC-FTAR-04 (p. 11), AC-FTAR-06 (p. 4), AC-FTAR-08 (p. 10), AC-FTAR-14 (p. 12 —
la aserción `por_bloque_horas` BLOQUEADA), AC-FTEN-04 (p. 3), AC-FTEN-05 (p. 9),
AC-FTEN-10 (p. 7), AC-FTEN-14 (p. 11), AC-FTEN-24 (p. 5 de la spec 04), AC-FTEN-25
(p. 10), AC-FTEN-27 (p. 12 — RESPONDIDA 09-ago, AC reescrito), AC-FVEH-06 (p. 6), AC-FVEH-07 (p. 12),
AC-FVEH-11 (p. 8/13), AC-FVEH-12 (p. 14), AC-FVEH-13 (p. 3), AC-FVEH-17 (p. 1),
AC-FVEH-19 (p. 9), AC-FVEH-20 (p. 7).

---

## Hito 0 — `packages/miga` (precondición del §9.1; su AC vive en la spec 08)

- [x] (P1) Tokens estructurales de Miga en 3 capas desde `constants.ts` (escala, grilla, targets, botón 56px); test de cifra operativa 96/700/tabular-nums que se pone ROJO si esa propiedad no está — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-01]

## Hito (a) — Núcleo tenancy: `control` + `tenant_template` + runner canario + constantes + linter de migraciones + criterios KiloRuta congelados `[tenancy]`

El primer ítem del hito es la lista KR congelada (mandato del encabezado del maestro).

- [x] (P1) `docs/criterios-kiloruta.txt` extraído UNA vez con IDs cerrados KR-01…KR-63 y N explícita (63); aprobado por Alexis el 08-ago-2026 con sus 7 decisiones firmadas; congelado custodiado por `db/flota/gate-criterios-kiloruta.mjs` en el gate — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-18]
- [x] (P1) `docs/matriz-kiloruta.md` como tabla `ID | tabla/constraint | test (ruta::nombre)` con gate mecánico triple: count==N, cada ID exactamente una vez, cada test existe en el repo — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-19]
- [x] (P1) `db/flota/guardrail.sh` versionado y ejecutado antes de cada iteración con las TRES reglas del §7.1 (DATABASE_URL solo localhost, secretos solo en `.env.local` gitignored, grep bloqueante TODO/FIXME/PLACEHOLDER/not implemented/lorem ipsum), un fixture por regla ⇒ exit ≠ 0 y árbol limpio ⇒ 0 — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-28]
- [x] (P1) `packages/nucleo-comun/src/constants.ts` fuente única de la familia §0 (+`constants.md` generado); número mágico fuera del archivo canónico ⇒ grep-gate rojo — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-01]
- [x] (P1) `tenant_template` versionada provisiona BD tenant vía `CREATE DATABASE … TEMPLATE` con `tenant_info` sembrada; `check.sh --full` provisiona 2 BDs + runner + seed; plantilla rezagada ⇒ exit ≠ 0 — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-02]
- [x] (P1) Rol `app_t_<slug>` NOSUPERUSER/NOBYPASSRLS/sin ownership con CONNECT solo a su BD; credenciales de A contra BD de B rechazadas (centinela 3) — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-03]
- [x] (P1) BD `control` acotada a E1 (tenants, entitlements sin billing Stripe, invitaciones de tenant, grants, agregados del exportador) + test de schema: sin dominio operativo y payload del exportador sin dinero/tarifas/clientes (centinela 14) — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-04]
- [x] (P1) Ruteo subdominio → lookup en `control` → pool PgBouncer multi-database con límite POR tenant (caso negativo bloqueado por pregunta 9 de la spec) — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-05]
- [x] (P1) Linter de esquema/migraciones: `tenant_id` + CHECK contra la constante de la BD (`tenant_actual()`) + índice (incl. cobertura de cada FK) + FK compuesta + `COMMENT ON TABLE` PLANIFICACIÓN|CAPTURA en toda tabla de dominio; omisión ⇒ exit ≠ 0 — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-06]
- [x] (P1) Runner de migraciones ×N: canario `t_canary` primero, `schema_migrations` por BD, rol `migrator` separado; BD rezagada ⇒ deploy no verde (centinela 13) — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-07]
- [x] (P1) PKs UUIDv7 generadas EN SERVIDOR (dos mitades verificadas) + `client_uuid` UUIDv7 `UNIQUE(tenant_id, client_uuid)` + `ON CONFLICT DO NOTHING` (doble INSERT ⇒ 1 fila) — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-08]
- [x] (P1) Dinero CLP `bigint` entero + `round_clp()` única; pgTAP contra catálogo de columnas de dinero que FALLA vacío; columna `numeric/float` ⇒ gate rojo — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-09]
- [x] (P1) `tenant_theme` (acento rechazado <4.5:1 — fixture de rechazo bloqueado por pregunta 7) y `tenant_terminology` (singular+plural, largos por tipo, caracteres prohibidos, términos de sistema excluidos) — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-10]
- [x] (P1) Entitlements 3 tablas + resolución `override ?? plan` probada en AMBOS sentidos; límites cuantitativos como columnas del plan — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-11]
- [x] (P1) `vertical_template` (con `meta_eevd` obligatoria), `grupos` árbol sin ciclos y `parametros` (reserva_pct, factor_consumo 0,85, tarifa_kwh_clp, …) en la plantilla — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-12]
- [x] (P1) Config versionada y congelada: toda edición crea versión nueva referenciable por `config_version_id` sin mutar la anterior — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-13]
- [x] (P1) Ganchos VIVOS de E1 en la plantilla (creador ÚNICO): `cargo_type`, `attribute_definition` versionada + trigger de `attrs`, `stop_requirement`, `reading` append-only SIN CHECK de rango, `instrument`, `vehicle_certification`, `lot` (clase bloqueada por pregunta 11) y `reference_document` UNIQUE(tipo, folio, emisor); vertical sintético activable SOLO con INSERTs — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-14]
- [x] (P1) Ganchos DDL-only sin activar (`thermal_profile`, `alarm_rule`, `disposition` append-only) + CHECK VIVO de matriz de honestidad + trigger de `excursion` inerte + `ProveedorTelemetria` única implementación `declarada` — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-15]
- [x] (P1) Reglas estáticas CI (superuser/BYPASSRLS/SET de sesión/cross-database) + wrapper tenant-scoped único de cache/colas/jobs/logs con grep bloqueante + backups por tenant documentados — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-16]
- [x] (P2) Offboarding: script `pg_dump` de la BD del tenant + test de restauración standalone con conteos (Ley 21.719, métrica 7) — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-17]
- [x] (P1) Job exportador a `control` EXISTE y corre en CI cumpliendo su schema fijo; campos sin fuente aún (EEVD, backlog) quedan NULL hasta su hito — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-20]
- [x] (P1) Patrón RLS de dinero `AS RESTRICTIVE FOR SELECT` con `app.current_role` SET LOCAL, probado con rol real sobre tabla fixture (SELECT chofer 0 filas; INSERT de captura pasa); verde vacuo prohibido — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-21]
- [x] (P1) `tenants.modo` como preset de entitlements con mapeo cerrado del §3 (mi_flota apaga tarifas/liquidación/portal/facturación); conmutar sin DELETE ni pérdida (base del centinela 11) — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-22]
- [x] (P2) `docs/instancia-dedicada.md` documenta la instancia dedicada del plan Empresa (misma plantilla, otro host) SIN construirla; test grep de existencia — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-23]
- [x] (P1) DDL transversal del §4.6 en `tenant_template` al cierre del hito (a) — `eventos` (secuencia monotónica por tenant; `prev_hash` NO en E1), `evidence` (enum completo, sha256 write-once), `audit_trail`, `client_metric` (enum CERRADO, client_uuid UNIQUE) y `review_queue` —, todas con tenant_id + CHECK + FK compuesta + índice + COMMENT de clase y append-only donde §7.4 lo exige; la CONDUCTA es de los módulos 04/05 — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-24]
- [x] (P1) Runbook de brechas (§7.8) versionado en `docs/runbook-brechas.md` con secciones mínimas (detección, contención, alcance POR TENANT, preservación de evidencia, comunicación, responsable) y test CI grep-able; plazos y canales BLOQUEADOS por la pregunta 10 de la spec — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-25]
- [x] (P1) Generador de la suite HTTP A-contra-B AUTOGENERADA del manifiesto de rutas (§9.2, centinela 2): un caso por ruta ⇒ 404 sin cadenas centinela de B y BD de B intacta; corre en `check.sh --full`; ruta sin caso ni exención escrita ⇒ gate rojo; contador de exenciones como artefacto con tendencia — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-26]
- [x] (P1) Visibilidad por grupos jerárquicos, MECANISMO (§3.E1.1): adscripción de vehículos y usuarios, alcance «mi nodo y sus descendientes», intersección con el rol, política aplicable con una línea; oráculo doble (pgTAP con rol de app real + e2e en el módulo dueño de cada superficie) — spec: specs/flota/00-modelo-datos-tenancy.md [AC-FTEN-27]

## Hito (b) — Identidad, roles y enrolamiento gobernado por el dueño `[security]`

- [x] (P1) Esquema §4.3 completo en `tenant_template` (personas RUT módulo 11, usuarios enum fijo + CHECK cliente, invitaciones, solicitudes_acceso, dispositivos con UNIQUE parcial, firmas append-only, retention_policy DDL) con linter y pgTAP verdes — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-01]
- [x] (P1) E2e del flujo feliz §5.4 contando acciones: emisión ≤4 toques, solicitud ~90 s sin email con teclado propio, aprobación 1 toque, sesión arranca sola — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-02]
- [x] (P1) La invitación solo da derecho a SOLICITAR: multi-uso, expira 7 días, pausa sin alterar expira_at, revocación inmediata; rebotes 422 tipados; entrada por código corto (RUT duplicado pendiente pregunta 10) — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-03]
- [x] (P1) Aprobación empareja persona+dispositivo+rol y emite el secreto UNA vez contra la clave pública (solo `secreto_hash` en BD); re-emisión rebota; cliente sin empresa 422 — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-04]
- [x] (P1) Enrolamiento incompleto sin standalone + persist(): degradación visible, `persist_denegado` a client_metric; con ambos, dispositivo activo — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-05]
- [x] (P1) PIN 4 dígitos argon2id server-side; lockout 5 POR USUARIO con `bloqueado_hasta` (backoff pendiente pregunta 9); en andén el bloqueo de A no frena a B; scan de logs sin PIN/RUT/secreto — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-06]
- [x] (P1) Dispositivo de andén como activo del tenant con rotación por PIN; cambio de identidad purga SOLO el snapshot y el outbox del anterior se replayea (centinela 9). check.sh --full --app=flota verde; e2e/anden-centinela-9.spec.ts verde. Se corrigió de paso una colisión de fixture (AC-FRUT-23 reusaba el índice de AC-FPOD-03) que impedía el verde completo — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-07]
- [x] (P1) Re-enrolamiento «Ya tengo cuenta»: la aprobación revoca el dispositivo anterior EN EL MISMO ACTO (transacción única, jamás 2 activos ni 0) — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-08]
- [x] (P1) Revocación soft con efecto inmediato; capturas post-revocación ≤72 h (flag `post_revocacion`) y >72 h (flag tardía + severidad alta) SIEMPRE 2xx, rechazos = 0 (centinela 4) — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-09]
- [x] (P1) Firmas con significado por rol; la firma por PIN en dispositivo ajeno NO abre ni desplaza sesión y los PODs posteriores del titular sincronizan válidos (centinela 12) — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-10]
- [x] (P1) Soporte sin god-mode: cero visibilidad sin grant; alcance + expiración 24 h|7 d automática; sin endpoint de impersonación; begin/end en la auditoría del tenant — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-11]
- [x] (P1) Panel de gobierno exclusivo del dueño: cada acción con rol no admin ⇒ 403 y 0 filas; recurso de otro tenant ⇒ 404 (centinela 2); todo a audit_trail + evento — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-12]
- [ ] (P2) Transferir propiedad exige passkey/WebAuthn del admin (única del sistema; prohibida en otros flujos); e2e con virtual authenticator — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-13]
- [x] (P1) 21.719 estructural: whitelist CERRADA de columnas PII (solo `personas` y `empresas_cliente`); cualquier otra tabla con nombre/rut/contacto ⇒ linter rojo — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-14]
- [ ] (P2) Export ARCO por persona sin datos de terceros, registrado en la bitácora (actor/formato condicionados a pregunta 8) — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-15]
- [ ] (P2) Enrolamiento real de punta a punta <5 min en teléfono real con guía A2HS (oráculo humano — DONE-adopción, no bloquea el loop) — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-16]
- [x] (P1) RUT inválido: 422 tipado en servidor con 0 filas + validación módulo 11 EN LÍNEA en el cliente sobre RUT auto-formateado — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-17]
- [x] (P1) Break-glass: doble control + notificación forzosa + registro inmutable (test BLOQUEADO por pregunta 7; entra al build al responderse) — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-18]
- [x] (P1) Anonimización 21.719 sin tocar el ledger: `anonimizada_en` + campos nulos con counts de eventos/PODs/firmas intactos — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-19]
- [x] (P1) La UI de enrolamiento NO presenta consentimiento a trabajadores (base de licitud = ejecución de contrato); e2e + grep — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-20]
- [x] (P1) Seeds/fixtures SOLO con RUTs de lista congelada versionada (módulo 11 + irreales); RUT fuera de lista ⇒ rojo — spec: specs/flota/01-identidad-enrolamiento.md [AC-FIDN-21]

## Hito (c) — Vehículos EV, energía/carga y agenda vehículo-día (primer módulo operativo: nace `eevd_semanal`)

- [x] (P1) Alta de vehículo con SOLO patente + tipo lo deja operable (resto progresivo); patente duplicada 422; baseline de acciones registrada con regresión bloqueante — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-01]
- [x] (P1) Vehículos solo-dueño (centinela 15): POST/PATCH/DELETE de `operador` ⇒ 403 y 0 filas; admin ⇒ 2xx + audit; DELETE = desactivación soft — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-02]
- [x] (P1) `vehiculo_documentos` (tipo, vence_el, sha256): con feature ON el documento vencido rebota planificación 422; OFF no rebota; estado con texto, jamás solo color — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-03]
- [x] (P1) Chequeo pre/post OK-por-defecto: ítem fallado +2 toques + flag sin bloquear; cadena chequeo→defecto→issue→resolución; captura offline con replay doble ⇒ 1 fila — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-04]
- [x] (P1) Odómetro/SOC SIEMPRE por `reading` (declarada, doble reloj, idempotencia doble); proyección `vehiculos.soc` clampada solo por trigger; SOC>100/odómetro menor/drift ⇒ 2xx + flag (centinela 4) — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-05]
- [x] (P1) Turnos vehículo-día con EXCLUDE de solape WHERE estado<>'anulado' ⇒ 422 online (solape al sync bloqueado por pregunta 6) — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-06]
- [x] (P1) `bloques_agenda` (ruta|recarga|mantencion|descanso) con EXCLUDE; «duplicar semana» clona los bloques REALES de 7 días atrás (colisiones pendientes pregunta 12); fechas es-CL — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-07]
- [x] (P1) Recarga dual: como plan rebota por solape; como captura JAMÁS rebota (`energy_entry` charge, costo_clp NULL del chofer, trigger de tarifa_kwh_clp; centinela 10) — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-08]
- [x] (P1) Fórmula ÚNICA de energía en el archivo canónico: rango_efectivo sin reserva; reserva SOLO en semáforo y max_distance; umbrales 30/20/15/10; grep-gate — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-09]
- [x] (P1) Apertura F3 ≤9 acciones con teclado propio: chequeo pre → odómetro/SOC → semáforo «Alcanza/No alcanza» textual 7:1 y cifra 96px; nada bloquea la apertura; VoiceOver completa — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-10]
- [x] (P1) Datos fuente de señales Flota/EV evaluables con fixtures (Anexo B; «no quedó enchufado» directo de turnos; método de estimación parametrizado por pregunta 13) — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-11]
- [x] (P1) Tablero «Listos para salir»: semáforo SOC actual vs necesario con fórmula única; 1 clic sugiere recarga AC nocturna; sin datos ⇒ vacío accionable, jamás folleto — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-12]
- [x] (P1) Reporte ahorro vs diésel: CLP entero calculado por BD, formato es-CL; invisible a chofer/responsable_carga (manifest + RLS); aserción numérica bloqueada por pregunta 3 — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-13]
- [x] (P2) Ganchos §4.9 en estado EXACTO: DDL-only sin UI ni seeds; CHECK de honestidad; excursion inerte; certificaciones rebotan solo feature ON; ProveedorTelemetria única impl — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-14]
- [x] (P2) «% rutas sin incidente de energía» computable de eventos/flags; cambio de parametros sin deploy no toca turno abierto y aplica al siguiente — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-15]
- [ ] (P2) Validación en vivo: alta real <2 min y lectura sin ayuda del semáforo y del tablero (oráculo humano — DONE-adopción, no bloquea) — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-16]
- [x] (P1) Recordatorios de vencimiento: estados «por vencer»/«vencido» visibles para el admin con anticipación como fila de `parametros` (canal adicional pendiente pregunta 1) — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-17]
- [x] (P1) Config congelada por turno: cambios con turno abierto no lo alteran y aplican al siguiente; captura de módulo apagado 2xx + flag `modulo_apagado` + config_version_id — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-18]
- [x] (P1) Máx 3 capturas de SOC por turno validado en el CLIENTE; exceso por sync 2xx + flag, jamás rebota (conteo exacto pendiente pregunta 9) — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-19]
- [x] (P1) Vista `eevd_semanal` nace aquí (creador ÚNICO), computada de eventos/turnos append-only; denominador verificable (2 turnos ⇒ vehiculos_dia=2; numerador 0 hasta hitos d/e) — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-20]
- [x] (P1) Cierre F5 ≤6 acciones: chequeo post + nota al siguiente turno (opcional) + odómetro/SOC + «¿Quedó enchufado?»; la nota reaparece en la apertura siguiente — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-21]
- [x] (P1) Cierre forzado administrativo del turno abierto (KR-41, decisión del dueño 08-ago-2026): `operador`/`admin_tenant` online, motivo tipado, audit + evento, resuelve la fila de `review_queue`; PLANIFICACIÓN (422 si ya está cerrado o sin motivo); no escribe `reading` ni mueve la proyección del vehículo; otros roles 403 y otro tenant 404 — spec: specs/flota/02-vehiculos-energia-agenda.md [AC-FVEH-22]

## Hito (d) — Encargos → paradas → ítems, rutas manuales y maestras, cadena de custodia multi-empresa

- [x] (P1) Alta de encargo con empresa + destino + bultos en ≤4 acciones; bultos fuera de 1–500 o attrs inválido ⇒ 422 y 0 filas — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-01]
- [x] (P2) Importación CSV de la bandeja F1: replay doble ⇒ 1 fila; filas inválidas 422 tipado y 0 filas de las inválidas (granularidad pendiente pregunta 6) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-02]
- [x] (P1) Máquina de estados del encargo: finales solo-por-trigger; `solicitado` editable por su creador solo hasta aceptación; reintento = encargo nuevo con `reintento_de` — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-03]
- [ ] (P2) El ítem bajado del manifiesto desasigna su encargo y lo deja re-planificable el mismo día, sin `reintento_de` (sub-decisión del dueño del 11-ago-2026; necesita marcar el ítem desasignado sin borrarlo) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-24]
- [x] (P1) Agrupación multi-empresa: N encargos de ≥2 empresas al mismo destino ⇒ UNA parada con desglose por empresa; stop_requirements derivados al PUBLICAR (momento único) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-04]
- [x] (P1) Publicar el día de 1 vehículo ≤15 clics recorriendo F1 completa (incluye «Listos para salir»); congela promesa_original y rutas.version; invariantes rebotan 422 (centinela 5) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-05]
- [x] (P1) Rutas maestras con drag & drop SOLO escritorio; día generado con origen=maestra y versión propia; la maestra queda intacta — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-06]
- [x] (P1) F2 sub-manifiesto POR EMPRESA: PIN 1 acción, «Conforme» 1 toque + undo 8 s, cifra 96px/tabular-nums, discrepancia EN el punto, foto progresiva, ≤4 acciones — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-07]
- [x] (P1) DTE gate: sin `reference_document` no queda a bordo; vía «bajar del manifiesto» explícita con evento; única modal permitida; grep cero emisión de DTE — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-08]
- [x] (P1) Custodia íntegra: firmas por rol + custody_transfer; doble firma o UNA si misma persona; UPDATE/DELETE ⇒ 42501; supersede ⇒ 2 filas (centinelas 6 y 12) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-09]
- [x] (P1) La captura de custodia JAMÁS rebota: válida ⇒ 2xx limpia; degradadas (manifiesto incompleto, sin DTE, drift, módulo apagado, sha256 mismatch) ⇒ 2xx + flag + cola; DTE repetido liga sin violar UNIQUE — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-10]
- [x] (P1) Ecuación de cierre por empresa vía SECURITY DEFINER (cargado = entregado + devuelto + faltante); no cierra descuadrada en cliente; por sync degrada; chofer sin CLP — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-11]
      Probado: unit sobre los mutantes de la ecuación y de la clasificación táctil
      (`src/dominio/cierre.test.ts`) + e2e `e2e/cierre-ruta.spec.ts` en verde — la ruta
      descuadrada no ofrece «Cerrar la ruta» y un toque la cuadra escribiendo `devuelto`;
      el cierre sin clasificar llegado por la API entra 201 con flag, evento y «Por
      revisar», y el replay no duplica ni fila ni aviso; la pantalla no muestra un CLP.
- [x] (P1) Aislamiento del módulo: IDs de B ⇒ 404 sin centinelas y BD intacta (centinela 2); cliente de X ⇒ 0 filas de Y (centinela 3) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-12]
- [x] (P1) Motivos por tenant sembrados de `vertical_template.motivos[]`: se apagan jamás DELETE; históricos intactos; require_notes exigido en cliente — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-13]
- [x] (P1) `empresas_cliente` con la implícita creada por trigger en mi_flota (UI contraída); conmutación de modo conserva TODO con la implícita intacta (centinela 11) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-14]
- [x] (P2) Destinos: lat/lng NULL con CHECK de caja Chile; enum geo_confianza completo (solo manual|sin_geo producibles); parada sin_geo opera igual — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-15]
- [ ] (P1) Camino dorado de custodia del piloto B: 14 días consecutivos ≥95% entregas con evidencia con custodia limpia (oráculo producción — DONE-adopción, no bloquea el loop) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-16]
- [x] (P2) «Duplicar encargos de ayer»: encargos NUEVOS conservando empresa/destino/bultos/attrs; replay doble ⇒ 1 fila — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-17]
- [x] (P1) Bloque de agenda tipo `recarga` materializado como parada tipo `recarga` en la ruta publicada, en su orden — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-18]
- [ ] (P2) Telemetría `toques_flujo` de los flujos del módulo a `client_metric` en lote por el endpoint de sync; conteo coincide con el e2e — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-19]
- [x] (P2) Gancho `pin_destinatario` DDL-only: el tipo existe y NINGÚN seed E1 siembra stop_requirements de ese tipo — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-20]
- [x] (P1) `devoluciones` nace en ESTE módulo (creador ÚNICO), clase CAPTURA con tenant_id + CHECK + FK compuesta e idempotencia `client_uuid`: la clasificación táctil del descuadre de F5 escribe empresa/ítems/motivo, viaja por el motor de sync (2xx siempre, replay doble ⇒ 1 fila) y cuadra la ecuación por empresa; fixture del seed A «1 devolución» ⇒ 1 línea `por_devolucion` (origen adicional en F4 pendiente pregunta 9) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-21]. PROBADO: gate verde con e2e (`cierre-ruta.spec.ts`).
- [x] (P1) Ninguna parada de entrega se abre sin el manifiesto de su carga confirmado (KR-29, ancla del art. 55, decisión del dueño 08-ago-2026): bloqueo EN EL CLIENTE contra el snapshot con texto que nombra la empresa y la vía, jamás modal; consolidada de varias empresas, cierra hasta que TODAS confirmaron — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-22]
- [x] (P1) El candado también en el SERVIDOR para el POD que llega por sync (2xx + flag `sin_manifiesto_confirmado` + evento + `review_queue` alta) y el camino feliz completo de la entrega («Llegué»→«Entregado», 2 acciones) — spec: specs/flota/03-encargos-rutas-custodia.md [AC-FRUT-23]. PROBADO: check.sh --full --app=flota verde; e2e/entrega-candado-servidor.spec.ts 3/3 verde en primer plano.

## Hito (e) — POD offline-first + motor de sync, y semáforo «Hoy» / visibilidad

- [x] (P1) Entrega feliz = 2 acciones EXACTAS con avance automático y undo 8 s único; e2e cuenta eventos con regresión bloqueante — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-01] — probado: máquina pura del bucle F4 (`dominio/pod-terreno.ts`, 9 mutantes) + `e2e/pod-feliz.spec.ts` con 2 acciones exactas, avance sin toque, undo dentro/fuera de la ventana y cero modales; baseline en `acciones-entrega-feliz.json`
- [x] (P1) Variantes cerradas ≤4 acciones: parcial (stepper por ítem + motivo), no entregado (3), dejado_en_punto (3); evidencia extra solo por stop_requirement — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-02]
- [x] (P1) 100% offline: POD completo sin red con «Entregada — por sincronizar» + contador real; el replay vacía la cola sin intervención — VERDE 11-ago-2026 (e2e/pod-offline.spec.ts, 3 de 3, incluidas las cuatro salidas de F4 capturadas sin red y aterrizadas con su resultado). El «bloqueo por migración» que se le anotó era falso: `db/migraciones-flota/` sí es del motor — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-03]
- [x] (P1) Idempotencia del outbox: replay DOBLE ⇒ exactamente 1 fila (centinela 1); idempotencia DOBLE de `reading` con instrumento sintético — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-04] — probado: `e2e/idempotencia-outbox.spec.ts` (2/2 verde); fix real en `servidor/lecturas.ts`: la segunda llave de idempotencia (instrumento, sensor, ts_dispositivo) estaba en el DDL pero la conducta nunca la escribía ni la protegía.
- [x] (P1) Regla de oro en el endpoint: CAPTURA 2xx SIEMPRE + flag + evento + review_queue (SOC >100, odómetro menor, drift >5 min); rechazos = 0 (centinela 4) — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-05]
- [x] (P1) Módulo apagado con turno abierto: captura 2xx + flag `modulo_apagado` + Por revisar mandando `turno.config_version_id`; suite offline cubre snapshot congelado — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-06]
- [x] (P1) Capturas de dispositivo revocado: ≤72 h cuarentena, >72 h severidad alta; JAMÁS descartadas ni rebotadas — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-07]
- [x] (P1) Undo 8 s cerrado: `pending_undo` inmediato; kill a los 3 s ⇒ replayea; undo post-replay = supersede motivo=undo excluido del métrico de gaming — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-08]
- [x] (P1) Outbox por (tenant, usuario) JAMÁS purgado: B se autentica y las 3 mutaciones de A sobreviven y se replayean (centinela 9) — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-09] — probado: `e2e/pod-outbox-multiusuario.spec.ts` (2 de 2 verde en primer plano) contra el servidor real; las 3 capturas de A aterrizan en `eventos` firmadas por el enrolamiento de A aunque las transmita la sesión de B
- [x] (P1) Secuencia monotónica por dispositivo (huecos ⇒ evento + Por revisar); replay-on-startup/online como camino principal; suite pasa sin Background Sync — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-10] — probado: `e2e/pod-secuencia-hueco.spec.ts` (4 de 4 verde en primer plano) contra el servidor real; `check.sh --full --app=flota` verde (verde-20260811-183129)
- [x] (P1) Inmutabilidad SQL: el DDL de `entregas_pod` nace en ESTE módulo (write-once + UNIQUE(encargo) parcial + COMMENT CAPTURA); UPDATE/DELETE ⇒ 42501; supersede ⇒ 2 filas (centinela 6) — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-11]
- [x] (P1) Foto y GPS mejoras progresivas: cámara denegada ⇒ sin foto + flag; GPS denegado bloquea SOLO coordenadas en cliente con aviso; el sync jamás rebota — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-12] — probado: `dominio/captura-progresiva.ts` + `cliente/{camara,gps}.ts` + wiring en `tarjeta-de-entrega.tsx`; `e2e/pod-foto-gps-degradado.spec.ts` (3/3), `check.sh --full --app=flota` verde (verde-20260811-193525)
- [x] (P1) Outbox generalizado: cierre de recarga por el MISMO outbox; offline ⇒ 2xx, costo_clp NULL, cero campos monetarios del chofer (centinela 10) — spec: specs/flota/04-pod-offline-sync.md — VERDE 11-ago-2026 (e2e/pod-recarga-outbox.spec.ts, 3 de 3) [AC-FPOD-13]
- [ ] (P2) `client_metric` en lote por el MISMO endpoint (2xx, client_uuid UNIQUE, enum completo); toques_flujo emitidos desde F4 — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-14]
- [ ] (P2) k6 «ráfaga matinal» nightly en pipeline APARTE con la fila Capacidad §0 completa; p95 bootstrap <400 ms y sync <250 ms fallan el pipeline — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-15]
- [ ] (P2) Conductor nuevo opera parada a parada <5 min sin ayuda con los pilotos (oráculo humano — DONE-adopción, no bloquea) — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-16]
- [x] (P1) Cámara denegada degrada el encuadre de dejado_en_punto a flag; tipos `pin_destinatario`/`escaneo_codigo` solo DDL sin seeds E1 — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-17] — probado: el botón «Encuadrar bultos» (`tarjeta-de-entrega.tsx`) ahora llama a `capturarFoto()` (el mismo wrapper de AC-FPOD-12) antes de marcar el paso cumplido, en vez de marcarlo sin intentar la cámara; `e2e/pod-encuadre-degradado.spec.ts` (1/1) prueba contra el navegador real, sin `grantPermissions`, que la denegación no bloquea el cierre. Para escaneo_codigo se agregó `db/flota/gate-seeds-escaneo-codigo.mjs` (+ test de mutantes), gemelo de `gate-seeds-pin-destinatario.mjs` (AC-FRUT-20), que ya cubría pin_destinatario; wireado en `db/flota/gate.sh`. `check.sh --full --app=flota` verde (verde-20260811-204951)
- [x] (P1) E2e de pantalla de parada bajo covering array 2-way (PICT versionado; flag nuevo sin regenerar ⇒ rojo) asertando toques y botón primario — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-18] — probado: generador propio (`db/flota/generar-covering-array.mjs`, 11 filas/110 pares) + gate de sincronización (`db/flota/gate-covering-array-parada.mjs`) + `apps/flota/e2e/pod-covering-array-parada.spec.ts` iterando el array generado, 11/11 verde; `check.sh --full --app=flota` verde (verde-20260811-214216)
- [x] (P1) Contrato de binarios de `evidence`: sha256 NOT NULL viaja ANTES del binario; mismatch al re-hashear ⇒ flag, la mutación sincroniza 2xx — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-19] — probado: `servidor/capturas.ts::registrarBinarioDeEvidencia` + `POST /api/paradas/[id]/evidencia` re-hashean y comparan contra la promesa del evento; `e2e/pod-evidencia-sha256.spec.ts` (4/4), `dominio/pod-sync.test.ts` (+6 casos); `check.sh --full --app=flota` verde (verde-20260811-222021)
- [x] (P1) Frontera de clases del MOTOR: mutación PLANIFICACIÓN por el camino de sync ⇒ 422 tipado; el 2xx-siempre rige SOLO para CAPTURA — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-20] — probado: `dominio/clasificacion-tablas.ts` + `servidor/clasificacion-tablas.ts::exigirClaseCaptura` (lee `COMMENT ON TABLE` vía `obj_description` contra la BD viva); wireada de verdad en `route.ts` (`/api/sync/capturas`) contra `eventos` en cada POST. Mutación sintética contra el vehículo del centinela 5: `db/flota/suite-bd/frontera-clases-motor.test.mjs` (4/4) — `turnos`/`bloques_agenda` (PLANIFICACIÓN) rebotan `fuera_de_clase` sin mover filas, `eventos` (CAPTURA) pasa. `dominio/clasificacion-tablas.test.ts` (6/6). `check.sh --full --app=flota` verde (verde-20260811-225009)
- [x] (P1) Orden autoritativo del servidor: event_time invertido aterriza 2xx con secuencia creciente; estado visible = proyección de eventos, cero contadores mutables — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-21]
- [x] (P1) Los 4 estados obligatorios de la pantalla de parada (vacío/skeleton/error sin rechazo/sin conexión con contador) — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-22]
  - REVERTIDO el 11-ago-2026 23:50 (era ddda9af). La UI de los 4 estados estaba escrita, pero cambiaba el candado de la parada de SNAPSHOT CONGELADO a un viaje por parada, y eso hace REGRESAR a AC-FPOD-03: sin red ese viaje no vuelve y la entrega no se puede cerrar. Su e2e lo agarró. Tampoco compilaba —cuatro llamadas armaban un SelloDelAparato sin secuenciaDispositivo, y la página le pasaba candados a un componente que ya no lo aceptaba—; el commit atribuía eso a AC-FPOD-02/04/10, pero revertir SOLO ddda9af deja el typecheck en verde: los errores eran suyos. AL REHACERLO: los 4 estados tienen que CONVIVIR con el candado que llega en el snapshot (prop candados de la pagina), no reemplazarlo por una llamada. SEGUNDO INTENTO, tambien revertido (era f2d4d37 + 00188b3, 12-ago 00:06): rompio CUATRO e2e de ACs ya cerrados —AC-FPOD-03, AC-FPOD-09 (dos casos) y AC-FPOD-10—, duplico GRILLA.base_px en estados-4-parada.tsx en vez de importarlo (§0) y tumbo los mutantes de los guardianes de db/flota; encima se marco [x] a si mismo con el gate en ROJO, que es el verde falso que el §9.2 prohibe. Va a acs-atascados.txt: dos intentos, dos regresiones de ACs cerrados. NO es trabajo para el motor solo — necesita a alguien que sostenga a la vez los 4 estados nuevos y los invariantes offline de F4.
- [x] (P1) Gate AA axe+Lighthouse de la pantalla de parada: 4.5:1/3:1/7:1, targets, foco, 200% sin truncar, cero aria-labels vacíos — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-23]
  - Cerrado 12-ago-2026 tras dos reverts (ver historial arriba en este archivo). `e2e/pod-a11y-gate.spec.ts` (7/7 verde en primer plano) reusa el fixture de `pod-feliz.spec.ts` en vez de reescribir uno contra un esquema inventado; `@axe-core/playwright` entra a `apps/flota/package.json` CON su entrada en `pnpm-lock.yaml` en este commit. Detalle completo en la spec. `check.sh --full --app=flota` verde (verde-20260812-041933).
- [x] (P1) VoiceOver completa TODAS las variantes de F4 de punta a punta como gate de CI — spec: specs/flota/04-pod-offline-sync.md [AC-FPOD-24]
- [x] (P1) Nivel 0 del «Hoy»: 6 tarjetas con seed A (SLA incluida) y 5 con seed C; verde solo agregado; amarillo/rojo con contador + excepción más antigua por record_time — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-01]
  - Probado: unit `semaforo.test.ts` + e2e `hoy-nivel-0.spec.ts` (6/6 verde) sobre seeds A/C fixture; gate `--full --app=flota` verde.
- [x] (P1) Histéresis: CHECK exige `umbral_recuperacion` distinto; secuencia disparo→zona intermedia (sigue) →recuperación (verde) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-02]
  - Probado: pgTAP `db/flota/pgtap/0023_histeresis_de_senales.sql` (15/15 contra el canario) sobre la migración `tenant/0058_signal_rule_con_histeresis.sql` — recuperación igual al disparo amarillo Y al rojo rebotan 23514, por INSERT y por UPDATE; unit `semaforo-histeresis.test.ts` (9/9) con la secuencia paso a paso. `check.sh --full --app=flota` verde.
- [x] (P1) Seed Anexo B como filas en `tenant_template` (playbook NOT NULL; edición por tenant sin deploy + audit); cero señales de frío ni «webhook caído» en E1 — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-03]
  - Probado: migración `tenant/0059_seed_anexo_b_semaforo.sql` + pgTAP `db/flota/pgtap/0024_seed_anexo_b_semaforo.sql` (8/8 contra `t_canary`). Detalle y hallazgo adversarial (audit_trail append-only bloqueaba la adopción de tenants nuevos) en la spec. `check.sh --full --app=flota` verde.
- [x] (P1) Peek N1: bottom-sheet sin navegar; orden severidad × antigüedad; swipe/botón reconoce (`nueva→reconocida`); re-reconocer ⇒ 422 — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-04]
  - Probado: unit `dominio/peek-n1.test.ts` (orden severidad × antigüedad, filtrado de filas incompletas) + `e2e/peek-n1.spec.ts` (11/11: contrato de servidor `POST /api/semaforo/excepciones/[id]/reconocer` contra `review_queue` real —200/422/404/403— y mecánica de UI del bottom-sheet sobre `/hoy?seed=a`). `npx playwright test e2e/peek-n1.spec.ts` en primer plano y `check.sh --full --app=flota` verdes.
- [ ] (P1) Detalle N2 deep-linkeable: timeline + evidencia degradando sin huecos; resolver exige nota; N1 no ofrece resolver a rojas (regla dura de servidor pendiente pregunta 9) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-05]
- [ ] (P1) Refresco: polling 15–30 s SOLO pestaña visible + ETag/304; grep cero WebSocket/EventSource; offline con digest viejo marcado — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-06]
- [ ] (P1) Dominio Datos/sync: pendientes 65 min ⇒ amarillo; sin sync >4 h ⇒ rojo; done sin evidence ⇒ rojo; hueco de secuencia ⇒ rojo; severidad alta se proyecta ROJA — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-07]
- [ ] (P1) Dominio Turnos/conductores según Anexo B sobre proyecciones append-only (65 min sin eventos amarillo; >2 h rojo; medianoche rojo) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-08]
- [ ] (P1) Aislamiento y roles del tablero: suite A-contra-B total; manifest solo `admin_tenant` (chofer/responsable/cliente/operador/responsable_tecnico ⇒ 403); cero CLP a roles vetados — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-09]
- [ ] (P1) Vista e-auto solo-`control` (componente contra fixtures): agregados técnicos/adopción; cero conexiones a BDs tenant; centinela 14 en rojo ante columna de dinero — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-10]
- [ ] (P1) Señales cross-tenant en `control`: sin eventos un día hábil rojo; −30% amarillo; 5% errores amarillo y >5%/15 min rojo; canario de fuga = rojo máximo NO degradable; churn EEVD — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-11]
- [ ] (P1) AA y estados del «Hoy»: nada solo-color; 7:1 en claro Y oscuro; 4 estados; snapshot 375px con términos extremos; e2e doble terminología sin cambiar selectores — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-12]
- [ ] (P1) Contracción sin residuos: feature OFF deja de evaluar al próximo bootstrap; tenant C 5 tarjetas sin CLP; conmutación conserva signal_rule y review_queue (centinela 11) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-13]
- [ ] (P2) Telemetría del módulo con el piloto: digest emitido y cola-a-cero visible en el panel (oráculo producción — DONE-adopción) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-14]
- [ ] (P2) Revisión adversarial del hito (e) sin hallazgos críticos + validación de Alexis del camino dorado con capturas (oráculo humano — no bloquea) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-15]
- [ ] (P1) Dominio Flota/energía EV consumiendo proyecciones del módulo 02: reserva+5pp amarillo; SOC < consumo restante rojo; retorno <15% rojo; «no quedó enchufado» rojo — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-16]
- [ ] (P1) Dominio Caja/custodia/liquidación: discrepancia pendiente amarillo; descuadre sin evidencia rojo; línea disputada rojo («observada» condicionada a pregunta 11); OFF no evalúa — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-17]
- [ ] (P1) Dominio DaaS/SLA (seed A farmacia OTD 95): −2 pp proyectado amarillo; incumplido rojo; empresa con NULL no evalúa ni muestra tarjeta — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-18]
- [ ] (P1) Dominio Entregas vs plan: 10% no-entregas amarillo y 12% rojo; compromiso vencido sin entrega rojo desde `promesa_original` (señal de ETA condicionada a pregunta 4) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-19]
- [ ] (P1) Reasignar/llamar en N2: reasignación audita y rebota sobre resueltas (422) y cross-tenant (404); acción «llamar» presente — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-20]
- [ ] (P1) Dominio sin señales activas no renderiza tarjeta, sin huecos (CONDICIONADO a pregunta 8; el AC se reescribe si el dueño fija otra conducta) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-21]
- [ ] (P1) Panel interno SaaS contra fixtures de `control`: EEVD por tenant con tendencia 4 semanas, embudo p50/p90, % vehículos con turno, calidad de la norte sin `undo`, exenciones con tendencia (ingesta pendiente pregunta 10) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-22]
- [ ] (P2) Minutos del dueño en el panel ≤5/día — CONDICIONADO a pregunta 6; se mide con el piloto (oráculo producción) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-23]
- [ ] (P2) E2e autenticado del panel cross-tenant de e-auto — CONDICIONADO a pregunta 2 (autenticación/montaje) — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-24]
- [ ] (P2) BLOQUEADO por la pregunta 12 — «hints re-mostrados = bug» (§10): no se construyen hints, no se amplía el enum de `client_metric` ni se inventa superficie de guía; resuelta la pregunta, el AC se reescribe con su fuente de métrica e indicador en el panel — spec: specs/flota/05-semaforo-visibilidad.md [AC-FSEM-25]

## Hito (f) — Tarifas, liquidación línea=evidencia y portal del contratante `[datos]`

- [ ] (P1) Tarifas por empresa: catálogo cerrado de 5 con CHECK; máx 4 activos (5º ⇒ 422); zonas ≤5 por comunas y recargo horario SOLO modificadores; cero recargo indexado — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-01]
- [ ] (P1) Vigencia append-only: UPDATE de precio ⇒ RAISE; tarifa solapada ⇒ 422 (centinela 5); COMMENT de clase + linter verdes — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-02]
- [ ] (P1) Devengo único en BD: solo la función SECURITY DEFINER crea líneas (INSERT directo ⇒ 42501); tarifa con mayor vigente_desde ≤ event_time; sin zona ⇒ precio base sin error; grep cero float — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-03]
- [ ] (P1) Línea=evidencia: UNIQUE(tenant, tipo, id); solo evidencia VIGENTE; supersedida después ⇒ línea bloqueada + review_queue (pregunta 11); huérfanas = 0; sin endpoint manual; excursión bloquea jamás crea/borra (centinela 7) — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-04]
- [ ] (P1) Máquina abierta→cerrada→pagada solo hacia adelante y de a una; salto/retroceso ⇒ 422; cada transición emite evento + audit — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-05]
- [ ] (P1) Disputa por línea: sobre cerrada, ventana 7 días, motivo tipado de catálogo; doble envío ⇒ 1 disputa (centinela 1); cliente solo SUS líneas (otra empresa ⇒ 404) — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-06]
- [ ] (P1) Drill-down línea→evidencia en UNA interacción; formatos es-CL completos; cero strings en inglés — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-07]
- [ ] (P1) La app JAMÁS emite DTE: grep de firmas de estructura (lista versionada) + manifiesto sin endpoint de emisión; registro manual de folio sobre `cerrada` (pregunta 10); folio duplicado ⇒ 422 — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-08]
- [ ] (P1) Dinero invisible: RLS RESTRICTIVE FOR SELECT en TODA tabla de montos; chofer SELECT ⇒ 0 filas y cierre de recarga offline ⇒ 2xx costo NULL (centinela 10) — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-09]
- [ ] (P1) Aislamiento: cliente de X ⇒ 0 filas de Y y payloads sin economía interna; suite A-contra-B en todas las rutas del módulo (centinelas 2 y 3) — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-10]
- [ ] (P1) Cotización = contrato: borrador + volúmenes simula con la lógica de devengo; «Aceptar» convierte el MISMO borrador en v1 sin re-digitación; borrador jamás genera líneas; >4 activos ⇒ 422 — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-11]
- [ ] (P1) Contracción por modo/feature: manifest sin tarifas/liquidación/facturación y endpoints 403; conmutación sin pérdida de filas (centinela 11) — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-12]
- [ ] (P2) `otd_comprometido_pct` smallint NULL CHECK 50–100; fuera de rango rebota; NULL desactiva tarjeta/señal SLA; farmacia 95 la muestra en el camino dorado — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-13]
- [ ] (P2) Fixture del devengo del seed A con montos HARDCODEADOS calculados a mano; `por_entrega` POR ENCARGO en paradas consolidadas; liquidaciones cerrada/disputada/pagada exactas; la aserción de `por_bloque_horas` (farmacia $45.000) queda BLOQUEADA por la pregunta 12 hasta que exista atribución turno/bloque→empresa — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-14]
- [ ] (P2) Primera liquidación semanal REAL del tenant A cerrada, con folio registrado y pagada sin líneas manuales; verificada por Alexis (oráculo producción — DONE-adopción, no bloquea) — spec: specs/flota/06-tarifas-liquidacion-facturacion.md [AC-FTAR-15]
- [ ] (P1) `control.tenants.modo` con dominio cerrado mi_flota|daas (fuera de dominio ⇒ rebote); el alta persiste el modo elegido — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-01]
- [ ] (P1) Centinela 11 completo: mi_flota→daas→mi_flota sin perder UNA fila (comparación por PK, counts ≥); empresa implícita intacta — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-02]
- [ ] (P1) Contracción mi_flota: manifest sin grupo DaaS, sin huecos/candados/parpadeo (aserción DOM por frames); sin tarjeta SLA; e2e tenant C sin CLP de tarifas — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-03]
- [ ] (P1) Portal OFF ⇒ TODA ruta /cliente/* responde 403; el namespace no expone endpoints de captura (auditoría del manifiesto); ON en daas ⇒ 2xx — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-04]
- [ ] (P1) Confinamiento en BD del rol cliente: CHECK empresa_cliente_id NOT NULL; pgTAP con rol real ⇒ 0 filas de otra empresa; liquidación solo vía vistas — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-05]
- [ ] (P1) Suite de aislamiento sobre /cliente/*: cross-empresa y cross-tenant ⇒ 404 sin cadenas centinela; payloads con schema fijo sin economía interna ni telemetría EV — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-06]
- [ ] (P1) Manifest del cliente = EXACTAMENTE 4 pantallas (Hoy · Encargos · Nuevo/CSV · Liquidación); e2e completo sin datos ajenos ni módulos del operador — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-07]
- [ ] (P1) Encargo del portal nace `solicitado`; inválido ⇒ 422 y 0 filas; editable solo hasta aceptación (después PATCH ⇒ 422 y la UI no ofrece) — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-08]
- [ ] (P2) Import CSV del cliente: cero filas espurias, 422 tipado, todo nace `solicitado`; sin conexión se deshabilita (atomicidad del lote pendiente pregunta 4) — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-09]
- [ ] (P1) Liquidación del portal con disputa por línea en ventana de 7 días desde `cerrada` (t0 provisional, pregunta 3); drill-down a 1 clic; e2e contra seed A — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-10]
- [ ] (P2) Detalle de encargo propio con estado/resultado/evidencia sin exponer orden global de ruta, paradas de terceros ni SOC — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-11]
- [ ] (P2) Gate GUI del portal por sub-checks: 4 estados, axe, es-CL, tema del tenant + dark, e2e doble terminología, snapshot 375px — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-12]
- [ ] (P2) Revisión adversarial del hito «portal» sin hallazgos críticos abiertos; hallazgos → ítems del plan (oráculo humano) — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-13]
- [ ] (P2) Piloto A en producción: 7 días con rutas manuales y ≥90% entregas con evidencia, medidos por Alexis en el panel (oráculo producción — DONE-adopción, no bloquea) — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-14]
- [ ] (P1) Conmutación de modo SOLO `admin_tenant` (otros ⇒ 403 y 0 filas); cada conmutación a audit_trail — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-15]
- [ ] (P1) Semántica del preset: la conmutación cambia el entitlement efectivo SIN mutar plan_features ni filas de otro tenant; rige en el próximo bootstrap — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-16]
- [ ] (P1) Tenant mi_flota recién provisionado tiene EXACTAMENTE UNA empresa_cliente (la implícita, efecto del trigger del módulo 03) — spec: specs/flota/07-portal-contratante-daas.md [AC-FPOR-17]

## Hito (g) — Panel admin white-label (incl. «Funciones»), wizard de onboarding y seeds de los 3 tenants

- [ ] (P1) Theming por filas: CSS custom properties del bootstrap con derivados pressed/disabled/dark; acento <4.5:1 ⇒ 422; grep anti-Liquid-Glass; dos tenants, temas distintos, UN build — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-02]
- [ ] (P1) Teclado numérico PROPIO (teclas ≥64px) en PIN/odómetro/SOC/cantidades; el del sistema jamás en terreno; campo = 1 acción con emisión de toques_flujo — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-03]
- [ ] (P1) Capa de copy única term_key tenant→vertical→base es-CL; canónico entre paréntesis para el admin; lint que veta getByText; suite e2e DOBLE sin cambiar un selector — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-04]
- [ ] (P1) Formatos es-CL únicos ($12.500, dd-mm-aaaa, RUT) con unit tests; grep cero strings visibles en inglés — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-05]
- [ ] (P1) Edición de terminología con CHECKs de BD (largos por tipo, caracteres, sistema no editable) ⇒ 422 es-CL; aplica al próximo bootstrap con turno abierto congelado — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-06]
- [ ] (P2) Snapshot 375px con 5 módulos y términos al máximo largo sin desbordes; texto 200% sin truncar cifras — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-07]
- [ ] (P1) Pantalla «Funciones»: OFF siempre permitido, ON solo del plan (mutación directa por API fuera de plan ⇒ 422 y 0 filas; rol no admin ⇒ 403); audit + próximo bootstrap — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-08]
- [ ] (P1) Regla de contracción completa: manifest server-side sin el módulo, 403 en planificación/lectura, captura 2xx con flag; app mínima todo-OFF sigue siendo producto completo — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-09]
- [ ] (P1) Los 4 estados como componentes ÚNICOS de Miga en wizard/panel/«Funciones»; las capturas JAMÁS muestran rechazo — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-10]
- [ ] (P1) Gate axe+Lighthouse de las pantallas del hito + PWA iOS (standalone, safe-areas, touch-action, inputs ≥16px); cualquier violación ⇒ rojo — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-11]
- [ ] (P2) Pasada VoiceOver real de apertura/POD/recepción con todo estado en texto (oráculo humano — DONE-adopción; complementa AC-FMIG-20) — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-12]
- [ ] (P2) Fluidez en producción vía enum de client_metric: latencia_ms p95 <1 s y time-to-first-stop <5 min (oráculo producción — complementa AC-FMIG-19) — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-13]
- [ ] (P1) Wizard 4 pasos completable por SCRIPT <15 min contra stack local: provisión CREATE DATABASE…TEMPLATE + siembra del vertical con demo tocable + vehículo/chofer + paradas + primera parada — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-14]
- [ ] (P1) Activar vertical = INSERT (schema_migrations idéntico antes/después); flujo armado POR DATOS (grep cero condicionales por vertical); cero seeds de ganchos E2/E3 (verticales de A y C pendientes pregunta 10) — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-15]
- [ ] (P2) Wizard y primera parada validados EN VIVO por Alexis (oráculo humano — DONE-adopción, no bloquea) — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-16]
- [ ] (P2) Embudo de activación en el panel SaaS: alta→primera entrega real con evidencia p50 <4 h, p90 <24 h (oráculo producción) — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-17]
- [ ] (P1) Seeds A/B/C EXACTOS según §10 (EV48, empresas y conceptos, terminología extrema de B, C contraído) con centinelas únicos por tenant, RUTs irreales y memoria de cálculo EEVD; fila cruzada ⇒ rojo — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-18]
- [ ] (P1) Gate CI de performance de terreno: presupuesto Lighthouse + frame-timing en los e2e de apertura/POD/recepción + test de feedback táctil simulado — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-19]
- [ ] (P1) Proxy CI bloqueante de VoiceOver: nombre accesible + rol correcto + orden de foco que completa los 3 flujos por navegación secuencial — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-20]
- [ ] (P1) «Una acción primaria por pantalla» asertada en e2e/snapshots del hito + profundidad ≤2 verificada mecánicamente sobre el manifest bajo el covering array — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-21]
- [ ] (P1) DPA en términos del tenant (§3.E1.15/§7.8): artefacto VERSIONADO del repo con secciones mínimas (partes, objeto, encargado/responsable, subencargados, seguridad, devolución/supresión y portabilidad `pg_dump`), servido en los términos sin CSS libre, alcanzable ≤2 niveles, versión vigente por tenant y aceptación del `admin_tenant` en audit_trail (rol distinto ⇒ 403); texto y momento BLOQUEADOS por la pregunta 12 — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-22]
- [ ] (P1) Test de fixture de la EEVD del DONE-software (§10): valor esperado HARDCODEADO con memoria de cálculo versionada junto a los seeds A/B, comparado contra la vista `eevd_semanal` del módulo 02 (AC-FVEH-20); denominador computable hoy, numerador BLOQUEADO por la pregunta 4 de la spec 04 — mientras siga abierta el test no entra al gate — spec: specs/flota/08-diseno-miga-onboarding.md [AC-FMIG-23]

---

## Notas de auditoría (estado tras la ronda de arbitraje, verificado leyendo las specs)

**Cerrado y verificado en el texto (no requiere acción):** DDL transversal del §4.6 con
creador único (00 · AC-FTEN-24) y conducta en 04/05 · `devoluciones` con creador único
(03 · AC-FRUT-21) · atribución `por_bloque_horas` como pregunta al dueño (06 · p. 12) con
AC-FTAR-14 bloqueado · DPA con AC propio (08 · AC-FMIG-22) y la referencia de la spec 01
resolviendo · runbook de brechas (00 · AC-FTEN-25) · generador de la suite A-contra-B
(00 · AC-FTEN-26) · `eevd_semanal` con creador único (02 · AC-FVEH-20) y 00/05/08 solo
consumidores · gancho `lot` con creador único (00 · AC-FTEN-14) y 03 consumidor ·
grupos jerárquicos bloqueados (00 · AC-FTEN-27 + p. 12) · «hints re-mostrados»
(05 · AC-FSEM-25 + p. 12) · `entregas_pod` declarado en 04 (AC-FPOD-11) · `guardrail.sh`
del §7.1 con AC (00 · AC-FTEN-28) · 195 ACs con id único, prefijo correcto y oráculo.

**Residuos abiertos que este plan NO puede cerrar (van al dueño / a una corrección de
spec; ningún ítem del plan los da por resueltos):**

1. **Clase de `reference_document` contradictoria.** La spec 03 la clasifica CAPTURA y
   la spec 06 declara PLANIFICACIÓN para «todas las tablas del módulo» incluyéndola en
   su modelo de datos; la tabla la crea el módulo 00 (AC-FTEN-14) y el linter exige UN
   `COMMENT ON TABLE` (AC-FTEN-06). El maestro no la clasifica: falta la pregunta al
   dueño equivalente a la que ya existe para `lot` (00 · p. 11). La migración no se
   escribe hasta dirimirlo.
2. **Creador de `stop_requirement` con doble declaración.** 00 lo crea (AC-FTEN-14,
   «único creador» de los ganchos VIVOS) pero la spec 03 lo sigue listando en su modelo
   de datos sin la nota «DDL del módulo 00» que sí llevan `lot` y `reference_document`.
3. **Pregunta duplicada sin canónica:** la «hora límite» del rojo «no quedó enchufado»
   se pide en 02 · p. 8 y en 05 · p. 5(c). Debe quedar UNA canónica (02, dueño de
   `turnos.enchufado_confirmado`) y la otra como puntero.
4. **Solapamiento menor:** la atomicidad/granularidad del import CSV se pregunta en
   03 · p. 6 (bandeja del operador) y 07 · p. 4 (portal del cliente). Son dos superficies
   distintas del maestro, pero la semántica del lote conviene decidirla UNA vez.
