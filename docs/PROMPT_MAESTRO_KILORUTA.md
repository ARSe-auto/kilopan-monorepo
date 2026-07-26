# PROMPT MAESTRO — KiloRuta

**App de control de flota y despacho consolidado multi-empresa para una operadora de
reparto con furgones eléctricos Gecko EV48: turnos que llenan el día del furgón, custodia
de carga de N empresas en un mismo vehículo, entrega con prueba y liquidación que se
escribe sola.** Producto HERMANO de KiloPan sobre la misma plataforma (mismo monorepo,
mismo núcleo, mismo método); la opera la empresa de reparto, no la panadería.

Documento auto-suficiente, método «El Elíxir» (10 secciones). No hay decisiones abiertas:
donde dice «se hace X», se hace X. Si algo no está aquí ni en `specs/`, no existe.
Sintetizado el 13-jul-2026 por un panel de 3 investigadores de benchmarks + 4 expertos +
3 adversarios (47 hallazgos adversariales dirimidos; cada umbral tiene UN valor).

> **Relación con KiloPan (veredicto del panel):** ni addendum de su MVP ni repo aparte.
> Dos variables norte no caben en un plan (el filtro de alcance de KiloPan rechazaría
> legítimamente todo el dominio flota), y dos repos duplicarían el núcleo más delicado
> (POD offline-first, identidad, DTE). KiloRuta es la segunda app del monorepo, comparte
> ~50 % de su carne vía paquetes núcleo, y se construye DESPUÉS de KiloPan con el mismo
> motor único. El contrato de integración (Anexo B) es post-DONE de ambos, tras
> feature-flag. Al prompt de KiloPan solo se le suma el addendum estructural del Anexo C.

---

## 1. ROL Y PANEL

Actúas como panel permanente: **arquitecto de datos Postgres** (preside y dirime),
**diseñador de producto iOS (HIG)** especializado en operación de madrugada (03:30,
frío, guantes, apuro), **ingeniero Next.js senior** con PWA offline-first, **experto en
transporte y cumplimiento chileno** (art. 55 DL 825, Código de Comercio arts. 166 y ss.,
art. 97 N°4 CT), **auditor de seguridad** (identidad, custodia multi-empresa,
anti-falsificación de POD) y un **adversario** que intenta romper lo que los demás den
por bueno. Ante conflicto de criterios, manda el arquitecto de datos; ante duda
normativa, manda el experto en cumplimiento.

## 2. OBJETIVO ESTRATÉGICO

**Variable norte: IFD — Ingreso por Furgón-Día.** CLP devengados del día dividido por
los furgones-día operativos. Devenga SOLO lo que tiene evidencia: entrega con POD
completo × tarifa vigente de su empresa cliente, bloque furgón-turno cerrado × su tarifa
de bloque, y devolución registrada como línea propia. La **fecha** del devengo la da
`capturado_at` (reloj del teléfono, corte 23:59 — mismo reloj que la TCK de KiloPan);
`recibido_at` (servidor) manda para todo lo demás del negocio. Furgón-día operativo =
furgón con ≥1 chequeo de apertura de turno tipo madrugada/alterno ese día (evento, no
snapshot); los bloques de recarga/mantención jamás cuentan en el denominador.

```sql
-- SQL de referencia (SIEMPRE sobre liquidacion_lineas — la MISMA fuente que factura;
-- el IFD de la noche y la liquidación de la semana citan exactamente las mismas filas)
SELECT d.fecha,
       SUM(d.monto_clp)::bigint / NULLIF(COUNT(DISTINCT o.furgon_id), 0) AS ifd_clp
FROM   flota.furgon_dia_operativo o        -- vista: chequeo 'apertura' de turnos madrugada/alterno
LEFT JOIN flota.devengo_diario d USING (fecha, furgon_id)  -- vista SOBRE liquidacion_lineas,
GROUP BY d.fecha;                          -- fecha por capturado_at del POD / cierre de turno
```

- **Meta MVP:** IFD ≥ $120.000 promedio sostenido 4 semanas en el piloto de 1–2
  furgones, con ≥2 turnos devengados por furgón-día en ≥60 % de los días hábiles y
  **100 % del devengo enlazado a su evidencia** (POD o cierre de bloque) — cero líneas
  manuales.
- **Secundarias** (mismas tablas de eventos): ocupación de madrugada = bultos cargados ÷
  `capacidad_bultos` del furgón, % por salida consolidada (métrica válida SOLO en rutas
  madrugada, donde el bulto es la bandeja estándar; los bloques alternos se miden por
  ingreso de bloque); utilización de agenda = horas con bloque facturable sobre la
  ventana **03:30–19:30** (16 h) por furgón; % de entregas con POD completo al primer
  intento; $/km devengado (CLP ÷ km de odómetro entre chequeos).
- El IFD es a la vez métrica de adopción (solo sube si el responsable carga con
  manifiesto, el chofer cierra PODs y el operador vende bloques) y el argumento
  comercial: *«cada peso que entra está enlazado a una foto con GPS o a un turno
  cerrado»*.

**Filtro único de alcance:** ¿esto ayuda a que una hora facturable del furgón de HOY
quede devengada hoy con su evidencia — POD o bloque cerrado — y a que el dueño la vea
esta noche en su IFD? Si no, queda fuera.

## 3. QUÉ HACE (ALCANCE MVP — lista cerrada)

**Flujo dorado:** el operador duplica la semana y los encargos de ayer en dos gestos →
el chofer abre turno con checklist + odómetro + SOC en una pantalla → en cada punto de
carga se cuentan los bultos POR EMPRESA contra el sub-manifiesto, con foto y DTE
asociado, y la custodia nace con un PIN → el chofer entrega parada por parada con POD de
≤4 toques, 100 % offline → la ruta cierra cuando la ecuación cuadra por empresa
(cargado = entregado + devuelto + faltante declarado) → esa noche el dueño ve el IFD del
día y el viernes la liquidación semanal ya está escrita, línea por línea con su
evidencia.

Siete módulos, ninguno más:

1. **Identidad y dispositivos (núcleo KiloPan).** Usuarios con RUT validado + PIN de 4
   dígitos; roles fijos (`admin`, `operador`, `chofer`, `responsable_carga` — un chofer
   puede actuar de responsable en turnos donde va solo); dispositivos enrolados, 1 sesión
   activa concurrente por usuario, cambio de operador por PIN. Todo write lleva
   `usuario_id + dispositivo_id + hora del servidor`. **Firma puntual ≠ sesión:** firmar
   con PIN en un dispositivo ajeno (traspaso de custodia) genera solo un evento de firma
   y JAMÁS desplaza la sesión del teléfono propio. Los `pin_hash` de los usuarios del
   turno se cachean en el dispositivo enrolado para validar PIN sin señal.
2. **Empresas cliente y tarifas.** La empresa cliente es campo de primera clase (quién
   paga y liquida, separada del receptor que recibe — la ventaja del nicho que ningún
   referente trae de fábrica). Rate card de **máximo 3 conceptos activos**: `por_entrega`,
   `por_bulto`, `por_bloque` (furgón-turno dedicado), con vigencia histórica append-only,
   CLP entero con `round_clp`. Cero pantallas de configuración de workflow.
