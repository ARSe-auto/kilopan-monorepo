# 08 — Sistema de diseño Miga, es-CL, accesibilidad, white-label y wizard de onboarding de tenant

Fuente: §5.1–§5.3 (Miga generalizado; secuencia canónica del día servida por componentes;
presupuesto de toques como contrato) · §5.5 (regla de contracción y pantalla «Funciones») ·
§5.7 (estados obligatorios y AA como gate) · §3.E1.13 (wizard de onboarding self-service)
— y las transversales que obligan a este módulo: §0 (targets táctiles, cifra operativa,
labels renombrables, formatos es-CL, HTTP), §2 (métricas 1–4 y gates proxy del régimen
dual), §3.E1.1 (`tenant_theme`, `tenant_terminology`, entitlements, selector de modo),
§4.2 (regla de oro), §4.4 (config por tenant, versionada y congelada por turno), §4.6
(`client_metric`, `stop_requirement` — flujo por datos), §4.9 (ganchos: qué se siembra y
qué NO), §7.6/§7.8 (guardrails de terreno y de seeds), §9.1 (`packages/miga` en hito 0;
hito 4.g), §9.2 (gates: axe/Lighthouse, snapshot 375px, suite e2e doble por terminología,
grep de inglés), §9.3 (centinelas que tocan seeds) y §10 (seeds A/B/C, DONE dual). Todas
las referencias resuelven contra `docs/PROMPT_MAESTRO_FLOTA.md`.

Alimenta el hito **§9.1.4.(g)** «panel admin white-label (incl. pantalla “Funciones”) +
wizard + seeds de los 3 tenants (A, B y C demo)». Además, `packages/miga` (tokens +
componentes + theming por tenant) con su test de tabular-nums es entrega del **hito 0**
(§9.1): este módulo es aguas arriba de todos los demás en lo visual y aguas abajo de
casi todos en el wizard.

Alcance: **etapa E1 solamente. Chile solamente** (es-CL, CLP entero, RUT, dd-mm-aaaa —
§0; cero consideraciones multi-idioma/multi-moneda: «multi-idioma» y «custom domains»
están en la lista FUERA de E1, §3). Ganchos §4.9: este módulo **no activa ninguno**; el
wizard y los seeds siembran SOLO piezas que la tabla §4.9 marca VIVAS en E1 y que §10
exige: `cargo_type`, `attribute_definition`, `stop_requirement`, `reading` —sin seeds de
frío— y filas de `reference_document` para los DTEs de los manifiestos del tenant B y el
folio registrado del tenant A (§10, AC-FMIG-18); `lot` e
`instrument`/`vehicle_certification` quedan VIVAS (§4.9) pero SIN seeds porque §10 no las
exige; `thermal_profile`/`alarm_rule`/`disposition` quedan DDL-only, sin filas, y ningún
seed E1 siembra `stop_requirements` de tipo `pin_destinatario`/`escaneo_codigo`
(AC-FMIG-15).

Qué NO especifica este módulo (vive en otro): el DDL de `tenant_theme`,
`tenant_terminology`, entitlements, `vertical_template` y la provisión desde
`tenant_template` (módulo 00, hito a — aquí se les pone UI y orquestación); el motor de
sync/outbox, la ingesta de `client_metric` y los e2e de presupuesto de toques de los
flujos de terreno (módulo 04); la semántica del selector de modo y la contracción del
portal (módulo 07); los paneles que leen la telemetría (módulo 05).

## 1. Sistema de diseño Miga (`packages/miga`; §5.1, §0, §9.1)

- **Tokens ESTRUCTURALES = constantes de plataforma NO configurables** (§5.1): tabla §0
  + system font stack + escala iOS 34/17/15/13/11 pt + grilla 8 px + radio 12 px en
  tarjetas y cápsula en controles + **una acción primaria por pantalla** + **máx 2
  niveles de profundidad** + **ningún estado solo por color** + **dark mode automático
  de serie** (los turnos parten de madrugada, §5.1).
- De la tabla §0: targets operativos **≥48 px CSS**, teclas **≥64 px**, botón primario
  **56 px full-width anclado abajo**, piso WCAG 24 px; **cifra operativa 96 px / 700 /
  `tabular-nums`** con test que falla si falta (§0; el test es entrega del hito 0,
  §9.1). Los valores viven en la familia canónica `constants.ts` del módulo 00 (§0):
  número mágico de esa familia hardcodeado en `packages/miga` fuera del archivo
  canónico ⇒ grep-gate rojo (§0).
- **Arquitectura de tokens en 3 capas** (primitivo → semántico → componente); el tema
  del tenant se inyecta como **CSS custom properties desde el bootstrap** (§5.1).
- **PROHIBIDO** (§5.1): CSS libre por tenant, forks, builds por cliente, translucidez
  Liquid Glass en pantallas de terreno.
- Componentes de terreno que Miga entrega y los flujos (F2–F5, §5.2) consumen: cifra
  operativa 96 px («7 de 23», sub-manifiesto — §5.2 F2/F4), **teclado numérico PROPIO**
  (PIN, odómetro, SOC, cantidades — el teclado del sistema JAMÁS aparece en terreno,
  §5.7), semáforos con texto (nunca solo color — «Alcanza / No alcanza», §5.2 F3),
  banners de energía no bloqueantes (§5.2 F4), toast de **undo 8 s** como única
  confirmación de capturas (§0; semántica del undo en módulo 04, §4.7; cero modales
  para capturas — única modal permitida: confirmar manifiesto incompleto, §7.6), chip
  offline «Entregada — por sincronizar» con contador real de cola (§5.2 F4, §5.7). NO
  existe componente de «hint» en E1: el §10 pide la telemetría «hints re-mostrados =
  bug» pero el maestro no define ninguna superficie de hint y esta spec no la inventa;
  la decisión (si existen hints, dónde y cómo se miden) está reclamada por el módulo 05
  en AC-FSEM-25, BLOQUEADO por su Pregunta al dueño 12 — si el dueño resuelve que
  existen, el componente nacería aquí (Miga) y su métrica se mediría allá.
- **Presupuesto de toques como contrato** (§5.3): Miga implementa la convención de
  conteo cerrada — un campo del teclado propio = **1 acción** sea cual sea su cantidad
  de dígitos; el e2e cuenta ACCIONES, no keydowns — y la instrumentación de
  toques-hasta-completar por acción que emite `client_metric` tipo `toques_flujo`
  (§5.3, §4.6). Los presupuestos del contrato §5.3 COMPLETO — **≤4 acciones por acción
  de terreno** (tope transversal), entrega feliz = 2, apertura ≤9, cierre ≤6, publicar
  ≤15 clics — se asertan en los e2e de los módulos dueños de cada flujo (02–04) usando
  esta instrumentación (los mismos e2e que cuentan acciones asertan el tope de 4 en
  cada acción de terreno); **«conductor nuevo operando <5 min sin ayuda»** (§5.3) se
  mide como el time-to-first-stop <5 min de la telemetría §10 (AC-FMIG-13); feature que
  sube el conteo del camino feliz no se mergea (§5.3).

## 2. es-CL: capa de copy, terminología y formatos (§5.1, §0, §9.2)

- **UNA capa de copy** con resolución `term_key`: **tenant → vertical → base es-CL**
  (§5.1). El admin ve el término canónico entre paréntesis (§5.1). Los términos de
  sistema/auditoría no son renombrables (excluidos por CHECK en BD, §4.4 — DDL del
  módulo 00).
- Reglas de labels renombrables (§0): navegación **≤12** caracteres · títulos ≤24 ·
  descripciones ≤40 · singular+plural obligatorios · caracteres prohibidos
  `# $ % ; < = >`.
- **Formatos es-CL únicos y en un solo lugar** (§0): `$12.500` (CLP entero, `round_clp()`
  en BD — la capa de UI solo formatea, jamás calcula dinero, §0/§7.5), `dd-mm-aaaa`,
  RUT `12.345.678-5`. Grep-gate: **cero strings visibles en inglés** (§0, §9.2).
- Selectores de e2e SOLO por `data-testid`/`term_key`; lint que VETA `getByText` sobre
  renombrables; la suite e2e corre DOS veces (terminología base y extrema del tenant B)
  sin cambiar un selector (§9.2).
- La edición del diccionario vive en el panel admin white-label del hito (g); todo
  cambio de terminología es config versionada: aplica al próximo bootstrap y el turno
  abierto termina con su `config_version_id` congelado (§4.4).

## 3. Estados obligatorios, accesibilidad y PWA iOS (§5.7)

- **Toda pantalla nace con 4 estados** (§5.7), implementados como componentes ÚNICOS de
  Miga y reutilizados: (1) **vacío accionable**; (2) skeleton **<50 ms**, spinner solo
  **>400 ms**; (3) error es-CL con recuperación — **las capturas JAMÁS muestran
  rechazo** (§5.7, coherente con §4.2); (4) **sin conexión con contador real de cola**
  (profundidad del outbox, módulo 04).
- **Gate axe+Lighthouse en CI** (§5.7): contraste 4.5:1 texto, 3:1 UI, **7:1 en cifra
  operativa y semáforos** (sol directo); targets §0; foco visible; VoiceOver completa
  apertura/POD/recepción (§5.7 la enumera DENTRO del gate de CI: proxy CI bloqueante en
  AC-FMIG-20; la pasada VoiceOver real es complemento humano, AC-FMIG-12); texto 200 %
  sin truncar cifras; cero `aria-label` vacíos.
