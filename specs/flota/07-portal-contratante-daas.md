# 07 — Portal del contratante DaaS y selector de modo (mi_flota vs daas)

Fuente: §3 (selector de modo) · §3.E1.1 (selector dentro del núcleo multi-tenant) ·
§3.E1.10 (portal del contratante) · §5 (GUI: §5.1 Miga/theming, §5.5 contracción por
toggles, §5.7 estados y AA) · §4.1 (aislamiento: el contratante ve SOLO su rebanada) ·
§4.2 (regla de oro) · §4.3 (rol `cliente`) · §4.4 (`control.tenants.modo`, config
congelada) · §4.5 (`empresas_cliente`, encargo `solicitado`) · §3.E1.9 y §0 (disputa de
liquidación, 7 días) · §9.3 (centinelas 2, 3 y 11) · §10 (seeds A y C, DONE dual).
Todas las referencias resuelven contra `docs/PROMPT_MAESTRO_FLOTA.md`. Alimenta el hito
§9.1.4.(f) «tarifas/liquidación/portal cliente `[datos]`».

Alcance: etapa E1 solamente. Chile solamente (es-CL, CLP entero, RUT — §0). Este módulo
NO activa ningún gancho §4.9: los ganchos que roza (p. ej. `reference_document` en las
líneas de liquidación) pertenecen a otros módulos y aquí solo se leen.

## 1. Selector de modo (§3, decisión cerrada del dueño)

- `tenants.modo ∈ {mi_flota, daas}` vive en `control.tenants` (§4.4) como dominio
  CERRADO. Se elige con un botón al crear la operación (wizard — módulo del hito g) y
  es conmutable después desde el panel admin del tenant (§3). Solo `admin_tenant`
  opera el cambio (§5.4/§5.5: el plano de control del tenant es exclusivo del dueño).
- Los modos son **presets del mismo sistema de entitlements** (§3): conmutar modo NO
  ejecuta código distinto ni migra esquema; el modo actúa sobre el entitlement
  efectivo del §4.4 (`override ?? plan`) apagando/encendiendo el grupo DaaS (tarifas,
  liquidación por cliente, portal del contratante, facturación) como configuración por
  filas — JAMÁS mutando `plan_features` (fila compartida por los tenants del plan) ni
  con ramas de código por modo (§3, §1 regla del presidente). Como todo toggle, queda
  en `audit_trail` y aplica en el próximo bootstrap; los turnos abiertos terminan con
  su `config_version_id` congelado (§5.5, §4.4).
- **mi_flota** (§3): UNA `empresa_cliente` implícita (= la propia), creada por trigger
  al provisionar (§4.5); tarifas, liquidación por cliente, portal del contratante y
  facturación quedan OFF **y ocultos** (manifest server-side sin el módulo, sin huecos
  ni candados; locked-states/upsell SOLO en panel admin — §5.5). Queda lo operativo
  puro; el semáforo no muestra la tarjeta SLA (ella existe solo «en modo daas»,
  §3.E1.11). Mientras `modo=mi_flota` el grupo DaaS queda OFF por definición del §3
  («quedan OFF y ocultos»): la pantalla «Funciones» no lo enciende individualmente —
  la vía para habilitarlo es conmutar a `daas` (§3, §5.5).
- **daas** (§3): 1..N empresas contratantes, carga consolidada, tarifas/contratos,
  liquidación con evidencia y portal del contratante. La facturación y el cobro que el
  §3 nombra para el modo daas son E2 (lista FUERA de E1: «facturación DTE y pagos»):
  el preset E1 de daas NO los enciende (§3). Cómo (o si) aparecen en la pantalla
  «Funciones» los módulos E2 aún no construidos NO está definido en el maestro; esa
  pantalla es del módulo 08 y no se especifica aquí (el §5.5 define locked-state solo
  para el caso ON-fuera-de-plan).
- Cambiar de modo es **aditivo, jamás destructivo** (§3): conmutar
  mi_flota→daas→mi_flota no pierde ni una fila y la empresa implícita queda intacta
  (test centinela 11, §9.3).
