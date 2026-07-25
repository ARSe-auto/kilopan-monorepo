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
- [x] (P0) Trigger: ningún INSERT/UPDATE de negocio pasa sin sesión de operador viva
      (SECURITY DEFINER, probado por el camino HTTP con `SET ROLE`, no por acceso
      directo) — cableado en `pesajes` y `hornadas` (hito 2); `pan.trg_exige_sesion()`
      es genérico, se reusa tal cual en cada tabla de negocio nueva [AC-ID-02]
- [x] (P0) PIN de 4 dígitos hasheado, nunca en texto plano en logs ni en
      `eventos.payload` — **sustitución deliberada**: `node:crypto` scrypt en vez de
      bcrypt (memory-hard, sin dependencia nueva que auditar; ver
      `apps/kilopan/src/identidad/hash.ts`). `POST /api/auth/login` probado en vivo
      contra el dev server: PIN correcto entra, incorrecto rebota, 5º intento fallido
      bloquea con 423 y el PIN correcto YA NO sirve hasta que expire [AC-ID-03]
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
- [x] (P0-SEC) Rate limit genérico en toda ruta de autenticación (no solo PIN):
      ventana deslizante en memoria por IP (20/min) en `identidad/limitador.ts` — nota
      honesta: en memoria de un solo proceso; multi-nodo necesitaría Redis, no aplica
      todavía [AC-SEC-02]

## Hito 2 — Catálogo y pesaje

- [x] (P1) `productos`, `precios` (2 listas, vigencia histórica), `hornadas`, `pesajes`
      con los CHECK de destino/motivo del prompt maestro §4 — probado en
      `db/test-invariantes.mjs` [AC-PES-01]
- [x] (P1) F1 Pesar ≤4 toques: cifra 96/700, teclado numérico propio, destino en un
      toque — probado en vivo end-to-end (clic real → API → BD → mensaje verde
      «Pesado: 2,500 kg · Frica»); Reparto visible pero deshabilitado hasta el hito de
      despacho; hornada_id NULL (fase 1, sin UI de hornadas todavía); orden de
      productos alfabético, no por frecuencia (falta trackear frecuencia real)
      [AC-PES-02]
- [x] (P1-SEC) Test centinela «báscula mal tipeada»: `pan.es_outlier_pesaje()` detecta
      >3× la mediana del producto (fase 1: sin cliente todavía — se agrega la dimensión
      cliente en el hito de despacho, cuando `pedido_linea_id` tenga FK real); falta la
      UI que exige re-confirmación explícita cuando la función devuelve true [AC-PES-03]
- [ ] (P2) **Foto de respaldo opcional** (decisión #1, nivel 1): columnas
      `pesajes.foto_sha256`/`foto_estado` ya existen (write-once, mismo contrato que
      POD) — el AC sigue abierto porque falta lo que lo hace usable: la tabla
      `parametros` + el toggle de admin (`pesaje_foto_obligatoria`) y el obturador en
      la UI de F1. No marcar [x] por solo tener las columnas [AC-PES-04]
- [ ] (P2) **Báscula conectada opcional** (decisión #1, nivel 2): columna
      `pesajes.origen_captura CHECK IN ('manual','bascula_bt','bascula_serial')` ya
      existe — falta toda la integración Web Bluetooth real (Chrome/Android only,
      degrada a manual en Safari/iOS) [AC-PES-05]
- [ ] (P2) **Cola con reintento automático** (decisión #4) para pesaje/mostrador:
      reusa el outbox de `packages/nucleo-pod` (genérico, no solo reparto); indicador
      «Sin conexión — N por subir» / «Sincronizado hace Xs» [AC-RED-01]

## Hito 3 — Venta mostrador

- [x] (P1) `ventas`, `venta_lineas`, `cierres_caja` (esperado vs declarado) — tablas +
      invariantes probadas (fiado exige cliente, línea es gramos XOR unidades). La
      pantalla de cierre de caja todavía no existe, solo su tabla [AC-VEN-01]
- [x] (P1) F6 Venta contra stock pesado — probado en vivo: pesados 5,000 kg → vendidos
      0,500 kg a $1.095 → quedan 4,500 kg, con `pan.stock_disponible()` derivando todo
      de eventos (pesajes − venta_lineas), nunca de un contador guardado. Productos sin
      stock quedan deshabilitados en pantalla [AC-VEN-02]
- [x] (P2) **Catálogo de medios de pago editable por admin** (decisión #5): tabla
      `pan.medios_pago` precargada con los 8 medios; `pan_app` puede prender/apagar
      (`activo`) pero NO borrar ni renombrar — probado. Falta la pantalla de admin para
      togglearlos y la fila-por-medio en el cierre de caja [AC-PAG-01]
- [ ] (P2) Fiado en mostrador reutiliza el mismo saldo por cliente del hito 6 — sin
      construir un segundo sistema de crédito. Hoy la API lo rechaza con mensaje
      explícito hasta que exista `pan.clientes` [AC-PAG-02]

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
- [ ] (P2) **Estado de mermas recuperables** (decisión #6): la máquina de estados ya
      existe en `pesajes.estado_merma` (hito 2, probada — incl. que `pan_app` solo puede
      tocar `estado_merma`/`venta_recuperada_id` por grant de columna, nunca `gramos`).
      Sigue abierto: la UI de resolución al día siguiente, y que la vista de TCK (este
      hito) sume `recuperada_con_venta` a `g_venta` en vez de a `g_merma_tipificada`
      [AC-MERM-01]
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
- [x] (P0-SEC) Cookies de sesión `HttpOnly` + `Secure` (en producción) + `SameSite=Lax`;
      ningún secreto ni token en `localStorage` — verificado en vivo: `document.cookie`
      no puede leer `kp_sesion` desde JS, pero el navegador la manda sola y
      `/api/auth/logout` la valida [AC-SEC-05]
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

## Motor autónomo (`packages/metodo/scripts/loop.sh` + `watchdog.sh`)

`loop.sh` toma el primer AC abierto (P0 antes que P1 antes que P2), le pide a `claude
-p` (con `--max-budget-usd`, `--permission-mode acceptEdits`, `--output-format json`)
implementarlo y correr `check.sh --full`, y verifica el resultado por `git rev-list
--count HEAD` antes/después — nunca confía en lo que el propio `claude` reporta sin
chequear el commit real. `watchdog.sh` lo repite con: (a) verificación de `command -v
claude`/`pnpm` en su PROPIO PATH antes de arrancar, (b) tope de iteraciones totales
(`KILOPAN_MAX_ITERACIONES`, default 20) y (c) corte tras N iteraciones seguidas sin
commit nuevo (`KILOPAN_MAX_SIN_AVANCE`, default 3) — nunca "corre indefinido hasta que
alguien se dé cuenta". Escritos y probada su sintaxis; **todavía no se lanzaron en modo
desatendido** — eso queda a decisión explícita de cada sesión (ver docs/LECCION_RALPH.md).

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