3. **Agenda del furgón: turnos y bloques.** Grilla semanal furgón × bloque con 4 tipos:
   `madrugada` / `alterno` / `recarga` / `mantencion` (recarga y mantención son agenda
   pura: reservan la ventana, sin chofer ni chequeos — la DC 20→80 % en 45 min del EV48
   hace viable el doble turno SOLO si esa ventana está en la grilla). **«Duplicar
   semana» clona los turnos reales de 7 días atrás** (no hay tabla de plantillas de
   turno: la semana real es la plantilla). Asignación directa del operador — sin turnos
   reclamables ni push. Apertura de turno en UNA pantalla: checklist fijo de **8 ítems**
   (solo en la primera apertura del día por furgón) + odómetro + SOC declarado; semáforo
   simple «Alcanza / No alcanza — recarga antes» comparando SOC vs `soc_minimo_pct` del
   turno (lo fija el operador por experiencia de sus rutas fijas; SIN motor aritmético de
   km en el MVP). Cierre de turno = solo odómetro + SOC + botón opcional «Reportar daño».
4. **Encargos.** Creación en <10 s: **3 campos digitados** (empresa cliente + destino +
   bultos; `fecha_servicio` DEFAULT hoy, editable — 4 NOT NULL en BD). Todo lo demás
   opcional. **«Duplicar encargos de ayer»** clona los de la fecha anterior (estado
   `pendiente`, sin DTE) y el operador ajusta los 2 que cambian — no hay motor de
   recurrencia. Estados: `pendiente → asignado → en_ruta → {entregado | parcial |
   no_entregado}` + `anulado` (prohibido tras POD); las transiciones intermedias las
   derivan triggers (asignar parada, ruta en curso), las finales las escribe SOLO el
   trigger de entregas. Reintento = encargo NUEVO con `reintento_de` al fallido, nace sin
   DTE y el gate se lo exige como a cualquiera (política de guía nueva o reuso explícito
   con evento `encargo.dte_reusado`, decisión auditada del operador).
5. **Carga con custodia.** El manifiesto de la ruta se compone de **sub-manifiestos por
   parada de carga**, firmados EN el punto por quien esté (responsable de carga en
   andén; el chofer en milk-run): cifra declarada vs contada POR EMPRESA en bultos
   estándar (bandeja/canasto — jamás escaneo por unidad de pan), UNA foto de la carga,
   discrepancia registrada EN EL PUNTO con el panadero presente, y **DTE asociado antes
   de abandonar ESA parada** (escaneo TED o tipo+folio+RUT manual). Un sub-manifiesto
   sin DTE se puede **«bajar del manifiesto»** (la mercadería se queda físicamente; el
   encargo vuelve a `pendiente` con flag `sin_dte` + evento + excepción del operador) —
   las otras empresas jamás quedan rehenes. El manifiesto pasa a `confirmado` al
   completar la última parada de carga, con doble firma responsable↔chofer por PIN (UNA
   firma sella ambas si son la misma persona); ninguna parada de entrega se abre sin
   manifiesto confirmado — ahí se ancla el art. 55 DL 825. El responsable puede **crear
   un encargo mínimo desde su PWA** durante la recepción (bultos que llegaron sin
   digitar: empresa + destino + bultos, offline, evento `encargo.creado_en_anden`).
   Regla física: bultos de empresas distintas NO se mezclan en el mismo espacio; la
   tarjeta de parada muestra empresa + cifra esperada.
6. **Ruta y entrega con POD (offline-first, núcleo KiloPan).** Ruta maestra recurrente
   con orden de paradas editable a mano — sin VRP. App del chofer lineal «siguiente
   parada» con UNA acción primaria: POD en ≤4 toques (foto en vivo + GPS + receptor
   precargado), **modo `dejado_en_punto` de primera clase** (a las 05:00 la mitad de los
   almacenes duerme; con bultos > umbral exige encuadre contable y queda flageada
   `entrega_sin_receptor` en la cola por revisar); no entregado = motivo de catálogo
   cerrado + foto en 2 toques; parcial admitido. 100 % offline con refresco PULL del
   snapshot en cada sync (banner «Ruta actualizada: +1 parada»; el operador ve si el
   teléfono ya la recibió). Cierre de ruta aritmético POR EMPRESA: `cargado = entregado
   + devuelto + faltante declarado`, con clasificación táctil del descuadre; la ruta no
   cierra descuadrada. Turno sin cierre → cierre forzado administrativo del operador
   (evento + datos flageados, sin alimentar la monotonicidad del odómetro).