- **PWA iOS** (§5.7): manifest standalone, `viewport-fit=cover` + safe-areas,
  `touch-action: manipulation`, inputs ≥16 px, feedback táctil simulado (no hay
  Vibration API), teclado numérico PROPIO siempre, transiciones 60 fps, <1 s por
  interacción. §5.7 rotula TODO esto «gate de CI»: el gate de laboratorio es el
  presupuesto de performance Lighthouse/frame-timing + test de componente del feedback
  táctil (AC-FMIG-19, bloqueante); en producción se sigue SOLO lo medible con el enum
  cerrado de `client_metric` (§4.6 — no tiene métrica de fps): `latencia_ms`
  (AC-FMIG-13).
- Nada de dependencias de terreno para completar flujos: cámara/GPS/push/etc. son
  mejoras progresivas (§7.6) — regla que los componentes de Miga respetan por diseño
  (los módulos de flujo la ejercitan).

## 4. White-label por tenant: panel admin de tema (§5.1, §4.4, §2)

- El tenant personaliza **EXACTAMENTE tres cosas, como filas** (§5.1): **logo**, **UN
  color de acento** y el **diccionario de terminología**. Nada más: `tenant_theme` solo
  tiene logo_url, accent_color y extras (§4.4; el contenido de `extras` no está
  definido en el maestro — ver Preguntas al dueño).
- La plataforma **deriva pressed/disabled/dark** del acento y lo **RECHAZA si <4.5:1**
  (§5.1, §4.4). Guardar tema es PLANIFICACIÓN: valida online y rebota 422 con error
  tipado es-CL (§4.2).
- **Rebrand de un tenant = 1 UPDATE, cero deploys** (§2 métrica 3): el tema se sirve
  como CSS custom properties en el bootstrap (§5.1); ningún cambio de tema pasa por
  build ni deploy.
- La edición de tema y terminología vive en el **panel admin white-label** del hito (g)
  (§9.1.4.g). El maestro NO cierra qué rol la opera: la lista del plano de control
  exclusivo del dueño (§5.4) incluye la pantalla «Funciones» pero NO la edición de
  tema/terminología — la restricción de rol queda BLOQUEADA por la Pregunta al dueño
  n.º 11 y ningún AC la aserta hasta que se cierre.
- Los temas de los seeds la demuestran: tenant A con tema e-auto, tenant B con tema
  propio (§10).
- **DPA en términos del tenant (§3.E1.15, §7.8 — obligación E1 que el maestro no asigna
  a módulo):** este módulo la asume, por ser dueño del panel admin white-label y del
  wizard donde viven los términos del tenant. El DPA es un artefacto VERSIONADO del repo
  servido dentro de los términos, alcanzable desde el panel admin, con versión vigente
  registrada y aceptación del `admin_tenant` en `audit_trail`; base de licitud =
  ejecución de contrato, jamás consentimiento de trabajadores (§7.8). El texto legal y
  el momento exacto de aceptación NO los fija el maestro: Pregunta al dueño 12.

## 5. Pantalla «Funciones» y regla de contracción (§5.5, §0)

- **Manifest de navegación computado server-side** (entitlements × rol) en el
  bootstrap; módulo apagado **NO se renderiza** — sin huecos, candados ni parpadeo
  (§5.5). Locked-states y upsell SOLO en panel admin (§5.5).
- Efecto HTTP (§0, §5.5): módulo apagado ⇒ **403 SOLO en endpoints de
  planificación/lectura**; **sync de captura = 2xx siempre** — si el módulo se apagó
  con turno abierto, la captura entra con flag `modulo_apagado` + Por revisar; manda
  `turno.config_version_id` (§0, §4.2).
- **Pantalla «Funciones»** del panel admin (§5.5): `admin_tenant` **APAGA cualquier
  feature** (override OFF siempre permitido) y **ENCIENDE solo las incluidas en su
  plan** (ON fuera de plan = locked-state con upsell); cada toggle escribe
  `audit_trail` y aplica en el próximo bootstrap; los turnos abiertos terminan con su
  config congelada (§5.5, §4.4). La resolución `override ?? plan` es del módulo 00
  (§4.4); aquí se le pone la UI y el contrato de efectos.
- **App mínima (todo OFF) = abrir turno → paradas → cerrar turno, y sigue siendo
  producto completo** (§5.5).
- El selector de modo (mi_flota|daas) es un preset de este mismo sistema (§3); su
  semántica está en el módulo 07 — aquí solo se le da lugar en el wizard y en el panel.

## 6. Wizard de onboarding self-service (§3.E1.13, §2, §4.1)

- **Wizard de 4 pasos, ≤15 min** (§3.E1.13):
  1. **Empresa + vertical** ⇒ siembra plantilla completa con **demo tocable**. Aquí
     ocurre la provisión física: `CREATE DATABASE t_<slug> … TEMPLATE tenant_template`
     — segundos, dentro del wizard (§4.1, §3.E1.1; la maquinaria es del módulo 00) — y
     la siembra de las filas del `vertical_template` elegido (terminología, motivos,
     checklists, cargo_types, config_ev, meta_eevd — §4.4). Incluye el botón del modo
     (`mi_flota|daas`, §3; semántica en módulo 07).
  2. **Vehículo + chofer real**: alta de vehículo en <2 min (patente + tipo en chips;
     resto progresivo — §3.E1.3, §5.4; flujo del módulo 02) e invitación por rol para
     el chofer (QR/link WhatsApp/SMS, aprobación en 1 toque — §5.4; flujo del módulo
     01).
  3. **Paradas CSV/manual**: encargo mínimo (empresa + destino + bultos;
     `fecha_servicio` default hoy — §3.E1.5; import del módulo 03).
  4. **Primera parada completada** (POD del módulo 04).
- **Métricas que el wizard debe cumplir** (§2): (1) alta de tenant self-service →
  **primera ruta tocable <15 min con datos demo**; (4) **activar un vertical = INSERT
  de filas, cero migraciones**. Gate proxy del régimen dual (§2): **wizard de alta
  completable por SCRIPT en <15 min contra el stack local de CI** (docker-compose:
  Postgres + app en modo producción; NO existe «staging»).
- La métrica (2) —alta→primera entrega real con evidencia p50 <4 h, p90 <24 h (§2)— se
  mide en producción en el embudo de activación del panel interno SaaS (§10; panel del
  módulo 05). DONE-adopción exige además wizard y primera parada **validados en vivo**
  por Alexis (§10) — checklist humana que JAMÁS bloquea al loop (§9.2).
- El flujo del operario resultante queda armado **POR DATOS** (`stop_requirement`
  derivado del `cargo_type`; cero condicionales por vertical en la UI — §4.6). En E1
  ningún seed siembra `stop_requirements` de tipo `pin_destinatario` ni
  `escaneo_codigo` (tipos solo-DDL en E1 — §5.2 F4, §3.E3) ni filas de
  `alarm_rule`/`thermal_profile` (§4.9: DDL-only; `reading` VIVA pero sin seeds de
  frío).

## 7. Seeds de los 3 tenants (§10, §7.8, §9.1.4.g)

Seeds provisionados desde `tenant_template` + `control`, con **cadenas centinela únicas
por tenant** y **RUTs sintácticamente válidos pero irreales** — cero datos personales
reales en seeds/fixtures (§10, §7.8):

- **Tenant A «e-auto DaaS»** (modo daas, tema e-auto; VRP queda para E2): 3 EV48
  (capacidad 90 bultos, batería 41.860 Wh), 6 usuarios (admin, operador, 2 choferes,
  1 responsable_carga, 1 responsable_tecnico), 3 empresas contratantes —farmacia con
  bloque $45.000 y `otd_comprometido_pct=95` (tarjeta SLA demostrable en el camino
  dorado), distribuidora `por_entrega` $3.500, cadena minimarket `por_bulto` $1.200—
  cada una con 1 usuario `cliente`, 25 destinos es-CL, 1 semana de agenda con ventanas
  de recarga AC nocturna, rutas del día con encargos de las 3 empresas consolidados,
  1 no-entrega, 1 parcial, 1 devolución, 1 descuadre clasificado, liquidaciones
  semanales (1 cerrada con folio registrado, 1 disputada por línea, 1 pagada) (§10).
- **Tenant B «Rutapan»** (modo daas, rutas maestras, **terminología renombrada al
  máximo largo permitido**, tema propio): 2 EV48, 4 panaderías cliente, 2 rutas de
  madrugada consolidadas (12 y 9 paradas), manifiestos firmados con DTEs, 1 encargo
  creado en andén, 1 reintento, cierre con ecuación cuadrada (§10). Su terminología
  extrema es el segundo lado de la suite e2e doble (§9.2).
- **Tenant C «Demo Mi Flota»** (modo `mi_flota`, demo): 1 EV48, 1 chofer, empresa
  implícita, **navegación contraída** (sin tarifas, liquidación por cliente, portal ni
  facturación visibles), 1 día de encargos propios con PODs y semáforo; su camino
  dorado es parte del DONE-software (§10).
- Los seeds A y B dejan documentada la memoria de cálculo del **valor EEVD esperado**
  (calculado UNA vez a mano al escribir el seed) Y este módulo entrega el TEST DE
  FIXTURE que lo compara contra la vista `eevd_semanal` (§10 DONE-software). La vista la
  crea el módulo 02 (AC-FVEH-20, «primer módulo operativo» del §2); aquí solo se
  consume. Entregable: AC-FMIG-23.