- Efecto HTTP de la contracción (§0, §5.5): módulo apagado ⇒ 403 SOLO en endpoints de
  planificación/lectura. El namespace del portal es 100% planificación/lectura: NO
  expone endpoints de captura, por lo que ninguna ruta `/cliente/*` participa del
  contrato «sync de captura = 2xx siempre» (§4.2).

## 2. Portal del contratante (§3.E1.10 — modo daas)

- Rol `cliente` con `empresa_cliente_id NOT NULL` (§4.3), confinado a su empresa por
  política en BD + vistas (§4.1, §7.2); ve SOLO su liquidación vía vistas (§4.3).
  Namespace `/cliente/*` en la MISMA PWA (§3.E1.10) — mismo tema del tenant (§5.1) y
  misma capa de copy con terminología (§5.1, §0).
- **Cuatro pantallas, lista cerrada** (§3.E1.10):
  1. **Hoy** — el maestro la nombra sin cerrar su contenido; aquí solo se exige que
     muestre exclusivamente datos de SU empresa y cumpla §5.7 (ver Preguntas al dueño).
  2. **Encargos (con evidencia)** — estado/resultado de sus encargos y la evidencia
     asociada (`evidence`, §4.6) de sus entregas; jamás el orden global de la ruta ni
     paradas de terceros.
  3. **Nuevo / Importar CSV** — el encargo del cliente nace en estado `solicitado`
     (§4.5); el operador acepta/programa; editable por el cliente SOLO hasta la
     aceptación (§3.E1.10). Crear/editar es PLANIFICACIÓN: valida online y rebota con
     error tipado 422 (§4.2) — sin conexión, la acción se deshabilita con el estado
     obligatorio de §5.7 (el portal no captura, no hay outbox de por medio).
  4. **Liquidación** — línea por línea (cada línea nace de exactamente UNA evidencia,
     §3.E1.9), estados abierta→cerrada→pagada, disputa por línea con motivo tipado
     dentro de la ventana de 7 días (§0 «disputa de liquidación 7 días»), drill-down
     línea→evidencia a 1 clic (§3.E1.9).
- **JAMÁS ve** (§3.E1.10): otras empresas contratantes, rutas completas, telemetría
  EV, economía del operador (tarifas de terceros, costos de energía, reporte ahorro vs
  diésel — §3.E1.12 lo reserva al gestor). El aislamiento intra-tenant entre empresas
  contratantes es política en BD + vistas (§4.1); el payload de `/cliente/*` cumple un
  schema fijo testeado sin columnas de economía interna (§9.3 centinela 3).
- Acceso a recurso ajeno: de otro tenant ⇒ 404 siempre, nunca 403 (§0, centinela 2);
  de otra empresa del mismo tenant ⇒ la política en BD devuelve 0 filas y el endpoint
  responde 404, sin cadenas centinela ajenas en el body (§9.3 centinela 3).
- Formatos es-CL en todo el portal: `$12.500`, `dd-mm-aaaa`, RUT `12.345.678-5`, cero
  strings visibles en inglés (§0). Estados obligatorios y AA por pantalla (§5.7).
  Selectores de e2e SOLO por data-testid/term_key; la suite corre dos veces con
  terminología base y extrema sin cambiar un selector (§9.2).
- La cuenta del `cliente` nace por invitación por rol emitida por el dueño (§5.4);
  identidad y sesión son del módulo de identidad (dependencia), no se re-especifican.

## Criterios de aceptación

