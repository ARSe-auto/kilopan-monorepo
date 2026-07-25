# IMPLEMENTATION_PLAN — KiloPan

Plan vivo del motor plan → build → verify. Fuente canónica de alcance:
`../KiloPan-propuesta/PROMPT_MAESTRO.md` (7 módulos, invariantes de BD, guardrails) +
las 9 decisiones de la lectura `docs/DECISIONES_AMPLIACION.md` (fiado, báscula conectada,
foto de respaldo, lectura de facturador, cola de reintentos, medios de pago, mermas,
multisucursal ligera, compartir nativo). Este documento no repite esos detalles — los
traduce en ACs ejecutables y gateados. Si algo no está aquí ni en `specs/`, no existe.

**Variable norte: TCK ≥ 95% sostenida 4 semanas** (ver SQL de referencia en el prompt
maestro §2). **Por qué existe este MVP** (para que ningún AC pierda de vista el objetivo
de negocio): cada kilo conciliado esa noche es lo que fideliza a la panadería y al gremio
(Fechipan/Indupan) — y la fidelización + los datos reales de reparto son exactamente lo
que arma, sin forzarlo, el caso de la van eléctrica para E-Auto (tarjeta «Tu flota»,
§3 módulo 7). Ningún AC de este plan existe para vender vans directamente; todos existen
para que el panadero confíe en la balanza-que-se-volvió-sistema todos los días.

Formato de ítem: `- [ ] (P0|P1|P2) descripción [AC-XXX-NN]`. Un AC por commit, con su
test naciendo en el mismo commit. `P0` = cimiento sin el cual nada más es seguro o
verificable; `P1` = flujo dorado (el MVP tal como está vendido); `P2` = las 9
ampliaciones + endurecimiento. El builder marca `[x]` solo cuando el gate pasa en verde
para ese AC — no antes.

---

## Hito 0 — Esqueleto del monorepo (sin dominio)

- [x] (P0) pnpm workspace + estructura `apps/*` `packages/*` [AC-H0-01]
- [x] (P0) `packages/miga`: tokens de diseño (color, tipografía, grilla, radios) como
      árbol de constantes TS + hoja CSS de variables; incluye acento `#C2410C` (KiloPan)
      y `#1D4ED8` (KiloRuta, reservado para `apps/flota`) [AC-H0-02]
- [x] (P0) Test que falla si una cifra de dinero o peso no usa `tabular-nums` /
      `font-variant-numeric` en los componentes de `packages/miga` — cifra de mostrador
      en `src/app/page.tsx` ya lo aplica; el grep de gate se endurece cuando existan más
      componentes [AC-H0-03]
- [x] (P0) `packages/metodo/scripts/guardrail.sh` ejecutable: aborta si `DATABASE_URL`
      no es localhost/127.0.0.1, aborta si hay secretos fuera de `.env.local`, grep
      bloqueante `TODO|FIXME|PLACEHOLDER|not implemented|lorem ipsum` en `src/` [AC-H0-04]
- [x] (P0) `packages/metodo/scripts/check.sh` ejecutable con `--full`: build + lint +
      types + unit (+ e2e y axe cuando exista UI) [AC-H0-05]
- [x] (P0) `packages/metodo/panel/generar.mjs`: genera `panel/index.html` desde estado
      real del repo (ver §Panel abajo) [AC-H0-06]
- [x] (P0) Shells vacíos de `packages/nucleo-{identidad,pod,dte,comun}` con
      `package.json` y un `README.md` que dice explícitamente: *«se puebla en el hito de
      extracción, después del DONE de KiloPan — no escribir lógica de negocio aquí
      todavía»* [AC-H0-07]

## Hito 1 — Identidad y dispositivos (P0: todo lo demás depende de esto)

- [x] (P0) Migración `db/migraciones/0001_identidad.sql`: `pan.usuarios`,
      `pan.dispositivos`, `pan.sesiones_operador` con `EXCLUDE USING gist` (requiere
      `btree_gist`), `pan.valida_rut()` (módulo 11), `pan.round_clp()` — probado contra
      pglite en `db/test-invariantes.mjs` [AC-ID-01]