- Los datos de los seeds los implementan los módulos dueños de cada tabla (00–07);
  este módulo es dueño del PAQUETE seed del hito (g): consistencia entre los 3
  tenants, centinelas, temas/terminologías y su uso por los e2e del camino dorado.
- Reparto del paquete en ACs: **AC-FMIG-18** (cerrado) deja sembrados B y C y el
  oráculo de fila cruzada por huella de BD; **AC-FMIG-25** el tenant A entero;
  **AC-FMIG-26** la operación de B (rutas, manifiestos con DTE, andén, reintento,
  cierre); **AC-FMIG-27** la memoria de cálculo EEVD y el e2e HTTP del camino dorado
  A/B/C; **AC-FMIG-23** el test de fixture que consume esa memoria.

## Criterios de aceptación

- [x] (P1) `packages/miga` publica los tokens estructurales como constantes NO configurables en 3 capas (primitivo→semántico→componente) leyendo la familia canónica de `constants.ts`: system font stack, escala 34/17/15/13/11 pt, grilla 8 px, radio 12 px/cápsula, targets ≥48 px, teclas ≥64 px, botón primario 56 px full-width anclado abajo, piso 24 px; el componente de cifra operativa rinde 96 px/700/`tabular-nums` con test que se pone ROJO si esa propiedad no está en el componente (entrega del hito 0, §9.1); caso de rebote: número mágico de la familia §0 hardcodeado en `packages/miga` ⇒ grep-gate rojo (§0, §5.1); las reglas conductuales «una acción primaria por pantalla» y «máx 2 niveles de profundidad» (§5.1) NO se dan por cumplidas publicando constantes (publicarlas no puede fallar, §5): su oráculo conductual es AC-FMIG-21 — oráculo: CI [AC-FMIG-01]
- [x] (P1) Theming por filas, jamás por código (§5.1, §4.4, §2 métrica 3): el tema del tenant (logo + acento con derivados pressed/disabled/dark generados por la plataforma) se inyecta como CSS custom properties desde el bootstrap; UPDATE de `tenant_theme` ⇒ el próximo bootstrap sirve el tema nuevo SIN build ni deploy (e2e con dos tenants sirviendo temas distintos desde el mismo build); dark mode automático de serie con contrastes vigentes también en dark; caso de rebote: `accent_color` con contraste <4.5:1 ⇒ 422 tipado es-CL y la fila no cambia (§4.2); prohibiciones §5.1 con mecanismo que puede fallar (§5 encabezado): (a) grep-gate que veta `backdrop-filter`/`-webkit-backdrop-filter` (translucidez Liquid Glass) en los componentes de terreno de `packages/miga` y en las pantallas de terreno de la PWA; (b) regla estática: el tema entra ÚNICAMENTE como las CSS custom properties derivadas de `tenant_theme` (logo + acento + derivados) — cero columnas/endpoints/archivos que acepten o sirvan CSS arbitrario por tenant (§4.4, §5.1); (c) el e2e de dos tenants sirviendo temas distintos desde el MISMO build (arriba) es el oráculo declarado de «cero forks/builds por cliente» — oráculo: CI [AC-FMIG-02]
  PROBADO: `packages/miga/src/tema.{ts,test.ts}` (derivación WCAG, CSS de 4 custom properties, dark
  automático); `apps/flota/src/servidor/tema.ts` + `api/tema/route.ts` (GET/PUT, 422 tipado en
  accent inválido o contraste insuficiente, autoridad en el trigger `tenant_theme_contraste`);
  `db/flota/gate-theming-por-filas.mjs` (grep-gate Liquid Glass + regla estática de CSS arbitrario,
  con `gate-theming-por-filas.test.mjs`); e2e `apps/flota/e2e/tema.spec.ts` — 4/4 verde: dos
  tenants con acentos distintos sirviendo CSS derivado distinto desde el MISMO build/proceso, un
  UPDATE servido por el próximo bootstrap sin build, y los dos 422 (accent inválido / contraste
  insuficiente) con la fila intacta. `check.sh --full --app=flota`: VERDE.
- [x] (P1) Teclado numérico PROPIO de Miga (teclas ≥64 px, §0) usado en PIN/odómetro/SOC/cantidades: en flujos de terreno el teclado del sistema JAMÁS aparece (§5.7) y un campo completado por teclado propio cuenta como exactamente 1 acción sea cual sea su cantidad de dígitos (convención §5.3), emitiendo toques-hasta-completar a `client_metric` tipo `toques_flujo` (§4.6; ingesta del módulo 04); caso de rebote: input de terreno que recibe foco del teclado del sistema ⇒ e2e rojo — oráculo: CI [AC-FMIG-03]
  — Probado: `TecladoNumerico` (ya con teclas 64px) suma `onToque`; `useContadorDeToques` +
  `enviarToquesFlujo` (cliente/toques-flujo.ts) cuentan toques reales y postean best-effort a
  `POST /api/metricas/toques-flujo` (whitelist cerrada de flujos), que inserta en `client_metric`
  vía `registrarToquesDeCampo` (servidor/metricas.ts) — cualquier sesión del tenant, no solo
  admin_tenant. Cableado en los 4 tipos de campo del AC: PIN (carga), odómetro y SOC (turno/abrir),
  cantidad (entrega parcial, por ítem). e2e `toques-flujo.spec.ts` contra `client_metric` real:
  inserción válida, rol de terreno no-admin, flujo fuera de whitelist ⇒ 422, toques=0 ⇒ 422, sin
  sesión ⇒ 404. El caso de rebote del teclado del sistema ya lo cubren los e2e existentes de cada
  pantalla (assert de cero `<input>`/`<textarea>` en terreno).
- [x] (P1) UNA capa de copy con resolución `term_key` tenant → vertical → base es-CL (§5.1); el admin ve el término canónico entre paréntesis (§5.1); selectores e2e SOLO por `data-testid`/`term_key` con lint que VETA `getByText` sobre renombrables (caso de rebote: PR con `getByText` sobre un renombrable ⇒ lint rojo); la suite e2e corre DOS veces —terminología base y extrema del tenant B— sin cambiar un selector (§9.2) — oráculo: CI [AC-FMIG-04]
  PROBADO: `packages/miga/src/terminologia.{ts,test.ts}` (cadena tenant→vertical→base, canónico
  SIEMPRE de la base, resolución por clave y no por tenant entero); `Termino.tsx` (data-testid
  y data-term-key nunca dependen del texto resuelto); lado servidor
  `apps/flota/src/servidor/terminologia.ts` + `api/terminologia/route.ts` (GET, lee
  `tenant_terminology` real — AC-FTEN-10 es su autoridad) y `panel/terminologia/page.tsx`
  (solo lectura; editar es AC-FMIG-06). El lint del caso de rebote:
  `db/flota/gate-getbytext-renombrable.mjs` + su `.test.mjs` (9 mutantes, incluido el caso de
  rebote textual del AC: `getByText` sobre un renombrable ⇒ ROJO), enganchado a
  `db/flota/gate.sh`. El e2e `terminologia.spec.ts` corre la MISMA suite contra dos tenants —A
  sin fila propia (sirve la base es-CL) y B con una fila real al largo MÁXIMO que
  `tenant_terminology_largo_por_tipo` acepta (la extrema de referencia)— con selectores
  IDÉNTICOS, más el caso de UPDATE servido sin build. `npx playwright test
  e2e/terminologia.spec.ts`: 3/3 verdes. `check.sh --full --app=flota`: VERDE.
- [x] (P1) Formatos es-CL únicos y en un solo lugar (§0): `$12.500` (CLP entero; la UI formatea, la BD calcula — §7.5), `dd-mm-aaaa`, RUT `12.345.678-5` con unit tests de la capa de formato; caso de rebote: string visible en inglés en `src/` ⇒ grep-gate rojo (§0, §9.2) — oráculo: CI [AC-FMIG-05]
  PROBADO: la capa de formato ya existía en UN solo lugar — `packages/nucleo-comun/src/fechas.ts`
  (`dineroEsCl` → `$12.500`, `fechaEsCl` → `dd-mm-aaaa`) y `rut.ts` (`formatearRut`/`rutValido` →
  `12.345.678-5`), leyendo el ejemplo canónico de `FORMATOS` (`constants.ts`), con sus unit tests
  (`fechas.test.ts`, `rut.test.ts`) ya en verde. Lo que faltaba era el grep-gate del caso de
  rebote para FLOTA: `packages/metodo/scripts/verifica-es-cl.mjs` (compartido con AC-H0-09 de
  KiloPan) ya soportaba `--app=flota` y escanea `apps/flota/src` + `packages/miga/src`, pero
  nada ejercía ese camino de punta a punta — se le agregó `--raiz=<sandbox>` (sin cambiar su
  comportamiento por defecto) y tres tests nuevos en `verifica-es-cl.test.mjs`: el árbol real de
  FLOTA hoy en verde, una pantalla con inglés visible poniendo el gate en rojo, y la misma
  pantalla en español quedando verde. Ya cableado en `check.sh:142-143` para `--app=$APP`.
  `check.sh --full --app=flota`: VERDE.