- [x] (P1) Selector persistido — dominio y alta: `control.tenants.modo` acepta SOLO
      `mi_flota|daas` (valor fuera del dominio ⇒ rebote 422/CHECK y 0 filas); el alta de
      la operación persiste el modo elegido (el botón del wizard es GUI del módulo 08;
      aquí se prueba el servicio de alta/conmutación que ese módulo consume) (§3, §4.4)
      — oráculo: CI [AC-FPOR-01]. Probado: el enum `tenant_modo` cierra el dominio en la
      BD (`db/migraciones-flota/control/0001_plano_de_control.sql`); `provisionar()` da
      de alta el tenant en `control.tenants` con el modo elegido, rechazando ANTES de
      tocar el cluster cualquier valor fuera de `mi_flota|daas`
      (`db/flota/provisionar.mjs`); `db/flota/suite-bd/provisionar.test.mjs` cubre alta
      con modo explícito, default `mi_flota`, recrear conservando `id` y el rebote del
      dominio cerrado — las 4 pruebas en verde en `pnpm check:full --app=flota`.
- [x] (P1) Centinela 11 — conmutación aditiva, jamás destructiva: sobre un tenant con
      datos operativos sembrados, mi_flota→daas→mi_flota NO PIERDE ni una fila. Oráculo
      de NO-PÉRDIDA, jamás de igualdad de counts (cada conmutación appendea filas
      legítimamente: `audit_trail` de cada toggle §5.5 y config de entitlements por
      filas §4.4): por cada tabla de dominio, toda fila del snapshot previo sigue
      presente tras la doble conmutación (comparación por PK) y count(después) ≥
      count(antes); la empresa implícita queda intacta (mismo id, misma fila) (§3,
      §9.3.11, §5.5) — oráculo: CI [AC-FPOR-02]. Probado:
      `db/flota/suite-bd/centinela-11.test.mjs` enumera CADA tabla con PK de `public` vía
      `information_schema` (≥20 tablas, sin lista a mano), siembra datos a lo ancho de
      ~20 tablas operativas, conmuta mi_flota→daas→mi_flota (alta una empresa nueva
      mientras está en daas) y compara por PK: cero filas perdidas, count(después) ≥
      count(antes) en cada tabla, la empresa implícita es la MISMA fila y la contratante
      dada de alta en daas sobrevive la vuelta — gate propio de flota en verde
      (`pnpm check:full --app=flota`).
- [x] (P1) Contracción mi_flota (manifest + e2e; el trigger de la empresa implícita se
      aserta aparte en AC-FPOR-17): el manifest server-side (entitlements × rol) no
      incluye tarifas, liquidación por cliente, portal ni facturación (sin huecos ni
      candados; locked-states solo en panel admin); «sin parpadeo» con aserción
      mecánica: los nodos DOM de los módulos contraídos no existen en NINGÚN frame
      entre el bootstrap y el render estable del e2e; el semáforo no ofrece tarjeta
      SLA; e2e del tenant C del seed: UI contraída y cero CLP de tarifas visibles (§3,
      §5.5, §3.E1.11, §10) — oráculo: CI [AC-FPOR-03]. Probado:
      `apps/flota/src/dominio/manifest.ts` espeja 1:1 las 4 filas de `modo_recorte`
      (db/migraciones-flota/control/0003_modo_como_preset.sql) — tarifas, liquidación
      por cliente, portal del contratante y facturación — y las omite del arreglo
      (sin hueco, sin candado) cuando su entitlement no está encendido, mismo criterio
      «sin entrada = apagada» que `dominioSemaforoActivo`; `hoy/page.tsx` lo resuelve en
      el Server Component (nunca un fetch en el cliente, así que no hay parpadeo
      estructuralmente posible) y lo renderiza en `<nav data-testid="manifest-modulos">`.
      `apps/flota/e2e/manifest-contraccion.spec.ts` prueba, sobre el tenant C del seed
      (`?seed=c`, mi_flota): (a) el grupo DaaS no aparece y lo operativo sigue completo;
      (b) el grupo SÍ aparece completo con seed A (daas); (c) «sin parpadeo» con
      aserción MECÁNICA — un `MutationObserver` instalado con `page.addInitScript` ANTES
      de que el documento navegado parsee un solo nodo, que capta la construcción del
      DOM entera y no un muestreo de frames; (d) el combo que el AC pide en un solo e2e
      del tenant C: manifest contraído + semáforo sin tarjeta SLA + cero CLP visible
      (reafirmando AC-FSEM-01/13 sobre la misma corrida). `manifest.test.ts` cubre el
      dominio puro (10 casos). Gate en verde:
      `bash packages/metodo/scripts/check.sh --full --app=flota` (18 OK, 0 rojos) y
      `pnpm --filter flota e2e` (502/502, incluidos los 4 tests nuevos) en PRIMER PLANO.