- [ ] (P0) Trigger: ningún INSERT/UPDATE de negocio pasa sin sesión de operador viva
      (SECURITY DEFINER, probado por el camino HTTP con `SET ROLE`, no por acceso
      directo) — `pan.exige_sesion_viva()` ya existe; falta CABLEARLA en las tablas de
      negocio del hito 2+ y testearla (todavía no hay tabla de negocio a la que
      aplicarla) [AC-ID-02]
- [ ] (P0) PIN de 4 dígitos con `bcrypt` (cost ≥ 12), nunca en texto plano en logs ni en
      `eventos.payload` — columna `pin_hash` ya existe; falta la ruta de alta/login que
      realmente hashea (hito de UI de identidad) [AC-ID-03]
- [x] (P0-SEC) **Bloqueo por PIN errado**: 5 intentos fallidos en 10 min ⇒ dispositivo
      bloqueado 15 min + evento `pin_bloqueado` auditable — un PIN de 4 dígitos son solo
      10.000 combinaciones, así que esto no es opcional aunque no esté en el prompt
      maestro original. `pan.registrar_intento_pin()`, probado incl. aislamiento entre
      usuarios/dispositivos distintos [AC-SEC-01]
- [x] (P0) 1 sesión activa concurrente por usuario; sesión nueva desplaza la anterior +
      fila de auditoría `sesion_desplazada` — trigger `trg_desplazar_sesiones`, probado
      [AC-ID-04]
- [ ] (P0) Auto-bloqueo a PIN tras 10 min de inactividad [AC-ID-05]
- [ ] (P1) F5 Cambio de operador ≤3 s, chip con nombre siempre visible [AC-ID-06]
- [ ] (P0-SEC) Rate limit genérico en toda ruta de autenticación (no solo PIN):
      middleware con ventana deslizante por IP + por dispositivo [AC-SEC-02]

## Hito 2 — Catálogo y pesaje

- [ ] (P1) `productos`, `precios` (2 listas, vigencia histórica), `hornadas`, `pesajes`
      con los CHECK de destino/motivo del prompt maestro §4 [AC-PES-01]
- [ ] (P1) F1 Pesar ≤4 toques: cifra 96/700, teclado numérico propio, destino en un
      toque [AC-PES-02]
- [ ] (P1-SEC) Test centinela «báscula mal tipeada»: outlier >3× mediana del
      cliente/producto exige re-confirmación explícita; cancelar no persiste nada
      [AC-PES-03]