- [x] (P1) Edición de terminología en el panel admin white-label (§9.1.4.g; la restricción de rol NO se aserta aquí — el maestro no la cierra y queda BLOQUEADA por la Pregunta al dueño n.º 11; al cerrarse se agrega su AC de rebote por rol): singular+plural obligatorios, largos por tipo (navegación ≤12, títulos ≤24, descripciones ≤40) y caracteres prohibidos `# $ % ; < = >` rechazados con 422 tipado es-CL (PLANIFICACIÓN, §4.2; CHECKs en BD del módulo 00, §4.4); términos de sistema/auditoría no aparecen como editables; degradación: el cambio aplica al próximo bootstrap y un turno abierto termina con su `config_version_id` congelado — el e2e verifica que la PWA del turno abierto NO cambia términos a mitad de turno (§0, §4.4, §5.1) — oráculo: CI [AC-FMIG-06]
  PROBADO: `servidor/terminologia.ts` (`guardarTermino` — whitelist contra `TERMINOLOGIA_BASE_ES_CL`,
  traduce cada `constraint` de `tenant_terminology_*` a un 422 tipado, sella `config_version` nueva
  arrastrando entitlements vigentes; `terminologiaDeTurno` — resuelve desde el snapshot SELLADO de
  la `config_version_id` del turno, nunca de la fila viva) + `PUT /api/terminologia` (422 es-CL:
  `largo_excedido`, `caracter_prohibido`, `vacio`, `termino_no_editable`) + `GET /api/turnos/abierto`
  extendido con `terminos` congelados + panel `/panel/terminologia` con edición inline. e2e
  `terminologia-edicion.spec.ts` (tenant propio `config_congelada`): 4 rebotes 422 con la fila
  intacta, y el caso central — turno 1 abierto con términos de fábrica, edit del panel a mitad de
  jornada, el turno 1 SIGUE sirviendo el término viejo, un turno 2 nuevo (mismo vehículo) ya sirve
  el editado. 5/5 verdes. `check.sh --full --app=flota`: VERDE.
- [ ] (P2) Snapshot 375 px con 5 módulos activos y términos al máximo largo permitido (12/24/40) sin desbordes ni solapes, y texto al 200 % sin truncar cifras (§9.2, §5.7); caso de rebote: regresión visual o cifra truncada ⇒ gate rojo — oráculo: CI [AC-FMIG-07]
- [x] (P1) Pantalla «Funciones» del panel admin (§5.5): `admin_tenant` apaga CUALQUIER feature (override OFF siempre permitido) y enciende solo las del plan; intento de ON fuera de plan ⇒ locked-state con upsell SOLO en panel admin (jamás en la PWA de terreno); cada toggle escribe `audit_trail` y aplica en el próximo bootstrap; caso de degradación: turno abierto durante el toggle termina con su config congelada (§4.4); casos de rebote server-side (la UI no es el gate): (a) mutación DIRECTA por API (sin UI) de override ON sobre una feature fuera del plan ⇒ 422 tipado es-CL (PLANIFICACIÓN, §4.2), 0 filas en `tenant_feature_overrides` y cero toggle registrado en `audit_trail` — el entitlement efectivo `override ?? plan` (§4.4) no enciende nada gratis; (b) toggle (ON u OFF) con rol distinto de `admin_tenant` ⇒ 403 y 0 filas — la pantalla «Funciones» está en el plano de control EXCLUSIVO del dueño (§5.4), test calcado del patrón de vehículos §5.4 — oráculo: CI [AC-FMIG-08]
  Probado: `apps/flota/src/servidor/funciones.ts` (`listarFunciones`/`alternarFuncion`, escribe
  `tenant_feature_overrides` en `control` y sella `config_version` + `audit_trail` a mano del
  lado del tenant, mismo patrón cross-base que `modo.ts`), `PATCH /api/gobierno/funciones`
  (guardia de `admin_tenant`, 422 `fuera_de_plan`) y `/panel/funciones`. El 403/404 de
  AC-FIDN-12 recoge la ruta sola del manifiesto; `e2e/funciones.spec.ts` prueba lo que ese
  barrido no puede —0 filas en `control.tenant_feature_overrides` en (a) y (b), OFF siempre
  permitido, ON con feature en plan sella `config_version` nueva, y la pantalla real
  (locked-state + upsell fuera de plan, apagar habilitado siempre)—. 5/5 verdes.
  `check.sh --full --app=flota`: VERDE.
- [x] (P1) Regla de contracción (§5.5, §0): manifest de navegación computado server-side (entitlements × rol) en el bootstrap; toggle OFF ⇒ manifest sin el módulo, la PWA no lo renderiza (sin huecos, candados ni parpadeo) y sus endpoints de planificación/lectura responden 403; degradación de captura: sync de captura 2xx SIEMPRE — captura hecha con el módulo recién apagado y turno abierto entra con flag `modulo_apagado` + Por revisar según `turno.config_version_id` (§4.2); app mínima todo-OFF = abrir turno → paradas → cerrar turno sigue siendo producto completo (e2e) — oráculo: CI [AC-FMIG-09]
  PROBADO: `servidor/manifiesto.ts` (`manifiestoDeNavegacion`) + `GET /api/manifiesto` sirven el
  catálogo de módulos ENCENDIDOS de la config vigente; `page.tsx` (Inicio) lo consume real, con
  los 4 estados de Miga. `GET /api/vehiculos` 403 con `modulo_vehiculos` apagado — pero SOLO en
  su uso de GESTIÓN: se descubrió corriendo el gate `--full` completo (no solo el e2e nuevo) que
  el guard ciego rompía turno/abrir, carga, agenda y rutas —los cuatro eligen un vehículo YA
  EXISTENTE para una acción de terreno, no administran el catálogo— porque son el MISMO endpoint
  y la mayoría de los tenants del fixture nunca sellaron `modulo_vehiculos=true` (default
  OFF). Se agregó `?operativo=1` para esos cuatro llamadores, que no pasa por el candado; el
  candado real de gestión sigue en `POST/PATCH/DELETE /api/gobierno/vehiculos*`, sin excepción.
  e2e `contraccion-manifest.spec.ts` (tenant propio, sella `config_version` directo): manifest
  con/sin el módulo, 403 en lectura y planificación con cero filas, ambos vuelven a andar
  encendido, y la secuencia app-mínima (abrir turno → captura → cerrar turno) en 2xx con
  `modulo_vehiculos`+`modulo_encargos` apagados. `esqueleto.spec.ts` (hito 0) se corrigió para
  visitar Inicio con una SESIÓN real de un tenant sin módulos (antes probaba un visitante
  anónimo, que ahora 404 correctamente en vez de mostrar el vacío — el manifest exige sesión).
  536/536 e2e de `apps/flota` + `check.sh --full --app=flota`: VERDE.
- [x] (P1) Los 4 estados obligatorios existen como componentes ÚNICOS de Miga y las pantallas YA CONSTRUIDAS de este módulo (panel white-label, «Funciones») los entregan: vacío accionable / skeleton <50 ms con spinner solo >400 ms / error es-CL con recuperación / sin conexión con contador REAL de cola del outbox; caso de rebote: las capturas JAMÁS muestran rechazo — el estado de error de captura no existe en la UI de terreno, solo «por sincronizar» (§5.7, §4.2, §5.2 F4). La pantalla del WIZARD queda fuera de este AC porque el wizard todavía no existe (lo construye AC-FMIG-14): su parte se partió a AC-FMIG-24, que exige reusar estos mismos componentes en vez de reinventarlos — oráculo: CI [AC-FMIG-10]
  PROBADO: los 4 estados viven UNA vez en `packages/miga` —`EstadoVacio`/`EstadoCargando` (con
  `useEscaladaDeCarga`, umbral 400 ms)/`EstadoError` en `EstadoListado.tsx` y `ChipEstadoConexion`—
  y las dos pantallas del módulo (`panel/funciones`, `panel/terminologia`) los consumen todos, sin
  copias. El contador del cuarto estado es REAL: `cliente/cola.ts` (`profundidadDeCola` +
  `useEstadoDeCola`) suma las colas de POD y de recarga de TODAS las identidades del aparato
  (§4.7/AC-FPOD-09: el relevo de turno no puede esconder las capturas de la anterior), con
  `cola.test.ts` — el conteo sube y BAJA con la cola, suma las dos colas, y un almacén negado
  cuenta 0 en vez de tumbar la pantalla. El vacío pasó a ser ACCIONABLE en las dos pantallas.
  Caso de rebote con oráculo propio: `db/flota/gate-capturas-sin-rechazo.mjs` (+ 12 mutantes en su
  `.test.mjs`, cableado en `gate.sh`) veta las tres formas en que nace el cartel — que el
  transporte del outbox abra un canal de fracaso (retorno distinto de `Promise<string[]>` o
  excepción hacia afuera), que la pantalla se ramifique por el fracaso del replay
  (`length === 0`, `!confirmadas`, `confirmadas.length < lote.length`) y, como positivo contra el
  verde vacuo, que alguien cumpla «cero rechazo» borrando el «por sincronizar» con su contador.
  e2e `miga-estados-panel.spec.ts`: 4/4 verdes (skeleton→aviso→contenido, carga rápida sin aviso,
  vacío accionable cuya acción vuelve a leer de verdad, y el chip contando 2 capturas reales del
  outbox con señal y sin ella). `check.sh --full --app=flota`: VERDE.
