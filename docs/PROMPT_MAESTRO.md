# PROMPT MAESTRO — KiloPan

**App de control operacional para panaderías chilenas: del pesaje del pan a la boleta o la
entrega con prueba, con identidad total.** Producto para vender vía Fechipan/Indupan a las
~5.500 panaderías tradicionales de Chile; complementariamente, genera leads calificados de
vans eléctricas para e-auto con los datos de reparto del propio panadero.

Documento auto-suficiente, método «El Elíxir» (10 secciones). No hay decisiones abiertas:
donde dice «se hace X», se hace X. Si algo no está aquí ni en `specs/`, no existe.
Sintetizado el 13-jul-2026 por un panel de 8 expertos + 2 revisores adversariales
(20 contradicciones detectadas y resueltas; cada umbral tiene UN valor).

---

## 1. ROL Y PANEL

Actúas como panel permanente: **arquitecto de datos Postgres** (preside y dirime),
**diseñador de producto iOS (HIG)** especializado en manos ocupadas (harina, guantes),
**ingeniero Next.js senior** con PWA offline-first, **experto en cumplimiento SII/DTE
chileno**, **auditor de seguridad** (identidad, anti-falsificación de POD) y un
**adversario** que intenta romper lo que los demás den por bueno. Ante conflicto de
criterios, manda el arquitecto de datos; ante duda normativa, manda el experto SII.

## 2. OBJETIVO ESTRATÉGICO

**Variable norte: TCK — Tasa de Conciliación diaria de Kilos.** Porcentaje de los gramos
pesados en el día (corte 23:59, sobre `capturado_at`) que quedan **cerrados** como:
venta de mostrador + entrega con POD completo + merma tipificada + devolución registrada.

```sql
-- SQL de referencia (la métrica se calcula SIEMPRE desde eventos, jamás desde snapshots)
SELECT fecha,
       (g_venta + g_pod_ok + g_merma_tipificada + g_devolucion)::numeric
       / NULLIF(g_pesados,0) AS tck
FROM pan.conciliacion_diaria;  -- vista sobre pesajes, venta_lineas, entregas, mermas, devoluciones
```

- **Meta MVP:** TCK ≥ 95 % sostenida 4 semanas en la panadería piloto.
- **Secundarias** (mismas tablas de eventos): merma tipificada semanal en gramos y CLP
  (valorizada a precio *mostrador* vigente); % de entregas con POD completo al primer
  intento; mediana pesaje→POD por ruta en minutos.
- La TCK es a la vez métrica de adopción (solo cierra si pesador, vendedor y repartidor
  usan la app) y el argumento de venta al gremio: *«sepa cada noche qué pasó con cada
  kilo que salió del horno»*.

**Filtro único de alcance:** ¿esto ayuda a que un kilo pesado hoy quede conciliado hoy —
vendido o entregado con prueba— y a que el dueño lo vea esta noche? Si no, queda fuera.

## 3. QUÉ HACE (ALCANCE MVP — lista cerrada)

**Flujo dorado:** el maestro pesa el lote en pantalla táctil → el pan sale a mostrador o
a reparto con su DTE registrado → el repartidor entrega con foto + GPS + receptor → el
dueño ve esa misma noche kilos pesados, vendidos, entregados y perdidos — y cuánto le
cuesta cada km de reparto.

Siete módulos, ninguno más:

1. **Identidad y dispositivos.** Usuarios con RUT validado + PIN de 4 dígitos; roles
   fijos (admin, maestro, vendedor, repartidor); dispositivos enrolados (N enrolados por
   usuario, **1 sesión activa concurrente por usuario**; dispositivos compartidos con
   cambio de operador por PIN). Todo write lleva `usuario_id + dispositivo_id + hora del
   servidor`. Sin sesión de operador abierta no hay escritura (trigger).
2. **Catálogo y pesaje.** Productos por kilo o unidad, dos listas de precios (mostrador /
   mayorista) con vigencia histórica. Estación de pesaje táctil: cifra en 96 px, teclado
   numérico propio, destino en un toque (**Mostrador / Reparto / Merma** — merma exige
   motivo tipificado). Requiere red local de la panadería (no es offline).
3. **Venta mostrador.** Venta táctil en ≤3 toques contra el stock pesado; medio de pago
   efectivo/débito; cierre de caja (esperado vs declarado). La boleta la emite el
   facturador que la panadería ya usa; la app registra la venta interna. Sin venta en ruta.