- [x] (P1) Módulo apagado en HTTP: con el portal OFF (mi_flota u override), TODA ruta
      `/cliente/*` (lectura y planificación) responde 403; el namespace no expone ningún
      endpoint de captura (auditoría del manifiesto de rutas: nada de `/cliente/*` en el
      contrato 2xx-siempre); con portal ON en daas las mismas rutas responden 2xx para
      el rol `cliente` (§0, §5.5, §4.2) — oráculo: CI [AC-FPOR-04]. Probado: el candado vive
      en `servidor.mjs` (mismo lugar que el 404/503 por subdominio, AC-FTEN-05, y por la
      MISMA razón — un Server Component no puede fijar el status HTTP), justo antes de
      `atender()`, para TODO request cuya ruta matchee `dominio/portal-ruta.ts` (prefijo de
      segmento `/cliente`, no substring). Consulta `servidor/portal.ts`, que resuelve
      `entitlementVigente(..., FEATURES.portal_contratante)` sobre la config CONGELADA del
      tenant — la MISMA `feature_lookup_key` que `modo_recorte` apaga en `mi_flota`
      (0003_modo_como_preset.sql). El namespace existe de verdad (`src/app/cliente/page.tsx`,
      declarado en `rutas/manifiesto.json` con su caso de cruce) para que el ON no sea
      vacuo. `rutas/portal-sin-captura.test.mjs` audita el manifiesto GENERADO (AC-FTEN-26):
      ninguna ruta `/cliente/*` importa `sesionParaSincronizarCapturas` —la única puerta que
      puede llamarla, «ninguna otra ruta debe usar esto» dice `gobierno.ts`— con un positivo
      sobre `/api/sync/capturas` que prueba que el chequeo atraparía el caso si existiera.
      `e2e/portal-modulo-apagado.spec.ts` (base propia `portal_cliente`; `config_version` se
      sella DIRECTO con `crear_config_version()` —el sembrado real por `plan_features`/
      overrides es del hito g, todavía no construido, mismo motivo por el que
      `dominio/manifest.ts` resuelve sus entitlements por fixture— append-only, así que la
      suite necesita OFF y luego ON en la MISMA base): OFF (mi_flota) ⇒ 403 en `/cliente`,
      `/cliente/`, `/cliente/hoy` y una ruta inventada bajo el prefijo, CON y SIN sesión
      válida de la casa; `/clientela` (fuera del namespace) no cae en el candado. ON (daas)
      ⇒ 2xx con una sesión real del rol `cliente`. `pnpm check:full --app=flota` en verde
      (506/506 e2e).
- [ ] (P1) Confinamiento del rol en BD: constraint que exige `empresa_cliente_id NOT
      NULL` cuando rol=`cliente` (alta sin empresa ⇒ rebote); pgTAP con el rol de app
      real y `set_config('app.current_role','cliente')`: SELECT del cliente de la
      empresa X sobre TODA tabla operativa ⇒ 0 filas de la empresa Y; su liquidación es
      accesible SOLO vía las vistas destinadas al rol (§4.1, §4.3, §9.3.3) — oráculo:
      CI [AC-FPOR-05]
- [ ] (P1) Suite HTTP de aislamiento sobre `/cliente/*` (autogenerada del manifiesto de
      rutas, §9.2): sesión `cliente` de la empresa X con IDs de recursos de la empresa Y
      (encargos, liquidaciones, líneas, evidencias) ⇒ 404 —jamás 403 revelador—, body
      sin cadenas centinela de Y y BD sin cambios en mutaciones; sesión del tenant A
      contra IDs del tenant B ⇒ 404 y BD de B intacta; el payload de toda respuesta del
      portal cumple schema fijo SIN columnas de economía interna del operador (tarifas
      de terceros, costos de energía, ahorro vs diésel) ni telemetría EV (§0, §9.3.2,
      §9.3.3, §3.E1.10) — oráculo: CI [AC-FPOR-06]