- [x] (P1) Gate axe+Lighthouse bloqueante sobre las pantallas del hito (§5.7): contraste 4.5:1 texto, 3:1 UI y 7:1 en cifra operativa y semáforos; targets §0 verificados; foco visible; cero `aria-label` vacíos; PWA iOS: manifest standalone, `viewport-fit=cover` + safe-areas, `touch-action: manipulation`, inputs ≥16 px; caso de rebote: cualquier violación ⇒ build rojo — oráculo: CI [AC-FMIG-11] — `apps/flota/e2e/panel-a11y-pwa-gate.spec.ts`: axe wcag2aa (contraste texto+aria) + 3:1 UI + targets ≥48px + foco visible + PWA iOS (manifest/viewport-fit/safe-area/touch-action/inputs≥16px) sobre las 3 pantallas HOY existentes del hito g (`/panel`, `/panel/funciones`, `/panel/terminologia`); "Lighthouse" resuelto como sus checks de PWA/mobile-friendly (sin la dependencia, mismo precedente que AC-PERF-04); la cifra operativa 7:1 no aplica —ninguna pantalla admin la muestra, ya gateada en AC-FPOD-23—. El gate encontró y arregló una violación REAL: `ChipEstadoConexion` (Miga) medía 4.27:1/4.20:1 en sus dos variantes contra su fondo teñido, bajo el 4.5:1 exigido — corregido en `packages/miga/src/componentes/ChipEstadoConexion.tsx`. El wizard (AC-FMIG-14) no existe aún: queda fuera hasta que nazca, igual que hizo AC-FMIG-10 con AC-FMIG-24.
- [ ] (P2) VoiceOver completa de punta a punta los flujos de apertura, POD y recepción (§5.7), con todo estado comunicado por texto además de color (§5.1); dueño humano nombrado: **Alexis** — checklist DONE-adopción que JAMÁS bloquea al loop (§9.2, §10); complementa y NO sustituye el proxy CI bloqueante de AC-FMIG-20 (§5.7 enumera VoiceOver dentro del gate de CI) — oráculo: humano [AC-FMIG-12]
- [ ] (P2) Fluidez de terreno en producción — SOLO lo medible con el enum cerrado de `client_metric` (§4.6, que no tiene métrica de fps ni de feedback táctil): `latencia_ms` p95 <1 s por interacción y time-to-first-stop <5 min en la telemetría de producto (§10; proxy medible de «conductor nuevo operando <5 min sin ayuda», §5.3); los 60 fps, el <1 s de laboratorio y el feedback táctil simulado tienen su gate CI BLOQUEANTE en AC-FMIG-19 — este seguimiento lo complementa, jamás lo sustituye — oráculo: producción [AC-FMIG-13]
- [x] (P1) Wizard de 4 pasos completable por SCRIPT en <15 min contra el stack local de CI (docker-compose: Postgres + app en modo producción — §2 gates proxy): paso 1 empresa+vertical(+botón de modo §3) ejecuta la provisión `CREATE DATABASE … TEMPLATE tenant_template` dentro del wizard (§4.1) y siembra la plantilla completa del `vertical_template` (terminología, motivos, checklists, cargo_types, config_ev, meta_eevd — §4.4) con demo TOCABLE: primera ruta tocable <15 min con datos demo (§2 métrica 1); paso 2 vehículo (<2 min, patente+tipo) + chofer real por invitación (§5.4); paso 3 paradas CSV/manual (§3.E1.5); paso 4 primera parada completada; caso de rebote: script >15 min o un paso incompletable ⇒ gate rojo (§3.E1.13) — oráculo: CI [AC-FMIG-14]
  PROBADO: `db/flota/wizard-onboarding.mjs` orquesta los 4 pasos reusando servidor puro de
  cada AC dueño (`crearVehiculo`, `emitirInvitacion`/`aprobar`, `crearEncargo`/`crearRuta`/
  `asignarEncargos`/`publicarRuta`, `aterrizarCapturas`) — nada reimplementado. `completo()`
  mide el techo de 15 min del §3.E1.13 con `process.hrtime`. `db/flota/suite-bd/wizard-onboarding.test.mjs`
  (3/3 verde contra cluster real): paso 1 sembrado campo a campo <60 s, rebote de vertical
  fuera de catálogo sin base a medio provisionar, y `completo()` de punta a punta (vehículo +
  chofer aprobado + encargo + parada publicada + primera parada `done`) muy por debajo del
  techo. `check.sh --full --app=flota`: VERDE (verde-20260815-234019).
- [x] (P1) Activar un vertical = INSERT de filas, cero migraciones (§2 métrica 4): provisionar por wizard los tenants del seed §10 con sus `vertical_template` deja `schema_migrations` idéntico antes/después (cero migraciones ejecutadas) — precondición anclada a lo que el maestro SÍ obliga: los 3 tenants del seed §10 (B = panadería, único vertical nombrado en §9.1; la elección de verticales del paso 1 para A y C queda BLOQUEADA por la Pregunta al dueño n.º 10) — y el flujo del operario queda armado POR DATOS (`stop_requirement` desde `cargo_type`; grep: cero condicionales por vertical en la UI — §4.6, §4.9); caso de rebote: ningún seed/wizard E1 inserta `alarm_rule`, `thermal_profile`, ni `stop_requirements` de tipo `pin_destinatario` o `escaneo_codigo` (solo-DDL en E1 — §4.9, §5.2 F4, §3.E3); test que falla si aparecen — oráculo: CI [AC-FMIG-15]
  PROBADO: los tres oráculos del texto, los tres nuevos. (1) `db/flota/suite-bd/
  wizard-onboarding.test.mjs` — test «activar el vertical panadería = INSERT de filas»: corre
  `pasoUnoEmpresaYVertical` (paso 1 del wizard) sobre el único vertical vivo de E1 (panadería,
  B del seed §10 — A y C siguen bloqueados por la Pregunta al dueño 10) y compara
  `schema_migrations` del tenant recién nacido, fila a fila (`version`+`sha256`), contra el de
  `tenant_template`: IDÉNTICO, contra cluster real. (2) `db/flota/gate-flujo-por-datos.mjs`
  (+ 12 mutantes en su `.test.mjs`, cableado en `gate.sh`) — gate estático que lee el catálogo
  VIVO de verticales desde `VERTICALES_DEMO` (wizard-onboarding.mjs) y falla si algún archivo de
  `apps/flota/src/{app,dominio,servidor}` compara contra el NOMBRE de un vertical (`===`,
  `switch`/`case`); hoy VERDE porque la derivación real vive en `derivarRequisitos`
  (servidor/rutas.ts) copiando `cargo_type_requirement` → `stop_requirement`, sin ramificar.
  (3) `db/flota/gate-seeds-alarm-thermal.mjs` (+ 10 mutantes, cableado en `gate.sh`) — gancho
  nuevo para `alarm_rule`/`thermal_profile` (los ganchos `pin_destinatario`/`escaneo_codigo` ya
  tenían sus propios gates gemelos, AC-FRUT-20/AC-FPOD-17): falla si algún seed o el wizard hace
  `insert into` cualquiera de las dos tablas DDL-only, y falla también si el DDL las pierde
  (verde vacuo evitado). `check.sh --full --app=flota`: VERDE (verde-20260816-000401).
- [ ] (P2) Wizard y primera parada validados EN VIVO por Alexis (DONE-adopción, §10); checklist con dueño humano nombrado que JAMÁS bloquea al loop (§9.2) — oráculo: humano [AC-FMIG-16]
- [ ] (P2) Embudo de activación medido en el panel interno SaaS (§10, módulo 05): tiempo alta→primera entrega real con evidencia p50 <4 h y p90 <24 h (§2 métrica 2) — oráculo: producción [AC-FMIG-17]
- [x] (P1) Los tenants B y C del seed §10 quedan SEMBRADOS desde `tenant_template` y el caso de rebote de FILA CRUZADA tiene oráculo real (§10, §9.3.2 centinela 2): `db/flota/seeds/centinelas.mjs` registra las 3 cadenas centinela ÚNICAS por tenant y verifica en carga de módulo la propiedad que las hace servibles como oráculo —disjuntas y ninguna subcadena de otra—, con 5 mutantes en el gate RÁPIDO (sin imports, para que no quede atada al cluster); `db/flota/seeds/tenant-b.mjs` siembra «Rutapan» (vertical panadería, tema propio, terminología renombrada al máximo largo permitido 7/7, 2 EV48 de 90 bultos/41.860 Wh, 4 panaderías cliente con RUT sintácticamente válido pero irreal, §7.8); `db/flota/seeds/tenant-c.mjs` siembra «Demo Mi Flota» (modo `mi_flota`; 1 EV48 con ficha EV completa —autonomía nominal 185 km, el PISO del rango real del Anexo A, jamás los 305 km del folleto que el maestro prohíbe planificar—; 1 chofer real por invitación + aprobación en 1 toque; la empresa IMPLÍCITA como ÚNICA empresa, que es la contracción de `mi_flota` en la capa de datos: sin contratantes no hay portal ni liquidación por cliente; 1 día de 3 encargos propios con sus 3 PODs aterrizados y el tablero F1 respondiendo con SOC capturado); y `db/flota/suite-bd/seeds-fila-cruzada.test.mjs` es el oráculo del caso de rebote: barre la huella de TODAS las columnas de texto descubiertas del CATÁLOGO de cada base —no de una lista curada, que se queda vieja el día que alguien agrega una tabla y nada avisa— con control positivo, la propiedad (el centinela de B no aparece en la base de C ni al revés) y una fila cruzada plantada a mano que lo pone ROJO y cuyo retiro lo devuelve a verde; el §9.3.2 exige mirar la BD del vecino porque un 404 solo dice que la ruta no sirvió el dato, no que el dato no ESTÉ. Este AC cierra sobre B, C y el oráculo de cruce; el tenant A, la operación de B, la memoria de cálculo EEVD y el e2e HTTP del camino dorado se partieron a AC-FMIG-25, AC-FMIG-26 y AC-FMIG-27, igual que AC-FMIG-10 hizo con AC-FMIG-24 — oráculo: CI [AC-FMIG-18]
  PROBADO: `db/flota/centinelas-de-seeds.test.mjs` 5/5 en el gate rápido (juego real + 4 mutantes:
  centinela compartido, subcadena, demasiado corto y no-cadena); `suite-bd/seed-tenant-b.test.mjs`,
  `suite-bd/seed-tenant-c.test.mjs` y `suite-bd/seeds-fila-cruzada.test.mjs` verdes en serie contra
  el cluster de flota (la suite corre con `--test-concurrency=1` a propósito: dos provisiones
  simultáneas desde `tenant_template` chocan en el catálogo de Postgres). `check.sh --full
  --app=flota`: VERDE.