4. **Despacho y reparto.** Pedidos recurrentes por cliente (kg por producto, L-S);
   armado de carga por ruta ordenada a mano (drag en web); checklist/escaneo de bultos.
   **«Salir a ruta» se bloquea si algún pedido de la carga no tiene DTE asociado**
   (art. 55 DL 825: el documento viaja con el pan; multa y retención del vehículo si no).
5. **Entrega con POD (offline-first).** App del repartidor: su ruta del día descargada
   al partir; por parada: foto en vivo + GPS + receptor precargado + gramos confirmados,
   en **≤4 toques**. Rechazo parcial/total con motivo de catálogo cerrado. Todo funciona
   sin señal y sincroniza solo (cola outbox local, `client_uuid` idempotente).
6. **Registro DTE.** La app **JAMÁS emite** documentos tributarios: registra y asocia los
   DTE ya emitidos (factura 33, boleta 39, guía 52, NC 61 como anulación) por escaneo del
   TED (PDF417) o ingreso manual tipo+folio+RUT — el manual es el camino primario en iOS.
7. **Dashboard web del dueño + flota.** Conciliación del día (TCK, gramos y CLP por
   destino, merma), detalle por entrega con foto ampliable, mapa estático de pines
   (Leaflet + OSM, solo dashboard), auditoría por usuario/dispositivo. Tarjeta «Tu flota»:
   km reales, $/km, comparativa combustión vs eléctrico y CTA «Quiero que e-auto me
   contacte» — **solo cuando existen ≥20 rutas cerradas**, descartable, jamás en el
   teléfono del repartidor.

**FUERA del MVP (explícito):** emisión de DTE ante el SII (solo registro; el modelo queda
listo para OpenFactura/LibreDTE en v2) · pagos integrados y cuentas por cobrar · venta en
ruta («ventas por efectuar») · inventario de insumos, recetas y costeo · optimizador de
rutas (VRP) y torre de control en vivo · e-commerce o app del cliente final · generación
de etiquetas/códigos propios con apariencia tributaria · integración con balanzas
(bluetooth/serial) · multi-sucursal · notificaciones push/WhatsApp · turnos y
remuneraciones · pesaje/mostrador offline (offline es SOLO el módulo de reparto) ·
correo saliente (no hay outbox de correo en este MVP).

## 4. MODELO DE DATOS (Postgres, schema `pan` — canónico, resuelve el panel)

**Unidades duras:** dinero = **CLP `integer`** con `pan.round_clp()`; peso = **gramos
`integer`** `CHECK (gramos BETWEEN 1 AND 100000)` — jamás numeric de kilos, jamás float;
la UI formatea `12,450 kg` y `$12.500` (es-CL). Timestamps `timestamptz`; el reloj del
**servidor** manda para negocio y métricas (`recibido_at`); el del teléfono
(`capturado_at`) se guarda para diagnóstico y TCK.

- **usuarios** — id uuid PK, nombre, rut UNIQUE CHECK `pan.valida_rut(rut)` (módulo 11),
  rol CHECK IN ('admin','maestro','vendedor','repartidor'), pin_hash (4 dígitos, bcrypt),
  clave_hash (solo admin/web), activo.
- **dispositivos** — id uuid PK, nombre («Tablet mesón», «Fono reparto 2»), secreto_hash
  (token emitido una vez; en el cliente vive en IndexedDB — garantía menor que Keychain,
  declarada), enrolado_por FK, enrolado_at, revocado_at (jamás DELETE).
- **sesiones_operador** — dispositivo_id FK, usuario_id FK, inicio, fin,
  `EXCLUDE USING gist (dispositivo_id WITH =, tstzrange(inicio,fin) WITH &&)`;
  además un usuario con sesión nueva en otro dispositivo desplaza la anterior
  (fila de auditoría `sesion_desplazada`). Auto-bloqueo a PIN: 10 min.
- **productos** — nombre UNIQUE, tipo_venta CHECK IN ('kilo','unidad'), codigo_barras
  UNIQUE NULL, activo. **precios** — producto_id FK, lista CHECK IN
  ('mostrador','mayorista'), precio_clp int, vigente_desde; PK (producto_id, lista,
  vigente_desde). **clientes.lista_precio** elige la lista.
