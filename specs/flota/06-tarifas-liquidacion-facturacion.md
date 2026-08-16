# 06 — Tarificación, liquidación y control de pago (DaaS); facturación SOLO vía adaptadores autorizados

Fuente: §3.E1 (tarifas y liquidación — ítems 8 y 9 de la lista cerrada; selector de modo; FUERA de E1) · §4.8 (dinero: enteros CLP, jamás float; RLS RESTRICTIVE FOR SELECT) · §7 n.º 3 (la app JAMÁS emite DTE — art. 97 N°4 CT; emisión solo vía puerto `EmisorDTE` contra proveedores autorizados SII, E2) y §7 n.º 5 (guardrails de dinero) · §0 (constantes: dinero, tarifas 5/4/5, plazos legales 30/8/7, formatos es-CL, HTTP 404/403/2xx) · §4.2 (regla de oro) · §4.5–§4.6 (esquema: contratos/tarifas, empresas_cliente, liquidaciones + lineas, reference_document) · §4.9 (ganchos: reference_document VIVA, excursion inerte) · §5.5 (contracción por toggle) · §9.3 (tests centinela 2, 3, 5, 7, 10 y 11) · §10 (seeds y DONE dual) — todas las citas resuelven contra `docs/PROMPT_MAESTRO_FLOTA.md`.

Alimenta el hito §9.1(4)(f) «tarifas/liquidación/portal cliente `[datos]`». Tag de build `[datos]` (§8): la función de devengo y la máquina de estados de liquidación son esquema fundacional — las escribe el modelo TOPE disponible (§8). Al cierre del hito corre la revisión adversarial de «devengo» (§9.4: datos malformados, doble-tap, red cortada a mitad de flujo, empresa A viendo lo de B, tenant A contra B).

## 0. Qué es y qué NO es (E1)

Este módulo existe SOLO para el modo `daas` (§3 selector de modo; en `mi_flota` queda OFF y oculto — preset de entitlements, jamás código distinto) y cubre:

1. **Tarificación** (§3.E1.8): rate card por empresa cliente, catálogo cerrado de 5 conceptos, máx 4 activos, zonas y recargo horario como modificadores, vigencias append-only, cotización que al aceptarse ES el contrato v1.
2. **Liquidación línea=evidencia** (§3.E1.9): devengo automático desde evidencia (cero líneas manuales por construcción), estados `abierta→cerrada→pagada`, disputa por línea con motivo tipado (ventana 7 días), drill-down línea→evidencia a 1 clic.
3. **Control de pago E1**: marcar la liquidación `pagada` + registro MANUAL del folio DTE emitido FUERA de la app, vía `reference_document` (§4.6, §7.3). El drill-down evidencia-por-línea es el arma de cobro de la Ley 19.983 (Anexo A).

**FUERA de E1 (lista explícita del §3):** emisión de DTE por puerto `EmisorDTE` (adapters Openfactura/Haulmer y SimpleAPI, credenciales por tenant, IVA 19% DTE 33 — todo E2), tablas `pre_facturas/facturas/pagos/notas_credito` (§4.6 las marca E2; NO son gancho del §4.9, por lo tanto NO se crean en E1 ni como DDL), pagos parciales, aging 0-30/31-60/61+, flag derivado `vencida`, recordatorios, bloqueo suave, billing SaaS Stripe, conciliación bancaria (E3). La anulación solo-por-nota-de-crédito (§7.5) rige desde que exista facturación (E2); en E1 no hay qué anular. Los únicos ganchos §4.9 que este módulo toca ya vienen con estado fijado por el maestro: `reference_document` (columnas/tabla VIVA, nullable desde el día 1) y `excursion` (trigger vivo pero inerte sin alarm_rules sembradas — aquí solo se respeta su contrato sobre las líneas).

## 1. Constantes que gobiernan (§0 — fuente única `constants.ts`; número mágico fuera del archivo canónico ⇒ build rojo)

- **Dinero:** CLP `bigint`, entero en unidad menor, `round_clp()` como única función de redondeo; jamás float (§0, §4.8).
- **Tarifas:** catálogo de **5 conceptos**, máx **4 activos** por empresa cliente, zonas máx **5** (§0).
- **Plazos legales:** pago default **30 días** (Ley 21.131) · reclamo de factura **8 días** (Ley 19.983 — opera con DTE en E2; la constante nace en E1) · **disputa de liquidación 7 días** (§0).
- **Formatos es-CL:** `$12.500`, `dd-mm-aaaa`, RUT `12.345.678-5`; grep: cero strings visibles en inglés (§0).
- **HTTP:** recurso de otro tenant = **404 siempre**; módulo apagado = **403** solo en endpoints de planificación/lectura (§0).
- **PK/idempotencia/tenancy:** UUIDv7 de servidor; `tenant_id uuid NOT NULL` + `CHECK (tenant_id = (SELECT id FROM tenant_info))` + FKs compuestas `(tenant_id, id)` en toda tabla del módulo (§0, §4.1).

## 2. Modelo de datos (§4.5–§4.6; vive en la BD del tenant)

- **contratos/tarifas** por `empresa_cliente_id` (§4.5): `concepto` con CHECK contra el catálogo cerrado (`por_entrega`, `por_bulto`, `por_bloque_horas`, `por_devolucion`, `por_intento_fallido`), `precio_clp bigint`, `vigente_desde`; **UPDATE de precio ⇒ RAISE** (append-only: corregir = fila nueva); **máx 4 conceptos activos** por empresa; `otd_comprometido_pct smallint NULL CHECK (BETWEEN 50 AND 100)` — con NULL la tarjeta SLA no se muestra para esa empresa y su `signal_rule` no evalúa (§4.5, §3.E1.11).
- **Modificadores de `por_entrega`** (§3.E1.8, §0): zonas (máx 5, definidas por comunas) y recargo horario — son MODIFICADORES, jamás conceptos del catálogo; prohibido todo recargo por combustible/energía indexado (§7.5; anti-ancla §6).
- **liquidaciones**: por empresa cliente y período (el seed y el camino dorado usan semanas — §10; la regla de corte queda en Preguntas 1); estados `abierta→cerrada→pagada` (§3.E1.9); asociación nullable al folio registrado (`reference_document`).
- **liquidacion_lineas** (§3.E1.9): cada línea nace de exactamente UNA evidencia — `tipo ∈ {entrega_pod, cierre_turno, devolucion, sesion_recarga}` + id — con **`UNIQUE(tenant, tipo, id)`**; concepto, cantidad, monto CLP entero calculado por la BD; **cero líneas manuales por construcción**. La disputa se modela sobre la línea: estado, motivo tipado de catálogo, autor, timestamp, `client_uuid` (idempotencia de mutación §0 — doble envío deja 1 fila, centinela §9.3.1); el flag de bloqueo por excursión nace en el esquema E1 (para no migrar después) aunque el trigger esté inerte (§4.9).
- **reference_document** (§4.6, §4.9 — VIVA desde el día 1): tipo DTE `33|39|52|61`, folio, emisor, `UNIQUE(tipo, folio, emisor)`; la app JAMÁS emite (§7.3) — aquí solo se REGISTRA lo emitido fuera. Tabla compartida con custodia (DTE del manifiesto, módulo 03); este módulo la usa para el folio de la liquidación.
- **Clasificación §4.2:** todas las tablas que CREA este módulo llevan `COMMENT ON TABLE … = 'PLANIFICACIÓN'` — `reference_document` queda FUERA de esa afirmación: no la crea este módulo (es DDL del 00, AC-FTEN-14) y su clase está sin decidir, con pregunta canónica 13 en la spec 00 porque la spec 03 la usa como CAPTURA. Este módulo no la clasifica por su cuenta — (sus mutaciones son acciones online de operador/admin/cliente y REBOTAN 422 tipado; las CAPTURAS que originan líneas viven en los módulos 02/03/04 y jamás rebotan). El linter de migraciones exige la clasificación, el `tenant_id` + CHECK + índice + FK compuesta (§9.2).
- **Transversales §3.E1.14/§4.6:** toda transición de estado emite evento append-only (UUIDv7, doble reloj, secuencia monotónica por tenant) + `audit_trail` por trigger; el estado visible es proyección, jamás contador mutable (§2).

## 3. Devengo — UNA fuente (§7.5, §4.8, §3.E1.9, §2)