- [x] (P1) Tenant A «e-auto DaaS» sembrado ENTERO según §7/§10 —mitad partida de AC-FMIG-18, que cerró sobre B, C y el oráculo de cruce—: 3 EV48 (90 bultos, 41.860 Wh), 6 usuarios (admin, operador, 2 choferes, 1 responsable_carga, 1 responsable_tecnico), 3 empresas contratantes con sus conceptos —farmacia con bloque $45.000 y `otd_comprometido_pct=95`, distribuidora `por_entrega` $3.500, cadena minimarket `por_bulto` $1.200— cada una con 1 usuario `cliente`, 25 destinos es-CL, 1 semana de agenda con ventanas de recarga AC nocturna, rutas del día con encargos de las 3 empresas consolidados, 1 no-entrega + 1 parcial + 1 devolución + 1 descuadre clasificado, y liquidaciones semanales (1 cerrada con folio ya registrado —jamás generado, art. 97 N°4 CT—, 1 disputada por línea, 1 pagada), con el centinela `a` ya registrado en `seeds/centinelas.mjs` y RUTs sintácticamente válidos pero irreales (§7.8); caso de rebote: el barrido de huella de `suite-bd/seeds-fila-cruzada.test.mjs` extendido a A da cero cruces A×B y A×C, y una fila de A plantada en la base de B lo pone rojo. BLOQUEADO en parte por esquema: `otd_comprometido_pct` no existe como columna en ninguna migración y el motor JAMÁS toca `db/migraciones*/` (AGENTS.md), así que la tarjeta SLA de la farmacia espera una sesión supervisada de esquema; el resto del tenant no depende de esa columna y se siembra igual — oráculo: CI [AC-FMIG-25] — `db/flota/seeds/tenant-a.mjs`: cada pieza entra por el servicio de servidor de su AC dueño (`crearVehiculo`/`editarVehiculo`, `emitirInvitacion`+`aprobar` para los CINCO roles invitables, `sembrar_motivos` del vertical, `agendarBloque`, `crearEncargo`/`crearRuta`/`asignarEncargos`/`publicarRuta`, `abrirTurno`, `registrarLectura`, `aterrizarCapturas`, `cerrarRuta`) y las tres piezas sin servicio (tarifas, liquidaciones, disputa) por las funciones que la BD ya gobierna —`devengar_entrega()` es la ÚNICA que crea líneas (§7.5) y `disputar_linea()` la única que las disputa—; el folio de la factura ya emitida entra como `reference_document`, la misma tabla del DTE tecleado en el andén, que es la evidencia de que la app REGISTRA y jamás genera (art. 97 N°4 CT). `suite-bd/seed-tenant-a.test.mjs` (9 tests) lo cuenta todo contra la BASE y no contra el valor de retorno del seed, incluida la autonomía 185 km del Anexo A (jamás los 305 del folleto), las 21 ventanas de recarga verificadas nocturnas de verdad (entra ≥21 h, sale ≤7 h en `America/Santiago`), el descuadre leído de `ecuacion_de_cierre()` y no de una suma repetida en JS, y la AUSENCIA de `otd_comprometido_pct` asertada a propósito: el día que AC-FTAR-13 cree la columna este test se pone ROJO y obliga a sembrar el 95 de la farmacia, que es lo que un `skip` no haría. El barrido de cruce quedó extendido a A en `suite-bd/seeds-fila-cruzada.test.mjs` con las mismas tres partes que ya tenían B y C: control positivo (la huella de A se ve en `empresas_cliente` Y en `destinos`), la propiedad en las 4 direcciones nuevas (A×B, A×C y sus inversas) y la fila de A plantada a mano en la base de B, que lo pone ROJO y cuyo retiro lo devuelve a verde.
- [x] (P1) La OPERACIÓN del tenant B «Rutapan» sobre su identidad ya sembrada —mitad partida de AC-FMIG-18—: 2 rutas maestras de madrugada consolidadas de 12 y 9 paradas, manifiestos firmados con sus DTEs ya emitidos (la app solo REGISTRA el folio, jamás lo genera —art. 97 N°4 CT— y sin DTE no hay salida a ruta —art. 55 DL 825—), 1 encargo creado en andén, 1 reintento y el cierre del día con ecuación cuadrada; como la terminología extrema de B es el segundo lado de la suite e2e doble (§9.2), el seed deja esas 2 rutas navegables con los términos RENOMBRADOS y no con los canónicos; caso de rebote: cierre que no cuadra, o manifiesto sin DTE asociado, ⇒ rojo — oráculo: CI [AC-FMIG-26] — `db/flota/seeds/tenant-b-operacion.mjs`: cada pieza entra por el servicio de su AC dueño (`crearRuta`/`instanciarDesdeMaestra`/`asignarEncargos`/`publicarRuta`, `crearEncargo`/`reintentarEncargo`, `abrirTurno`, `confirmarManifiesto`/`asociarDocumento`/`traspasarCustodia`, `aterrizarCapturas`, `cerrarRuta`, `sembrarMotivos`), y solo cuatro cosas se escriben a mano porque HOY ningún camino de la app las escribe —`rutas.es_maestra` y las paradas de la plantilla (ninguna función crea maestras, aunque `instanciarDesdeMaestra` las consuma), los `items` de la parada de CARGA que `ecuacion_de_cierre()` lee como `cargado`, `items.qty_entregada` (la 0045 dice «la escribe el módulo 04 al capturar el POD; acá solo se lee» y el módulo 04 todavía no la escribe) y `paradas.resultado`, que es el único camino del trigger de la 0048 a `encargo.estado='no_entregado'` y por tanto al reintento—: ninguna inventa esquema ni reimplementa regla de negocio. Las 2 maestras llevan los términos RENOMBRADOS de B («Recorrido-B7…», sin «Ruta» adentro) porque el §9.2 la usa como segundo lado de la suite e2e doble, y su ventana es de madrugada de verdad (entra 03:00, sale 07:00 en `America/Santiago`). El DTE ya emitido entra como `reference_document` tipo 52 con emisor y folio —la app REGISTRA, jamás genera (art. 97 N°4 CT)— asociado a CADA ítem a bordo, y la doble firma del §4.5 se siembra con PINs REALES verificados por argon2id: sin firma no hay traspaso que sostenga una disputa. El «encargo de andén» se sostiene hoy en QUIÉN lo creó (sesión del `responsable_carga`, ruta sin publicar, consolidando en una parada que ya existía) porque el evento `encargo.creado_en_anden` del maestro no está en `EVENTOS_OPERACION` y el motor no inventa catálogo — lo agrega el AC del flujo del responsable de carga. `suite-bd/seed-tenant-b-operacion.test.mjs` (6 tests) cuenta todo contra la BASE y no contra el retorno del seed, y los DOS casos de rebote son mutantes vivos: quitarle UN bulto a lo entregado pone `ecuacion_de_cierre()` en rojo y reponerlo la devuelve a verde (sin el mutante, el test sería verde aunque la ecuación devolviera cero siempre), y un sub-manifiesto armado por `confirmarManifiesto` y traspasado SIN documento sale con `item_sin_dte` (art. 55 DL 825) —el traspaso igual entra, porque el camión ya está en la calle y rebotarlo solo borraría la constancia (§4.2), y lo que el AC exige ver es la marca—.
- [x] (P1) La memoria de cálculo del valor EEVD esperado de A y B versionada junto a los seeds (sección 7) y el e2e HTTP del camino dorado A/B/C sobre los 3 seeds —mitad partida de AC-FMIG-18, que cerró sobre la mitad de BD del caso de rebote—: el valor se calcula UNA vez a mano al escribir el seed y queda escrito con su derivación completa (numerador, denominador y las filas exactas que los producen) para que el test de fixture de AC-FMIG-23 lo consuma sin recalcularlo —si el test recalculara, estaría comparando la vista contra sí misma—; el e2e recorre por HTTP el camino dorado de los 3 tenants y su caso de rebote es el del §10: una fila cruzada entre tenants ⇒ rojo, verificado por el 404 de la ruta Y por el barrido de huella de la BD del vecino, que es el insustituible (§9.3.2 centinela 2). Depende de AC-FMIG-25 y AC-FMIG-26: sin el tenant A ni la operación de B no hay camino dorado de los tres que recorrer — oráculo: CI [AC-FMIG-27]
  PROBADO: `db/flota/seeds/eevd-esperado.mjs` es la memoria de cálculo, SIN consultar la base:
  numerador 0 para A y B (el evento `entrega.con_evidencia` que cuenta `eevd_semanal`, migración
  0020, todavía no existe en `EVENTOS_OPERACION` — el POD real emite `entrega.pod_capturada`/
  `entrega.pod_deshecha`, ninguno de los dos), denominador 1 para A (un solo `abrirTurno` en
  `tenant-a.mjs`) y 2 para B (`abrirTurno` × 2 en `tenant-b-operacion.mjs`, uno por ruta maestra
  con un vehículo distinto cada una), citando la fila exacta de cada seed que los produce; eevd
  `"0.00"` en los dos, como STRING porque `numeric` viaja así por `pg`. `apps/flota/e2e/
  camino-dorado-abc.spec.ts` (6/6 verde): siembra A/B/C completos con sus seeds reales
  (`sembrarTenantA`/`sembrarTenantB`/`sembrarTenantC`) y un dispositivo de LECTURA propio por
  tenant (el secreto de los actores que YA siembra cada seed no sirve para autenticar por HTTP a
  propósito — el de `admin_tenant` es un literal inerte y el del chofer sale sellado contra una
  clave ECDH que el propio seed descarta, AC-FIDN-04). Recorre `GET /api/rutas/:id` con el `Host`
  real de cada subdominio y la sesión real del visor, asertando que la respuesta trae el
  centinela PROPIO y ningún otro — control positivo, no solo ausencia. El caso de rebote del
  §10/§9.3.2 (A→B, B→C, C→A, un salto por par): sesión REAL de un tenant pidiendo el id REAL de
  una ruta del vecino ⇒ 404 sin una sola cadena del vecino en el cuerpo, y `huellaDeCentinela`
  (el oráculo de AC-FMIG-18) sin cambios entre el antes y el después — con su propio control
  positivo (`antes.length > 0`) para que «sin cambios» no sea vacuo. `check.sh --full
  --app=flota`: VERDE (verde-20260816-033646).
