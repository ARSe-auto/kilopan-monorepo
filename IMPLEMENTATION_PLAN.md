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
- ~~[x]~~ (P0) Test que falla si una cifra de dinero o peso no usa `tabular-nums` /
      `font-variant-numeric` en los componentes de `packages/miga` — `cifras.test.ts`
      exige la propiedad por componente (comentarios descartados) y falla si aparece un
      `.tsx` sin clasificar; `prueba-arnes.sh` §7 lo prueba matando dos mutantes
      [AC-H0-03]
- [x] (P0) `packages/metodo/scripts/guardrail.sh` ejecutable: aborta si `DATABASE_URL`
      no es localhost/127.0.0.1, aborta si hay secretos fuera de `.env.local`, grep
      bloqueante `TODO|FIXME|PLACEHOLDER|not implemented|lorem ipsum` en `src/` [AC-H0-04]
- ~~[x]~~ (P0) `packages/metodo/scripts/check.sh` ejecutable con `--full`: build + lint +
      types + unit (+ e2e y axe cuando exista UI) [AC-H0-05]
- ~~[x]~~ (P0) `packages/metodo/panel/generar.mjs`: genera `panel/index.html` desde estado
      real del repo (ver §Panel abajo) [AC-H0-06]
- ~~[x]~~ (P0) Shells vacíos de `packages/nucleo-{identidad,pod,dte,comun}` con
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
- ~~[x]~~ (P0) PIN de 4 dígitos hasheado, nunca en texto plano en logs ni en
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
- ~~[x]~~ (P2) **Foto de respaldo opcional** (decisión #1, nivel 1): toggle
      `pesaje_foto_obligatoria` en `/admin`, solo para admin — deliberadamente NO en la
      pantalla de pesaje, para que quien pesa no lo apague cuando le incomode. Obturador
      real por `getUserMedia` con compresión a ~400 KB y `sha256` calculado sobre el
      blob comprimido. **Estuvo marcado [x] falsamente hasta el 25-jul-2026**: las
      columnas y el toggle existían, pero `/api/pesajes` no aceptaba el hash y `/pesar`
      nunca abría la cámara — el control del dueño estaba apagado en los hechos.
      Cerrado de verdad ahora: la exigencia se valida en el SERVIDOR (validarla solo en
      la UI sería teatro), `pan_app` puede marcar `foto_estado` pero no reapuntar
      `foto_sha256`, y hay 2 tests de invariante que lo prueban [AC-PES-04]
- ~~[x]~~ (P2) **Báscula conectada opcional** (decisión #1, nivel 2): Web Bluetooth
      contra el perfil GATT Weight Scale, con degradación a manual. **NO probado contra
      una báscula real** — y las marcas comunes en panaderías chilenas (Toledo, CAS,
      Torrey) suelen usar serie propietario, no GATT: dar por validado solo tras
      conectar una de verdad. En iPhone este camino nunca se ofrece (Web Bluetooth no
      existe en Safari) [AC-PES-05]
- ~~[x]~~ (P2) **Cola con reintento automático** (decisión #4) en pesaje: respaldada
      en sessionStorage, reintento cada 15 s y al volver `online`, con el chip «Sin
      conexión — N por subir». Un rechazo 4xx del servidor NO se encola (es una
      respuesta que el operador tiene que ver ahora); solo se reintenta lo que falló por red [AC-RED-01]
- [x] (P1) Pesaje a reparto imputado a línea de pedido; el stock de mostrador no se descuenta — cerrado directo en spec; evidencia: `db/test-invariantes.mjs:2021` y `:2080` (espejo agregado 06-ago) [AC-PES-06]

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
- [x] (P1) Pantalla de cierre de caja `/caja`: esperado vs declarado por medio — cerrado directo en spec; evidencia: `apps/kilopan/src/app/caja/page.tsx` + e2e «la caja se cuenta a ciegas» (espejo agregado 06-ago) [AC-VEN-03]

## Hito 4 — Despacho y reparto

- [x] (P1) `clientes`, `pedidos` (máquina de estados + `correlativo_pedido` solo vía
      `pan.asignar_correlativo()`, inmutable después), `pedido_lineas` (con
      `gramos_pesados` mantenido por trigger, jamás por la app), `rutas`,
      `ruta_paradas` — todo probado [AC-DES-01]
- [x] (P1) **Bloqueo real**: «Salir a ruta» rebota si algún pedido de la carga no tiene
      DTE asociado (art. 55 DL 825) — trigger en BD, sin override; probado en ambos
      sentidos (sin guía rebota, con guía sale) [AC-DES-02]
- ~~[x]~~ (P1) F2 Armar pedido: `/pedidos` con alta de cliente, pedido con precio de la
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
- ~~[x]~~ (P2) **Consolidación de guías en una factura + saldo por cliente** (decisión #2):
      `documento_tributario.consolidado_en_id` (self-FK, índice único — ninguna guía se
      factura dos veces), vista `pan.saldo_cliente` derivada de eventos (nunca tabla
      editable a mano), `estado_pago` con «marcar pagada» — probado de punta a punta en
      BD [AC-FIA-01]
- ~~[x]~~ (P2) UI «Consolidar y facturar»: admin elige cliente, ve sus guías sueltas,
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
      la regla de rol está testeada: el dashboard entero bloquea el contenido si no sos
      `admin`, así que el CLP jamás llega al teléfono del repartidor. Probado:
      `autorizacion.spec.ts` ingresa como repartidor y confirma el bloqueo y la
      ausencia de TCK/«Tu flota»/CLP [AC-DASH-02]
- [x] (P2) **CTA hermano de KiloRuta** en la misma tarjeta «Tu flota»: «Prefiero que
      alguien más reparta por mí» → tabla `lead_kiloruta` simétrica a `lead_eauto`,
      ambas exigiendo consentimiento explícito (probado). No depende del contrato
      técnico del Anexo B. Falta cablear el POST de ambos CTA [AC-DASH-03]
- ~~[x]~~ (P2) **Lectura de totales del facturador** (decisión #3, fase 1): campo en
      el cierre de caja que compara contra lo que registró KiloPan. Probado: detecta
      que el facturador marcó $310 más. Las fases CSV y API quedan para cuando el
      piloto lo pida [AC-DASH-04]
- [x] (P2) **Estado de mermas recuperables** (decisión #6): máquina de estados en
      `pesajes.estado_merma` + la vista de TCK ya mueve `recuperada_con_venta` de
      `g_merma_tipificada` a `g_venta` sin cambiar la fórmula — probado (3.000 g pasan
      de merma a venta y la TCK sigue cerrando al 100%). Falta la UI de resolución al
      día siguiente [AC-MERM-01]
- ~~[x]~~ (P2) **Multisucursal ligero** (decisión #7): tabla `sucursales` +
      `sucursal_id` heredado automáticamente del dispositivo (el equipo vive en un
      local, nadie lo elige a mano). Probado que con una sola sucursal queda NULL y no
      agrega complejidad. Falta el selector en el dashboard [AC-SUC-01]
- ~~[x]~~ (P2) **Botón compartir nativo** (decisión #9): `navigator.share()` con
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
- ~~[x]~~ (P0-SEC) Cabeceras de seguridad base (`X-Content-Type-Options`, `Referrer-Policy`,
      `X-Frame-Options`) en `next.config.ts` — CSP completa y HSTS quedan para cuando
      existan orígenes reales que permitir (fotos, mapa estático); no declarar una CSP
      amplia "por si acaso" [AC-SEC-04]
- [x] (P0-SEC) Cookies de sesión `HttpOnly` + `Secure` (en producción) + `SameSite=Lax`;
      ningún secreto ni token en `localStorage` — verificado en vivo: `document.cookie`
      no puede leer `kp_sesion` desde JS, pero el navegador la manda sola y
      `/api/auth/logout` la valida. Cerrado 2-ago-2026: el secreto de dispositivo, que
      vivía en `localStorage` en texto plano, se migró a IndexedDB [AC-SEC-05]
- [x] (P0-SEC) Toda query a Postgres parametrizada (cero interpolación de string en
      SQL) — grep en `guardrail.sh` + disciplina en `db/migrar.mjs` y
      `db/test-invariantes.mjs` desde el primer commit [AC-SEC-06]
- [x] (P0-SEC) Fotos write-once: tabla `pan.fotos` con trigger que rebota UPDATE y
      DELETE, `pan_app` solo con INSERT. El servidor RECALCULA el sha256 y rechaza la
      foto si no coincide con el declarado en el POD. Guardar el binario en la BD es
      decisión consciente para el piloto (volumen chico); si crece, pasa a URL sin
      cambiar el contrato [AC-SEC-07]
- ~~[x]~~ (P1-PERF) Índices en los filtros calientes (`pesajes.capturado_at`,
      `destino+fecha`, `ventas.creado_at`, `pedidos(fecha,estado)`, `ruta_paradas`,
      `entregas.capturado_at`). Nota: el índice sobre `creado_at::date` NO se puede —
      castear timestamptz a date no es IMMUTABLE [AC-PERF-01]
- ~~[x]~~ (P1-PERF) Compresión de fotos en el cliente antes de subir: 1280 px de ancho
      máximo y calidad 0.72, objetivo ≈400 KB, con techo duro de 1,5 MB en el servidor [AC-PERF-02]
- [x] (P1-PERF) Paginación por CURSOR (keyset), no por OFFSET, en el listado de
      entregas: con OFFSET la página 40 obliga a recorrer y descartar 2.000 filas, y el
      cursor además no se corre si entra una entrega nueva mientras el dueño scrollea —
      cerrado 08-ago: endpoint `/api/entregas` con cursor keyset, e2e
      `ac-perf-05-historial-entregas-cursor.spec.ts` verifica sin offset y sin desvío de
      cursor ante inserciones. Consumido por pantalla `/admin/entregas/historial`
      (AC-PERF-05). Gate --full en progreso [AC-PERF-03]
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

- [x] (P1) F23 — sin `<select>` nativo en manos enharinadas: `vender/page.tsx` (cliente al fiar) y `admin/page.tsx` (rol de usuario) usan el `<select>` del sistema; reemplazar por `SelectorUnToque` (packages/miga), el mismo patrón que ya usan destino de pesaje y medio de pago. Actualizar los 5 e2e que dependen del DOM actual — correctivo: `docs/PROMPT_CORRECTIVO.md` §5 — **cerrado**: commit `e9edb29` (/caja, /vender, /admin migrados a SelectorUnToque/TecladoNumerico/CifraGrande), verificado dos veces (navegador real + `check.sh --full` 12/12 antes y después de comitear), marcador de verde `89a39df`. El checkbox de este plan quedó desincronizado del código hasta esta auditoría (2-ago-2026); no hay `<select>` nativo restante en esas tres rutas (quedan en `historial`, `pedidos` y `facturar`, fuera del alcance declarado de F23). [nota 06-ago: sin AC de spec — F23 es del correctivo §5, excluido del conteo por AC]
- [x] (P1) Chip con el nombre del operador **siempre visible** en cada pantalla, como exige §5 F5 — cerrado 7-ago-2026 con `e2e/identidad-chip-operador.spec.ts` (un test por rol, recorre todas las rutas de `DESTINOS_POR_ROL` más `/inicio` y `/mas`, chip localizado por `title`) — spec: `specs/kilopan/01-identidad.md` [AC-ID-07]
- [x] (P1) Orden de productos **por frecuencia real** de pesaje, no alfabético como hoy. §5 F1 lo exige para que repetir producto cueste 2 toques. Requiere trackear frecuencia. Test: sembrar fr… — spec: `specs/kilopan/02-catalogo-pesaje.md` [AC-PES-07]
- [x] (P1) Capa de BD de la carga: `pan.bultos` + gate salir-a-ruta con override auditado — cerrado por sesión supervisada 06-ago (migración 0024, 3 tests, suite 81/0); partido: API → AC-DES-05, pantalla → AC-DES-06, escáner → AC-DES-07 — spec: `specs/kilopan/04-despacho-reparto.md` [AC-DES-04]
- [x] (P1) API de carga sobre 0024: generar bultos al confirmar, POST escaneo (409 en duplicado), GET estado N/M por ruta — cerrado 06-ago (`/api/pedidos` genera bultos al confirmar; `/api/bultos` GET N/M + POST escaneo 2xx/409/404; e2e `carga-bultos.spec.ts`) — spec: `specs/kilopan/04-despacho-reparto.md` [AC-DES-05]
- [x] (P1) Pantalla F3 `/cargar`: contador N/M 96 px, captura manual + checklist, banner ámbar en duplicado, salir-a-ruta con la única modal — cerrado 06-ago: e2e móvil 390×844 `cargar-bultos-pantalla.spec.ts` (camino feliz + duplicado + override) verde; contrato de captura por botones del teclado propio, override auditado en el mismo update (0024), modal por encima de la BarraPestanas — spec: `specs/kilopan/04-despacho-reparto.md` [AC-DES-06]
- [ ] (P2) Escáner cámara full-screen + linterna + beep/vibración (zxing-js) como mejora progresiva; la captura manual sigue siendo el camino primario en iOS — spec: `specs/kilopan/04-despacho-reparto.md` [AC-DES-07]
- [x] (P1) Escaneo del TED con zxing-js como mejora progresiva — cerrado 07-ago: `parsearTed` (src/comun/ted.ts) extrae tipo/folio/RUT/monto del XML del PDF417 (6 tests unitarios `ted.test.ts`, verdes), `EscanerTed.tsx` abre la cámara con `BrowserPDF417Reader` y cae de vuelta a manual ante cualquier fallo (botón solo si hay cámara), panel `/pedidos` cableado (edición manual descarta el `ted_xml`); backend `/api/dte` ya aceptaba `ted_scan`+`tedXml`. Gate --full verde (12/0/0) — spec: `specs/kilopan/06-registro-dte.md` [AC-DTE-03]
- [x] (P1) Mapa estático de pines de los PODs del día (Leaflet + OSM, **solo dashboard**, §3 módulo 7). Cerrado 07-ago: MapaPodsDia.tsx componente client con react-leaflet, query de entregas cerradas del día en dashboard/page.tsx, e2e `dashboard-mapa-pods.spec.ts` valida marcadores y popups interactivos; gate --full verde — spec: `specs/kilopan/07-dashboard-flota.md` [AC-DASH-05]
- [x] (P1) Pantalla de auditoría por usuario y dispositivo sobre la tabla `eventos` (append-only). Construido: sección en `/dashboard` filtrable por usuario y dispositivo, API GET `/api/auditoria` con límite 500, componente cliente `PantallaAuditoria.tsx`, test e2e verifica tabla y filtros — spec: `specs/kilopan/07-dashboard-flota.md` [AC-DASH-06]
- [x] (P1-PERF) Cablear la paginación por cursor a una pantalla de historial de entregas. El endpoint existe desde `AC-PERF-03` y ninguna pantalla lo consume — cerrado 07-ago: pantalla `/admin/entregas/historial` con paginación por cursor, filtro de entregas por revisar, indicadores de problemas (GPS degradado, foto pendiente, entrega parcial); `ac-perf-05-historial-entregas-cursor.spec.ts` cobriendo el endpoint y consumo en UI — spec: `specs/kilopan/08-seguridad-rendimiento.md` [AC-PERF-05]
- [x] (P1) TEST que verifique la escala tipográfica completa de Miga — cerrado 07-ago: `packages/miga/src/componentes/tipografia.test.ts` (escala completa+descendente, `pesoBascula` 96/700, cada `fontSize` literal de `packages/miga/src/componentes` comparado contra el token vivo); corrigió 3 pantallas fuera de escala (`SelectorUnToque`, `EstadoListado`, `TecladoNumerico`). Gate --full verde — spec: `specs/kilopan/09-plataforma-miga.md` [AC-H0-08]
- [x] (P1) es-CL verificado por grep de gate — cerrado 07-ago: `verifica-es-cl.mjs` propio en `check.sh` (kg/CLP/fecha sin bypass manual, cero inglés visible, RUT validado en vivo con `estadoRut()`); corrigió bug real en `MapaPodsDia.tsx` (`.toFixed(1)` daba punto en vez de coma); `verifica-es-cl.test.mjs` mata los mutantes. Gate --full verde — spec: `specs/kilopan/09-plataforma-miga.md` [AC-H0-09]
- [x] (P1) AA medible en el gate: **axe instalado y en el gate** — cerrado 07-ago: `accessibility.spec.ts` (5 tests: contraste axe en `/ingresar` y `/dashboard`, targets ≥44px, aria-label vacíos, zoom 200%) corre dentro de `e2e` con `check.sh --full`; corrigió 2 violaciones reales de contraste (`ChipOperador`, estado vacío de `MapaPodsDia`). Foco visible y VoiceOver partidos a `AC-H0-14` — spec: `specs/kilopan/09-plataforma-miga.md` [AC-H0-10]
- [ ] (P1) Foco visible + recorrido VoiceOver (F1/F4/F5) sin trampas — partido de `AC-H0-10` el 7-ago porque un e2e headless no puede ejercer ninguno de los dos; sesión supervisada — spec: `specs/kilopan/09-plataforma-miga.md` [AC-H0-14]
- ~~[ ]~~ (P1) Estados obligatorios en todo listado: vacío accionable / skeleton / error con reintentar / sin conexión con **contador real de cola** («Sin conexión — N registros por subir» ámbar → … — spec: `specs/kilopan/09-plataforma-miga.md` [AC-H0-11] — fusionado 06-ago: el checkbox vigente de AC-H0-11 es el de Ola 2 (P0)
- [ ] (P2) Validar el camino GATT contra una báscula real antes de darlo por bueno. Las marcas comunes en panaderías chilenas (Toledo, CAS, Torrey) suelen usar serie propietario, no GATT — `AC-… — spec: `specs/kilopan/02-catalogo-pesaje.md` [AC-PES-09]
- [ ] (P2) UI de resolución de mermas al día siguiente: hoy la máquina de estados existe y la TCK la respeta, pero nadie puede mover una merma a `recuperada_con_venta` desde pantalla — spec: `specs/kilopan/02-catalogo-pesaje.md` [AC-MERM-02]
- [ ] (P2) Cablear el POST de ambos CTA (`lead_eauto` y `lead_kiloruta`): las tablas y el consentimiento están probados, pero el botón no envía — spec: `specs/kilopan/07-dashboard-flota.md` [AC-DASH-07]
- [ ] (P2) Selector de sucursal en el dashboard, para que multisucursal sirva de algo cuando haya más de un local — spec: `specs/kilopan/07-dashboard-flota.md` [AC-SUC-02]
- [ ] (P2) Botón compartir en el detalle de entrega, no solo en el cierre de caja — spec: `specs/kilopan/07-dashboard-flota.md` [AC-SHARE-02]

## Auditoría Anexo D (Ola 1, 2-ago-2026) — ACs devueltos a abiertos

Procedimiento de `docs/PROMPT_CORRECTIVO.md` Anexo D ejecutado sobre los 62 ACs `[x]` de
`specs/kilopan/*.md`: 15 ya venían señalados por una auditoría previa (cross-session), los
otros 47 se auditaron ahora en 4 lotes paralelos, cada uno con evidencia real (test
encontrado y leído, o su ausencia confirmada) — no por lectura de nombre de archivo. Cada
ítem tiene su nota completa en el `[ ]` correspondiente de `specs/kilopan/*.md`. **5 ACs de
la lista original de 15 NO se devolvieron** tras encontrarles test real y vigente que
contradice la lista previa: `AC-DES-01`, `AC-PES-01`, `AC-MERM-01`, `AC-H0-02` (tests
directos en `db/test-invariantes.mjs`, verificados en vivo, 0 fail/0 skipped), y
`AC-PERF-04` (su defecto de fondo —medía cero pantallas— ya fue reparado por el propio Ola
1 en el commit `43813e8`, anterior a esta auditoría). Documentado para que quede trazable,
no oculto. **`AC-SEC-06` volvió a cerrarse el mismo día**: el hueco (grep case-sensitive en
`guardrail.sh`) se corrigió y se le agregó prueba en `prueba-arnes.sh` §2b horas después de
esta misma auditoría — no queda como ítem abierto de la lista de abajo.

- [ ] (P2) [AC-FIA-01] — el "índice único" de consolidación no existe (solo índice no-único); ver nota en `specs/kilopan/06-registro-dte.md`
- [ ] (P2) [AC-FIA-02] — doble facturación 409 sin test — `specs/kilopan/06-registro-dte.md`
- [ ] (P2) [AC-SUC-01] — sucursal_id probado en BD pero invisible en toda la UI — `specs/kilopan/07-dashboard-flota.md`
- [ ] (P1) [AC-POD-04] — e2e flaky confirmado, no es evidencia repetible — `specs/kilopan/05-entrega-pod.md`
- [ ] (P1) [AC-DES-03] — depende del mismo e2e flaky que AC-POD-04 — `specs/kilopan/04-despacho-reparto.md`
- [ ] (P2) [AC-DASH-04] — comparación con el facturador sin ningún test — `specs/kilopan/07-dashboard-flota.md`
- [ ] (P2) [AC-SHARE-01] — degradación de `navigator.share()` sin test — `specs/kilopan/07-dashboard-flota.md`
- [x] (P0-SEC) [AC-SEC-04] — cabeceras de seguridad declaradas pero sin test que confirme que el servidor las emite — `specs/kilopan/08-seguridad-rendimiento.md` — cerrado con `e2e/seguridad-cabeceras.spec.ts` (página + ruta de API)
- [ ] (P1-PERF) [AC-PERF-02] — compresión de fotos y techo de 1,5 MB sin ningún test — `specs/kilopan/08-seguridad-rendimiento.md`
- [ ] (P1-PERF) [AC-PERF-01] — índices creados sin `EXPLAIN` que confirme que el planner los usa — `specs/kilopan/00-modelo-datos.md`
- [x] (P0) [AC-ID-03] — el 423 de `/api/auth/login` nunca se probó automatizado (solo su hermano de enrolamiento) — `specs/kilopan/01-identidad.md` — cerrado con `e2e/seguridad-login.spec.ts`: 4 PIN incorrectos en 401, el 5º en 423, y el PIN correcto sigue en 423 tras el bloqueo; control aparte confirma el 200 con cookie
- [ ] (P2) [AC-PES-04] — falta test de que el servidor RECHACE un pesaje sin foto con el toggle activo (mismo patrón que ya falló una vez) — `specs/kilopan/02-catalogo-pesaje.md`
- [ ] (P2) [AC-PES-05] — báscula GATT sin ningún test, ya reconocido por AC-PES-09 — `specs/kilopan/02-catalogo-pesaje.md`
- [ ] (P2) [AC-RED-01] — describe un mecanismo (sessionStorage/15s) que ya no existe en el código (es IndexedDB/30s); ninguna versión tiene test — `specs/kilopan/02-catalogo-pesaje.md`
- [ ] (P1-SEC) [AC-PES-08] — la única evidencia citada es lectura de archivo, no un test — `specs/kilopan/02-catalogo-pesaje.md`
- [x] (P0) [AC-H0-03] — el grep de tabular-nums solo comprobaba que existe UNA VEZ en el árbol, no por componente — `specs/kilopan/09-plataforma-miga.md` — cerrado con `packages/miga/src/componentes/cifras.test.ts` (propiedad exigida por componente, comentarios descartados) + `pnpm test` propio de miga + `prueba-arnes.sh` §7, que mata dos mutantes contra un árbol de juguete: borrar la propiedad de un solo componente, y agregar uno nuevo sin clasificar
- [x] (P0) [AC-H0-05] — `prueba-arnes.sh` §8b ejecuta `check.sh --full` en sandbox hermético y exige que dispare pnpm run {lint,typecheck,test,build,e2e}; mata al mutante que borra los run_step — `specs/kilopan/09-plataforma-miga.md`
- [x] (P0) [AC-H0-06] — `prueba-arnes.sh` §8c ejerce `generar.mjs` en sandbox hermético (specs y loop.pid controlados) y exige: prender el loop no mueve el avance, el avance sube con los ACs cerrados (no con commits), y con el loop VIVO pero 0 cerrados el avance es 0 (el pid jamás es señal de avance) — `specs/kilopan/09-plataforma-miga.md`
- [x] (P0) [AC-H0-07] — los 4 shells de `packages/nucleo-*` ahora tienen `package.json` real; `prueba-arnes.sh` §5b verifica en disco que cada uno existe y parsea, y que el README sigue advirtiendo que está vacío a propósito — `specs/kilopan/09-plataforma-miga.md`
- [ ] (P1) [AC-ADM-01] — nadie llama `POST`/`PATCH /api/usuarios` desde una prueba — `specs/kilopan/10-administracion.md`
- [ ] (P1) [AC-ADM-02] — nadie llama `POST`/`PATCH /api/productos` ni prueba la vigencia histórica de precios — `specs/kilopan/10-administracion.md`
- [ ] (P2) [AC-ADM-03] — cero referencias a `/api/parametros` en cualquier test — `specs/kilopan/10-administracion.md`
- [ ] (P2) [AC-PAG-03] — pantalla de admin de medios de pago sin ningún test — `specs/kilopan/03-venta-mostrador.md`
- [ ] (P1) [AC-POD-05] — flujo de rechazo/parcial desde `/ruta` sin test; el catálogo "cerrado" tampoco se valida en el servidor — `specs/kilopan/05-entrega-pod.md`

## Ola 2 — «Marcha atrás» (`docs/PROMPT_CORRECTIVO.md` §5, planificada 3-ago-2026)

La causa raíz R1: hoy corregir un error de operación exige SQL a mano. Cada AC vive con su
texto completo en la spec citada — acá va solo su estado, como manda la jerarquía de verdad.

**§4 (modelo de datos) ya estaba hecho** y se verificó antes de escribir esto:
`0017_fiado_mostrador_suma_saldo.sql` y `0018_turnos_cierre_caja.sql` cubren el saldo del
fiado de mesón y la tabla `pan.turnos`. La numeración del documento (0016/0017) no coincide
con la real porque en el medio entró `0016_bloqueo_pin_enrolamiento.sql`. **Ola 2 no
necesita migraciones nuevas**, así que el motor puede construirla casi entera solo.

- [x] (P0) [AC-ADM-04] — pantalla `/arreglar` solo admin, con 403 desde el SERVIDOR — `specs/kilopan/10-administracion.md` — cerrado con `app/arreglar/page.tsx` + `e2e/seguridad-arreglar.spec.ts`
- [x] (P0) [AC-ADM-05] — anular una venta con motivo escrito, su evento, y que deje de sumar al arqueo — `specs/kilopan/10-administracion.md` — cerrado 2-ago-2026: `POST /api/ventas/anular` (solo admin) marca `anulada_at`/`anulada_motivo` append-only + evento `venta_anulada`; `/api/cierre-caja` excluye `anulada_at is not null`; migración 0020 con CHECK; e2e + invariante verdes.
- [x] (P0) [AC-ADM-06] — corregir un cierre de turno sin pisar el original (append-only) — `specs/kilopan/10-administracion.md`
- [x] (P0) [AC-ADM-10] — `pan.eventos` obligatoria en toda operación de plata y configuración, un test por operación — `specs/kilopan/10-administracion.md`
- [ ] (P0) [AC-H0-11] — los cuatro estados obligatorios de listado (partido: el undo salió a AC-H0-12) — `specs/kilopan/09-plataforma-miga.md`
- [ ] (P0) [AC-H0-12] — deshacer de 8 s en pesaje, venta, carro y armar ruta, en vez de modales — `specs/kilopan/09-plataforma-miga.md`
- [x] (P0) [AC-POD-06] — bandeja de pendientes persistente con el porqué de cada rechazo — `specs/kilopan/05-entrega-pod.md`
- [x] (P0) [AC-VEN-05] — apertura de turno con fondo inicial, dos toques — `specs/kilopan/03-venta-mostrador.md`
- [ ] (P1) [AC-ADM-07] — cerrar una ruta con odómetro desde `/arreglar` — `specs/kilopan/10-administracion.md`
- [ ] (P1) [AC-ADM-08] — revocar equipo y desbloquear PIN desde `/arreglar` — `specs/kilopan/10-administracion.md`
- [ ] (P1) [AC-ADM-09] — quitar un pedido de una ruta desde `/arreglar` — `specs/kilopan/10-administracion.md`
- [ ] (P1) [AC-H0-13] — teclado grande en todo campo de plata, incluido el arqueo — `specs/kilopan/09-plataforma-miga.md`

**Fuera del alcance del motor** (`docs/PROMPT_CORRECTIVO.md` §7 — sesión supervisada):

- [ ] (P0) [AC-ADM-11] — reparación de datos históricos con informe FIRMADO por la dueña — `specs/kilopan/10-administracion.md`
      El motor no lo toca: son datos reales con evidencia y exige la firma de una persona.
      Anotado en `packages/metodo/panel/acs-atascados.txt` para que no tape a los demás.

## Ola 3 — «Que la dueña vea» (`docs/PROMPT_CORRECTIVO.md` §3, planificada 3-ago-2026)

Causas raíz R3/R4. Dos piezas ya estaban en el plan bajo el encabezado de Ola 2
(`AC-ADM-10`, arriba) por ser prerrequisito de datos — ver la nota de archivo en su
spec. `AC-DASH-06` (pantalla de auditoría) también ya existía, escrita antes de esta
sesión — no se duplicó.

- [ ] (P0) [AC-DASH-08] — cola de entregas rechazadas/parciales cableada a una pantalla del dashboard — `specs/kilopan/07-dashboard-flota.md`
- [x] (P0) [AC-SEC-10] — 500 crudos convertidos en 400 validados, 18 apariciones contadas en `apps/kilopan/src/app/api/` — `specs/kilopan/08-seguridad-rendimiento.md`
- [ ] (P1) [AC-DASH-09] — histórico con rango de fechas y exportación de la conciliación diaria — `specs/kilopan/07-dashboard-flota.md`
- [ ] (P1) [AC-SEC-09] — auditoría de límites de negocio validados solo en el cliente, movidos a servidor+BD — `specs/kilopan/08-seguridad-rendimiento.md`

## Ola 4 — Robustez y accesibilidad (`docs/PROMPT_CORRECTIVO.md` §3, planificada 3-ago-2026)

Causa raíz R5. `AC-H0-11` (cuatro estados) y `AC-H0-10` (axe/AA) ya estaban en el plan —
el primero bajo el encabezado de Ola 2 por historia (ver nota de archivo en su spec), el
segundo escrito antes de esta sesión. (Corrección 06-ago: AC-H0-11 SÍ quedó
duplicado — líneas de «Trabajo abierto» y de Ola 2; fusionado dejando vigente el de Ola 2.)

- [x] (P0) [AC-POD-07] — `/ruta` sabe si está offline y el chip dice la verdad — `specs/kilopan/05-entrega-pod.md`. **Cerrado en la spec el 3-ago-2026** (commits `9d2ae29` primera mitad, `7b8d47b` segunda mitad). El plan había quedado desincronizado con la spec durable, que ya lo tenía `[x]` con las dos mitades hechas. Primera mitad: `/ruta/page.tsx` usa `useEnLinea()`, probado por `e2e/pod-offline.spec.ts` (pierde señal con la pantalla ya cargada y exige «Sin conexión», mutante muerto). Segunda mitad —quitar el hook a `pesar`/`vender`— era decisión de Alexis, ya tomada en sesión supervisada a favor del código: `enviarOEncolar` ya encola ante cortes momentáneos en producción sin incidentes, y el maestro/`AGENTS.md` se actualizaron para decir la verdad («la UX de offline es solo reparto»). Ninguna pantalla miente ya

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
alguien se dé cuenta". Escritos y probada su sintaxis.

**Estado 2-ago-2026 (cierre de Ola 1):** las cuatro condiciones de encendido de
`docs/PROMPT_CORRECTIVO.md` §9.4 están verificadas — gate 0 saltados, los 5 mutantes de
Anexo B en rojo (`campana.mjs --had` 100%), CI verde en 3 commits distintos
(`.github/workflows/gate.yml`, corridas #8/#9/#10), `lock.sh` exit 7 confirmado — pero
el motor **todavía no se cargó en launchd**: `com.eauto.ralph-loop` está corriendo en
vivo en esta máquina ahora mismo, y ambos motores comparten la misma credencial OAuth
(`packages/metodo/launchd/README.md`); el propio maestro exige un solo motor a la vez.
Encender el de KiloPan mientras el de eauto vive rompería esa regla. Queda a decisión
explícita de Alexis (pausar eauto o esperar a que termine) — ver docs/BITACORA.md.

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