- [ ] (P1) Manifest del rol `cliente` = exactamente las 4 pantallas (Hoy · Encargos ·
      Nuevo/Importar CSV · Liquidación) bajo `/cliente/*` en la misma PWA; e2e que
      recorre TODO el portal con el usuario `cliente` del seed A y no encuentra rutas
      completas, datos de otra empresa, telemetría EV ni módulos del operador
      (§3.E1.10, §5.5, §10) — oráculo: CI [AC-FPOR-07]
- [ ] (P1) Ciclo del encargo solicitado: creado desde el portal nace `solicitado` (0
      filas en estados posteriores); POST de un encargo inválido desde la pantalla
      «Nuevo» (p. ej. sin destino, o bultos fuera de 1–500 — §4.5) ⇒ 422 con error
      tipado y 0 filas en BD (planificación rebota, §4.2); el cliente puede editarlo
      mientras siga `solicitado`; tras la aceptación/programación del operador, PATCH
      del cliente ⇒ 422 tipado y 0 cambios en BD, y la UI ya no ofrece edición
      (§3.E1.10, §4.5, §4.2) — oráculo: CI [AC-FPOR-08]
- [ ] (P2) Importar CSV — solo lo derivable del maestro como gate: ningún registro
      inválido del archivo crea encargos (cero filas espurias); un import íntegramente
      inválido ⇒ 422 con error tipado y 0 filas (planificación rebota, jamás degrada —
      §4.2); todo encargo creado por el import nace `solicitado` (§3.E1.10); sin
      conexión la acción se deshabilita mostrando el estado obligatorio de §5.7.
      Cláusula PROVISIONAL, ligada a la Pregunta al dueño 4 y EXCLUIDA del gate de CI
      hasta que se responda (el maestro no cierra la atomicidad del lote): en un lote
      mixto las filas válidas crean encargos y las inválidas rebotan con error tipado
      por fila visible para el cliente (§3.E1.10, §4.2, §5.7) — oráculo: CI
      [AC-FPOR-09]
- [ ] (P1) Liquidación con disputa: la pantalla lista las liquidaciones de SU empresa
      (abierta→cerrada→pagada) línea por línea; disputa por línea con motivo tipado
      dentro de la ventana de 7 días ⇒ disputa registrada y visible; fuera de la
      ventana o con motivo fuera del catálogo ⇒ 422 tipado y 0 filas — t0 PROVISIONAL
      para que el fixture sea construible: la ventana corre desde el paso de la
      liquidación a `cerrada` (el maestro fija solo la duración, §0; sujeto a la
      Pregunta al dueño 3, ajustable en UNA constante); drill-down línea→evidencia a 1
      clic; e2e contra el seed A (trae 1 liquidación disputada por línea) (§3.E1.9,
      §0, §10) — oráculo: CI [AC-FPOR-10]
- [ ] (P2) Encargos con evidencia: el detalle de un encargo propio muestra estado,
      resultado (exito|fallo|parcial) y la evidencia asociada (`evidence` §4.6, binarios
      referenciados por sha256), sin exponer el orden global de la ruta, paradas de
      terceros ni curvas de SOC (§3.E1.10, §4.6) — oráculo: CI [AC-FPOR-11]
- [ ] (P2) GUI del portal conforme a plataforma — gate GUI aplicado al portal; los
      sub-checks se reportan como ítems verificables INDIVIDUALES para que un rojo
      localice: (a) las 4 pantallas nacen con los 4 estados obligatorios (vacío
      accionable / carga / error es-CL con recuperación / sin conexión); (b)
      axe+Lighthouse verdes (4.5:1 texto, 3:1 UI, targets §0); (c) formatos es-CL y
      cero strings visibles en inglés (grep); (d) tema del tenant (logo + acento
      derivado) vía CSS custom properties del bootstrap y dark mode automático; (e)
      e2e del portal corre DOS veces (terminología base y extrema del tenant B) sin
      cambiar un selector; (f) snapshot 375px con términos al máximo largo (§5.7, §0,
      §5.1, §9.2) — oráculo: CI [AC-FPOR-12]