- **hornadas** — producto_id FK, fecha, masa_gramos int, usuario_id, dispositivo_id.
- **pesajes** — client_uuid UNIQUE (idempotencia), hornada_id FK **NULL** (fase 1),
  pedido_linea_id FK NULL, gramos int, destino CHECK IN ('mostrador','reparto','merma'),
  `CHECK ((destino='reparto') = (pedido_linea_id IS NOT NULL))`,
  `CHECK ((destino='merma') = (motivo_merma IS NOT NULL))`, identidad, pesado_at.
- **mermas tipificadas** via destino='merma' + motivo CHECK IN
  ('quemado','sobrante_dia','devolucion_cliente','otro'); **devoluciones** —
  cliente_id FK, gramos, fecha, foto_sha256 NULL, identidad.
- **clientes** — rut UNIQUE CHECK valida_rut, razon_social, canal CHECK IN
  ('mostrador','reparto'), direccion, lat/lng numeric(9,6), contacto_nombre,
  contacto_fono, lista_precio, activo.
- **pedidos** — **correlativo_pedido** bigint UNIQUE (NULL en borrador; lo asigna SOLO
  `pan.asignar_correlativo()` al confirmar; trigger aborta todo UPDATE posterior;
  `REVOKE UPDATE(correlativo_pedido)`) — *se llama correlativo, no «folio»: el único
  folio del sistema es el del SII*. cliente_id FK, fecha_entrega, estado CHECK IN
  ('borrador','confirmado','pesado','en_ruta','entregado','anulado') con máquina de
  estados por trigger (anulado prohibido tras POD), total_clp int, identidad.
- **pedido_lineas** — pedido_id FK CASCADE, producto_id FK, gramos_pedidos,
  gramos_pesados (lo mantiene trigger que suma pesajes — jamás la app),
  gramos_entregados, unidades_*, precio_clp snapshot al confirmar,
  UNIQUE(pedido_id, producto_id).
- **rutas** — fecha, repartidor_id FK, vehiculo (patente), estado CHECK IN
  ('planificada','cargando','en_curso','cerrada') solo hacia adelante, km_inicio,
  km_fin CHECK (km_fin>=km_inicio) — **el odómetro manual manda para $/km**; los puntos
  GPS de los PODs son apoyo, no hay tracking continuo.
- **ruta_paradas** — ruta_id FK, pedido_id FK, orden, UNIQUE(ruta_id, orden), intento
  int, estado CHECK IN ('pendiente','entregada','rechazada').
- **entregas** (POD — tabla canónica ÚNICA) — client_uuid UNIQUE, pedido_id FK,
  `UNIQUE (pedido_id) WHERE cerrada AND supersede_id IS NULL` (índice parcial: permite
  reintentos y correcciones), supersede_id FK NULL a la entrega corregida,
  receptor_nombre NOT NULL (precargado de clientes.contacto_nombre), receptor_rut NULL
  CHECK valida_rut, firma_png NULL (opcional), foto_sha256 NOT NULL,
  foto_estado CHECK IN ('pendiente_subida','subida'), lat/lng NOT NULL
  `CHECK (lat BETWEEN -56 AND -17 AND lng BETWEEN -76 AND -66)` (rango Chile — (0,0)
  rebota en la BD), precision_m NOT NULL (>100 m ⇒ flag `gps_degradado`, no bloquea),
  `gps_fuera_de_zona` bool (distancia al cliente >300 m ⇒ flag, no bloquea; cola
  «Entregas por revisar» del dashboard), gramos_entregados, motivo_rechazo FK catálogo
  cerrado obligatorio si entrega parcial, capturado_at (teléfono), recibido_at DEFAULT
  now() (servidor), identidad, cerrada bool.
  **Permiso de GPS denegado = la app bloquea la confirmación y lo dice; precisión mala
  jamás bloquea** (el pan no espera).
- **documento_tributario** — tipo_dte CHECK IN (33,39,52,61), folio_sii bigint,
  rut_emisor CHECK valida_rut, rut_receptor NULL, fecha_emision, monto_total int,
  monto_neto/iva int NULL (el TED no los trae; invariante: si ambos no-nulos,
  neto+iva=total con round_clp), origen_captura CHECK IN ('ted_scan','manual'),
  ted_xml text NULL (crudo, re-verificable contra el CAF), ind_traslado NULL (solo 52),
  estado CHECK IN ('registrado','anulado') — *sin ciclo de emisión: no somos emisores*,
  `UNIQUE (tipo_dte, folio_sii, rut_emisor)`, FK a pedido/parada, identidad.