- Una única función **`SECURITY DEFINER`** en la BD crea las líneas (misma técnica que la ecuación de cierre, §4.5); el rol de app NO tiene INSERT directo sobre `liquidacion_lineas` y no existe endpoint de línea manual en el manifiesto de rutas.
- El monto se computa EN LA BD: CLP entero `bigint`, redondeo exclusivamente por `round_clp()` (§0). Grep-gate: cero aritmética monetaria en cliente, cero float en columnas o cálculos de dinero (§4.8).
- **Tarifa aplicable** = la fila con mayor `vigente_desde` ≤ `event_time` de la evidencia (semántica del append-only con `vigente_desde`, §3.E1.8; doble reloj §4.6). Determinista y recalculable: lee de la MISMA fuente append-only que `eevd_semanal` (§2: «misma fuente que la liquidación»).
- **Mapeo concepto→evidencia** (coherente con §2 y §3.E1.9; la matriz exhaustiva queda en Preguntas 2–3): `por_entrega` sobre ENCARGO entregado (`exito|parcial`) respaldado por SU `entrega_pod` vigente — grano derivado de §3.E1.9 (cada línea = exactamente UNA evidencia) + §4.5 (POD único POR ENCARGO: `UNIQUE(encargo) WHERE cerrada AND supersede IS NULL`); en la parada consolidada multi-empresa del §3.E1.5 nacen tantas líneas `por_entrega` como encargos entregados con POD — cada una a la empresa de SU encargo, N encargos de la misma empresa ⇒ N líneas, jamás «una línea por parada» (la parada es el grano de la EEVD §2, que es métrica, no regla de devengo); `por_bulto` sobre bultos efectivamente entregados (`items.qty_entregada`); `por_intento_fallido` sobre POD cerrado con `resultado='fallo'`; `por_devolucion` sobre `devoluciones`; `por_bloque_horas` sobre `cierre_turno` — BLOQUEADO por la Pregunta 12: la evidencia `cierre_turno` pertenece a un turno de vehículo (§4.5) y NI `turnos` NI `bloques_agenda` traen `empresa_cliente_id`, de modo que no existe atribución turno/bloque→empresa contratante y el devengo no puede elegirla sin inventar negocio; hasta la respuesta no se implementa regla alguna para este concepto. El tipo `sesion_recarga` existe en el enum por mandato del §3.E1.9, sin regla de devengo cerrada en el maestro (Preguntas 2).
- **Modificadores:** aplican SOLO sobre `por_entrega`, en la MISMA línea (no crean líneas ni conceptos); entrega cuyo destino no calza con ninguna zona o carece de comuna resoluble ⇒ precio base sin modificador, cero error (degradación, jamás rebote).
- **Excursión** (§4.9, centinela §9.3.7): una excursión asociada a la evidencia **bloquea** la línea — JAMÁS la crea ni la borra; `count(lineas)` idéntico antes y después.
- **Evidencia supersedida** (§4.5, §4.6, §4.7): el devengo crea líneas SOLO desde evidencia VIGENTE (`cerrada AND supersede IS NULL` — el único POD válido por encargo, §4.5); POD supersedido ANTES del devengo ⇒ jamás nace línea. Supersede DESPUÉS de devengada la línea (undo post-replay §4.7, corrección §4.6): la línea queda **bloqueada** + fila en `review_queue` — supuesto operativo calcado del patrón de la excursión (§9.3.7: bloquea, jamás crea ni borra); la conducta final (recálculo/exclusión/ajuste) no está cerrada en el maestro — Pregunta 11. «Huérfana» del centinela §9.3.7 se define operativamente como línea cuya evidencia referenciada está supersedida sin resolución (con evidencia append-only y FK compuesta es el único sentido en que ese test puede fallar).
- **Evidencia sin tarifa vigente** para su concepto/empresa: el maestro no cierra el caso (Preguntas 8) — el devengo NO inventa montos mientras el dueño no resuelva.

## 4. Cotización = contrato (§3.E1.8)

Rate card en estado **borrador** + volúmenes hipotéticos ⇒ total simulado en CLP entero con la MISMA lógica del devengo. «Aceptar» convierte el MISMO borrador en la v1 vigente (`vigente_desde`), **cero re-digitación** (quote = contrato). El borrador jamás tarifica operación real y sus volúmenes hipotéticos jamás generan líneas (no son evidencia). Aceptar un borrador que dejaría >4 conceptos activos ⇒ 422 y 0 filas.

## 5. Estados y control de pago E1 (§3.E1.9, §4.6, §10)

- `abierta` (el devengo agrega líneas del período) → `cerrada` (foto estable: habilita disputa del cliente y registro de folio) → `pagada` (registro manual del operador/admin). Transiciones solo hacia adelante y de a una; salto o retroceso (`abierta→pagada`, `pagada→cerrada`) ⇒ 422 y 0 cambios.
- **Registro de folio:** el operador registra el DTE emitido FUERA de la app (software autorizado SII o portal SII del tenant) como fila de `reference_document` asociada — camino paralelo permanente (§7.3, §3.E2). Se opera sobre liquidación `cerrada` (sobre `abierta` ⇒ 422) como supuesto DERIVADO, no mandato: lo respaldan el seed §10 («1 cerrada con folio registrado» es ejemplo, no regla) y el pipeline E2 que parte de `cerrada` (§3.E2 «liquidación cerrada → pre-factura inmutable → emisión → folio»), pero ninguna línea del maestro condiciona el folio al estado — sujeto a Pregunta 10. Folio duplicado ⇒ viola `UNIQUE(tipo, folio, emisor)`.
- El plazo de pago default 30 días (Ley 21.131) existe como constante desde E1 (§0); E1 NO construye flag `vencida`, aging ni recordatorios (E2, §3).
- **Señales para el semáforo** (Anexo B, dominio Caja/custodia — las evalúa el módulo 05): este módulo garantiza que «línea disputada» (rojo: dinero disputado siempre es rojo) y los estados de liquidación sean legibles por `signal_rule` dentro de la MISMA BD del tenant (jamás cross-database, §4.1).

## 6. Disputa por línea (§3.E1.9, §0, §4.2)

- Sobre liquidación `cerrada`, dentro de **7 días** (constante §0; punto de partida asumido = cierre, Preguntas 5); **motivo tipado obligatorio** de catálogo del tenant (mecanismo de filas tipo `motivos` §4.5 — se apagan, jamás DELETE); nota opcional. Fuera de ventana, sin motivo o con motivo fuera de catálogo ⇒ 422 y 0 filas (acción de PLANIFICACIÓN, §4.2).
- **Quién disputa:** el rol `cliente` desde el portal (módulo 07) SOLO sobre líneas de SU `empresa_cliente_id` — línea de otra empresa ⇒ 404 y 0 filas, como DERIVACIÓN de diseño del centinela §9.3.3 (la política de rol hace la fila invisible ⇒ el endpoint no la encuentra), no como mandato del §0: el §0 reserva su 404 para recurso de otro TENANT y el maestro no fija código HTTP para el caso intra-tenant cross-empresa (§9.3.3 solo exige 0 filas y payloads sin economía interna); el operador/admin puede registrar además la disputa recibida por otro canal.
- Cada disputa emite evento + `audit_trail` y alimenta la señal roja de Caja/custodia (Anexo B). La RESOLUCIÓN de la disputa (supersede vs ajuste en período siguiente; si bloquea `pagada`) NO está cerrada en el maestro — Preguntas 4: en E1 se construye el registro y su visibilidad, no una resolución inventada.

## 7. Facturación: prohibición dura + registro manual (§7.3, §3.E2)