- [ ] (P2) Revisión adversarial del hito «portal» sin hallazgos críticos abiertos:
      datos malformados, doble-tap, red cortada a mitad de flujo, empresa A viendo lo
      de B, tenant A contra B, covering array; hallazgos → ítems del plan (§9.4) —
      oráculo: humano [AC-FPOR-13]
- [ ] (P2) Piloto A (e-auto DaaS) en producción — umbral del maestro, sin
      ampliaciones (DONE-adopción es definición CERRADA del §10): 7 días de producción
      operando con rutas manuales y ≥90% de entregas con evidencia (los umbrales que
      §10 fija para el piloto A vía §3.E2), medidos por Alexis en el panel como parte
      de DONE-adopción — JAMÁS bloquea el DONE-software del loop (§10, §3.E2, §9.2) —
      oráculo: producción [AC-FPOR-14]
- [ ] (P1) Conmutación autorizada y auditada: solo `admin_tenant` conmuta el modo
      (cualquier otro rol ⇒ 403 y 0 filas); cada conmutación escribe `audit_trail`
      (§3, §5.4, §5.5) — oráculo: CI [AC-FPOR-15]
- [ ] (P1) Semántica del preset: la conmutación cambia el entitlement efectivo
      (`override ?? plan`, §4.4) del grupo DaaS SIN mutar `plan_features` (fila
      compartida por los tenants del plan) ni filas de otro tenant, y rige recién en
      el próximo bootstrap (§3, §4.4, §5.5; el congelamiento por turno de
      `config_version_id` lo manda §5.5/§4.4 y su verificación pertenece al módulo
      dueño de `turnos` — aquí no se abre turno) — oráculo: CI [AC-FPOR-16]
- [ ] (P1) Empresa implícita en mi_flota — efecto observable (el trigger es del
      módulo 03, §4.5; aquí solo se aserta su efecto): un tenant recién provisionado
      en modo `mi_flota` tiene exactamente UNA `empresa_cliente` — la implícita, la
      propia (§3, §4.5) — oráculo: CI [AC-FPOR-17]

## Dependencias

Módulos 00–08 del mapa del orquestador (entre paréntesis, su hito del §9.1.4):

- **00 — Modelo de datos y tenancy (hito a):** `control.tenants` (columna `modo`),
  `features`/`plan_features`/`tenant_feature_overrides` y el entitlement efectivo,
  manifest de navegación server-side, BD-por-tenant con credenciales propias,
  `tenant_info` y la suite HTTP A-contra-B autogenerada — el selector de modo aplica
  presets SOBRE ese sistema y el portal hereda su aislamiento (§3, §4.1, §4.4, §5.5,
  §9.2).
- **01 — Identidad y enrolamiento (hito b):** rol `cliente` del enum fijo,
  `usuarios.empresa_cliente_id`, invitación por rol emitida por el dueño, PIN
  argon2id, sesión y `set_config('app.current_role', …)` por transacción (§4.3, §5.4,
  §4.1).
- **03 — Encargos/rutas/custodia (hito d):** `empresas_cliente` (y su trigger de
  empresa implícita en mi_flota), `encargos` con su máquina de estados (incluido
  `solicitado` y la aceptación/programación por el operador) y `destinos` (§4.5,
  §3.E1.5).
- **04 — POD offline/sync (hito e):** tabla `evidence` y los PODs para «Encargos (con
  evidencia)» y el drill-down línea→evidencia (§4.6, §3.E1.10).
- **05 — Semáforo (hito e):** la tarjeta SLA del semáforo del OPERADOR que el modo
  daas habilita y mi_flota contrae (§3.E1.11) — el portal del cliente no la muestra.