- **ventas / venta_lineas / cierres_caja** — venta: vendedor, medio_pago CHECK IN
  ('efectivo','debito'), total_clp, identidad; líneas con gramos y precio snapshot;
  cierre_caja: esperado_clp vs declarado_clp, diferencia visible.
- **eventos** (append-only: REVOKE UPDATE/DELETE + trigger) — tipo, entidad, entidad_id,
  payload jsonb, identidad, at. Alimenta dashboard, TCK y auditoría.
- **ruta_metricas** (deriva al cerrar ruta) — km, paradas, gramos_entregados,
  costo_combustible_est_clp, costo_ev_equiv_clp, co2_g. **parametros** (clave PK, valor,
  editable por admin; defaults con fuente: `clp_km_combustible=140`, `clp_km_ev=35`,
  `co2_g_km_evitado=150`). **lead_eauto** — panaderia, km_mes, ahorro_estimado_clp,
  contacto, consentimiento, ts.

**Invariantes EN LA BD (el gate las testea intentando violarlas):**
POD inmutable una vez `cerrada` (UPDATE/DELETE ⇒ RAISE; corrección = fila nueva con
supersede_id) · foto jamás re-apuntable ni anulable · cadena de tolerancias única:
`gramos_pesados ≤ gramos_pedidos×1,10` y `gramos_entregados ≤ gramos_pesados×1,02`,
excedente exige evento admin `ajuste.autorizado` · `SUM(gramos)` por hornada ≤
masa_gramos · correlativo solo por función · CLP entero · RUT módulo 11 · identidad
obligatoria con sesión viva · escrituras privilegiadas vía SECURITY DEFINER (probar el
camino HTTP + SET ROLE real, no el acceso directo).

**Offline (solo módulo reparto):** al iniciar ruta se descarga el snapshot del día a
IndexedDB (Dexie); mutaciones nacen con `client_uuid` y se encolan (outbox local);
`POST /api/sync` hace `INSERT … ON CONFLICT (client_uuid) DO NOTHING` — reintento
infinito sin duplicar, cero merge. La foto viaja aparte (multipart) y el server marca
`subida` al verificar el sha256. Segundo POD de otro dispositivo rebota 409 y la app
muestra «ya entregado por X».

## 5. INTERFAZ (verificable con captura; si no puede fallar, no entra)

- **PWA instalable móvil-primero** (viewport base 390×844) + **dashboard web escritorio**
  (≥1280 px, maestro-detalle, densidad alta). Referencia: HIG de Apple — listas nativas,
  Large Title, hairlines con inset, sheets, estado presionado en toda celda. Solo modo
  claro en el MVP.
- **Sistema de diseño «Miga»** (tokens en UN archivo): system font stack; escala
  `peso-bascula` 96/700 · display 34/700 · título 22/600 · cuerpo 17/400 · pie 13/400;
  `tabular-nums` en TODA cifra (test que falla si falta); acento único `#C2410C`
  (corteza), ok `#15803D`, alerta `#B45309`, error `#B91C1C`; grilla 8 px, radio 12 px;
  targets **≥44×44 pt** (≥8 px entre sí); botón primario full-width 56 px anclado abajo
  en safe-area. Ningún estado se comunica solo por color.
- **es-CL:** `12,450 kg` (coma, 3 decimales desde gramos), `$12.500` (entero, punto de
  miles), `dd-mm-aaaa`, RUT `12.345.678-5` validado al escribir. Grep de gate: cero
  strings visibles en inglés.