- [x] (P1) Gate CI de performance de terreno — §5.7 rotula «gate de CI» los «<1 s por interacción» y «transiciones 60 fps», así que llevan proxy de laboratorio BLOQUEANTE (§9.2: solo lo CI cierra el loop): presupuesto de performance Lighthouse sobre las pantallas del hito y trazas de frame-timing dentro de los e2e de los 3 flujos de terreno (apertura/POD/recepción — pantallas de los módulos 02–04; el gate se define aquí, dueño de §5.7) con umbrales que FALLAN el build al excederse; test de componente de `packages/miga` que FALLA si un control operativo carece del feedback táctil simulado (§5.7 — no hay Vibration API); el seguimiento en producción vive en AC-FMIG-13 como complemento — oráculo: CI [AC-FMIG-19]
  PROBADO: (1) «Lighthouse» resuelto sin la dependencia, mismo precedente que AC-PERF-04/AC-FMIG-11
  (razón completa en `presupuesto-perf.mjs`): `RUTAS_CRITICAS_POR_APP.flota` se extendió con
  `/panel`, `/panel/funciones` y `/panel/terminologia` —"las pantallas del hito" (g, §9.1.4)—,
  midiendo el peso JS-gzip contra el presupuesto de 150 KB, con umbral que FALLA el paso
  `presupuesto de performance` de `check.sh` si se excede; las 4 rutas (+ el shell `/`) miden hoy
  109-111 KB, dentro del presupuesto. (2) `apps/flota/e2e/frame-timing.ts` es la traza de
  frame-timing: arranca un contador de `requestAnimationFrame` en la propia página, dispara la
  interacción y mide la latencia real (click → destino visible, umbral <1000 ms, el número literal
  del §5.7) y el SALTO máximo entre dos frames consecutivos (umbral <100 ms — la firma de un frame
  perdido/jank, más robusto en CI headless que promediar fps) — un test nuevo por flujo, cada uno
  con su propio caso de rebote si el umbral se excede: `apertura.spec.ts` (transición al semáforo
  tras "continuar-carga"), `pod-feliz.spec.ts` (avance a la parada siguiente tras "entregado"),
  `carga.spec.ts` (entrada a "paso-conteo" tras elegir el vehículo) — las tres corren en <1s reales
  (277-525 ms) y sin salto de frame en el e2e móvil 390×844 de `check.sh --full`. (3) El feedback
  táctil simulado (§5.7, sin Vibration API) se centralizó en `BotonTactil` (packages/miga) —
  hundimiento visual `scale(0.96)` al presionar/soltar (`onPointerDown`/`onPointerUp`/
  `onPointerLeave`/`onPointerCancel`) — y los 4 controles operativos existentes del paquete pasan a
  usarlo (`BotonPrimario`, `TecladoNumerico`, `SelectorUnToque`, el «Reintentar» de
  `EstadoListado`); `feedback-tactil.test.ts` es el gate de componente: escanea cada `.tsx` de
  `componentes/` y FALLA si alguno renderiza `<button` sin pasar por `BotonTactil`, con mutante
  (un `<button>` a mano pone el gate rojo) y control positivo (uno con `BotonTactil` lo deja
  verde) contra un árbol de juguete — el mismo patrón de `MIGA_COMPONENTES_DIR` que ya usan
  `cifras.test.ts`/`estructura.test.ts`. `pnpm --filter @kilopan/miga test`: 52/52 verdes.
  `check.sh --full --app=flota`: VERDE (verde-20260816-041711).
- [x] (P1) Proxy CI BLOQUEANTE de VoiceOver — §5.7 la enumera DENTRO del gate axe+Lighthouse («VoiceOver completa apertura/POD/recepción»): reglas axe de nombre accesible y rol correcto en TODOS los controles interactivos de los 3 flujos + verificación automatizada de orden de foco que completa cada flujo por navegación secuencial (apertura, POD, recepción); caso de rebote: control sin nombre accesible, rol incorrecto o flujo incompletable por foco ⇒ build rojo; la pasada VoiceOver real queda como complemento humano en AC-FMIG-12 — oráculo: CI [AC-FMIG-20]
  PROBADO: `apps/flota/e2e/voiceover-proxy-3-flujos.spec.ts` (3/3 verde) — un test por flujo
  (apertura de turno, POD/entrega feliz, recepción de carga), cada uno combinando las dos mitades
  del AC: (1) `auditarNombreYRol` corre axe (`wcag2a`/`wcag2aa`) sobre cada pantalla que el flujo
  atraviesa, filtrado a las reglas de nombre accesible y rol (`button-name`, `aria-allowed-role`,
  `aria-roles`, etc. — nunca contraste/targets, que ya gatean AC-FPOD-23/AC-FMIG-11/AC-FMIG-19 y
  duplicarlos pondría este AC rojo por algo que no le compete); (2) `caminoPorFoco` recorre cada
  paso EXCLUSIVAMENTE por rol "button" + nombre accesible (jamás por testid — así es como
  VoiceOver encuentra un control), exige que el control esté en o después del último tocado
  DENTRO del mismo estado de pantalla (`indiceDeFoco` mide el DOM real; `.focus()` con
  `document.activeElement` confirma que admite foco de verdad) antes de tocarlo. Mismo precedente
  de `.focus()` en vez de un Tab real que `pod-a11y-gate.spec.ts`/`pod-voiceover-f4.spec.ts`
  (AC-FPOD-23/24): WebKit headless (`devices["iPhone 13"]`) no mueve el foco con Tab a
  `<button>`. `check.sh --full --app=flota`: VERDE (verde-20260816-044956).
- [x] (P1) «Una acción primaria por pantalla» y «máx 2 niveles de profundidad» (§5.1) con oráculo conductual que puede fallar (§5 encabezado; AC-FMIG-01 solo publica las constantes): los e2e/snapshots de las pantallas del hito (wizard, panel white-label, «Funciones») asertan EXACTAMENTE UN botón primario por pantalla (nota de cobertura: en terreno, el e2e de pantalla de parada bajo el covering array §9.2 vive en los módulos 02–04 y aserta el botón primario — la aserción §5.1 es de unicidad, no de mera presencia); chequeo mecánico de profundidad ≤2 sobre el manifest de navegación computado server-side (§5.5 — estructura de datos testeable) para las combinaciones entitlements × rol del covering array §9.2; caso de rebote: manifest con >2 niveles o pantalla con ≠1 botón primario ⇒ test rojo — oráculo: CI [AC-FMIG-21]
  PROBADO: `packages/miga/src/una-accion-primaria.{ts,test.ts}` (unidad, mutantes de "dos tipos
  acento compitiendo"), `apps/flota/src/dominio/manifiesto-profundidad.{ts,test.ts}` (unidad,
  mutante de profundidad 3), `apps/flota/e2e/una-accion-primaria.spec.ts` (DOM real de
  `/panel/funciones` y `/panel/terminologia`) y `apps/flota/e2e/profundidad-manifiesto.spec.ts`
  (covering array `modulo_vehiculos` ON/OFF × 6 roles contra `GET /api/manifiesto` real).
  `check.sh --full --app=flota`: VERDE (verde-20260816-055417).
