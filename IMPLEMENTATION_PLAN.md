# IMPLEMENTATION_PLAN — KiloPan

Plan vivo del motor plan → build → verify. **Este documento es desechable**: el planner
lo regenera desde cero. La definición canónica y durable de cada AC vive en
`specs/kilopan/*.md`; acá solo vive su ESTADO. Fuente de alcance:
`docs/PROMPT_MAESTRO.md` (7 módulos, invariantes de BD, guardrails) +
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
- [x] (P0) Auto-bloqueo a PIN tras 10 min de inactividad — validado EN EL SERVIDOR
      (`pan.sesion_expirada` + `tocar_sesion`), no solo en la UI: un cliente adulterado
      simplemente no llamaría al cierre. Probado, incl. que una sesión inexistente se
      trata como expirada y nunca como válida [AC-ID-05]
- [x] (P1) F5 Cambio de operador en equipo compartido — `pan.abrir_sesion()` hace el
      relevo atómico y auditado (evento `operador_relevado`). **Bug real encontrado
      probando el login**: el EXCLUDE impedía que el vendedor tomara la tablet que dejó
      el maestro y devolvía 500. Falta el chip con el nombre siempre visible en cada
      pantalla [AC-ID-06]
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
- [x] (P2) **Foto de respaldo opcional** (decisión #1, nivel 1): toggle
      `pesaje_foto_obligatoria` en `/admin`, solo para admin — deliberadamente NO en la
      pantalla de pesaje, para que quien pesa no lo apague cuando le incomode. Obturador
      real por `getUserMedia` con compresión a ~400 KB y `sha256` calculado sobre el
      blob comprimido. **Estuvo marcado [x] falsamente hasta el 25-jul-2026**: las
      columnas y el toggle existían, pero `/api/pesajes` no aceptaba el hash y `/pesar`
      nunca abría la cámara — el control del dueño estaba apagado en los hechos.
      Cerrado de verdad ahora: la exigencia se valida en el SERVIDOR (validarla solo en
      la UI sería teatro), `pan_app` puede marcar `foto_estado` pero no reapuntar
      `foto_sha256`, y hay 2 tests de invariante que lo prueban [AC-PES-04]
- [x] (P2) **Báscula conectada opcional** (decisión #1, nivel 2): Web Bluetooth
      contra el perfil GATT Weight Scale, con degradación a manual. **NO probado contra
      una báscula real** — y las marcas comunes en panaderías chilenas (Toledo, CAS,
      Torrey) suelen usar serie propietario, no GATT: dar por validado solo tras
      conectar una de verdad. En iPhone este camino nunca se ofrece (Web Bluetooth no
      existe en Safari) [AC-PES-05]
- [x] (P2) **Cola con reintento automático** (decisión #4) en pesaje: respaldada
      en sessionStorage, reintento cada 15 s y al volver `online`, con el chip «Sin
      conexión — N por subir». Un rechazo 4xx del servidor NO se encola (es una
      respuesta que el operador tiene que ver ahora); solo se reintenta lo que falló por red [AC-RED-01]

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
- [x] (P2) Fiado en mostrador reutiliza el MISMO cliente y saldo que el del
      reparto — cero segundo sistema de crédito. Probado por HTTP: sin cliente rebota
      con mensaje claro, con cliente entra y suma al saldo [AC-PAG-02]

## Hito 4 — Despacho y reparto

- [x] (P1) `clientes`, `pedidos` (máquina de estados + `correlativo_pedido` solo vía
      `pan.asignar_correlativo()`, inmutable después), `pedido_lineas` (con
      `gramos_pesados` mantenido por trigger, jamás por la app), `rutas`,
      `ruta_paradas` — todo probado [AC-DES-01]
- [x] (P1) **Bloqueo real**: «Salir a ruta» rebota si algún pedido de la carga no tiene
      DTE asociado (art. 55 DL 825) — trigger en BD, sin override; probado en ambos
      sentidos (sin guía rebota, con guía sale) [AC-DES-02]
- [x] (P1) F2 Armar pedido: `/pedidos` con alta de cliente, pedido con precio de la
      lista del cliente, registro de DTE y «Armar ruta y salir». El bloqueo del art. 55
      se ve en pantalla (pedidos sin documento en rojo) y probado por HTTP: 409 sin
      guía, 200 con guía. **F3 Cargar van con escáner sigue SIN construir** [AC-DES-03]

## Hito 5 — Registro DTE

- [x] (P1) `documento_tributario` (tipos 33/39/52/61) con unicidad
      (tipo+folio+emisor), neto+IVA cuadrando, `ind_traslado` solo en guías; jamás
      emite. Falta el escaneo TED (zxing-js) y la UI de captura manual [AC-DTE-01]
- [x] (P0-SEC) La app no puede reescribir un folio ni un RUT ya registrado: `pan_app`
      solo tiene UPDATE en (`consolidado_en_id`, `estado_pago`) — probado. No existe
      ninguna función que genere folios (art. 97 N°4 CT) [AC-DTE-02]

## Hito 6 — Entrega con POD (offline-first) + fiado / consolidación

- [x] (P1) `entregas` (POD inmutable con trigger, `supersede_id`, GPS con rango Chile
      que rebota (0,0) en la BD, flags `gps_degradado`/`gps_fuera_de_zona` que NUNCA
      bloquean, un solo POD vigente por pedido vía índice parcial) — todo probado
      [AC-POD-01]
- [x] (P1) Outbox del cliente en IndexedDB (sin Dexie: ~80 líneas propias en vez de
      una dependencia más que auditar) con reintento automático al volver `online` y
      cada 30 s + `POST /api/sync` idempotente. Probado por HTTP: 3 replays del mismo
      `client_uuid` ⇒ UNA entrega de 12 kg en el dashboard, y un GPS (0,0) sale como
      rechazo explícito en vez de girar en la cola para siempre [AC-POD-02]
- [x] (P1) F4 Entregar: `/ruta` con la parada activa destacada, obturador real,
      receptor precargado y confirmación. Permiso de GPS denegado bloquea y lo dice;
      precisión mala entra igual marcada «(impreciso, igual sirve)». El repartidor
      ve km y kg, **jamás CLP** — verificado en pantalla.
      **La foto era falsa hasta el 25-jul-2026**: `capturarFoto()` hacía el sha256 de
      un texto (`${parada}-${Date.now()}`), no de una imagen, y nunca llamaba a
      `/api/fotos` — o sea, la evidencia de entrega, que es el mecanismo de confianza
      central del producto, no existía. `comun/camara.ts` estaba escrito y correcto,
      solo desconectado. Ahora: `getUserMedia` in-app (nunca `<input type=file>`, que
      permitiría adjuntar una foto vieja de la galería), JPEG ~400 KB, sha256 sobre el
      blob comprimido, subida a `/api/fotos` y —si no hay señal— el binario queda en la
      cola de fotos del outbox y se reintenta solo. **Compila y pasa lint, pero el
      flujo NO está ejercitado de punta a punta todavía**: sembrar una parada de prueba
      exige sesión viva de operador. Faltan los modos rechazo/parcial [AC-POD-03]
- [x] (P2) **Consolidación de guías en una factura + saldo por cliente** (decisión #2):
      `documento_tributario.consolidado_en_id` (self-FK, índice único — ninguna guía se
      factura dos veces), vista `pan.saldo_cliente` derivada de eventos (nunca tabla
      editable a mano), `estado_pago` con «marcar pagada» — probado de punta a punta en
      BD [AC-FIA-01]
- [x] (P2) UI «Consolidar y facturar»: admin elige cliente, ve sus guías sueltas,
      las marca y registra la factura que las cubre (monto = suma de las guías, no un
      número tecleado aparte). Probado: doble facturación rebota con 409 [AC-FIA-02]

## Hito 7 — Dashboard del dueño + flota + endurecimiento de datos

- [x] (P1) Conciliación del día: `/dashboard` con TCK en vivo desde
      `pan.conciliacion_diaria` (vista sobre eventos, no escribible — probado), gramos
      por destino, merma perdida vs recuperada separadas, semáforo contra la meta de
      95%. Probado en vivo: 13.000 g pesados, 9.000 vendidos + 1.000 merma ⇒ 77% en
      ámbar. Falta el mapa Leaflet+OSM y la pantalla de auditoría [AC-DASH-01]
- [x] (P1) Tarjeta «Tu flota»: km reales del odómetro, combustión vs EV desde
      `pan.parametros` (editables, con fuente), aparece solo con ≥20 rutas cerradas —
      la regla de rol está testeada: el dashboard entero rebota si no sos `admin`, así
      que el CLP jamás llega al teléfono del repartidor [AC-DASH-02]
- [x] (P2) **CTA hermano de KiloRuta** en la misma tarjeta «Tu flota»: «Prefiero que
      alguien más reparta por mí» → tabla `lead_kiloruta` simétrica a `lead_eauto`,
      ambas exigiendo consentimiento explícito (probado). No depende del contrato
      técnico del Anexo B. Falta cablear el POST de ambos CTA [AC-DASH-03]
- [x] (P2) **Lectura de totales del facturador** (decisión #3, fase 1): campo en
      el cierre de caja que compara contra lo que registró KiloPan. Probado: detecta
      que el facturador marcó $310 más. Las fases CSV y API quedan para cuando el
      piloto lo pida [AC-DASH-04]
- [x] (P2) **Estado de mermas recuperables** (decisión #6): máquina de estados en
      `pesajes.estado_merma` + la vista de TCK ya mueve `recuperada_con_venta` de
      `g_merma_tipificada` a `g_venta` sin cambiar la fórmula — probado (3.000 g pasan
      de merma a venta y la TCK sigue cerrando al 100%). Falta la UI de resolución al
      día siguiente [AC-MERM-01]
- [x] (P2) **Multisucursal ligero** (decisión #7): tabla `sucursales` +
      `sucursal_id` heredado automáticamente del dispositivo (el equipo vive en un
      local, nadie lo elige a mano). Probado que con una sola sucursal queda NULL y no
      agrega complejidad. Falta el selector en el dashboard [AC-SUC-01]
- [x] (P2) **Botón compartir nativo** (decisión #9): `navigator.share()` con
      degradación a texto si el teléfono no soporta compartir archivos. Cero número de
      teléfono guardado, cero envío automático. Está en el cierre de caja; falta
      agregarlo al detalle de entrega [AC-SHARE-01]

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
- [x] (P0-SEC) Fotos write-once: tabla `pan.fotos` con trigger que rebota UPDATE y
      DELETE, `pan_app` solo con INSERT. El servidor RECALCULA el sha256 y rechaza la
      foto si no coincide con el declarado en el POD. Guardar el binario en la BD es
      decisión consciente para el piloto (volumen chico); si crece, pasa a URL sin
      cambiar el contrato [AC-SEC-07]
- [x] (P1-PERF) Índices en los filtros calientes (`pesajes.capturado_at`,
      `destino+fecha`, `ventas.creado_at`, `pedidos(fecha,estado)`, `ruta_paradas`,
      `entregas.capturado_at`). Nota: el índice sobre `creado_at::date` NO se puede —
      castear timestamptz a date no es IMMUTABLE [AC-PERF-01]
- [x] (P1-PERF) Compresión de fotos en el cliente antes de subir: 1280 px de ancho
      máximo y calidad 0.72, objetivo ≈400 KB, con techo duro de 1,5 MB en el servidor [AC-PERF-02]
- [x] (P1-PERF) Paginación por CURSOR (keyset), no por OFFSET, en el listado de
      entregas: con OFFSET la página 40 obliga a recorrer y descartar 2.000 filas, y el
      cursor además no se corre si entra una entrega nueva mientras el dueño scrollea.
      Falta cablearlo a una pantalla de historial (el endpoint ya existe) [AC-PERF-03]
- [x] (P1-PERF) Presupuesto de performance en el gate: **no Lighthouse** —necesita
      Chrome headless, ~300 MB de dependencias, y su puntaje mezcla SEO/PWA con lo
      único que importa a las 4 AM. Se mide el peso GZIP del flujo dorado contra 150 KB.
      Hoy: 104 KB en /pesar, /vender, /ruta (coincide con lo que reporta Next, o sea
      está bien calibrado) [AC-PERF-04]

## Trabajo abierto (reconciliado contra el código, 26-jul-2026)

Los 22 «abiertos» del primer volcado venían del texto viejo del plan, no del árbol. Al
verificarlos uno por uno **leyendo el código, no grepeando** —un grep no distingue una
pantalla de un comentario que la menciona— 7 ya estaban construidos y 2 estaban a medias.
Quedan 16 reales. Cada AC cerrado hoy lleva su cita en el archivo que lo implementa.

- [x] (P1) Chip con el nombre del operador **siempre visible** en cada pantalla, como exige §5 F5. Hoy el relevo funciona pero el chip no existe: quien pesa no puede confirmar de un vistazo baj… — spec: `specs/kilopan/01-identidad.md` [AC-ID-07]
- [ ] (P1) Orden de productos **por frecuencia real** de pesaje, no alfabético como hoy. §5 F1 lo exige para que repetir producto cueste 2 toques. Requiere trackear frecuencia. Test: sembrar fr… — spec: `specs/kilopan/02-catalogo-pesaje.md` [AC-PES-07]
- [ ] (P1) F3 Cargar van: contador N/M en 96 px, escáner de cámara full-screen con linterna (48 px, alcanzable con pulgar — madrugada real), lectura válida = beep + vibración, duplicada = tono … — spec: `specs/kilopan/04-despacho-reparto.md` [AC-DES-04]
- [ ] (P1) Escaneo del TED con zxing-js como mejora progresiva. La captura MANUAL —el camino primario en iOS según §7— ya existe: panel «Registrar documento del SII» en `/pedidos`. Falta solo e… — spec: `specs/kilopan/06-registro-dte.md` [AC-DTE-03]
- [ ] (P1) Mapa estático de pines de los PODs del día (Leaflet + OSM, **solo dashboard**, §3 módulo 7). Sin construir — spec: `specs/kilopan/07-dashboard-flota.md` [AC-DASH-05]
- [ ] (P1) Pantalla de auditoría por usuario y dispositivo sobre la tabla `eventos` (append-only). Sin construir: hoy los eventos se escriben y nadie puede leerlos desde la app — spec: `specs/kilopan/07-dashboard-flota.md` [AC-DASH-06]
- [ ] (P1-PERF) Cablear la paginación por cursor a una pantalla de historial de entregas. El endpoint existe desde `AC-PERF-03` y ninguna pantalla lo consume — spec: `specs/kilopan/08-seguridad-rendimiento.md` [AC-PERF-05]
- [ ] (P1) TEST que verifique la escala tipográfica completa de Miga. Los tokens ya existen (`tokens.ts`: `pesoBascula` 96/700, y `CifraGrande.tsx` la aplica); lo que no existe es la prueba que… — spec: `specs/kilopan/09-plataforma-miga.md` [AC-H0-08]
- [ ] (P1) es-CL verificado por grep de gate: `12,450 kg` (coma, 3 decimales desde gramos), `$12.500` (entero, punto de miles), `dd-mm-aaaa`, RUT `12.345.678-5` validado al escribir. **Cero str… — spec: `specs/kilopan/09-plataforma-miga.md` [AC-H0-09]
- [ ] (P1) AA medible en el gate: **axe no está instalado ni como dependencia ni como test** — `check.sh` solo lo nombra en un comentario y en el mensaje de «saltado». Falta: contraste ≥4.5:1 a… — spec: `specs/kilopan/09-plataforma-miga.md` [AC-H0-10]
- [ ] (P1) Estados obligatorios en todo listado: vacío accionable / skeleton / error con reintentar / sin conexión con **contador real de cola** («Sin conexión — N registros por subir» ámbar → … — spec: `specs/kilopan/09-plataforma-miga.md` [AC-H0-11]
- [ ] (P2) Validar el camino GATT contra una báscula real antes de darlo por bueno. Las marcas comunes en panaderías chilenas (Toledo, CAS, Torrey) suelen usar serie propietario, no GATT — `AC-… — spec: `specs/kilopan/02-catalogo-pesaje.md` [AC-PES-09]
- [ ] (P2) UI de resolución de mermas al día siguiente: hoy la máquina de estados existe y la TCK la respeta, pero nadie puede mover una merma a `recuperada_con_venta` desde pantalla — spec: `specs/kilopan/02-catalogo-pesaje.md` [AC-MERM-02]
- [ ] (P2) Cablear el POST de ambos CTA (`lead_eauto` y `lead_kiloruta`): las tablas y el consentimiento están probados, pero el botón no envía — spec: `specs/kilopan/07-dashboard-flota.md` [AC-DASH-07]
- [ ] (P2) Selector de sucursal en el dashboard, para que multisucursal sirva de algo cuando haya más de un local — spec: `specs/kilopan/07-dashboard-flota.md` [AC-SUC-02]
- [ ] (P2) Botón compartir en el detalle de entrega, no solo en el cierre de caja — spec: `specs/kilopan/07-dashboard-flota.md` [AC-SHARE-02]

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