- **Flujos táctiles con AC de toques** (manos enharinadas: cero hover, cero long-press
  obligatorio, cero drag fino en móvil):
  - **F1 Pesar** ≤4 toques (repetir producto: 2): grilla de productos por frecuencia →
    cifra 96 px + teclado numérico PROPIO (teclas ≥64 px, coma es-CL; jamás el teclado
    del sistema) → destino en un toque (Mostrador/Reparto/Merma) → snackbar Deshacer 8 s
    → encadena con el último producto preseleccionado.
  - **F2 Armar pedido:** clientes por ruta habitual → stepper 44 px y teclado propio →
    cerrar pedido genera bultos con correlativo (etiqueta Code128+QR si hay impresora;
    número de bulto en 96 px si no — mismo flujo, cero rama muerta) → **asociar DTE
    obligatorio antes de salir a ruta** (escaneo TED o tipo+folio+RUT manual).
  - **F3 Cargar van:** contador N/M en 96 px; escáner cámara full-screen con linterna
    (48 px, alcanzable con pulgar — madrugada real); lectura válida = beep + vibración;
    duplicada = tono distinto + banner ámbar; sin código = checklist 44 px equivalente.
    «Salir a ruta» exige 100 % o confirmación auditada (única modal permitida) **y**
    todos los DTE asociados (sin override).
  - **F4 Entregar (POD)** ≤4 toques: «Entregar» → obturador (GPS+hora+identidad se
    capturan solos) → receptor precargado (editable) → «Confirmar»; firma opcional con
    salto. Offline: tarjeta «Entregada — por sincronizar» con nube tachada.
  - **F5 Cambio de operador:** chip con el nombre SIEMPRE visible → PIN 4 dígitos
    (teclas 64 px) → cambio completo ≤3 s; auto-bloqueo 10 min.
  - **F6 Venta mostrador** ≤3 toques por venta + cierre de caja esperado vs declarado.
- **Fin de ruta del repartidor: muestra SOLO km y kg** — el CLP y el $/km viven
  únicamente en el dashboard del admin (regla de rol, testeada).
- **Estados obligatorios** de todo listado: vacío accionable / skeleton / error con
  reintentar / **sin conexión con contador real de cola** («Sin conexión — N registros
  por subir» ámbar → «Sincronizado hace Xs» verde). Undo 8 s en vez de modales.
- **AA medible en el gate:** contraste ≥4.5:1 (axe automatizado); cero targets <44 pt
  (test que recorre el DOM); foco visible; F1/F4/F5 completables con VoiceOver; texto
  200 % sin truncar kilos ni CLP; cero aria-label vacíos (grep).

## 6. BENCHMARKS (patrón a extraer, no pantalla a clonar)

| Referente | Patrón | Aplica en |
|---|---|---|
| Square/Toast POS | cifra dominante + teclado numérico propio; una transacción = una pantalla | F1, F6 |
| Things 3 | captura en cadena sin volver al home | F1, F2 |
| SimpliRoute / Beetrack (driver) | ruta = pila de tarjetas, parada activa expandida; POD cierra la tarjeta | Mi ruta, F4 |
| Uber Eats Driver | una acción primaria por pantalla, botón 56 px anclado abajo | F4 |
| Apps scanner-first | cámara full-screen, linterna alcanzable, feedback sonoro+háptico, contador vivo | F3 |

De los grandes del last-mile **no copiar**: optimizador VRP, torre de control en vivo,
ETA por ML, portal del cliente. Sí copiar su disciplina de POD (foto+GPS+receptor,
offline-first). Cada patrón adoptado se declara en el plan con adoptar/adaptar/descartar
y su porqué; la spec resultante lleva `Fuente:` y ≥3 ACs.

## 7. RESTRICCIONES Y PROHIBICIONES (guardrails como código; violarlas aborta el ítem)

- `guardrail.sh` antes de cada iteración: `DATABASE_URL` SOLO localhost (exit ≠ 0
  aborta) · secretos SOLO en `.env.local` gitignored · grep bloqueante en `src/`:
  `TODO|FIXME|PLACEHOLDER|not implemented|lorem ipsum`.
- **El folio tributario JAMÁS se genera:** la app no crea ningún documento, PDF ni
  número con apariencia de DTE (art. 97 N°4 CT — documento falso). Solo registra folios
  del SII. El correlativo interno se llama `correlativo_pedido` y lo asigna la BD.
- **Sin DTE asociado no hay salida a ruta** (guardrail en BD + UI, sin override): la
  guía debe existir ANTES del traslado (art. 55 DL 825; multa 10 %–200 % de 1 UTA y
  retención del vehículo).
- **POD inmutable y foto write-once:** bucket sin permiso DELETE para el rol de la app;
  trigger impide editar/borrar entregas cerradas; corrección = supersede.
- **Peso en gramos enteros y dinero en CLP enteros, calculados por la BD** — la UI jamás
  reimplementa reglas ni redondeos.
- **Jamás migración destructiva** ni `db:reset` sobre datos con evidencia (fotos de POD).
- **Jamás API de pago:** motor OAuth-only; ventana agotada ⇒ ESPERA. Recarga automática
  de créditos desactivada en consola ANTES del primer ciclo autónomo.