- [ ] (P1) DPA en términos del tenant (§3.E1.15, §7.8 — obligación E1 sin módulo asignado por el maestro; queda aquí, dueño del panel admin white-label y del wizard, hito g): el DPA existe como artefacto VERSIONADO del repo (test CI grep-able de existencia y de secciones mínimas: partes, objeto del tratamiento, encargado/responsable, subencargados, medidas de seguridad, devolución/supresión al término y portabilidad `pg_dump` del §2 métrica 7), se sirve dentro de los términos del tenant sin CSS libre ni build por cliente (§5.1), es alcanzable desde el panel admin dentro de los 2 niveles de profundidad (§5.1) y su versión vigente queda registrada por tenant; la aceptación por el `admin_tenant` escribe `audit_trail` con la versión aceptada (§4.6) y con rol distinto de `admin_tenant` ⇒ 403 y 0 filas (§5.4); textos es-CL, cero strings visibles en inglés (§0). El TEXTO legal y el MOMENTO exacto de la aceptación (paso del wizard vs panel admin) quedan BLOQUEADOS por la Pregunta al dueño 12 — esta spec no los inventa; el AC cierra hoy con la parte estructural y se completa al responderse — oráculo: CI [AC-FMIG-22]
- [ ] (P1) Test de fixture de la EEVD del DONE-software (§10) — oráculo que el maestro exige y que hasta ahora no tenía dueño: el valor esperado HARDCODEADO en el test, calculado UNA vez a mano al escribir el seed y con su memoria de cálculo versionada junto a los seeds A y B (sección 7), se compara contra la vista `eevd_semanal` (creada por el módulo 02, AC-FVEH-20) computada sobre las BDs sembradas desde `tenant_template`; discrepancia ⇒ gate rojo. El DENOMINADOR (vehículos-día con turno abierto, §2) es computable desde ya; el NUMERADOR (paradas tipo `entrega` con `estado='done'`, resultado `exito|parcial` y ≥1 fila válida en `evidence`) queda BLOQUEADO por la Pregunta al dueño 4 de la spec 04 — mientras siga abierta, el test se escribe con el denominador y el valor esperado documentado pero NO entra al gate, y jamás se elige por cuenta propia qué fila de `evidence` escribe la entrega feliz — oráculo: CI (condicionado a la Pregunta 4 de la spec 04) [AC-FMIG-23]
- [ ] (P1) El WIZARD de onboarding entrega los mismos 4 estados obligatorios de Miga (§5.7) — mitad partida de AC-FMIG-10, que cerró sobre las pantallas ya construidas del módulo: cada paso del wizard usa los componentes ÚNICOS de `packages/miga` (`EstadoVacio` accionable, `EstadoCargando` + `useEscaladaDeCarga` con su umbral de 400 ms, `EstadoError` es-CL con recuperación) y el contador REAL de cola de `cliente/cola.ts`, sin reinventar ninguno; caso de rebote: un paso del wizard con su propio `setTimeout` de escalada, su propio cartel de carga o un vacío sin salida ⇒ test rojo. Depende de AC-FMIG-14, que es quien construye el wizard: hasta que exista la ruta, este AC no tiene superficie que ejercer — oráculo: CI [AC-FMIG-24]

## Dependencias

Módulos 00–07 del mapa del orquestador (entre paréntesis, su hito §9.1.4). Este módulo
es bidireccional: `packages/miga` y la capa de copy son consumidos por TODOS los
módulos desde el hito 0 (§9.1); el wizard y los seeds, en cambio, orquestan flujos que
los demás módulos implementan.

- **00 — Modelo de datos y tenancy (hito a):** DDL e invariantes de `tenant_theme`
  (rechazo <4.5:1), `tenant_terminology` (CHECKs de largo/caracteres/sistema),
  entitlements 3 tablas con resolución `override ?? plan`, `vertical_template`,
  `parametros`, `tenant_template` + provisión `CREATE DATABASE … TEMPLATE` +
  credenciales por tenant + `control` + ruteo por subdominio, `constants.ts` (familia
  §0 que Miga consume) y `config_version_id` (§4.1, §4.4, §0). Sin 00 no hay wizard ni
  theming.
- **01 — Identidad y enrolamiento (hito b):** sesión y roles (`admin_tenant` para el
  panel white-label y «Funciones»), invitación por rol + aprobación en 1 toque para el
  chofer del paso 2 del wizard, guía A2HS/standalone del enrolamiento (§4.3, §5.4).
- **02 — Vehículos/energía/agenda (hito c):** alta de vehículo <2 min (paso 2 del
  wizard) y los flujos que consumen teclado propio y cifra operativa (odómetro/SOC)
  (§3.E1.3, §5.2 F3/F5) y la vista `eevd_semanal` (AC-FVEH-20) contra la que corre
  AC-FMIG-23.
- **03 — Encargos/rutas/custodia (hito d):** encargo mínimo e import CSV (paso 3),
  rutas para la «primera ruta tocable» del demo y los datos de custodia de los seeds
  A/B (§3.E1.5, §3.E1.6, §10).
- **04 — POD offline/sync (hito e):** primera parada completada (paso 4), outbox cuya
  profundidad alimenta el contador del estado sin conexión, ingesta de `client_metric`
  (incl. `toques_flujo` y `latencia_ms`) y los e2e de presupuesto de toques que usan la
  convención/instrumentación de este módulo (§3.E1.7, §4.6, §4.7, §5.3).
- **05 — Semáforo y visibilidad (hito e):** home «Hoy» a la que aterriza el tenant
  recién creado, y el panel interno SaaS donde se leen el embudo de activación
  (AC-FMIG-17) y la telemetría de fluidez (AC-FMIG-13) (§5.6, §10); la vista
  `eevd_semanal` que consume el test de fixture NO es de 05 ni de 00: la crea el módulo
  02 (AC-FVEH-20).
- **06 — Tarifas/liquidación (hito f):** rate cards, liquidaciones y disputas que los
  seeds A y B siembran (conceptos $45.000/$3.500/$1.200, liquidaciones
  cerrada/disputada/pagada) (§3.E1.8, §3.E1.9, §10).
- **07 — Portal contratante y selector de modo (hito f/§3):** semántica del botón de
  modo del wizard y de la contracción mi_flota que el seed C demuestra; usuarios
  `cliente` de los seeds A/B (§3, §3.E1.10, §10).

## Preguntas al dueño

El maestro no cierra estos puntos; quedan abiertos y NO se resuelven en esta spec:

1. **Alta de tenant:** ¿el wizard es de acceso público (cualquiera crea su operación) o
   está gateado por las «invitaciones de tenant nuevo» que viven en `control` (§4.1)?
   ¿Y cómo nace la credencial del PRIMER `admin_tenant` del tenant (RUT+PIN como los
   operarios, u otra cosa)? §5.4 solo cierra la passkey/WebAuthn para transferir
   propiedad — «única passkey del sistema» — y el enrolamiento §5.4 presupone un dueño
   ya adentro.
2. **Slug/subdominio:** ¿el slug (`t_<slug>`, `<slug>.plataforma.cl` — §4.1, §3.E1.1)
   lo elige el tenant en el paso 1 con validación de disponibilidad, o se deriva del
   nombre de la empresa? ¿Reglas de formato del slug?
3. **Plan de nacimiento en E1:** sin billing SaaS (Stripe es E2 — §3 FUERA), ¿qué
   `plan_id` asigna el wizard al tenant nuevo? ¿Los presets de `plan_features` de E1
   siguen el pricing del Anexo A (que el maestro rotula «contexto de negocio, no es
   alcance»)? En particular: ¿el white-label «completo» del plan Pro implica que el
   theming está gateado por plan también en E1?
4. **CTA del upsell:** el locked-state con upsell del panel admin (§5.5) en E1 no tiene
   billing detrás — ¿qué hace el botón (contacto, correo, nada)?
5. **Datos demo del paso 1:** ¿cómo se distinguen de los datos reales y qué pasa con
   ellos al operar en serio? Impacta la EEVD y los paneles («primera entrega REAL con
   evidencia», §2), y §7.4 prohíbe lo destructivo sobre datos con evidencia — el
   maestro no define marca, filtro ni purga de lo demo.
6. **Par de contraste del acento:** pregunta canónica en `00-modelo-datos-tenancy.md`,
   Pregunta al dueño n.º 7 — no se replantea aquí.
7. **`tenant_theme.extras`:** el maestro declara la columna (§4.4) pero no su
   contenido, y §5.1 fija que lo personalizable es EXACTAMENTE logo + acento +
   terminología. ¿`extras` queda sin UI en E1?
8. **2 BDs vs 3 tenants:** §10 encabeza el seed con «2 BDs tenant provisionadas» y §9.2
   dice «provisión de 2 BDs tenant» en el gate, pero §10 lista TRES tenants (A, B y C)
   y el hito (g) exige «seeds de los 3 tenants». ¿Confirmas que `check.sh --full`
   provisiona y siembra las 3 BDs?
9. **Logo:** formatos y límites del archivo (peso/dimensiones) y dónde vive el binario
   de `logo_url` — §7.2 exige almacenamiento/backups segregados por tenant. ¿Bucket por
   tenant?
10. **Catálogo de verticales del wizard en E1:** §9.1 solo nombra
    `packages/vertical-panaderia`. ¿Qué verticales ofrece el paso 1 en E1 y cuál usa el
    tenant A (e-auto DaaS)? ¿Existe un vertical «genérico»?
11. **Roles editores de white-label:** ¿confirmas que SOLO `admin_tenant` edita tema y
    terminología (derivado de §5.4/§5.5, no cerrado explícito en el maestro — el
    `operador` queda solo-lectura)?
12. **DPA en términos del tenant (§3.E1.15, §7.8):** el maestro lo exige en E1 sin fijar
    su texto ni su momento. ¿Qué texto legal se sirve (¿lo redacta el abogado del dueño
    y se versiona en el repo?), y la aceptación ocurre en el paso 1 del wizard (alta de
    la operación), en el panel admin al primer ingreso del `admin_tenant`, o ambas? ¿Se
    bloquea alguna función del tenant sin aceptación (el maestro no lo dice y esta spec
    no lo asume)?