7. **Liquidación y panel del dueño.** `flota.devengar()` (SECURITY DEFINER) corre **al
   cerrar cada entrega, devolución y bloque** (evento-driven, no batch): toda línea nace
   de exactamente UNO de (entrega, turno, devolución) con su evidencia enlazada
   (foto+GPS+receptor+folio DTE) — prohibida la línea manual o vaga («misc charges» =
   causa #1 de disputas del rubro). Liquidación semanal por empresa: `abierta → cerrada
   → pagada`; la «preliquidación» es el PDF exportado de una liquidación abierta, que el
   operador envía por su canal de siempre (fuera de la app); la disputa la registra el
   OPERADOR por línea con nota. La factura la emite el operador por su vía SII y la app
   solo registra el folio. Panel web «Hoy»: IFD del día, ocupación por salida,
   utilización 03:30–19:30, $/km, entregas OK vs excepciones, SOC declarado por furgón,
   vencimientos (revisión técnica, permiso, próximo servicio por km) y UNA bandeja viva
   de excepciones con 3 acciones (reintentar mañana / devolver / contactar).

**FUERA del MVP (explícito):** portal de consulta para empresas cliente y RLS
multi-tenant (v2 con invariante testeable: sesión de empresa A + SELECT de datos de B ⇒
0 filas por el camino HTTP + SET ROLE) · optimizador de rutas (VRP) y re-secuenciación
automática · tracking GPS continuo, torre de control en vivo y mapa de puntitos ·
notificaciones push/WhatsApp y TODO correo saliente (no existe outbox de correo; el PDF
se comparte fuera de la app) · portal/SMS/link de tracking al receptor final · pagos
integrados, cobranza y cuentas por cobrar · emisión de DTE ante el SII (solo registro;
art. 97 N°4 CT) · venta y cobro en ruta (autoventa Bimbo) · remuneraciones, asistencia y
auto-scheduler de turnos · turnos reclamables/marketplace de bloques · mantención ERP
(órdenes de trabajo, repuestos; solo 3 vencimientos en la ficha + issues con foto) ·
telemetría/OBD/OCPP, motor aritmético de rango por km y mapa de cargadores (SOC
declarado manda; telemetría OEM del EV48 vía e-auto = punto de extensión v2) · escaneo
unitario por bulto de pan · paquetería con par origen→destino arbitrario por encargo
(el retiro en punto de la empresa ya lo cubre la parada de carga; lo demás es v2 con su
primer contrato) · sello de seguridad por empresa (migración aditiva cuando un contrato
lo pida) · form-builders, campos custom y configuración de workflows · multi-bodega,
multi-flota, e-commerce y app del cliente final · gamificación y scoring de choferes ·
firma obligatoria del receptor y PIN de entrega · correlativo interno de encargo con
maquinaria de folio (identificador de presentación derivado en vista; el único folio del
sistema es el del SII).

## 4. MODELO DE DATOS (Postgres, schema `flota` — canónico, resuelve el panel)

**Unidades duras (idénticas a KiloPan):** dinero = **CLP `integer`** con
`flota.round_clp()`; la unidad de ocupación y custodia = **bulto `integer`** (bandeja /
canasto / paquete estándar) `CHECK (bultos BETWEEN 1 AND 500)`; timestamps `timestamptz`;
el reloj del **servidor** (`recibido_at`) manda para negocio, el del teléfono
(`capturado_at`) fecha el devengo diario y se guarda para diagnóstico. es-CL en toda UI.

**REGLA DE ORO — dos clases de invariante (resuelve offline vs candados):**
- **Invariantes de PLANIFICACIÓN** (solapes de agenda, tarifas, liquidación, estados de
  documentos): se validan online y REBOTAN con RAISE.
- **CAPTURAS de hechos operativos** (chequeos, manifiesto_items, entregas, devoluciones):
  el mundo físico ya ocurrió — **JAMÁS rebotan al sincronizar**. El trigger degrada la
  violación a flag (`apertura_bajo_soc`, `odometro_inconsistente`, `gps_fuera_de_zona`,
  `entrega_sin_receptor`) + evento + cola «Por revisar» del operador. La validación
  bloqueante corre en el CLIENTE contra el snapshot del turno. El outbox drena en orden:
  apertura → manifiesto → PODs/devoluciones → cierre (las FK existen al insertar).

- **usuarios** — id uuid PK, nombre, rut UNIQUE CHECK `flota.valida_rut(rut)` (módulo
  11), rol CHECK IN ('admin','operador','chofer','responsable_carga'), pin_hash (4
  dígitos, bcrypt), clave_hash (solo admin/operador web), activo.
- **dispositivos** — id uuid PK, nombre, secreto_hash (token emitido una vez; en cliente
  vive en IndexedDB — garantía menor que Keychain, declarada), enrolado_por FK,
  enrolado_at, revocado_at (jamás DELETE). *(Reuso KiloPan idéntico.)*
- **sesiones_operador** — dispositivo_id FK, usuario_id FK, inicio, fin, `EXCLUDE USING
  gist (dispositivo_id WITH =, tstzrange(inicio,fin) WITH &&)`; sesión nueva en otro
  dispositivo desplaza la anterior con auditoría; auto-bloqueo a PIN 10 min. Las
  sesiones capturadas offline llevan client_uuid y se regularizan al sync; la identidad
  de un write se evalúa a `capturado_at` contra la sesión local. **Las firmas puntuales
  (PIN en dispositivo ajeno) NO abren sesión ni desplazan nada** — solo dejan evento.
- **empresas_cliente** — id uuid PK, rut UNIQUE CHECK valida_rut, razon_social NOT NULL,
  tipo_servicio CHECK IN ('madrugada','alterno','ambos'), direccion_retiro NOT NULL,
  lat/lng numeric(9,6) NULL CHECK rango Chile si no-nulos, contacto_nombre,
  contacto_fono, activo.
- **tarifas** — empresa_cliente_id FK, concepto CHECK IN
  ('por_entrega','por_bulto','por_bloque'), precio_clp int CHECK (>0), vigente_desde
  date, PK (empresa_cliente_id, concepto, vigente_desde). **Append-only:** UPDATE de
  precio ⇒ RAISE; cambio = fila nueva. Máximo 3 conceptos activos por empresa.
- **destinos** — id uuid PK, nombre NOT NULL, direccion NOT NULL, lat/lng NULL CHECK
  Chile, contacto_nombre NULL (precarga el POD), contacto_fono NULL, notas_acceso NULL
  («portón lateral; abren 06:30»), activo. Creación inline desde el encargo.
- **furgones** — id uuid PK, patente UNIQUE, modelo DEFAULT 'Gecko EV48',
  capacidad_bultos int NOT NULL (denominador ÚNICO del % de ocupación),
  capacidad_carga_gramos int DEFAULT 1375000 (dato de ficha), bateria_wh int DEFAULT
  41860, odometro_km int NOT NULL DEFAULT 0, soc_pct int CHECK (0–100) — **odometro_km
  y soc_pct SOLO los mantiene el trigger de chequeos_turno desde el último chequeo
  VIGENTE** (`REVOKE UPDATE`) —, revision_tecnica_vence date NULL,
  permiso_circulacion_vence date NULL, proximo_servicio_km int NULL, activo.
- **turnos** — id uuid PK, furgon_id FK NOT NULL, tipo CHECK IN
  ('madrugada','alterno','recarga','mantencion'), chofer_id FK NULL (obligatorio recién
  para ABRIR), responsable_carga_id FK NULL (trigger valida rol; puede ser el chofer),
  empresa_cliente_id FK NULL (solo bloque alterno dedicado), inicio/fin CHECK (fin >
  inicio), `EXCLUDE USING gist (furgon_id WITH =, tstzrange(inicio,fin) WITH &&) WHERE
  (estado <> 'anulado')` e ídem por chofer — **el WHERE permite anular y reemplazar; el
  gate testea que el reemplazo idéntico pasa** —, soc_minimo_pct int NULL (0–100,
  advertencia de planificación, jamás candado), estado CHECK IN
  ('planificado','abierto','cerrado','anulado') solo hacia adelante; recarga/mantención
  solo `planificado/anulado` (agenda pura, sin chofer ni chequeos), identidad.
  «Duplicar semana» = función que clona los turnos reales de 7 días atrás.
- **rutas_maestras / ruta_maestra_paradas** — nombre UNIQUE, activo; paradas con orden
  UNIQUE, tipo CHECK IN ('carga','entrega'), `CHECK ((tipo='carga') =
  (empresa_cliente_id IS NOT NULL) AND (tipo='entrega') = (destino_id IS NOT NULL))`.
- **encargos** — id uuid PK, client_uuid UNIQUE (idempotencia), empresa_cliente_id FK
  NOT NULL, destino_id FK NOT NULL, fecha_servicio date NOT NULL DEFAULT hoy, bultos int
  NOT NULL CHECK (1–500), referencia text NULL (folio interno del cliente), notas NULL,
  documento_tributario_id FK NULL (exigido en el sub-manifiesto, no al digitar),
  detalle_externo jsonb NULL (payload íntegro de la IDA KiloPan: líneas
  producto+gramos, correlativos de bulto, ventana — de aquí deriva la VUELTA sus
  gramos), estado CHECK con la máquina del módulo 4 (`REVOKE UPDATE(estado)`; intermedias
  por triggers, finales solo el trigger de entregas, anulado prohibido tras POD),
  reintento_de FK encargos NULL, parada_carga_id FK NULL, parada_entrega_id FK NULL,
  flag sin_dte bool DEFAULT false, identidad, creado_at.
- **motivos_no_entrega** — codigo PK ('local_cerrado','rechaza_pedido','direccion_mala',
  'sin_acceso','mercaderia_danada','otro'), descripcion, activo (se apaga, jamás DELETE).
- **rutas** — id uuid PK, turno_id FK UNIQUE NOT NULL (trigger: tipo madrugada/alterno),
  ruta_maestra_id FK NULL, estado CHECK IN ('armada','cargando','en_curso','cerrada')
  solo hacia adelante; `cerrada` exige cierre_ruta cuadrado (trigger), identidad.
- **paradas** — ruta_id FK, orden, UNIQUE(ruta_id, orden), tipo CHECK IN
  ('carga','entrega') con los CHECKs de ruta_maestra_paradas, estado CHECK IN
  ('pendiente','en_sitio','completada','fallida') solo adelante, llegada_at NULL.
  **Trigger art. 55: ninguna parada 'entrega' pasa a `en_sitio` sin manifiesto
  `confirmado`.** Una parada 'entrega' agrupa N encargos de N empresas al mismo destino
  (el caso normal del pan consolidado, como primera clase).
- **manifiestos** — id uuid PK, ruta_id FK UNIQUE NOT NULL, responsable_carga_id FK
  NULL, chofer_id FK NULL (reasignable con evento mientras `abierto`), estado CHECK IN
  ('abierto','confirmado'), firmado_responsable_at NULL, firmado_chofer_at NULL (cada
  firma = PIN + evento; **si responsable = chofer, UNA firma sella ambos timestamps**),
  `CHECK (estado <> 'confirmado' OR (chofer_id IS NOT NULL AND firmado_responsable_at
  IS NOT NULL AND firmado_chofer_at IS NOT NULL))`. Se confirma al completar la última
  parada 'carga'.
- **manifiesto_items** (sub-manifiesto) — id uuid PK, client_uuid UNIQUE, manifiesto_id
  FK, parada_id FK (tipo 'carga'), encargo_id FK UNIQUE (un encargo sube UNA vez; el
  reintento es encargo nuevo), bultos_declarados int NOT NULL CHECK (>0) (snapshot),
  bultos_cargados int NOT NULL CHECK (>=0), motivo_discrepancia text NULL
  `CHECK ((bultos_cargados <> bultos_declarados) = (motivo_discrepancia IS NOT NULL))`,
  estado CHECK IN ('a_bordo','retirado') — **«bajar del manifiesto» = 'retirado' +
  encargo a `pendiente` con sin_dte + evento; el gate DTE se evalúa SOLO sobre los
  'a_bordo'** —, foto_sha256 NULL, capturado_at, recibido_at, identidad. Trigger: ningún
  item queda 'a_bordo' al confirmar si su encargo no tiene documento_tributario_id.
- **entregas** (POD — canónica ÚNICA, núcleo KiloPan) — id uuid PK, client_uuid UNIQUE,
  encargo_id FK NOT NULL, `UNIQUE (encargo_id) WHERE cerrada AND supersede_id IS NULL`,
  supersede_id FK NULL, resultado CHECK IN ('total','parcial','rechazo'),
  bultos_entregados int NOT NULL CHECK (>=0) — trigger cruzado con manifiesto_items:
  total ⇒ = bultos_cargados; parcial ⇒ menor; rechazo ⇒ 0 —, motivo_id FK NULL
  `CHECK ((resultado IN ('parcial','rechazo')) = (motivo_id IS NOT NULL))`, modo CHECK
  IN ('receptor','dejado_en_punto') — *'dejado_en_punto' es ENTREGA efectuada sin
  receptor; 'local_cerrado' existe solo como motivo de NO-entrega* —, receptor_nombre
  NULL `CHECK ((modo='receptor') = (receptor_nombre IS NOT NULL))` (precargado; sin
  RUT del receptor), firma_png NULL (opcional), foto_sha256 NOT NULL, foto_estado CHECK
  IN ('pendiente_subida','subida'), lat/lng NOT NULL CHECK rango Chile ((0,0) rebota),
  precision_m NOT NULL (>100 m ⇒ flag, no bloquea), gps_fuera_de_zona bool (>300 m ⇒
  flag, no bloquea), entrega_sin_receptor bool (dejado_en_punto con bultos >
  `parametros.bultos_max_sin_receptor` ⇒ flag + cola), capturado_at, recibido_at,
  identidad, cerrada bool. **GPS denegado bloquea en el cliente y lo dice; precisión
  mala jamás bloquea (el pan no espera).**
- **devoluciones** — id uuid PK, client_uuid UNIQUE, encargo_id FK NOT NULL, bultos int
  CHECK (>0), motivo_id FK NOT NULL, foto_sha256 NULL, capturado_at, recibido_at,
  identidad. Trigger conservación: bultos_entregados + SUM(devoluciones) ≤
  bultos_cargados del item.
- **cierres_ruta / cierre_ruta_empresas** — cierre 1:1 con ruta; por empresa:
  bultos_cargados/entregados/devueltos/faltantes NOT NULL CHECK (>=0),
  `CHECK (bultos_cargados = bultos_entregados + bultos_devueltos + bultos_faltantes)`,
  `CHECK ((bultos_faltantes > 0) = (motivo_faltante IS NOT NULL))`. Los cuatro números
  los calcula la función de cierre (SECURITY DEFINER) sumando items, PODs y
  devoluciones — la app jamás los escribe.
- **chequeos_turno** — id uuid PK, client_uuid UNIQUE, turno_id FK, momento CHECK IN
  ('apertura','cierre'), UNIQUE(turno_id, momento) entre vigentes, supersede_id FK NULL
  (**corrección del operador = fila nueva; el trigger recalcula odómetro/SOC del furgón
  desde el último chequeo VIGENTE**), odometro_km int NOT NULL — monotónico vs vigente:
  online rebota, al sync degrada a flag `odometro_inconsistente` —, soc_pct int NOT NULL
  CHECK (0–100), checklist_version text NULL, respuestas jsonb NULL `CHECK ((momento =
  'apertura' Y primera del día) = (respuestas IS NOT NULL))` (checklist fijo de 8 ítems
  versionado EN CÓDIGO, con severidad por ítem: bloqueantes frenos/luces/neumáticos;
  cosméticos solo issue), apto bool derivado, origen CHECK IN
  ('operativo','administrativo') (cierre forzado del operador = 'administrativo', datos
  flageados, sin monotonicidad), capturado_at, recibido_at, identidad. **Abrir con SOC <
  soc_minimo o con ítem bloqueante fallado NUNCA exige admin: UN toque de confirmación
  del chofer + evento (`apertura_bajo_soc`/`apertura_con_falla`) + cola del operador.**
  `bloqueante` real de furgón lo marca SOLO el operador (issue).
- **issues_furgon** — furgon_id FK, chequeo_id FK NULL, descripcion, foto_sha256 NULL,
  bloqueante bool DEFAULT false (**solo lo setea el operador**), abierto_at,
  resuelto_at/por NULL, identidad.
- **documento_tributario** — IDÉNTICO a KiloPan: tipo_dte CHECK IN (33,39,52,61),
  folio_sii, rut_emisor CHECK valida_rut, rut_receptor NULL, fecha_emision, montos int
  (si neto+iva no-nulos ⇒ = total con round_clp), origen_captura ('ted_scan','manual'),
  ted_xml NULL, ind_traslado NULL, estado ('registrado','anulado'), `UNIQUE (tipo_dte,
  folio_sii, rut_emisor)`, identidad. *Sin ciclo de emisión: no somos emisores.*
- **liquidaciones** — id uuid PK, empresa_cliente_id FK, periodo_desde/hasta CHECK,
  `EXCLUDE USING gist (empresa_cliente_id WITH =, daterange(desde,hasta,'[]') WITH &&)`
  (ciclo semanal por convención), estado CHECK IN ('abierta','cerrada','pagada') solo
  adelante — inmutable (cabecera y líneas) desde 'cerrada'; 'pagada' solo escribe
  pagada_at + evento —, total_clp int (lo suma trigger con round_clp),
  documento_tributario_id FK NULL (la factura registrada), identidad.
- **liquidacion_lineas** — id uuid PK, liquidacion_id FK, entrega_id FK UNIQUE NULL,
  turno_id FK UNIQUE NULL, devolucion_id FK UNIQUE NULL, **CHECK: exactamente UNO de
  (entrega_id, turno_id, devolucion_id) NOT NULL** — toda línea nace de un evento con
  evidencia; NO existen líneas manuales —, tipo CHECK IN
  ('entrega','entrega_parcial','no_entrega','devolucion','bloque_turno') con CHECKs de
  correspondencia, concepto_tarifa CHECK IN ('por_entrega','por_bulto','por_bloque'),
  precio_clp int (snapshot vigente a fecha_servicio), cantidad int CHECK (>=0),
  monto_clp int `CHECK (monto_clp = flota.round_clp(cantidad * precio_clp))`, estado
  CHECK IN ('conforme','disputada') DEFAULT 'conforme', nota_disputa NULL
  `CHECK ((estado='disputada') = (nota_disputa IS NOT NULL))` (la registra el OPERADOR).
  Líneas SOLO vía `flota.devengar()` (SECURITY DEFINER), que corre al cerrar cada
  entrega/devolución/bloque; parciales y no-entregas entran como líneas visibles (monto
  0 o proporcional).
- **eventos** — append-only (`REVOKE UPDATE/DELETE` + trigger): tipo
  ('encargo.creado_en_anden','manifiesto.item_retirado','manifiesto.chofer_reasignado',
  'apertura_bajo_soc','turno.cierre_forzado','encargo.dte_reusado',
  'liquidacion.cerrada','liquidacion.pagada',…), entidad, entidad_id, payload jsonb,
  identidad, at. Los 3 momentos legales de la custodia (recepción, traspaso, entrega/
  devolución) y toda autorización excepcional quedan como hechos inmutables.
- **parametros** — clave PK, valor, editable por admin; defaults con fuente:
  `bultos_max_sin_receptor=6`. (Las capacidades viven SOLO en furgones; sin parámetros
  EV en el MVP — el semáforo es soc_pct vs soc_minimo_pct del turno.)

**Invariantes EN LA BD (el gate las testea intentando violarlas):** POD inmutable una
vez `cerrada` (corrección = supersede; segundo POD de otro dispositivo rebota 409 vía
client_uuid) · foto write-once (bucket sin DELETE) · máquina de estados del encargo con
finales solo-por-trigger · sin DTE no hay item `a_bordo` al confirmar (por
sub-manifiesto, con vía «bajar») · ninguna entrega sin manifiesto confirmado · doble
firma (o una si misma persona) para confirmar · discrepancia visible o no existe ·
un encargo sube una vez · ecuación de custodia o la ruta no cierra · conservación de
bultos · EXCLUDE de agenda con `WHERE estado <> 'anulado'` · odómetro monotónico con
supersede y degradación a flag al sync · liquidación sin líneas vagas (XOR triple,
UNIQUE por evidencia, round_clp, total por trigger, inmutable desde cerrada) · tarifas
append-only · DTE UNIQUE (tipo, folio, emisor) y jamás emitido · CLP/bultos enteros ·
RUT módulo 11 · lat/lng Chile · identidad con sesión viva en toda escritura operativa ·
capturas jamás rebotan al sync (degradan a flag + cola) · escrituras privilegiadas SOLO
vía SECURITY DEFINER, probadas por el camino HTTP + SET ROLE real.

**Offline (chofer Y responsable de carga — delta declarado sobre KiloPan, donde offline
es solo reparto):** el núcleo se extrae generalizado como **outbox de mutaciones
operativas** (POD + manifiesto_items + chequeos + devoluciones + encargo_de_anden), con
los tests centinela viajando al paquete: replay doble de CUALQUIER mutación ⇒
`count(*)=1`. Snapshot del turno a IndexedDB (Dexie) al abrir; `POST /api/sync` con
`INSERT … ON CONFLICT (client_uuid) DO NOTHING`; foto multipart verificada por sha256;
refresco PULL del delta de ruta en cada sync.

## 5. INTERFAZ (verificable con captura; si no puede fallar, no entra)

- **PWA instalable móvil-primero** (390×844) para chofer y responsable de carga +
  **dashboard web escritorio** (≥1280 px, maestro-detalle, drag & drop SOLO aquí).
  Referencia: HIG de Apple. Solo modo claro en el MVP.
- **Sistema de diseño «Miga» reusado ÍNTEGRO de KiloPan** (tokens en UN archivo): system
  font stack, escala con cifra operativa 96/700, `tabular-nums` en TODA cifra (test que
  falla si falta), grilla 8 px, radio 12 px, targets ≥44×44 pt, teclado numérico PROPIO
  (teclas ≥64 px, coma es-CL), botón primario full-width 56 px anclado abajo, undo 8 s
  en vez de modales (ÚNICA modal permitida: confirmar manifiesto incompleto), ningún
  estado solo por color. Acento único de KiloRuta: `#1D4ED8` (ruta); ok `#15803D`,
  alerta `#B45309`, error `#B91C1C`. es-CL: `$12.500`, `dd-mm-aaaa`, RUT
  `12.345.678-5`; grep de gate: cero strings visibles en inglés.
- **Flujos del CHOFER** (manos con guantes, 03:30, cero hover/long-press/drag):
  - **FC1 Abrir turno** ≤4 toques + 2 cifras: «Mi turno de hoy» ya lo espera (chip con
    su nombre siempre visible) → checklist 8 ítems «Todo conforme» en un toque (falla =
    toque en ítem + foto → issue; bloqueante solo alerta y exige SU confirmación
    auditada, jamás un admin a las 03:40) → odómetro 96 px → SOC % → semáforo «Alcanza /
    No alcanza — recarga antes» (texto, nunca solo color) → «Confirmar». Todo offline.
  - **FC2 Cargar en punto (milk-run) / revisar carga (andén)** ≤2 toques por empresa:
    en cada parada 'carga' el sub-manifiesto de ESA empresa: cifra declarada 96 px →
    «Conforme» o ajuste con teclado propio (discrepancia ámbar EN el punto) → foto →
    DTE por escaneo TED (linterna a 48 px del pulgar, beep+vibración) o tipo+folio+RUT
    manual → sin DTE: «Bajar de la carga» (la mercadería se queda; excepción al
    operador). Última carga completada → firma(s) por PIN → «Salir a repartir».
  - **FC3 Entregar (POD)** ≤4 toques: tarjeta de parada activa (N empresas agrupadas,
    cifra esperada POR empresa visible) → «Entregar» → obturador (GPS+hora+identidad
    solos) → receptor precargado editable → «Confirmar» → tarjeta cierra con undo 8 s y
    la siguiente sube sola. Variante «Dejado en punto» 3 toques (encuadre contable
    guiado si bultos > umbral). Variante parcial: cifra + motivo. Offline: «Entregada —
    por sincronizar» con nube tachada.
  - **FC4 No entregado** ≤4 toques: «No pude entregar» → motivo de catálogo → foto →
    «Confirmar» → ámbar, bultos quedan a bordo en la ecuación, cae EN VIVO a Excepciones.
  - **FC5 Cerrar turno** ≤3 toques + 2 cifras: ecuación por empresa YA calculada →
    odómetro fin → SOC fin (ámbar si no alcanza el próximo bloque del furgón: «Conecta a
    cargar — 14:00 necesita 60 %») → «Reportar daño» opcional → «Cerrar». **El chofer ve
    SOLO km, bultos y SOC — jamás CLP** (regla de rol, testeada).
- **Flujos del RESPONSABLE DE CARGA** (andén, dispositivo compartido, PIN ≤3 s):
  - **FR1 Recibir por empresa** ≤4 toques por empresa: igual a FC2 (mismo componente de
    sub-manifiesto) + **«Encargo nuevo» mínimo desde la recepción** (bultos sin digitar:
    empresa + destino + bultos, offline). Su PIN inicia la custodia legal (C. de
    Comercio art. 166: depositario desde la recepción).
  - **FR2 Cargar el furgón:** contador N/M en 96 px, check 44 pt por bulto/empresa;
    regla física: empresas no se mezclan en el mismo espacio. «Cerrar carga» exige 100 %
    o la única modal auditada.
  - **FR3 Traspaso al chofer** ≤2 toques + PIN del chofer: resumen con discrepancias
    ámbar PRIMERO → el chofer teclea SU PIN (firma puntual: NO desplaza su sesión) →
    evento `custodia_chofer` → «Listo para salir» en el tablero.
  - **FR4 Devoluciones y cierre** ≤4 toques por empresa con descuadre: cifra devuelta →
    foto → ecuación en 96 px → clasificar descuadre en un toque (catálogo) → «Cerrar
    ruta» → undo 8 s. La liquidación se deriva ÍNTEGRA de aquí, cero re-digitación.
- **Flujos del OPERADOR/DUEÑO (web):**
  - **FO1 Encargo rápido** ≤10 s: formulario mínimo SIEMPRE visible: empresa
    (autocompleta) + destino (autocompleta/inline) + bultos → ⏎ y foco listo para el
    siguiente (captura en cadena); fecha DEFAULT hoy; opcionales colapsados bajo «Más».
    Botón «Duplicar encargos de ayer».
  - **FO2 Armar ruta** 1 clic plantilla + 1 drag por encargo: tablero del día
    furgón×turno, columna «Sin asignar», «Aplicar ruta maestra» trae el orden fijo,
    encargos a la misma dirección se agrupan solos mezclando empresas; % de ocupación
    vivo (bultos vs capacidad del EV48). Asignar a ruta en curso muestra «entregado al
    teléfono: sí/no» (refresco pull).
  - **FO3 Excepciones** ≤2 clics: UNA lista viva (no torre de control): motivo + foto →
    tres acciones: «Reintentar mañana» (duplica con historia) / «Devolver» / «Contactar»
    (muestra el teléfono).
  - **FO4 Semana** 1 clic duplicar + 2 clics por asignación: grilla furgón×día, 4 tipos
    de bloque; «Duplicar semana anterior» clona los turnos REALES; validación de
    contigüidad en ámbar (SOC esperado vs mínimo del siguiente). Sin auto-scheduler,
    sin turnos reclamables, sin push.
  - **FO5 Liquidación** ≤3 clics al PDF: empresa + semana → preliquidación YA generada;
    cada línea abre su evidencia (foto+GPS+receptor+DTE); disputa por línea con nota
    (la registra el operador); «Cerrar y exportar PDF» + registrar folio de la factura;
    después «Marcar pagada».
  - **FO6 Hoy** 0 clics (es el home): tarjeta por furgón — ingreso del día, ocupación
    madrugada, entregas OK/excepciones, SOC con semáforo del próximo bloque, turno en
    curso, vencimientos — y la fila de totales con el IFD.
- **Estados obligatorios** de todo listado: vacío accionable / skeleton / error con
  reintentar / **sin conexión con contador real de cola** («Sin conexión — N registros
  por subir» ámbar → «Sincronizado hace Xs» verde).
- **AA medible en el gate:** contraste ≥4.5:1 (axe), cero targets <44 pt (test DOM),
  foco visible, FC1/FC3/FR1 completables con VoiceOver, texto 200 % sin truncar cifras,
  cero aria-label vacíos (grep).

## 6. BENCHMARKS (patrón a extraer, no pantalla a clonar)

| Referente | Patrón | Aplica en |
|---|---|---|
| Onfleet | encargo mínimo = destino + receptor; todo lo demás opcional | FO1, modelo encargos |
| SimpliRoute / Beetrack-DispatchTrack (CL) | estados con 'parcial'; no-entrega = estado + motivo estructurado de catálogo; pila de tarjetas del driver | FC3/FC4, motivos, Mi ruta |
| Amazon Flex / Uber Eats Driver | flujo lineal «siguiente parada», UNA acción primaria, botón 56 px, avanza solo | FC3 |
| Circuit / Routific / Track-POD | offline-first total: ruta cacheada, POD sin señal, sync solo | núcleo outbox |
| OptimoRoute | reintento = duplicar el encargo fallido a mañana conservando historia | FO3 |
| Samsara DVIR 2.0 / Motive | inspección = elegir vehículo → checklist → defecto con foto → veredicto → firmar, offline; SIN hardware OBD | FC1, chequeos_turno |
| Connecteam / Sling | «duplicar semana anterior» como EL gesto de planificación | FO4 |
| Amazon Flex / GoShare / Frayt | el furgón-turno (bloque de horas a precio fijo) como unidad de venta de los horarios alternos | turnos, tarifas por_bloque |
| Bimbo DSD | reconciliación diaria de ruta: cargado = entregado + devuelto (+ faltante); la devolución es estructural, no excepción | FR4, cierres_ruta |
| Liquidación 3PL / trucking statements | toda línea itemizada y enlazada a su evidencia POD; los «misc charges» son la causa #1 de disputas | FO5, liquidacion_lineas |

De los grandes **no copiar**: optimizador VRP (hasta Circuit produce «rutas enredadas»;
nuestras rutas son fijas), torre de control en vivo, ETA por ML, portal del receptor,
form-builders y configuración enterprise (Bringg: implementaciones de 3-6 meses — el
antipatrón completo), telemática con hardware y contratos de 3 años prepagados
(Samsara/Motive: US$27-45/vehículo/mes que esta app reemplaza con SOC declarado).
Ninguna app del benchmark trata la consolidación multi-empresa como primera clase — esa
es la ventaja del nicho. Cada patrón adoptado se declara en el plan con
adoptar/adaptar/descartar y su porqué; la spec resultante lleva `Fuente:` y ≥3 ACs.

## 7. RESTRICCIONES Y PROHIBICIONES (guardrails como código; violarlas aborta el ítem)

- `guardrail.sh` antes de cada iteración: `DATABASE_URL` SOLO localhost (exit ≠ 0
  aborta) · secretos SOLO en `.env.local` gitignored · grep bloqueante en `src/`:
  `TODO|FIXME|PLACEHOLDER|not implemented|lorem ipsum`.
- **La app JAMÁS emite documentos tributarios** ni genera PDF/número con apariencia de
  DTE (art. 97 N°4 CT); solo registra folios del SII. No existe correlativo interno con
  maquinaria de folio.
- **Sin DTE asociado no hay mercadería a bordo** (art. 55 DL 825): gate por
  sub-manifiesto al confirmar, con la vía «bajar del manifiesto» — jamás un bloqueo que
  deje a las demás empresas rehenes, jamás un override silencioso.
- **POD inmutable y foto write-once**; corrección = supersede; **capturas de hechos
  operativos JAMÁS rebotan al sincronizar** — degradan a flag + evento + cola «Por
  revisar» (la validación bloqueante vive en el cliente).
- **CLP enteros y bultos enteros calculados por la BD** — la UI jamás reimplementa
  reglas ni redondeos. El devengo tiene UNA fuente (`flota.devengar()`).
- **El chofer jamás ve CLP** (regla de rol testeada); las firmas puntuales por PIN no
  abren sesión; todo write operativo exige identidad con sesión viva.
- **Jamás migración destructiva** ni `db:reset` sobre datos con evidencia (fotos POD,
  manifiestos firmados).
- **Jamás API de pago:** motor OAuth-only; ventana agotada ⇒ ESPERA. Recarga automática
  de créditos desactivada en consola ANTES del primer ciclo autónomo.
- Cámara solo vía `getUserMedia` in-app; PDF417 del TED con zxing-js como mejora
  progresiva y **captura manual como camino primario en iOS** (AC probado en iPhone
  real). Sin push, sin WhatsApp, sin correo saliente (no existe outbox de correo).

## 8. MODELO Y ESFUERZO

- **plan → Sonnet · verify → Sonnet** (leen mucho, deciden poco).
- **build → ruteo por tag del planificador:** `[security]` (PIN, sesiones, firmas
  puntuales, custodia, SECURITY DEFINER) y `[datos]` (esquema, triggers, ecuación de
  cierre, sync offline, devengo) → **Opus**; `[HIG]` (pulido táctil, estados) →
  **Haiku**; resto → **Sonnet**. **Juez del verify → Opus** con mandato de refutar.
- **Escalación de dos strikes:** 2 fallos del gate en el mismo AC ⇒ subir un nivel y
  reintentar UNA vez; tercer fallo ⇒ el ítem vuelve a plan con nota en bitácora.
- El selector de modelo es un script y **se testea contra el caso normal** (el no-op
  que todo lo manda a Opus quema la ventana en silencio — pasó en e-auto).
- Vía de costo: exclusivamente la ventana OAuth de la suscripción; costo marginal cero.

## 9. PROCESO

- **Monorepo pnpm workspace** (Anexo C): `packages/miga` (tokens + componentes
  táctiles), `packages/nucleo-identidad`, `packages/nucleo-pod` (generalizado como
  outbox de mutaciones operativas), `packages/nucleo-dte`, `packages/nucleo-comun`
  (round_clp, valida_rut, es-CL, eventos), `packages/metodo` (guardrail, check,
  gate_specs, loop, panel); `apps/kilopan` (schema `pan`) y `apps/flota` (schema
  `flota`). **DOS despliegues, DOS BD, cero FK entre productos** — la frontera es solo
  la API del Anexo B.
- **Orden de construcción con UN solo motor OAuth (regla dura):**
  0. Este prompt (listo — costo cero de ventana).
  1. Hito 0: esqueleto del monorepo + `packages/metodo` + `packages/miga` con su test
     tabular-nums. Nada de dominio.
  2. **KiloPan COMPLETO hasta su DONE** (es el producto vendido que financia todo), con
     fronteras de módulo limpias pero SIN extraer paquetes aún.
  3. **Hito de extracción** (refactor sin cambio de conducta, `[datos]`→Opus): mover
     identidad/POD-outbox/DTE/comun a `packages/nucleo-*` con los tests centinela
     viajando al paquete; criterio = gate de KiloPan sigue verde sin tocar sus specs;
     limpiar todo supuesto panadero del núcleo.
  4. **apps/flota** contra ESTE prompt, por hitos: (a) schema + identidad/turnos
     `[security][datos]`; (b) empresas/tarifas/encargos; (c) manifiesto y custodia
     multi-empresa; (d) ruta + POD del chofer (reuso nucleo-pod); (e) chequeos/SOC/
     agenda; (f) devengo y liquidación `[datos]`; (g) panel «Hoy» + excepciones.
  5. **Contrato de integración (Anexo B) al FINAL**, con ambos DONE, tras feature-flag.
- Loop **plan → build → verify** sobre `IMPLEMENTATION_PLAN.md` vivo; ítems con prefijo
  de app; el verify asume que el builder miente. **Un AC por commit** con su test
  (`feat(flota/modulo): descripción [AC-XX-YY]`). Gate por-app como default; gate raíz
  (ambas apps + suite de contrato) cuando el diff toca `packages/` y al cierre de hito.
- **Gate único por app:** `bash scripts/check.sh --full` = build + lint + types + unit +
  e2e Playwright (móvil 390×844 **con modo offline emulado** y web ≥1280) + grep
  anti-cáscaras + axe + **tests de invariantes de BD** (violar cada invariante del §4 y
  esperar el rebote — o el flag, según su clase).
- **Los 5 tests centinela de KiloRuta** (nacen en la semana 1 de apps/flota):
  1. Replay doble de la cola (manifiesto_item Y POD) ⇒ `count(*)=1` por client_uuid.
  2. Sync de una captura que viola planificación (SOC bajo el mínimo, odómetro menor)
     ⇒ NO rebota: fila insertada + flag + aparece en la cola «Por revisar».
  3. Firma por PIN del chofer en el dispositivo del responsable ⇒ NO desplaza la sesión
     del teléfono del chofer; sus PODs posteriores sincronizan válidos.
  4. Cierre de ruta con ecuación descuadrada ⇒ RAISE; faltante > 0 sin motivo ⇒ RAISE;
     con motivo ⇒ cierra y el descuadre aparece atribuido por empresa.
  5. Anular un turno e insertar el reemplazo idéntico ⇒ pasa; el solape real ⇒ rebota
     (EXCLUDE con WHERE estado <> 'anulado').
- Specs por módulo en `specs/` con `Fuente:` y ≥3 ACs verificables. **Revisión
  adversarial al cierre de cada hito** (identidad/turnos, custodia, POD, devengo):
  datos malformados, doble-tap, red cortada a mitad de flujo, PIN ajeno, reloj
  adulterado, empresa A intentando ver/devengar lo de B. Hallazgos → ítems del plan.
- **UN builder por worktree**; antes de construir, verificar que no hay motor activo.

## 10. MONITOREO Y ENTREGA

- Panel HTML del loop (launchd): ítem, fase, gate verde/rojo, cuelgue por mtime >120 s +
  CPU 0. Panel de tokens contra la ventana OAuth de 5 h. Todo heurístico del panel se
  prueba contra el caso normal.
- Bitácora disco-backed `docs/BITACORA.md` por ítem; `docs/HANDOFF.md` ante traspaso.
- **Evidencia exigida:** conteo de tests del gate (N/0) + capturas de los flujos
  dorados (abrir turno con SOC bajo confirmado, recepción con discrepancia y DTE,
  «bajar del manifiesto», POD offline→sync, dejado_en_punto con encuadre, ecuación de
  cierre con descuadre clasificado, liquidación con línea disputada y PDF, panel «Hoy»
  con IFD del día).
- **Seed realista:** 2 furgones EV48 (capacidad_bultos 90), 5 usuarios (admin, operador,
  2 choferes — uno también responsable —, 1 responsable), 4 panaderías cliente
  (tarifa por_bulto $1.200 / por_entrega $2.800) + 1 farmacia (bloque alterno $45.000) +
  1 distribuidora (por_entrega $3.500), 25 destinos con RUT/direcciones es-CL, 1 semana
  de turnos con ventanas de recarga, 2 rutas de madrugada consolidadas (12 y 9 paradas,
  3-4 empresas por ruta) con manifiestos firmados y DTEs, 1 bloque alterno cerrado,
  1 no-entrega con motivo, 1 parcial, 1 devolución, 1 descuadre clasificado, 1 encargo
  creado en andén, 1 reintento, 1 liquidación semanal cerrada con folio de factura y
  1 pagada. IFD del día seed calculable con el SQL de referencia.
- **DONE =** plan vacío + gate `--full` verde + camino dorado demostrado de punta a
  punta con el seed + revisión adversarial final sin hallazgos críticos + IFD del día
  seed = suma de sus liquidacion_lineas ÷ furgones operativos, verificado a mano.

---

## Anexo A — Contexto de negocio (para el planificador; no es alcance)

- **La empresa:** operadora de reparto propia con furgones eléctricos **Gecko EV48**
  (ficha verificada 13-jul-2026: batería CATL LFP 41,86 kWh, carga útil 1.375 kg
  — distribuidor publica 1.440 —, 6,2 m³, motor 60 kW, 6,2 km/kWh según 3CV Chile,
  305 km CLTC ⇒ **185-245 km reales con carga** — JAMÁS planificar con el folleto —,
  DC 20→80 % en 45 min ⇒ ~150 km repuestos entre turnos; AC nocturna en base como
  método primario). El doble/triple turno es físicamente viable SOLO con la ventana de
  recarga agendada — por eso la recarga es un tipo de bloque de la grilla.
- **Servicio madrugada (~03:30–08:00):** reparto de pan POR CUENTA de varias panaderías
  a la vez, rutas fijas consolidadas — un furgón lleva pedidos de N panaderías hacia
  sus clientes (almacenes, minimarkets, casinos). Sin dedicación exclusiva: la
  ocupación del furgón es la métrica de la madrugada.
- **Servicios alternos (día/tarde):** bloques furgón-turno vendidos a otras empresas
  (farmacia, distribución local), devengados por bloque; encargos por-entrega también
  posibles con el mismo mecanismo de ruta (carga en el punto de la empresa → entregas
  con POD).
- **El riesgo que la app administra:** mercadería de N empresas en un solo furgón. La
  responsabilidad del porteador nace con la RECEPCIÓN (C. de Comercio arts. 166 y ss.,
  custodio como depositario, presunción de responsabilidad por pérdida) y cada partida
  viaja con su DTE (art. 55 DL 825: multa 10 %–200 % de 1 UTA y retención del vehículo).
  El manifiesto digital con sub-manifiestos firmados ES la carta de porte; quien tiene
  los 4 documentos (manifiesto, POD, foto, timestamp) gana la disputa.
- **Por qué existe espacio:** Samsara/Motive cuestan US$27-45/vehículo/mes + hardware +
  contratos de 3 años prepagados; Onfleet cobra el multi-marca a US$2.999/mes; ninguno
  trae la consolidación multi-empresa ni el furgón-turno como unidad de venta. Para 1-5
  furgones, esta app ES la diferencia entre operar con cuaderno o con evidencia.
- **Sinergia e-auto/KiloPan:** e-auto vende el EV48 (la flota es la vitrina rodante);
  KiloPan genera la demanda (panaderías que ya pesan y despachan con datos) y esta app
  la sirve; las panaderías KiloPan que externalicen reparto se conectan por el contrato
  del Anexo B y su TCK se cierra sola. El trío software-servicio-van se refuerza:
  KiloPan vende la van con datos del panadero; KiloRuta vende el servicio con la van.

## Anexo B — Contrato de integración KiloPan ↔ KiloRuta (post-DONE de ambos, feature-flag)

*Se construye al FINAL, con ambos productos DONE; ningún MVP depende de él. KiloRuta es
autosuficiente: la empresa que no usa KiloPan opera igual (el responsable asocia el DTE
en la recepción — camino primario, no excepción).*

1. **IDA (pedido → encargo):** KiloPan marca un pedido confirmado como «reparto
   externo» (feature-flag post-DONE) y lo encola en un outbox HTTP server-side (tabla
   `flota_outbox`, reintento infinito con backoff, jamás fetch desde la UI). `POST
   /api/v1/encargos` con: `client_uuid` (el del pedido KiloPan — idempotencia extremo a
   extremo), RUT/razón social de la panadería (= empresa_cliente), destino (RUT,
   dirección, lat/lng, contacto para precargar el POD), bultos, referencia del DTE ya
   asociado (tipo+folio+rut_emisor, ted_xml opcional) y `detalle_externo` (líneas
   producto+gramos enteros, correlativos de bulto, ventana del pedido — se persiste
   ÍNTEGRO en `encargos.detalle_externo`). KiloRuta hace `INSERT … ON CONFLICT
   (client_uuid) DO NOTHING` y responde 200 con el recurso: replay infinito sin
   duplicar. Encargo sin DTE se acepta `pendiente` con flag `sin_dte` (no cargable);
   KiloPan puede completarlo vía `PUT /api/v1/encargos/{client_uuid}` mientras no esté
   a bordo (cada update = evento).
2. **VUELTA (POD → KiloPan):** al cerrar el POD, el outbox de KiloRuta dispara `POST
   {webhook_panaderia}/webhooks/flota/pod` firmado con HMAC del secreto del convenio:
   client_uuid del POD y del encargo original, `bultos_entregados` **+ gramos derivados
   de `detalle_externo`** (100 % si resultado='total'; proporcional a
   bultos_entregados/bultos_cargados si 'parcial'; 0 si 'rechazo' — regla única del
   contrato), receptor, lat/lng+precision+flags, motivo mapeado con la **tabla fija
   motivos_no_entrega(flota) → motivo_rechazo(KiloPan)**, capturado_at/recibido_at,
   sha256 de la foto + URL firmada temporal. KiloPan recibe idempotente, transiciona su
   pedido por su propia máquina de estados y acredita `g_pod_ok` en su TCK esa noche.
3. **Convenio y autenticación:** token bearer por empresa cliente (hash en BD,
   revocable, jamás DELETE) + secreto HMAC para el webhook; sin SSO, los usuarios NO se
   comparten entre productos. Ni precios/ventas/TCK de la panadería viajan a KiloRuta,
   ni tarifas de KiloRuta a KiloPan — superficie mínima.
4. **Suite de contrato en el gate raíz:** replay doble en ambos sentidos ⇒ 1 fila;
   encargo sin DTE no cargable; webhook con HMAC inválido rebota; mapeo de motivos
   total (cero motivos sin destino).

## Anexo C — Addendum estructural al PROMPT_MAESTRO de KiloPan (lo único que se le suma)

Texto a anexar al prompt de KiloPan (NO toca su alcance MVP ni su variable norte):
layout de monorepo pnpm (`packages/miga|nucleo-identidad|nucleo-pod|nucleo-dte|
nucleo-comun|metodo`, `apps/kilopan`, `apps/flota`); fronteras internas de módulo
(identidad, pod, dte, comun como carpetas con imports unidireccionales) para la
extracción del hito 3 SIN cambio de conducta; y la reserva: «reparto externo» =
feature-flag post-DONE definido en el Anexo B de KiloRuta — no infla este MVP. Un solo
motor OAuth para todo el monorepo; ítems del plan con prefijo de app.

## Anexo D — Checklist prevuelo (cap. 14 del Elíxir)

☐ Variable norte declarada y computable (SQL §2 sobre liquidacion_lineas)
☐ Campos del negocio con ejemplos reales (§4 + seed §10) ☐ MVP cerrado con FUERA (§3)
☐ UI verificable con captura y AC de toques (§5) ☐ Gate único ejecutable por app (§9)
☐ Guardrails como código (§7) ☐ Invariantes en BD con sus DOS clases (§4)
☐ Modelo/esfuerzo por fase + OAuth-only (§8) ☐ Recarga automática de API desactivada
☐ Panel + bitácora + evidencia (§10) ☐ Un builder por worktree ☐ Specs con Fuente: y ≥3 ACs
☐ Seed es-CL realista ☐ Revisión adversarial por hito ☐ DONE definido y demostrable
☐ Orden de construcción respetado: KiloPan DONE → extracción → flota → contrato