- **06 — Tarifas/liquidación (hito f, mismo hito que este módulo):** `liquidaciones` +
  `lineas` (línea=evidencia, `UNIQUE(tenant, tipo, id)`), estados y mecánica de
  disputa con motivo tipado; las vistas de liquidación para el rol `cliente` (§3.E1.8,
  §3.E1.9, §4.3).
- **08 — Panel admin white-label + wizard + seeds (hito g):** botón de modo en el
  wizard, conmutador de modo y pantalla «Funciones» en el panel admin, `tenant_theme`/
  `tenant_terminology`, y los seeds A/B/C contra los que corren los e2e de este módulo
  (§3, §5.5, §10).
- **Miga (hito 0, `packages/miga`):** tokens estructurales, componentes y theming por
  tenant que el portal consume en `/cliente/*` (§5.1).

No depende del módulo 02 (vehículos/energía/agenda): el portal JAMÁS muestra
telemetría EV ni economía de energía del operador (§3.E1.10, §3.E1.12).

## Preguntas al dueño

1. **«Visibilidad dual» del portal (§3):** el maestro usa el término para el portal
   pero no lo define ahí (la decisión (6) del encabezado define la visibilidad dual DE
   E-AUTO, otro plano). ¿Se refiere a operador-ve-todo / contratante-ve-solo-su-rebanada,
   o a la dupla vista operativa (Hoy/Encargos) + vista económica (Liquidación) dentro
   del portal? La spec implementa lo inequívoco (4 pantallas, lista JAMÁS, aislamiento);
   confirmar por si «dual» obliga algo adicional.
2. **Contenido de la pantalla «Hoy» del cliente:** el maestro solo la nombra
   (§3.E1.10). ¿Qué tarjetas/agregados muestra (p. ej. contadores de sus encargos del
   día por estado)? Mientras no se cierre, este módulo solo garantiza su existencia,
   su confinamiento a la empresa y los estados §5.7.
3. **t0 de la ventana de disputa:** ver la pregunta canónica en
   `specs/06-tarifas-liquidacion-facturacion.md`, «Preguntas al dueño» n.º 5.
4. **CSV del portal (§3.E1.10):** columnas exactas del archivo del cliente y
   atomicidad del import (¿todo-o-nada o por fila?). AC-FPOR-09 deja la semántica
   por-fila como cláusula PROVISIONAL excluida del gate de CI hasta esta respuesta;
   el gate solo aserta lo derivable del maestro (cero filas inválidas, 422 tipado,
   `solicitado`, §5.7). *Superficie DISTINTA de la del CSV de encargos de F1 (spec 03,
   pregunta 6), pero la semántica del lote —todo-o-nada vs por fila— conviene
   responderla UNA vez para ambas: son la misma regla del §4.2 aplicada a dos vías
   masivas, y respuestas divergentes obligarían a dos motores de import.*
5. **Cancelación por el cliente:** «editable solo hasta aceptación» — ¿puede el
   cliente CANCELAR un encargo `solicitado` (además de editarlo)? ¿Y después de
   aceptado (pedir cancelación al operador)? No está cerrado en el maestro.
6. **Avisos al contratante en E1:** ¿el portal es solo de consulta (polling visual) o
   hay algún aviso (p. ej. WhatsApp/SMS manual) cuando se acepta un encargo o se
   cierra una liquidación? El maestro no lo especifica y push está FUERA de E1 como
   dependencia (§3, §7.6).
7. **Criterio de adopción adicional del portal (propuesto, NO vigente):** ¿sumar a la
   checklist de adopción que al menos una empresa contratante real complete el ciclo
   solicitud→aceptación→entrega con evidencia→liquidación visible/disputable desde el
   portal? DONE-adopción es definición cerrada del §10 (el umbral del piloto A es «7
   días operando con rutas manuales y ≥90% de entregas con evidencia», §3.E2) y esta
   spec NO la amplía; queda como propuesta sujeta a aprobación del dueño.