- [ ] (P2) **Foto de respaldo opcional** (decisión #1, nivel 1): `parametros.pesaje_foto_obligatoria`
      editable solo por `admin`; encendido agrega obturador antes de confirmar,
      `pesajes.foto_sha256` write-once igual que POD [AC-PES-04]
- [ ] (P2) **Báscula conectada opcional** (decisión #1, nivel 2): `pesajes.origen_captura
      CHECK IN ('manual','bascula_bt','bascula_serial')`; Web Bluetooth solo en
      Chrome/Android — degradar a manual sin romper el flujo en Safari/iOS [AC-PES-05]
- [ ] (P2) **Cola con reintento automático** (decisión #4) para pesaje/mostrador:
      reusa el outbox de `packages/nucleo-pod` (genérico, no solo reparto); indicador
      «Sin conexión — N por subir» / «Sincronizado hace Xs» [AC-RED-01]

## Hito 3 — Venta mostrador

- [ ] (P1) `ventas`, `venta_lineas`, `cierres_caja` (esperado vs declarado) [AC-VEN-01]
- [ ] (P1) F6 Venta ≤3 toques contra stock pesado [AC-VEN-02]
- [ ] (P2) **Catálogo de medios de pago editable por admin** (decisión #5): tabla
      `pan.medios_pago` precargada (efectivo, débito, crédito, transferencia,
      Mercado Pago, Mach, fiado, otro); cierre de caja pasa de un par a una fila por
      medio activo [AC-PAG-01]
- [ ] (P2) Fiado en mostrador reutiliza el mismo saldo por cliente del hito 6 — sin
      construir un segundo sistema de crédito [AC-PAG-02]

## Hito 4 — Despacho y reparto

- [ ] (P1) `clientes`, `pedidos` (máquina de estados + `correlativo_pedido` solo vía
      `pan.asignar_correlativo()`), `pedido_lineas`, `rutas`, `ruta_paradas` [AC-DES-01]
- [ ] (P1) **Bloqueo real**: «Salir a ruta» rebota si algún pedido de la carga no tiene
      DTE asociado (art. 55 DL 825) — guardrail en BD + UI, sin override [AC-DES-02]
- [ ] (P1) F2 Armar pedido, F3 Cargar van (escáner + checklist equivalente) [AC-DES-03]

## Hito 5 — Registro DTE

- [ ] (P1) `documento_tributario` (tipos 33/39/52/61), TED scan (zxing-js, mejora
      progresiva) + manual tipo+folio+RUT como camino primario iOS; jamás emite
      [AC-DTE-01]
- [ ] (P0-SEC) Test que falla si en algún punto del código se genera un folio, PDF o
      número con apariencia de DTE — grep + revisión adversarial dedicada (art. 97 N°4
      CT) [AC-DTE-02]

## Hito 6 — Entrega con POD (offline-first) + fiado / consolidación

- [ ] (P1) `entregas` (POD inmutable, `supersede_id`, foto write-once, GPS con rango
      Chile, flags `gps_degradado`/`gps_fuera_de_zona`) [AC-POD-01]
- [ ] (P1) Outbox IndexedDB (Dexie) con `client_uuid`, `POST /api/sync` idempotente
      (`ON CONFLICT DO NOTHING`), reintento infinito [AC-POD-02]
- [ ] (P1) F4 Entregar ≤4 toques; permiso GPS denegado bloquea y lo dice, precisión
      mala jamás bloquea [AC-POD-03]
- [ ] (P2) **Consolidación de guías en una factura + saldo por cliente** (decisión #2):
      `documento_tributario.consolidado_en_id` (self-FK, índice único — ninguna guía se
      factura dos veces), vista `pan.saldo_cliente` derivada de eventos (nunca tabla
      editable a mano), `documento_tributario.estado_pago` con «marcar pagada» (mismo
      gesto que la liquidación de KiloRuta) [AC-FIA-01]
- [ ] (P2) UI «Consolidar y facturar»: admin selecciona cliente → guías entregadas sin
      facturar → suma corriendo 96px → registra factura (mismo camino TED/manual ya
      existente) [AC-FIA-02]

## Hito 7 — Dashboard del dueño + flota + endurecimiento de datos

- [ ] (P1) Conciliación del día (TCK, gramos/CLP por destino, merma), mapa estático
      Leaflet+OSM, auditoría por usuario/dispositivo [AC-DASH-01]
- [ ] (P1) Tarjeta «Tu flota»: km reales, $/km, combustión vs EV, CTA
      «Quiero que e-auto me contacte» solo con ≥20 rutas cerradas, jamás en el teléfono
      del repartidor [AC-DASH-02]
- [ ] (P2) **CTA hermano de KiloRuta** en la misma tarjeta «Tu flota»: «Prefiero que
      alguien más reparta por mí» → tabla `lead_kiloruta` (mismo patrón que
      `lead_eauto`); no depende del contrato técnico del Anexo B para existir — es la
      forma más barata de validar demanda antes de construir la integración [AC-DASH-03]
- [ ] (P2) **Lectura de totales del facturador, por capas** (decisión #3): fase 1 (este
      hito) — un campo `cierres_caja.total_facturador_clp` tecleado al cerrar caja,
      comparado contra `declarado_clp` con el mismo componente visual esperado/declarado
      [AC-DASH-04]
- [ ] (P2) **Estado de mermas recuperables** (decisión #6): `mermas.estado CHECK IN
      ('pendiente','confirmada_perdida','recuperada_con_venta')`, resolución al día
      siguiente; recuperada mueve gramos de `g_merma_tipificada` a `g_venta` en la vista
      de TCK sin tocar la fórmula [AC-MERM-01]
- [ ] (P2) **Multisucursal ligero, condicional** (decisión #7): tabla `sucursales` +
      `sucursal_id` en equipos/hornadas/cierres/rutas; selector en dashboard oculto si
      hay una sola sucursal — **no iniciar sin confirmar con al menos un piloto real que
      lo necesita** [AC-SUC-01]
- [ ] (P2) **Botón compartir nativo** (decisión #9): `navigator.share()` en detalle de
      entrega y en cierre del panel; fallback a texto si el teléfono no soporta
      compartir archivos; cero número de teléfono guardado, cero envío automático
      [AC-SHARE-01]

## Endurecimiento transversal (P0/P1, no es un hito — corre en paralelo a todos)

- [x] (P0-SEC) **Rol de aplicación de mínimo privilegio (`pan_app`)**: la app nunca se
      conecta como dueño/superusuario del esquema — es la única forma real de que un
      `REVOKE ... FROM PUBLIC` signifique algo. Todo test de invariante hace `SET ROLE
      pan_app` antes de intentar violar algo, nunca prueba por el camino del dueño
      [AC-SEC-08]
- [x] (P0-SEC) `pnpm audit` (o equivalente) sin vulnerabilidades altas/críticas en el
      gate; falla el build si aparecen — encontró 4 altas + 1 moderada reales (sharp/
      postcss/brace-expansion transitivos) el primer día; corregidas con overrides en
      `pnpm-workspace.yaml` [AC-SEC-03]
- [x] (P0-SEC) Cabeceras de seguridad base (`X-Content-Type-Options`, `Referrer-Policy`,
      `X-Frame-Options`) en `next.config.ts` — CSP completa y HSTS quedan para cuando
      existan orígenes reales que permitir (fotos, mapa estático); no declarar una CSP
      amplia "por si acaso" [AC-SEC-04]
- [ ] (P0-SEC) Cookies de sesión `HttpOnly` + `Secure` + `SameSite=Lax`; ningún secreto
      ni token en `localStorage` [AC-SEC-05]
- [x] (P0-SEC) Toda query a Postgres parametrizada (cero interpolación de string en
      SQL) — grep en `guardrail.sh` + disciplina en `db/migrar.mjs` y
      `db/test-invariantes.mjs` desde el primer commit [AC-SEC-06]
- [ ] (P0-SEC) Bucket de fotos (pesaje + POD) sin permiso `DELETE` para el rol de la
      app; URLs firmadas con expiración corta [AC-SEC-07]
- [ ] (P1-PERF) Índices en las columnas de los filtros calientes: `pesajes(pesado_at)`,
      `entregas(pedido_id)`, `pedidos(fecha_entrega, estado)` — verificados con
      `EXPLAIN ANALYZE` en el seed de escala [AC-PERF-01]
- [ ] (P1-PERF) Compresión de fotos (pesaje y POD) en el cliente antes de subir —
      objetivo ≤400 KB por foto sin perder legibilidad para auditoría [AC-PERF-02]
- [ ] (P1-PERF) Paginación o scroll virtualizado en todo listado que pueda superar
      ~200 filas (entregas del día, historial de auditoría) [AC-PERF-03]
- [ ] (P1-PERF) Presupuesto de performance en el gate: Lighthouse móvil ≥90 en F1/F4/F6
      con throttling 4G — estas son las pantallas de la madrugada, no pueden colgarse
      [AC-PERF-04]

## DONE

Plan vacío (todo `[x]`) + `check.sh --full` verde + camino dorado demostrado de punta a
punta con el seed (§10 del prompt maestro) + revisión adversarial final sin hallazgos
críticos + TCK del día seed calculable + panel mostrando 0 ACs abiertos P0/P1.

---

## Panel (qué debe poder leer `packages/metodo/panel/generar.mjs`)

Nunca «proceso vivo» como señal de avance — ver `docs/LECCION_RALPH.md`. El panel se
calcula SIEMPRE desde estado verificable en disco/git, igual que la TCK se calcula
siempre desde eventos:

1. `git rev-list --count HEAD` (commits totales) y timestamp del último commit.
2. Conteo de ACs por estado: `grep -cE '^- \[ \] \(P[0-9]'` (abiertos) vs
   `grep -cE '^- \[x\] \(P[0-9]'` (cerrados), por hito y por prioridad.
3. Resultado del último `check.sh --full` (verde/rojo + timestamp del log).
4. Últimos 10 mensajes de commit (para ver si los ACs recientes tienen sentido, no solo
   si existen).
5. Heurístico de cuelgue: si no hay commit nuevo en >30 min **y** hay un proceso builder
   corriendo, marcarlo ámbar — pero el número de commits manda sobre el estado del
   proceso, nunca al revés.