- Cámara solo vía `getUserMedia` in-app (sin file-input a galería); PDF417 del TED con
  zxing-js como mejora progresiva y **captura manual como camino primario en iOS**
  (AC probado en iPhone real).

## 8. MODELO Y ESFUERZO

- **plan → Sonnet · verify → Sonnet** (leen mucho, deciden poco).
- **build → ruteo por tag del planificador:** `[security]` (PIN, sesiones,
  device-binding, SECURITY DEFINER) y `[datos]` (esquema, triggers POD/correlativo,
  sync offline) → **Opus**; `[HIG]` (pulido táctil, estados) → **Haiku**; resto →
  **Sonnet**. **Juez del verify → Opus** con mandato de refutar.
- **Escalación de dos strikes:** 2 fallos del gate en el mismo AC ⇒ subir un nivel de
  modelo y reintentar UNA vez; tercer fallo ⇒ el ítem vuelve a plan con nota en bitácora.
- El selector de modelo es un script y **se testea contra el caso normal** (un selector
  no-op que todo lo manda a Opus quema la ventana en silencio — pasó en e-auto).
- Vía de costo: exclusivamente la ventana OAuth de la suscripción; costo marginal cero.

## 9. PROCESO

- Loop **plan → build → verify** con prompts fijos sobre `IMPLEMENTATION_PLAN.md` vivo;
  el verify asume que el builder miente.
- **Un AC por commit** con su test naciendo en el mismo commit
  (`feat(modulo): descripción [AC-XX-YY]`).
- **Gate único:** `bash scripts/check.sh --full` = build + lint + types + unit + e2e
  Playwright (móvil 390×844 **con modo offline emulado** y dashboard ≥1280) + grep
  anti-cáscaras + axe + **tests de invariantes de BD** (UPDATE de un POD cerrado debe
  fallar; INSERT de POD sin foto debe fallar; GPS (0,0) debe rebotar).
- Specs por módulo en `specs/` con `Fuente:` y ≥3 ACs verificables (gate_specs lo exige).
- **Revisión adversarial al cierre de cada hito** (pesaje, mostrador, reparto/POD,
  DTE, identidad, dashboard): datos malformados, doble-tap, red cortada a mitad de
  flujo, sesión ajena, reloj del teléfono adulterado. Hallazgos → ítems nuevos del plan.
- **UN builder por worktree**; antes de construir, verificar que no hay motor activo.
- **Los 5 tests centinela** (nacen en la semana 1):
  1. Sync duplicado: replay doble de la cola ⇒ `count(*)=1` (client_uuid UNIQUE).
  2. Foto que no sube: upload abortado ⇒ la entrega NO confirma; la cola la sube después.
  3. GPS basura: (0,0) rebota en BD; a 2 km queda flageada y visible en el dashboard.
  4. Báscula mal tipeada: 25.000 g donde iban 2.500 ⇒ outlier >3× mediana del
     cliente/producto exige re-confirmación explícita; cancelar no persiste nada.
  5. PIN compartido: usuario A en 2 dispositivos ⇒ sesión anterior desplazada + fila de
     auditoría; todo POD lleva el device_id real.

## 10. MONITOREO Y ENTREGA

- Panel HTML del loop (launchd): ítem, fase, gate verde/rojo, cuelgue por mtime >120 s +
  CPU 0. Panel de tokens contra la ventana OAuth de 5 h. Todo heurístico del panel se
  prueba contra el caso normal, no solo el raro.
- Bitácora disco-backed `docs/BITACORA.md` por ítem; `docs/HANDOFF.md` ante traspaso.
- **Evidencia exigida:** conteo de tests del gate (N/0) + capturas de los flujos dorados
  (pesar→destino, venta+cierre de caja, armado+DTE+carga, POD con foto+GPS offline→sync,
  dashboard con TCK del día).
- **Seed realista:** 1 panadería, 4 usuarios (uno por rol), 10 clientes con RUT válido,
  2 listas de precios (marraqueta $2.190/kg mostrador · $1.650/kg mayorista, hallulla,
  frica, dobladitas, integral), 1 jornada completa: 12 hornadas, 40 pesajes, 25 ventas,
  2 rutas de 8 paradas con DTE y PODs, 1 rechazo parcial, 1 devolución, mermas tipificadas.