- **La app JAMÁS emite DTE ni genera XML/TED/folios con apariencia de DTE** (art. 97 N°4 CT). Guardrail como código (§7): regla estática en CI — grep sobre `src/` de `apps/flota` + manifiesto de rutas sin endpoint de emisión. Violarla aborta el ítem.
- La emisión existirá SOLO en E2 vía puerto `EmisorDTE` con credenciales POR TENANT contra proveedores autorizados SII (adapter #1 Openfactura/Haulmer, adapter #2 SimpleAPI; registro manual de folio como camino paralelo permanente; IVA 19% afecto, DTE 33 — §3.E2). En E1 este módulo NO define el puerto, NO crea sus tablas y NO siembra credenciales: deja funcionando únicamente el registro manual de folio del §5.
- El gate DTE-antes-de-abordar (art. 55 DL 825, vía «bajar del manifiesto») pertenece a custodia (módulo 03); comparte `reference_document`, no este flujo.

## 8. Seguridad del dinero (§4.8, §7.5, §4.3, §4.1)

- Política RLS adicional **`AS RESTRICTIVE` declarada `FOR SELECT` únicamente** en TODA tabla con montos del módulo (tarifas, liquidaciones, líneas — y los costos de energía del módulo 02): exige `app.current_role NOT IN ('chofer','responsable_carga')`. FOR SELECT y no total: una RESTRICTIVE total rebotaría el INSERT del cierre de recarga del chofer (§4.8, corrección del adversario).
- El flujo del chofer NUNCA contiene campos monetarios: el cierre de recarga captura solo SOC/kWh; `costo_clp` lo completa el operador o lo deriva un trigger de `parametros.tarifa_kwh_clp` (§4.8). El chofer ve km, bultos y SOC — JAMÁS CLP (§5.2 F5; la garantía vive en la BD, no en la UI).
- Rol `cliente`: confinado a su `empresa_cliente_id` por política en BD + vistas (§4.1, §4.3); ve SOLO su liquidación; payloads sin columnas de economía interna del operador (costos de energía, `tarifa_kwh_clp`, ahorro vs diésel — §3.E1.10 «JAMÁS ve … economía del operador»).
- `set_config('app.current_role', $2, true)` por transacción — SET LOCAL siempre, jamás SET de sesión (§4.1, §7.2).
- Cross-tenant: garantizado por aislamiento físico (§4.1); las rutas nuevas del módulo entran a la suite HTTP A-contra-B AUTOGENERADA del manifiesto (§9.2); recurso ajeno ⇒ 404 siempre, body sin cadenas centinela (§0, §9.3.2).

## 9. UI (verificable con captura; transversales §5.1/§5.5/§5.7/§9.2)

- **Operador/admin (web, escritorio):** rate card por empresa (5 conceptos, activos ≤4, modificadores), cotización con volúmenes hipotéticos y «Aceptar», liquidación del período línea por línea, cierre, registro de folio, marcar pagada. Locked-states y upsell SOLO en panel admin (§5.5).
- **Drill-down línea→evidencia a 1 clic** (§3.E1.9): desde cualquier línea, UNA interacción abre la evidencia completa (foto, firma, motivo, GPS estático si existe — nivel 2 del patrón §5.6).
- Formatos es-CL en todo el módulo: `$12.500`, `dd-mm-aaaa`, RUT `12.345.678-5` (§0). Terminología por `term_key` (resolución tenant→vertical→base, §5.1); selectores SOLO por `data-testid`/term_key — la suite e2e corre con terminología base y extrema sin cambiar un selector; lint que veta getByText sobre renombrables (§9.2).
- 4 estados obligatorios por pantalla (vacío accionable / skeleton / error es-CL con recuperación / sin conexión) y gate axe/Lighthouse AA (§5.7); dark mode de serie (§5.1); snapshot 375px con términos al máximo largo (§9.2).

## Criterios de aceptación

- [x] (P1) Esquema de tarifas por empresa cliente (§3.E1.8, §4.5, §0): `concepto` con CHECK contra el catálogo cerrado de 5 (`por_entrega`, `por_bulto`, `por_bloque_horas`, `por_devolucion`, `por_intento_fallido`) — INSERT de concepto fuera del catálogo ⇒ rechazo en BD y 0 filas; `precio_clp bigint` CLP entero; intento de dejar 5 conceptos activos en una empresa ⇒ 422 y 0 filas (máx 4); zonas SOLO como modificadores de `por_entrega` definidas por comunas con máximo 5 — la 6ª zona ⇒ 422 y 0 filas (el test corre bajo el supuesto operativo «tope evaluado POR EMPRESA CLIENTE», coherente con la rate card por empresa; el ámbito real del «zonas máx 5» del §0 queda sujeto a Pregunta 9); recargo horario SOLO como modificador — no existe concepto «zona» ni «horario» ni recargo por combustible/energía indexado (test de catálogo + grep §7.5) — oráculo: CI [AC-FTAR-01]
  - Probado: `db/migraciones-flota/tenant/0061_tarifas_por_empresa.sql` (tablas `tarifas`,
    `tarifa_zonas`, `tarifa_recargo_horario`; CHECK de catálogo cerrado; triggers de tope de
    conceptos distintos activos y de zonas, con `errcode = check_violation` que el servidor
    traduce a 422; RLS restrictiva del rol `cliente` vía `aplicar_rls_de_empresa`, reusando la
    de AC-FRUT-12) + `db/flota/pgtap/0026_tarifas_por_empresa.sql`. `check.sh --full --app=flota`
    en verde (gate-constantes: los topes se referencian desde `TARIFAS.activos_max_por_empresa`
    del canónico, sin duplicar el número mágico).
- [x] (P1) Vigencia append-only (§3.E1.8, §4.5, §9.3.5): `UPDATE` de `precio_clp` con el rol de app ⇒ RAISE del trigger y 0 cambios (corregir precio = INSERT con nuevo `vigente_desde`); tarifa solapada para la misma empresa+concepto ⇒ 422 y 0 filas (centinela 5); toda tabla del módulo lleva `COMMENT ON TABLE` clase PLANIFICACIÓN y pasa el linter de migraciones (`tenant_id` + CHECK constante + índice + FK compuesta, §4.2/§9.2) — oráculo: CI [AC-FTAR-02]
  - Probado: `db/migraciones-flota/tenant/0062_tarifas_vigencia_append_only.sql` (trigger
    `tarifas_vigencia_append_only` — BEFORE UPDATE, RAISE con `errcode = check_violation` sobre
    CUALQUIER columna, no solo `precio_clp`: la fila completa es la vigencia; trigger
    `tarifas_vigencia_no_solapada` — BEFORE INSERT, rebota si `vigente_desde` <= la última ya
    registrada del mismo empresa+concepto, centinela 5; `vigente_desde` pasa su DEFAULT de
    `now()` —fijo dentro de una transacción— a `clock_timestamp()`, porque la corrección de
    precio necesita vigencias estrictamente crecientes incluso dentro de la transacción única
    de una suite pgTAP) + `db/flota/pgtap/0027_tarifas_vigencia_append_only.sql`. La clase
    PLANIFICACIÓN y el linter ya quedaban verdes desde AC-FTAR-01 (0062 no crea tablas nuevas).
    `check.sh --full --app=flota` en verde.
- [x] (P1) Devengo único en BD (§7.5, §4.8, §3.E1.8): las líneas SOLO las crea la función `SECURITY DEFINER` — INSERT directo a `liquidacion_lineas` con el rol de app ⇒ 42501; el monto se calcula EN LA BD en CLP entero con `round_clp()` aplicando la tarifa con mayor `vigente_desde` ≤ `event_time` de la evidencia (test con dos vigencias: la evidencia anterior al cambio devenga el precio viejo); entrega sin zona que calce o sin comuna resoluble ⇒ precio base de `por_entrega` sin modificador, cero error; grep-gate: cero float y cero aritmética monetaria fuera de la BD — oráculo: CI [AC-FTAR-03]
  - Probado: `db/migraciones-flota/tenant/0063_devengo_unico.sql` (tablas `liquidaciones` y
    `liquidacion_lineas` con la forma mínima que el devengo necesita; trigger
    `liquidacion_lineas_solo_devengo` — INSERT directo ⇒ 42501 hasta para el migrador — más el
    REVOKE INSERT al rol de app, que `db/flota/rol-app.mjs` deriva de la PRESENCIA de ese
    trigger igual que el REVOKE UPDATE/DELETE de los hechos; `devengar_entrega()` SECURITY
    DEFINER con `search_path` fijo calcula el monto con `round_clp()` sobre
    `tarifa_vigente_al()` —mayor `vigente_desde` ≤ `event_time`— más
    `modificadores_de_entrega()`, que devuelve 0 sin zona que calce o sin comuna) +
    `db/flota/pgtap/0028_devengo_unico.sql` (15/15: dos vigencias con la entrega de marzo
    devengando 3.500 y la de julio 3.800; Ñuñoa 3.500+700 de zona; Maipú y el destino sin
    comuna a precio base sin error; el rol `app_t_canary` sin INSERT y con SELECT; devengar dos
    veces la misma evidencia no crea una segunda línea) + grep-gate
    `db/flota/gate-dinero-en-la-bd.mjs` con sus mutantes (cero aritmética monetaria y cero
    flotante sobre símbolos `*_clp` en `apps/flota`, `packages/nucleo-comun` y `packages/miga`;
    el «cero float» de las COLUMNAS ya lo cubren el linter y `0003_dinero.sql`).
    `check.sh --full --app=flota` en verde.
- [x] (P1) Línea=evidencia (§3.E1.9, §9.3.7): cada línea referencia exactamente UNA evidencia de tipo `entrega_pod|cierre_turno|devolucion|sesion_recarga` con `UNIQUE(tenant, tipo, id)` — la segunda línea sobre la misma evidencia viola el UNIQUE; el devengo solo crea líneas desde evidencia VIGENTE (`cerrada AND supersede IS NULL`, §4.5) — fixture: POD supersedido ANTES del devengo ⇒ 0 líneas de ese POD; POD devengado y LUEGO supersedido con motivo=`undo` (§4.7) ⇒ la línea queda bloqueada + fila en `review_queue` y `count(lineas)` no cambia (supuesto operativo sujeto a Pregunta 11); consulta de líneas huérfanas = 0 sobre seed y camino dorado, con definición operativa: huérfana = línea cuya evidencia referenciada está supersedida sin resolución (único sentido no trivial del centinela §9.3.7 con evidencia append-only y FK compuesta); NO existe endpoint de línea manual en el manifiesto de rutas (test estructural); excursión inyectada por fixture (gancho §4.9, inerte en E1) BLOQUEA la línea y jamás la crea ni la borra — `count(lineas)` idéntico antes y después — oráculo: CI. Probado: `db/flota/pgtap/0029_linea_es_evidencia.sql` (15/15) + `apps/flota/rutas/linea-manual.test.mjs`; gate completo verde (25/25 db/flota, 493 e2e) [AC-FTAR-04]
- [x] (P1) Máquina de estados `abierta→cerrada→pagada` (§3.E1.9, §4.6, §2): solo la liquidación `abierta` acepta líneas nuevas; `cerrada` congela líneas y totales; transición que salta o retrocede (`abierta→pagada`, `pagada→cerrada`, nueva línea sobre `cerrada`) ⇒ 422 y 0 cambios; cada transición emite evento append-only + `audit_trail` por trigger; el estado visible es proyección, jamás contador mutable — oráculo: CI [AC-FTAR-05]
  - Probado: `db/migraciones-flota/tenant/0065_maquina_de_estados_de_liquidacion.sql` (trigger
    `liquidacion_guarda_de_estados` — BEFORE UPDATE, rebota con `check_violation` todo salto o
    retroceso de `estado`, incluido el retroceso desde el estado final `pagada`; trigger
    `liquidacion_emitir_evento_de_estado` — AFTER UPDATE, emite `liquidacion.cerrada` o
    `liquidacion.pagada` a `eventos` con el huso de `America/Santiago` resuelto contra la base
    de husos del sistema, jamás 0 fijo; `audit_trail` ya quedaba enganchado desde AC-FTAR-03,
    sin duplicar el trigger; `solo_el_devengo_crea_lineas()` extendida para rebotar con
    `check_violation` cualquier línea nueva —incluso desde `devengar_entrega()` SECURITY
    DEFINER— contra una liquidación que no esté `abierta`) + `db/flota/pgtap/0030_maquina_de_
    estados_de_liquidacion.sql` (21/21: salto `abierta→pagada` y retrocesos `cerrada→abierta` /
    `pagada→cerrada` rebotan con 0 cambios y 0 eventos; el camino dorado `abierta→cerrada→pagada`
    deja exactamente 2 eventos y 2 filas de `audit_trail`; `devengar_entrega()` sobre una
    liquidación `cerrada` rebota 422 y deja 0 líneas; un UPDATE que no toca `estado` no emite
    evento). `check.sh --full --app=flota` en verde.
- [x] (P1) Disputa por línea (§3.E1.9, §0, §4.2, §9.3.3): sobre liquidación `cerrada` y dentro de la ventana de 7 días (constante en `constants.ts`, jamás hardcodeada), con motivo tipado obligatorio de catálogo del tenant; fuera de ventana, sin motivo, con motivo fuera de catálogo o sobre liquidación en estado distinto de `cerrada` (`abierta`; el caso `pagada` queda además ligado a Pregunta 4) ⇒ 422 y 0 filas; doble envío de la misma disputa (doble-tap, §9.4) ⇒ exactamente 1 disputa y 1 evento — centinela §9.3.1: replay doble de CUALQUIER mutación ⇒ `count(*)=1` por `client_uuid`; la disputa emite evento + audit y deja el estado legible para la señal roja Caja/custodia («dinero disputado siempre es rojo», Anexo B); el rol `cliente` solo disputa líneas de SU empresa — línea de otra empresa ⇒ 404 y 0 filas (derivación del §9.3.3: fila invisible por política de rol; el 404 del §0 es cross-tenant) — oráculo: CI. Probado: `db/migraciones-flota/tenant/0066_disputa_por_linea.sql` (columnas
  `disputa_*` en `liquidacion_lineas`, catálogo de 4 motivos, evento
  `liquidacion_linea.disputada`, función `disputar_linea()` SIN `SECURITY DEFINER` — corre con
  los privilegios e RLS de quien invoca, a propósito, para que `aplicar_rls_de_empresa` del rol
  `cliente` (viva desde la 0063) decida qué línea existe para quién) + `db/flota/pgtap/
  0031_disputa_por_linea.sql` (23/23: camino dorado, replay del mismo `client_uuid` — centinela
  1 —, ventana de 7 días medida desde el evento `liquidacion.cerrada`, motivo ausente/fuera de
  catálogo, liquidación no cerrada) + `db/flota/suite-bd/disputa-por-linea.test.mjs`, NUEVO en
  este AC, con el rol de app real NOSUPERUSER (pgTAP corre como superusuario y a un superusuario
  la RLS no se le aplica — mismo motivo que AC-FRUT-12): el cliente disputa SU línea (positivo),
  la línea de OTRA empresa es invisible — 0 filas sin excepción, la derivación exacta del
  §9.3.3 —, y un cliente sin empresa declarada tampoco disputa nada. `check.sh --full --app=flota`
  en verde. [AC-FTAR-06]
- [x] (P1) Drill-down línea→evidencia a 1 clic + es-CL (§3.E1.9, §0, §9.2): e2e con selectores `data-testid` (cero getByText sobre renombrables) que desde una línea de la liquidación abre la evidencia completa (POD con foto/firma/motivo) en UNA interacción; montos `$12.500` (CLP entero, miles con punto), fechas `dd-mm-aaaa`, RUT `12.345.678-5`; grep: cero strings visibles en inglés en el módulo — oráculo: CI. Probado:
  `apps/flota/src/servidor/liquidaciones.ts` (`liquidacionConLineas`, `evidenciaDeLinea`, SOLO
  LECTURA vía `enLectura` — el devengo, la máquina de estados y la disputa ya existen en la BD
  desde AC-FTAR-03/05/06) + rutas `GET /api/liquidaciones/[id]` y
  `GET /api/liquidacion-lineas/[id]/evidencia` (guardia `admin_tenant`/`operador`, 404 pelado
  cross-tenant, 403 con un rol sin panel) + pantalla `/liquidaciones?id=` con bottom-sheet local
  (mismo patrón que `hoy/peek-n1.tsx`: la evidencia es estado de la MISMA pantalla, jamás una
  ruta nueva) que abre foto/firma/motivo de la línea en el mismo clic que la selecciona, con
  `dineroEsCl`/`fechaEsCl`/`formatearRut` (cero string en inglés) + `apps/flota/e2e/
  liquidacion-drill-down.spec.ts`, NUEVO en este AC (sembrando con `devengar_entrega()` real,
  la misma función SECURITY DEFINER que usa la app). Dos hallazgos reales de la corrida completa,
  arreglados en este mismo commit: (1) `periodo_inicio`/`periodo_fin` son `date` sin huso —
  `fechaEsCl(new Date(...))` les aplicaba el huso de Chile y corría la fecha un día hacia atrás
  (`06-04-2026` se leía `05-04-2026`); se ancla a mediodía (`T12:00:00`), mismo patrón que
  `bandeja/page.tsx`. (2) el fixture de este AC deja PERMANENTEMENTE una ruta con `entregas_pod`
  aterrizado (append-only, §7.4) en el tenant A compartido — `limpiarBandeja` (borrado de
  encargos) y los `beforeEach`/limpiezas de `rutas.spec.ts` y `publicar-dia.spec.ts` (borrado
  crudo de `rutas`, sin el guardia que `limpiarOperacion` ya tenía desde AC-FRUT-23) rebotaban
  «violates foreign key constraint» contra ese POD; ambos quedan con el mismo guardia
  `not exists (... entregas_pod ...)`. Además: RUT sintético `76.543.219-7` agregado a la lista
  congelada (`db/flota/ruts-sinteticos.mjs`, AC-FIDN-21) y liquidación devengada real del tenant
  B agregada a `preparar-tenants.mjs` para que el centinela 2 (`cruce-tenant.spec.ts`,
  AC-FTEN-26) tuviera fila real contra la cual probar el cruce en las dos rutas nuevas.
  `check.sh --full --app=flota` en verde (18 pasos OK, 0 fallidos). [AC-FTAR-07]
- [x] (P1) La app JAMÁS emite DTE — guardrail estático (§7.3, §4.6, §3.E2): regla estática en CI con lista de firmas VERSIONADA en el repo (mismo estándar que el grep explícito del §7.1): grep bloqueante sobre `src/` de `apps/flota` de firmas de ESTRUCTURA de DTE — tags XML `<DTE`, `<TED`, `<CAF`, generación o firma de timbre electrónico, librerías de firma XML-DSIG SII, generación de folios — jamás la palabra suelta «DTE» (el registro manual la usa legítimamente); + cero endpoint de emisión en el manifiesto de rutas (test estructural; violación de cualquiera aborta el ítem) — oráculo: CI [AC-FTAR-08]
  - Probado: `apps/flota/dte/firmas-de-estructura.json` (lista versionada: 13 firmas de estructura,
    cada una con su `porque` y su `positivo`; 10 negativos tomados del registro manual REAL de
    `manifiestos.ts`; 16 segmentos de ruta de emisión prohibidos) + `apps/flota/dte/gate-jamas-emite.mjs`
    (escanea los 296 archivos de `apps/flota/src` y las 88 rutas del manifiesto generado; sale 1 con
    el hallazgo, el archivo y la línea) + 10 pruebas en `apps/flota/dte/gate-jamas-emite.test.mjs`:
    árbol real limpio, walker no vacuo (>100 archivos y alcanza `servidor/manifiestos.ts`), cada
    firma atrapa su propio positivo (anti no-op), los 10 negativos del registro manual NO disparan,
    13 mutantes verosímiles (`<DTE`, `<EnvioDTE`, `<TED`, `<CAF`, `<FRMT`, namespace xmldsig,
    `xml-crypto`, Openfactura, `generarTimbre`, `asignarFolio`, `nextval('folio_33_seq')`, `.p12`,
    `TRACKID`) atrapados por la firma que les toca, 10 rutas de emisión atrapadas y 7 legítimas
    —incluida `/api/liquidaciones/[id]/folio` del registro manual— intactas. Corre en el gate
    RÁPIDO, antes de los tests (`apps/flota/package.json`), porque es un guardrail penal (art. 97
    N°4 CT) y no una aserción más. La mitad de MUTACIÓN de este ítem —registro manual del folio
    sobre liquidación `cerrada`— se partió al AC-FTAR-16 de más abajo, que pide DDL: el motor no
    escribe migraciones y la asociación liquidación↔folio no existe todavía en la BD.
- [x] (P1) La app JAMÁS emite DTE — registro MANUAL del folio (§7.3, §4.6, §3.E2; mitad de mutación partida de [AC-FTAR-08], que ya cerró el guardrail estático): el registro MANUAL de folio vía `reference_document(tipo 33|39|52|61, folio, emisor)` opera sobre liquidación `cerrada` (sobre `abierta` ⇒ 422 — supuesto operativo DERIVADO del seed §10 y del pipeline E2 que parte de `cerrada` §3.E2, no mandato del maestro; sujeto a Pregunta 10) y queda como camino paralelo permanente; folio duplicado ⇒ viola `UNIQUE(tipo, folio, emisor)`, 422 y 0 filas; el folio queda ASOCIADO a su liquidación y se lee desde el drill-down (§4.6, sección «Modelo»: «asociación nullable al folio registrado») — oráculo: CI [AC-FTAR-16]
  - Probado: `registrarFolioDeLiquidacion` (`apps/flota/src/servidor/liquidaciones.ts`) y su puerta
    `POST /api/liquidaciones/[id]/folio`, sobre la asociación que trajo la migración 0072 (columna,
    FK COMPUESTA e índice único parcial) — la DDL que tenía bloqueado a este AC y que resolvió la
    sesión supervisada del 16-ago-2026. La mutación ENTERA es UNA sentencia: `objetivo` toma la
    liquidación elegible con `for update`, el INSERT del documento cuelga de ella y el UPDATE cuelga
    del INSERT, así que el «0 filas» de cada rebote es estructural y no depende de que tres consultas
    separadas hayan quedado en el orden correcto. El `on conflict do nothing` acá es el DETECTOR del
    duplicado y no la semántica «creando/ligando» de la custodia (`manifiestos.ts::asociarDocumento`,
    que es captura de terreno y por la regla de oro §4.2 jamás rebota): ligar sería pegarle a ESTA
    liquidación el papel que ampara otra. `pagada` también rebota 422 —el folio es lo que se cobra,
    llega ANTES del pago— y sin evento append-only porque `evento_tipo` no tiene código para este
    acto y sembrarlo es DDL supervisada; el acto igual queda en `audit_trail` por el trigger de la
    0063. Cubierto por 7 pruebas en `db/flota/suite-bd/folio-de-la-liquidacion.test.mjs` con el rol
    de APP real (`app_t_<slug>`, NOSUPERUSER, sin BYPASSRLS) contra el cluster: el positivo primero
    (el folio queda asociado a SU liquidación y se lee desde el drill-down), `abierta` ⇒ 422,
    `pagada` ⇒ 422, duplicado sobre otra cerrada ⇒ 422 con el documento original amparando UNA sola
    liquidación, liquidación que ya tiene folio ⇒ 422 sin perder el suyo, id inexistente ⇒ 404, y el
    catálogo `dte_tipo` afirmado contra el enum de la BD con un 52 de punta a punta (el positivo de
    arriba es un 33, y un servicio con el tipo cableado pasaría sin esto). Los cuatro rebotes cuentan
    `reference_document` ANTES y DESPUÉS: es tabla compartida con custodia y su `UNIQUE(tipo, folio,
    emisor)` es global, así que un folio escrito de más queda quemado para siempre. Caso de cruce
    declarado en `apps/flota/rutas/manifiesto.json` (recurso sobre `liquidaciones`, con la huella de
    la BD de B — un 404 con la fila escrita sería el peor de los verdes). `check.sh --full
    --app=flota` en verde.
- [x] (P1) Dinero invisible — el patrón probado CON EL ROL DE APP REAL (§4.8, §9.3.10; la mitad DDL se partió al [AC-FTAR-17]): pgTAP que corre bajo `set role app_t_<slug>` —el rol con el que la app habla con la base (LOGIN, NOSUPERUSER, NOBYPASSRLS, cero ownership)— y no bajo el dueño del esquema, contra el que toda RLS es transparente: chofer y `responsable_carga` `SELECT` sobre la tabla de montos ⇒ 0 filas, rol sin declarar ⇒ 0 filas (la falla va hacia el cierre), operador ⇒ >0 (las 0 filas no son una tabla vacía); chofer cierra recarga offline + replay ⇒ sin rebote, misma fila, `costo_clp` NULL a completar por el operador o el trigger desde `parametros.tarifa_kwh_clp`; forma de la política afirmada sobre el CONJUNTO (`RESTRICTIVE`, `FOR SELECT` únicamente, con su `PERMISSIVE` de base) y el inventario de tablas de montos derivado del catálogo por el sufijo `_clp`, con las que aún no la llevan congeladas en una lista exacta que se pone roja si la deuda crece o si se salda sin declararlo — oráculo: CI [AC-FTAR-09]
  - Probado: `db/flota/pgtap/0032_dinero_invisible.sql`, NUEVO en este AC (17 aserciones, verde
    contra el canario). Nace porque la 0016 abría su sección de RLS diciendo «se prueba con
    `set role` al rol de app real» y después NO hacía ningún `set role`: miraba `pg_policies` y
    se declaraba verde — el centinela 10 (§9.3) con nombre y apellido. Acá el `set role` es de
    verdad y lo PRIMERO que se afirma es `current_user`, para que la suite no pueda recaer en el
    verde vacuo que vino a matar. Un hallazgo real de la corrida: el replay del cierre de recarga
    escrito como `insert … on conflict` INLINE **sí rebota** al chofer con 42501 —el árbitro del
    ON CONFLICT necesita LEER la fila en conflicto y leerla es justo lo que la política le niega,
    así que rebota el REPLAY, no el primer intento, y la captura queda atrapada en el outbox
    offline—; el servidor ya iba por `registrar_recarga` (SECURITY DEFINER) por ese motivo, pero
    nada lo afirmaba: ahora un `throws_ok` cubre la «simplificación» a upsert inline, que el gate
    no habría visto. `check.sh --full --app=flota` en verde.
- [x] (P1) Dinero invisible — APLICAR la política a las tablas de montos del módulo (§4.8, §9.3.10; mitad partida de [AC-FTAR-09], que ya cerró el patrón y su prueba con el rol real): `select aplicar_rls_de_dinero(…)` sobre las cuatro tablas de economía pura —`tarifas` (`precio_clp`), `tarifa_zonas` y `tarifa_recargo_horario` (`monto_clp`), `liquidacion_lineas` (`monto_clp`, `precio_base_clp`, `modificadores_clp`)—, que tenían `aplicar_rls_de_empresa()` (confinamiento del `cliente`, 0040) pero no la RESTRICTIVE del chofer; con la política puesta, el `bag_eq` de `db/flota/pgtap/0032_dinero_invisible.sql` deja de listarlas como deuda y sus tres aserciones de forma pasan a cubrirlas sin tocar el test. La quinta no era mecánica y se resolvió por ESTRUCTURA: `parametros` es una tabla de UNA fila donde el dinero (`tarifa_kwh_clp`, `precio_diesel_litro_clp`) convive con la configuración que el terreno necesita (`reserva_pct`, `factor_consumo`, `bultos_max_sin_receptor`), así que la RESTRICTIVE de fila la dejaría entera invisible para el chofer —sin la fórmula de energía del §0— y un `revoke select` por columna tampoco sirve, porque el rol de Postgres es UNO por tenant (`app_t_<slug>`, §4.1) y el papel viaja en `app.current_role`, una variable de sesión que un GRANT no mira: se lo quitaría al gestor igual que al chofer. La salida es la vista `parametros_operativos` (`security_invoker`, sin las dos columnas de plata), y el terreno lee de ahí — oráculo: CI [AC-FTAR-17]
  - Probado: migración `0073_dinero_invisible_en_las_cinco_tablas.sql` (sesión supervisada) +
    `db/flota/pgtap/0037_folio_y_dinero_invisible.sql` — las cuatro tablas con RLS encendida y
    con las DOS políticas del patrón (`dinero_base` permisiva + `dinero_sin_chofer` restrictiva,
    8 en total), la vista existente, SIN `tarifa_kwh_clp` ni `precio_diesel_litro_clp` y CON
    `reserva_pct`, `factor_consumo` y `bultos_max_sin_receptor` (una vista segura y también
    inútil dejaría al chofer sin el §0). La mitad de aplicación —que el terreno CONSUMA la
    vista— no la puede afirmar la base: `parametros` no lleva RLS de dinero y queda legible, así
    que lo único que separa al terreno del dinero es de qué relación pregunta. Eso lo vigila
    `db/flota/gate-terreno-sin-parametros.mjs`, NUEVO en este AC, con sus 9 mutantes en
    `gate-terreno-sin-parametros.test.mjs`: en `apps/flota/src` toda lectura (`from` o `join`,
    que el tablero entra por `left join`) de `parametros` tiene que ser de
    `parametros_operativos` salvo los archivos declarados con su motivo, y la lista es exacta en
    las dos direcciones —un lector nuevo se pone rojo, y una excepción que dejó de leer la tabla
    también, para que no sobreviva a su motivo—. Hoy la declaración es una sola:
    `src/servidor/tablero.ts`, que es del OPERADOR (§5.2-F1) y no proyecta ninguna columna de
    plata. El único lector de terreno era `src/app/entrega/page.tsx` (`bultos_max_sin_receptor`,
    §4.4) y ahora lee la vista, con las e2e de POD que lo ejercitan (`pod-offline`,
    `pod-encuadre-degradado`, `pod-variantes`) en verde. Antídoto al verde vacuo: el gate exige
    que ALGUIEN lea la vista — si nadie la consume, el terreno se quedó sin su configuración y
    eso también es rojo. `check.sh --full --app=flota` en verde.
- [x] (P1) Aislamiento del rol `cliente` y cross-tenant (§9.3.2, §9.3.3, §4.3, §0): sesión `cliente` de la empresa X ⇒ 0 filas de tarifas/liquidaciones/líneas de la empresa Y en toda tabla operativa (política en BD + vistas) y payloads sin columnas de economía interna del operador (costos de energía, `tarifa_kwh_clp`, ahorro vs diésel); todas las rutas del módulo cubiertas por la suite HTTP A-contra-B autogenerada del manifiesto: recurso de otro tenant ⇒ 404 con body sin cadenas centinela y BD de B sin cambios — oráculo: CI [AC-FTAR-10]
  - Probado: `db/flota/suite-bd/aislamiento-cliente-modulo-tarifas.test.mjs`, NUEVO en este AC
    (10/10, rol de app REAL `app_t_<slug>` conectado sin BYPASSRLS, mismo patrón que
    `confinamiento.test.mjs` AC-FRUT-12 y `disputa-por-linea.test.mjs` AC-FTAR-06 pero con
    SELECT CRUDO —no a través de una función que podría esconder el defecto— sobre las CINCO
    tablas propias del módulo: `tarifas`, `tarifa_zonas`, `tarifa_recargo_horario`,
    `liquidaciones`, `liquidacion_lineas`. Cada tabla lleva su positivo (empresa X ve lo suyo)
    y su negativo (0 filas de la empresa Y); más forma de la política (RLS + 2 policies),
    cliente sin empresa ⇒ 0 filas en las cinco, operador sin rol declarado ve ambas empresas
    (la política no estorba), cliente no puede ESCRIBIR sobre la fila ajena (FOR ALL), y un
    test estructural sobre `information_schema.columns` que prueba que ninguna de las cinco
    tablas lleva columna de economía interna del operador (`kwh`, `diesel/diésel`, `ahorro`,
    `energ*`) — la garantía verificable hoy, sin portal del contratante (módulo 07) todavía
    construido: la fuga no puede venir NI del esquema NI de la única consulta que existe
    (`apps/flota/src/servidor/liquidaciones.ts`, AC-FTAR-07, que tampoco las selecciona). La
    suite HTTP A-contra-B autogenerada del manifiesto (AC-FTEN-26, `cruce-tenant.spec.ts`) ya
    cubre las dos rutas de recurso del módulo (`/api/liquidaciones/[id]`,
    `/api/liquidacion-lineas/[id]/evidencia`) desde que declararon su `cruce` en AC-FTAR-07 —
    es autogenerada del manifiesto comiteado, así que no había una tercera suite que escribir
    para eso. `check.sh --full --app=flota` en verde (18/18 pasos OK, 0 fallidos, incluido
    `e2e móvil 390x844` que corre `cruce-tenant.spec.ts`).
- [x] (P1) Cotización = contrato (§3.E1.8): rate card en borrador + volúmenes hipotéticos produce total simulado en CLP entero calculado en la BD con `round_clp()` (§0; que sea la MISMA función del devengo es decisión de implementación del §4 del cuerpo, fuera del oráculo — §3.E1.8 solo exige quote=contrato y cero re-digitación); «Aceptar» convierte el MISMO borrador en la v1 vigente sin re-digitación (test compara filas antes/después: mismas filas, ahora vigentes); el borrador y sus volúmenes hipotéticos jamás generan líneas de liquidación (no son evidencia); aceptar un borrador que dejaría >4 conceptos activos ⇒ 422 y 0 filas — oráculo: CI [AC-FTAR-11]
  - Probado: `db/migraciones-flota/tenant/0067_cotizacion_es_contrato.sql` (tablas `cotizaciones`,
    `cotizacion_tarifas`, `cotizacion_volumenes` — el borrador vive FUERA de `tarifas` para que
    `tarifa_vigente_al()` nunca lo tarifique por error; `simular_cotizacion()` suma
    `round_clp(precio × volumen)` por concepto, misma función de redondeo que el devengo, sin
    tocar `liquidacion_lineas`; `aceptar_cotizacion()` inserta cada línea del borrador en
    `tarifas` con SU MISMO `id` —cero re-digitación— vía INSERT normal, así que hereda gratis
    `tarifas_limite_conceptos` (0061): un borrador que dejaría >4 conceptos activos rebota con
    `check_violation` a mitad de la función y Postgres revierte TODO lo insertado en esa
    llamada, 0 filas) + `db/flota/pgtap/0033_cotizacion_es_contrato.sql` (21/21: total simulado
    exacto, concepto con volumen sin precio no suma, `bag_eq` confirma que las MISMAS filas
    —mismo id/concepto/precio— migran de `cotizacion_tarifas` a `tarifas`, aceptar dos veces
    rebota por ser terminal, y el bloque de >4 activos deja el conteo de conceptos y el estado
    de la cotización intactos). `check.sh --full --app=flota` en verde (18/18 pasos OK).
- [x] (P1) Contracción por modo — conmutación sin pérdida de filas (§3 selector, §9.3.11; mitad de mutación de la contracción completa, partida al [AC-FTAR-18] de más abajo, que queda BLOQUEADO): conmutar `mi_flota→daas→mi_flota` no pierde ni una fila de `tarifas`, `tarifa_zonas`, `tarifa_recargo_horario`, `liquidaciones` ni `liquidacion_lineas` (centinela 11: aditivo, jamás destructivo; mismo patrón que AC-FSEM-13/AC-FRUT-14 — cuenta CADA tabla del módulo y compara identidad de fila vía `string_agg(id::text)`, no solo el conteo) — oráculo: CI [AC-FTAR-12]
  - Probado: `apps/flota/e2e/tarifas-contraccion.spec.ts`, NUEVO en este AC (mismo patrón
    `elInventario()` + `conmutarDirecto()` de `semaforo-contraccion.spec.ts` AC-FSEM-13):
    siembra una empresa cliente propia con tarifa + zona + recargo horario vigentes y una
    liquidación con una línea devengada de verdad vía `devengar_entrega()` —la misma función
    `SECURITY DEFINER` de AC-FTAR-03; un INSERT directo a `liquidacion_lineas` rebota 42501—,
    cuenta las 5 tablas del módulo y compara ids antes/después del viaje `mi_flota→daas→
    mi_flota`: mismos ids, mismos conteos, cero filas perdidas ni recreadas.
    `check.sh --full --app=flota` en verde.
- [x] (P1) Contracción por modo/entitlement — manifest sin tarifas/liquidación/facturación y endpoints de planificación/lectura ⇒ 403 (§3 selector, §5.5, §0; mitad de mutación partida del [AC-FTAR-12], que ya cerró la conmutación sin pérdida de filas): en `mi_flota` o con el feature OFF, el manifest de navegación server-side no incluye tarifas/liquidación/facturación (sin huecos, candados ni parpadeo; locked-state solo en panel admin) y `GET /api/liquidaciones/[id]` + `GET /api/liquidacion-lineas/[id]/evidencia` (y cualquier endpoint nuevo del módulo) responden 403 — BLOQUEADO por DOS cosas, ninguna resoluble por el motor: (1) **DDL de sesión supervisada** — las 4 `lookup_key` que `modo_recorte` ya recorta (`tarifas`, `liquidacion_por_cliente`, `portal_contratante`, `facturacion`; `db/migraciones-flota/control/0003_modo_como_preset.sql`) NUNCA se insertaron en la tabla `features` de `control` (patrón exacto de `0006_feature_de_documentos.sql`/`0007_feature_del_modulo.sql`); sin esa fila, la vista `entitlements_efectivos` —que hace `cross join features`— jamás produce una entrada para ellas, así que el snapshot congelado (`config_version.snapshot->'entitlements'`) nunca las incluye y `estadoDeFeature`/`entitlementVigente` (`apps/flota/src/servidor/config.ts`) devuelven `null`/`false` SIEMPRE, para CUALQUIER modo — construir el gate hoy dejaría `daas` tan bloqueado como `mi_flota` (verde falso: rompería el camino dorado de AC-FTAR-07, que hoy pasa GET en `daas`); (2) el «manifest de navegación server-side (entitlements × rol) en el bootstrap» que este AC pide NO es infraestructura de este módulo: es el MISMO entregable que [AC-FMIG-09] (spec 08, hito g) y [AC-FPOR-03] (spec 07 §portal, texto casi idéntico: «el manifest server-side no incluye tarifas, liquidación por cliente, portal ni facturación»); construir una versión propia acá duplicaría esa infraestructura genérica en vez de consumirla. DESBLOQUEADO el 16-ago-2026: las dos condiciones se cumplieron. (1) La migración de `features` existe (`db/migraciones-flota/control/0009_features_del_grupo_daas.sql`, AC-FTAR-18) y un invariante en `control.test.mjs` verifica que toda `lookup_key` que un modo recorta esté en el catálogo; (2) el manifest genérico está construido: AC-FMIG-09 y AC-FPOR-03 cerraron. Lo que queda es lo de este módulo y es CONSTRUIBLE: este módulo entonces agrega `entitlementVigente(c, slug, FEATURES.tarifas)` (patrón ya usado en `apps/flota/src/servidor/manifiestos.ts`) a sus endpoints de lectura, antes/junto al chequeo de rol que ya tienen — oráculo: CI [AC-FTAR-18]
  - Probado: `moduloDeLiquidacionEncendido()` (`apps/flota/src/servidor/liquidaciones.ts`) lee
    `entitlementVigente(c, slug, FEATURES.liquidacion_por_cliente)` —la feature del módulo al
    que pertenecen las dos puertas; `modo_recorte` apaga las cuatro juntas en `mi_flota`, así
    que para el MODO da igual, pero un override por feature del hito (g) no puede cerrar la
    liquidación devengada apagando «tarifas»— y las dos rutas de lectura
    (`/api/liquidaciones/[id]`, `/api/liquidacion-lineas/[id]/evidencia`) la consultan DESPUÉS
    del rol y ANTES del id, devolviendo el 403 `modulo_apagado` de `config.ts`. Estricto («sin
    entrada en el snapshot» = apagado), el mismo criterio que las otras dos puertas del grupo
    DaaS: `portalClienteEncendido` (AC-FPOR-04) y `modulosNavegables` (AC-FPOR-03), que es la
    mitad «manifest» de este AC y ya estaba cerrada. `e2e/liquidacion-contraccion.spec.ts` sobre
    una base propia (`liquidacion_contraccion`): con el módulo sellado en OFF las dos puertas dan
    403 con `error: "modulo_apagado"` y sin razón social, RUT ni CLP en el cuerpo, y un uuid
    inventado da el MISMO 403 (la puerta cerrada no dice qué ids existen); resellado en ON, las
    dos vuelven a 200 con los MISMOS ids —la contracción es aditiva, nada se borró. Efecto
    lateral del catálogo: la 0009 sumó 4 filas a `features`, así que el fixture de
    `e2e/una-accion-primaria.spec.ts` (AC-FMIG-21) —que siembra su plan con
    `Object.values(FEATURES)`— pinta ahora 7 «Encender» y no 3; su conteo esperado pasó a
    derivarse del `rowCount` real del insert en `plan_features` en vez de un literal. La
    aserción del AC (los N botones son UN tipo de acción, no N) queda intacta.
    `check.sh --full --app=flota` en verde: 712 e2e, incluidos los 2 de este AC.
- [x] (P2) `otd_comprometido_pct` del contrato (§4.5, §3.E1.11, §10): columna `smallint NULL CHECK (BETWEEN 50 AND 100)` — INSERT fuera de rango ⇒ rechazo en BD y 0 filas; con NULL la tarjeta SLA de esa empresa no se muestra y su `signal_rule` no evalúa; con el seed de la farmacia (`otd_comprometido_pct=95`) la tarjeta SLA aparece en el camino dorado del tenant A. **Bloqueado (investigado 16-ago-2026):** la columna no existe hoy — `empresas_cliente` se crea en `db/migraciones-flota/tenant/0036_encargos.sql` y la última migración que la toca (`0039_empresa_implicita.sql`) tampoco la agrega. Agregarla exige `ALTER TABLE empresas_cliente ADD COLUMN otd_comprometido_pct smallint CHECK (otd_comprometido_pct BETWEEN 50 AND 100)` en `db/migraciones-flota/tenant/`, que es DDL de sesión supervisada (AGENTS.md); el motor no la escribe. Construir el resto en TS sin el CHECK real en BD sería el antipatrón que ya dejó una lección en AGENTS.md (la foto del POD que hasheaba texto en vez de imagen): el oráculo exige que sea la BD la que rechace el INSERT fuera de rango, y sin la columna no hay BD que rechace nada. El consumo ya está listo del lado de lectura —`apps/flota/src/dominio/semaforo-fixtures.ts` y `semaforo-daas-sla.ts` ya usan `otd_comprometido_pct` sobre fixtures TS puros (AC-FSEM-08)—, así que en cuanto exista la columna solo leerla del contrato real es trabajo de otro AC del módulo 06. Se implementa en la sesión supervisada que agregue la columna. Queda registrado en `packages/metodo/acs-bloqueados-flota.txt` (sección de DDL supervisado) porque el motor ya lo eligió dos veces el 16-ago-2026 y re-investigó lo mismo; quitar esa línea es decisión de persona, cuando el `ALTER TABLE` exista — oráculo: CI [AC-FTAR-13]
  - Probado: `db/migraciones-flota/tenant/0071_otd_comprometido_por_empresa.sql` agrega la
    columna con su CHECK, aplicada por el runner a las 11 bases del cluster; el pgTAP NUEVO
    `db/flota/pgtap/0036_otd_comprometido_por_empresa.sql` (5/5) ejerce las tres puntas del
    contrato: un valor válido se guarda y se lee igual, NULL entra como «sin compromiso
    pactado» (el caso de la empresa implícita de `mi_flota`, donde la tarjeta SLA no se
    renderiza por el precedente SLA-NULL del §4.5), y los DOS bordes —49 y 101— rebotan con
    23514 desde la BASE, que es lo que el AC pide y no que lo valide la pantalla; un último
    aserto confirma que ninguno de los rechazados dejó la empresa a medio crear. El lado de
    LECTURA ya estaba construido (`semaforo-daas-sla.ts`, AC-FSEM-08) y leía un porcentaje
    que hasta acá no existía en ninguna parte. `db/flota/gate.sh --full` VERDE (31 OK).
- [x] (P2) Fixture del devengo con el seed A (§10, §2, §3.E1.5): con el seed del tenant A (farmacia `por_bloque_horas` $45.000, distribuidora `por_entrega` $3.500, minimarket `por_bulto` $1.200) las liquidaciones reproducen montos esperados HARDCODEADOS en el test, calculados UNA vez a mano (patrón del test de fixture EEVD, §10 DONE-software) con `por_entrega` devengado POR ENCARGO (§3 de esta spec: en la parada consolidada del seed — encargos de las 3 empresas en una misma parada, §3.E1.5 — nace una línea por encargo entregado con POD vigente, cada una a la empresa de SU encargo, N encargos de la misma empresa ⇒ N líneas, jamás una por parada), y las 3 liquidaciones del seed quedan en sus 3 estados finales: 1 `cerrada`, 1 `cerrada` con línea disputada, 1 `pagada`. **Investigado 16-ago-2026 — el AC se cierra con alcance CORREGIDO respecto de su texto original:** la aserción del monto de la farmacia (`por_bloque_horas` $45.000) sigue INCOMPUTABLE mientras no exista atribución turno/bloque→empresa cliente (Pregunta 12, sin cambios); además se encontró que `por_bulto` (minimarket, $1.200) TAMPOCO tiene devengo hoy — `devengar_entrega()` (AC-FTAR-03/04) es la ÚNICA función de devengo y crea EXCLUSIVAMENTE líneas `por_entrega`; el resto del catálogo cerrado de 5 conceptos no tiene función que lo devengue (la matriz exhaustiva sigue abierta en Preguntas 2–3), y escribir `devengar_bulto()` es DDL de sesión supervisada igual que `devengar_entrega()` mismo. Tampoco se afirma «cerrada con folio registrado»: `liquidaciones` no lleva `reference_document_id` (eso es [AC-FTAR-16], bloqueado); sembrar un folio sin FK que lo ate a la liquidación no probaría nada de ESA liquidación. Lo que el AC SÍ cierra, con oráculo CI real: el grano de `por_entrega` en la parada consolidada de 3 empresas (farmacia y minimarket también colocan encargos por-entrega sueltos, además de su concepto bloqueado — Anexo A del maestro) con montos hardcodeados, y los 3 estados finales de liquidación — oráculo: CI [AC-FTAR-14]
  - Probado: `db/flota/pgtap/0035_fixture_devengo_seed_a.sql`, NUEVO en este AC (17/17): 3
    empresas del seed A con sus contratos de catálogo (farmacia `por_bloque_horas` $45.000,
    minimarket `por_bulto` $1.200, sembrados pero sin línea — `is_empty` lo confirma para
    ambos conceptos en toda la suite) más un contrato `por_entrega` propio de cada una
    ($3.500/$4.200/$2.900); 1 parada consolidada con 4 encargos (2 de la distribuidora, 1 de
    la farmacia, 1 del minimarket) devengados vía `devengar_entrega()` real — 4 líneas, 3
    empresas, montos exactos por `array_agg`; `disputar_linea()` real sobre la línea de la
    farmacia; máquina de estados real (`update … set estado`) hasta `cerrada`/`pagada`; cierre
    con `count` sobre las 3 liquidaciones confirmando la distribución exacta 1/1/1 de estados
    que pide el AC. No usa ningún atajo: cero DDL nuevo, todo contra el esquema ya existente
    (0061–0067). `check.sh --full --app=flota` en verde.
- [ ] (P2) Control de pago real del piloto (§10 DONE-adopción — checklist con dueño humano, JAMÁS bloquea al loop §9.2): la primera liquidación semanal REAL del tenant A (e-auto DaaS) se cierra desde el panel, registra el folio del DTE emitido fuera de la app y se marca `pagada` sin que exista ninguna línea manual ni ajuste fuera de evidencia; lo verifica Alexis en el panel — oráculo: producción [AC-FTAR-15]

## Dependencias

Numeración según el set de specs 00–08 de esta misma carpeta (resolver por nombre si el orquestador renumera):

- **00 — Modelo de datos y tenancy** (hito §9.1(4)(a)): BD por tenant + `tenant_info` CHECK + FKs compuestas (§4.1); `constants.ts` con `round_clp()`, catálogo de tarifas, plazos 30/8/7 y formatos (§0); entitlements (3 tablas) y resolución `override ?? plan` para el OFF por modo/feature (§4.4, §5.5); linter de migraciones con clase PLANIFICACIÓN|CAPTURA (§4.2); suite HTTP A-contra-B autogenerada (§9.2). Sin esto no hay dónde colgar tarifas ni cómo apagarlas.
- **01 — Identidad y enrolamiento** (hito b): enum fijo de roles — `cliente` con `empresa_cliente_id NOT NULL`, `chofer`, `responsable_carga` (§4.3); `set_config('app.current_role', …, true)` por transacción (§4.1) del que dependen la RLS de dinero y el confinamiento del cliente; firmas append-only (§4.3).
- **02 — Vehículos, energía y agenda** (hito c): cierre de recarga con SOC/kWh — la evidencia `sesion_recarga` y la fila con `costo_clp` NULL del chofer (§4.8); `parametros.tarifa_kwh_clp` (§4.4); `cierre_turno`/bloques como base de `por_bloque_horas` (§4.5).
- **03 — Encargos, rutas y custodia** (hito d): `empresas_cliente` — el sujeto de la rate card (§4.5); `encargos/paradas/items` con `qty_entregada` (base de `por_bulto` y entrega parcial); `devoluciones` — tabla y captura creadas por el módulo 03 (AC-FRUT-21), base de la evidencia `devolucion` y del concepto `por_devolucion` (§3.E1.9); `destinos` con comuna (modificador de zona); tabla compartida `reference_document` (§4.6 — custodia registra DTE del manifiesto, este módulo el folio de la liquidación).
- **04 — POD offline y sync** (hito e): `entregas_pod`/`evidence` write-once con supersede — la evidencia de la que nacen las líneas (§3.E1.9, §4.6); motor de sync que garantiza 2xx de capturas (§4.2) y `review_queue` (§4.6).
- **05 — Semáforo y visibilidad** (hito e): consume de este módulo los estados legibles para la tarjeta Caja/custodia/liquidación, la señal roja «línea disputada» y la tarjeta SLA por contrato vía `otd_comprometido_pct` (§5.6, Anexo B, §4.5) — dependencia INVERSA: 05 lee, este módulo garantiza legibilidad en la misma BD del tenant.
- **07 — Portal del contratante** (hito f, módulo hermano): consume las vistas de liquidación por empresa y el endpoint de disputa por línea (§3.E1.10) — este módulo provee datos y políticas; el portal, la pantalla.
- **08 — Panel admin white-label, wizard y seeds** (hito g; spec aún no presente en el set): pantalla «Funciones» que opera los toggles del módulo (§5.5) y seeds de los tenants A/B con las rate cards y liquidaciones del §10 que este módulo debe reproducir en su fixture.

## Preguntas al dueño

1. **Periodicidad de la liquidación:** el seed usa liquidaciones semanales (§10) y `eevd_semanal` es semanal, pero el maestro no fija si el período es semanal duro en E1 o un parámetro por tenant/empresa (§4.4 `parametros` termina en «…»). ¿Semanal fijo en E1?
2. **`sesion_recarga` como evidencia de línea (§3.E1.9):** ninguno de los 5 conceptos del catálogo es de energía y está prohibido el recargo por energía indexado (§7.5). ¿Qué concepto devenga una sesión de recarga hacia el cliente, o el tipo queda habilitado en el enum sin regla de devengo en E1?
3. **Devengo de `por_entrega` ante resultado `parcial`:** la EEVD cuenta `exito` y `parcial` en el numerador (§2), pero el maestro no dice si `por_entrega` cobra completo ante una entrega parcial (el ajuste fino iría por `por_bulto` con `qty_entregada`). ¿Se devenga entero, proporcional, o queda a modificador?
4. **Resolución de disputa:** aceptada una disputa a favor del cliente, ¿la corrección es supersede de la línea, ajuste en la liquidación del período siguiente, u otra vía? ¿Una disputa abierta bloquea marcar la liquidación `pagada`? El maestro solo define el registro (motivo tipado, ventana 7 días).
5. **Punto de partida de la ventana de disputa:** se asumió 7 días DESDE EL CIERRE de la liquidación (§0 solo dice «disputa de liquidación 7 días»). ¿Correcto? — pregunta CANÓNICA de este módulo (dueño de la liquidación); de su respuesta depende también la spec **07 — Portal del contratante** (pantalla y endpoint de disputa del rol `cliente`).
6. **«Liquidación observada» (Anexo B, amarillo de Caja/custodia):** ¿qué estado del módulo la constituye, distinto de «línea disputada» (rojo)? §3.E1.9 no define un estado `observada`. — pregunta CANÓNICA de este módulo (dueño de la liquidación); de su respuesta depende también la spec **05 — Semáforo y visibilidad** (umbral amarillo de la tarjeta Caja/custodia).
7. **Tarifas retroactivas:** ¿se permite `vigente_desde` en el pasado (afectaría el devengo de evidencia aún no liquidada) o solo fechas ≥ hoy? El centinela §9.3.5 solo cierra el caso «solapada».
8. **Evidencia sin tarifa vigente:** si llega evidencia de una empresa sin tarifa vigente para su concepto (p. ej. rate card aún en borrador), ¿la línea no nace y el caso cae a «Por revisar», o nace con monto NULL a completar por el operador? El devengo no debe inventar montos.
9. **Forma de los modificadores:** ¿zona y recargo horario son monto fijo CLP o porcentaje sobre `por_entrega`? ¿El recargo horario evalúa sobre `event_time` del hecho o sobre la ventana comprometida? ¿El tope de 5 zonas es por empresa cliente o por tenant (el renglón Tarifas del §0 lista «zonas máx 5» junto al «máx 4 por empresa»)?
10. **Relación folio↔estados (dos sentidos):** (a) ¿marcar `pagada` exige folio registrado? El seed muestra «1 cerrada con folio registrado» y «1 pagada» como ítems distintos (§10), lo que sugiere que NO. (b) A la inversa: ¿registrar folio exige liquidación `cerrada`? La spec opera con «sobre `abierta` ⇒ 422» como supuesto DERIVADO del seed §10 y del pipeline E2 (§3.E2 parte de «liquidación cerrada»), pero ninguna línea del maestro lo fija. ¿Se confirman ambos?
11. **Línea cuya evidencia fue supersedida DESPUÉS del devengo** (undo post-replay §4.7; corrección de POD §4.6): la spec la bloquea + `review_queue` como supuesto operativo (patrón de la excursión, §9.3.7: bloquea, jamás crea ni borra). ¿Es esa la conducta final, o corresponde recálculo/exclusión de la línea (liquidación aún `abierta`) o ajuste en el período siguiente (ya `cerrada`)? El maestro no lo cierra.
12. **Atribución turno/bloque → empresa cliente para `por_bloque_horas` (§0 catálogo, §3.E1.8, §4.5):** el concepto existe en el catálogo cerrado y el seed A lo usa (farmacia, bloque $45.000, §10), pero el esquema §4.5 no da ninguna vía para saber A QUÉ empresa contratante se devenga un turno o un bloque de agenda: `turnos` (EXCLUDE, config_version_id, semaforo_salida, enchufado_confirmado) y `bloques_agenda` (ruta|recarga|mantencion|descanso) no tienen `empresa_cliente_id`. ¿Cómo se atribuye? Opciones que el dueño debe dirimir (ninguna se implementa antes): (a) columna `empresa_cliente_id` en `turnos` o en `bloques_agenda` — DDL del módulo 02, tablas de su propiedad; (b) derivación desde los encargos/paradas de la ruta del turno cuando TODOS pertenecen a una sola empresa (y qué hacer con un turno consolidado multi-empresa, que es justamente el caso del §3.E1.5); (c) contrato de bloque como fila propia por empresa que referencia el turno. Sin respuesta, `por_bloque_horas` no devenga (AC-FTAR-14 cerró su alcance sin este monto, 16-ago-2026 — la aserción queda pendiente de esta pregunta, no el AC entero).