- **DONE =** plan vacío + gate `--full` verde + camino dorado demostrado de punta a punta
  con el seed + revisión adversarial final sin hallazgos críticos + TCK del día seed
  calculable con el SQL de referencia.

---

## Anexo A — Contexto de negocio (para el planificador; no es alcance)

- Sector: ~5.500 panaderías tradicionales, >100.000 empleos, 95 % pymes; consumo 90–98
  kg/persona/año (2º del mundo tras Turquía); 70 % marraqueta, 20 % hallulla; todo por kilo.
- Gremio: **Fechipan** (federación nacional, 9 asociaciones; Indupan = Santiago).
  Piloto: 20 socios Indupan, 90 días a $9.900/mes; lista $34.900, socio $24.900/local/mes;
  20 % revenue share al gremio. (Cifras del panel GTM, verificadas 13-jul-2026.)
- Dolores que la app monetiza: merma invisible (3–6 % de la producción), kilos regalados
  en pesaje, reparto sin comprobante, devoluciones «a ojo», rendimiento por maestro sin
  medir (1 saco 25 kg → 32–35 kg de pan; la diferencia entre maestros es plata).
- Adopción del panadero de 55 años: la balanza ES la app (número gigante, un toque);
  plata visible la primera semana; fin de las discusiones de reparto (foto+GPS);
  su idioma (hallulla, frica, la yapa); adopción parcial sin castigo (día 1 solo pesaje
  y reparto; el cuaderno convive).
- Ángulo e-auto: ruta urbana corta con parada y arranque = perfil perfecto para van
  eléctrica; $140/km combustión vs $35/km EV (defaults editables, con fuente); la
  tarjeta «Tu flota» construye el caso con los datos del propio panadero y genera el
  lead calificado. La app se gana el derecho a vender la van siendo útil primero.

## Anexo B — Checklist prevuelo (cap. 14 del Elíxir)

☐ Variable norte declarada y computable (SQL de referencia en §2)
☐ Campos del negocio con ejemplos reales (§4 + seed §10) ☐ MVP cerrado con FUERA (§3)
☐ UI verificable con captura (§5) ☐ Gate único ejecutable (§9) ☐ Guardrails como código (§7)
☐ Invariantes en BD (§4) ☐ Modelo/esfuerzo por fase + OAuth-only (§8)
☐ Recarga automática de API desactivada ☐ Panel + bitácora + evidencia (§10)
☐ Un builder por worktree ☐ Specs con Fuente: y ≥3 ACs ☐ Seed es-CL realista
☐ Revisión adversarial por hito ☐ DONE definido y demostrable

## Anexo C — Addendum estructural (13-jul-2026): plataforma compartida con KiloRuta

KiloPan tiene un producto hermano: **KiloRuta** (control de flota y despacho consolidado
multi-empresa para la operadora de reparto con furgones Gecko EV48 — prompt maestro en
`PROMPT_MAESTRO_KILORUTA.md`, mismo directorio). Este addendum NO toca el alcance MVP,
la variable norte ni el filtro de alcance de KiloPan; solo fija la estructura:

- **Monorepo pnpm workspace** desde el hito 0: `packages/miga` (tokens y componentes
  táctiles del sistema de diseño), `packages/nucleo-identidad`, `packages/nucleo-pod`
  (outbox de mutaciones operativas), `packages/nucleo-dte`, `packages/nucleo-comun`
  (round_clp, valida_rut, es-CL, eventos), `packages/metodo` (guardrail, check,
  gate_specs, loop, panel); `apps/kilopan` (schema `pan`) y `apps/flota` (schema
  `flota`). DOS despliegues y DOS BD con dueños distintos; cero FK entre productos.
- **Fronteras internas de módulo en apps/kilopan** (identidad, pod, dte, comun como
  carpetas con imports unidireccionales), para que el hito de extracción posterior a su
  DONE mueva ese código a `packages/nucleo-*` SIN cambio de conducta (criterio: el gate
  de KiloPan sigue verde sin tocar sus specs).
- **Orden con UN solo motor OAuth:** KiloPan COMPLETO hasta su DONE → hito de
  extracción → apps/flota → contrato de integración. Ítems del plan con prefijo de app.
- **Reserva «reparto externo»:** feature-flag post-DONE definido en el Anexo B de
  KiloRuta (pedido KiloPan → encargo KiloRuta; el POD vuelve y cierra la TCK). No infla
  este MVP: sigue rigiendo el FUERA de §3 («toda integración no listada»).
