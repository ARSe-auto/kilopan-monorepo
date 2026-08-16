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
- [x] (P1) Confinamiento del rol en BD: constraint que exige `empresa_cliente_id NOT
      NULL` cuando rol=`cliente` (alta sin empresa ⇒ rebote); pgTAP con el rol de app
      real y `set_config('app.current_role','cliente')`: SELECT del cliente de la
      empresa X sobre TODA tabla operativa ⇒ 0 filas de la empresa Y; su liquidación es
      accesible SOLO vía las vistas destinadas al rol (§4.1, §4.3, §9.3.3) — oráculo:
      CI [AC-FPOR-05]. Probado: el CHECK `usuarios_cliente_con_empresa` (0011) y la RLS
      de `aplicar_rls_de_empresa` ya confinaban `encargos`/`items`/`usuarios`/`paradas`/
      `rutas` (AC-FRUT-12) y `liquidacion_lineas` (AC-FTAR-06) con el rol de app real;
      `db/flota/suite-bd/confinamiento-portal.test.mjs` cierra el resto de «TODA tabla
      operativa» con datos reales sobre `tarifas`, `tarifa_zonas`,
      `tarifa_recargo_horario` y `liquidaciones` (cabecera) — positivo y negativo por
      tabla, más el caso «cliente sin empresa ⇒ 0 filas» y «sin rol ⇒ el operador ve las
      dos empresas». `db/migraciones-flota/tenant/0067_vistas_liquidacion_cliente.sql`
      agrega `liquidacion_cliente`/`liquidacion_lineas_cliente` (security_invoker=true,
      invariante AC-FVEH-13) como la vía sancionada del §4.3 — RLS de la tabla base
      sigue siendo quien confina, probado con el rol de app real leyendo a través de la
      vista. `pnpm check:full --app=flota` en verde (gate propio de flota: 24 OK).
- [x] (P1) Suite HTTP de aislamiento sobre `/cliente/*` (autogenerada del manifiesto de
      rutas, §9.2): sesión `cliente` de la empresa X con IDs de recursos de la empresa Y
      (encargos, liquidaciones, líneas, evidencias) ⇒ 404 —jamás 403 revelador—, body
      sin cadenas centinela de Y y BD sin cambios en mutaciones; sesión del tenant A
      contra IDs del tenant B ⇒ 404 y BD de B intacta; el payload de toda respuesta del
      portal cumple schema fijo SIN columnas de economía interna del operador (tarifas
      de terceros, costos de energía, ahorro vs diésel) ni telemetría EV (§0, §9.3.2,
      §9.3.3, §3.E1.10) — oráculo: CI [AC-FPOR-06]. Probado: `servidor/portal-cliente.ts`
      da las cuatro lecturas mínimas del namespace (encargo, liquidación con líneas,
      línea sola, evidencia), CADA una con `where empresa_cliente_id = $2` A MANO además
      de `enLectura` — necesario porque el pool conecta como `flota_admin`
      (`rolbypassrls=true`: la RLS de 0040/0061/0063 nunca se evalúa sobre esta conexión,
      confirmado con `pg_roles`), así que el filtro explícito es la ÚNICA guardia real,
      no una redundancia. Las cuatro rutas (`src/app/cliente/api/{encargos,liquidaciones,
      liquidacion-lineas,evidencias}/[id]/route.ts`) dan 403 con rol de la casa y 404
      pelado sin sesión / id ajeno — la misma forma para las tres causas (centinela 2).
      `e2e/portal-aislamiento.spec.ts` (base propia `portal_aislamiento`, dos empresas
      contratantes X e Y del MISMO tenant): cross-empresa intra-tenant ⇒ 404 sin cadena
      centinela de Y en ninguna de las cuatro formas, control positivo propio en 2xx,
      anti-vacuidad (la razón social de Y sí es observable cuando corresponde), rol de la
      casa ⇒ 403, y el centinela 3 completo — cada respuesta tiene EXACTAMENTE las claves
      de su tipo, cero columnas del catálogo prohibido (costo, precio diésel, ahorro,
      batería, autonomía, SOH, SOC, odómetro, `tenant_id`). La mitad tenant-contra-tenant
      la corre gratis `e2e/cruce-tenant.spec.ts` [AC-FTEN-26] apenas el manifiesto declara
      el `cruce` de las cuatro rutas como `recurso` con su `ids_de_b`: encontré que esa
      suite genérica corría contra tenants fixture (`ruteo_activo`/`ruteo_activo_b`) sin
      `portal_contratante` encendido, así que el candado de módulo (AC-FPOR-04, en
      `servidor.mjs`, ANTES de Next) daba 403 al namespace ENTERO sin importar el id — un
      403 vetado para `tipo: "recurso"`, pero por la razón equivocada: no medía el
      aislamiento de este AC, medía un candado que ya había cerrado otro. Se corrigió
      sellando `portal_contratante=true` para el tenant A en un `beforeAll` de
      `cruce-tenant.spec.ts` (mismo mecanismo directo de `crear_config_version` que usa
      `portal-aislamiento.spec.ts`, hito g todavía no construido) para que el candado real
      se ejerza: sin sesión, `sesionDelTenant` rebota 404 — el mismo camino que un id
      inventado. `pnpm --filter flota e2e` 521/521 y
      `bash packages/metodo/scripts/check.sh --full --app=flota` en verde. [AC-FPOR-06]
- [x] (P1) Manifest del rol `cliente` = exactamente las 4 pantallas (Hoy · Encargos ·
      Nuevo/Importar CSV · Liquidación) bajo `/cliente/*` en la misma PWA; e2e que
      recorre TODO el portal con el usuario `cliente` del seed A y no encuentra rutas
      completas, datos de otra empresa, telemetría EV ni módulos del operador
      (§3.E1.10, §5.5, §10) — oráculo: CI [AC-FPOR-07]. Probado:
      `dominio/manifest-cliente.ts` fija las 4 pantallas como constante (a diferencia del
      manifest del operador, acá no hay entitlement que recortar: el candado es el módulo
      entero, ya cerrado por AC-FPOR-04) — `manifest-cliente.test.ts` prueba las 4 exactas,
      su orden y que ninguna clave del operador se cuele. `layout.tsx` renderiza la nav
      (`data-testid="modulo-nav-cliente"`, deliberadamente distinto del `modulo-nav` del
      operador) en las 4 pantallas reales: `page.tsx` (Hoy, resumen propio de hoy por
      estado), `encargos/page.tsx` y `liquidaciones/page.tsx` (listas propias, «use
      client» + `pedir()` contra los nuevos `GET /cliente/api/{encargos,liquidaciones}`
      —confinados por `empresa_cliente_id` de la sesión en `servidor/portal-cliente.ts`,
      mismo patrón que AC-FPOR-06—) y `nuevo/page.tsx` (shell estático: la mutación de
      alta es AC-FPOR-08 y el import es AC-FPOR-09, los dos todavía abiertos). Las 4 rutas
      de página más las 2 de API nuevas quedan declaradas en `rutas/manifiesto.json`
      (`tipo: "sin_recurso"`). `e2e/portal-manifest-cliente.spec.ts` navega con sesión REAL
      de navegador (secreto en IndexedDB, mismo mecanismo que `pod-feliz.spec.ts`) sobre un
      tenant `daas` con una empresa vecina del MISMO tenant sembrada aparte: nav = 4 exactas
      en orden; cada una de las 4 sin `modulo-nav`/`manifest-modulos`/`tarjeta-hoy` del
      operador y sin telemetría EV (batería/autonomía/odómetro/ahorro/diésel/kWh/SOC/SOH);
      «Encargos» cuenta 2 (nunca el 3° de la vecina), «Liquidación» cuenta 1 (nunca el de
      la vecina), «Hoy» resume 2 de hoy — 8/8 verdes.
      `bash packages/metodo/scripts/check.sh --full --app=flota` en verde.
- [x] (P1) Ciclo del encargo solicitado: creado desde el portal nace `solicitado` (0
      filas en estados posteriores); POST de un encargo inválido desde la pantalla
      «Nuevo» (p. ej. sin destino, o bultos fuera de 1–500 — §4.5) ⇒ 422 con error
      tipado y 0 filas en BD (planificación rebota, §4.2); el cliente puede editarlo
      mientras siga `solicitado`; tras la aceptación/programación del operador, PATCH
      del cliente ⇒ 422 tipado y 0 cambios en BD, y la UI ya no ofrece edición
      (§3.E1.10, §4.5, §4.2) — oráculo: CI [AC-FPOR-08]. Probado:
      `POST`/`PATCH /cliente/api/encargos*` reusan `crearEncargo`/`editarEncargo`
      (`servidor/encargos.ts`) con guardia del rol `cliente` — nace `solicitado` con la
      `empresa_cliente_id` de la sesión, y la ventana de edición la cierra la MISMA BD que
      usa el operador (AC-FRUT-03), entrando por un namespace distinto. UI:
      `cliente/nuevo/page.tsx` (alta) y el botón «Corregir» en `cliente/encargos/page.tsx`,
      presente únicamente en la fila cuyo `estado === "solicitado"` — ausencia del control,
      no un `disabled` que igual se ve. `e2e/portal-encargos-alta.spec.ts` (6 tests, sesión
      real de rol `cliente`): POST sin destino y con bultos fuera de 1–500 ⇒ 422 tipado y 0
      filas; POST válido nace `solicitado`; corrección aceptada mientras sigue `solicitado`;
      tras aceptación del operador (estampada directo por SQL, acto del operador es
      AC-FRUT-03) PATCH del cliente ⇒ 422 `ya_aceptado` y 0 cambios; y la UI real —
      navegador con sesión en IndexedDB— muestra «Corregir» en la fila `solicitado` y no en
      la `aceptado`, filtrando por `data-id` porque la empresa del fixture ya trae otros
      encargos `solicitado` de tests previos del mismo archivo. `pnpm check:full --app=flota`
      en verde (18 OK, 1 saltado que no aplica a flota) y
      `npx playwright test e2e/portal-encargos-alta.spec.ts` 6/6 en PRIMER PLANO.
- [x] (P2) Importar CSV — solo lo derivable del maestro como gate: ningún registro
      inválido del archivo crea encargos (cero filas espurias); un import íntegramente
      inválido ⇒ 422 con error tipado y 0 filas (planificación rebota, jamás degrada —
      §4.2); todo encargo creado por el import nace `solicitado` (§3.E1.10); sin
      conexión la acción se deshabilita mostrando el estado obligatorio de §5.7.
      Cláusula PROVISIONAL, ligada a la Pregunta al dueño 4 y EXCLUIDA del gate de CI
      hasta que se responda (el maestro no cierra la atomicidad del lote): en un lote
      mixto las filas válidas crean encargos y las inválidas rebotan con error tipado
      por fila visible para el cliente (§3.E1.10, §4.2, §5.7) — oráculo: CI
      [AC-FPOR-09]. Probado: `importarEncargosCliente` (servidor/encargos.ts) —
      hermana de `importarEncargos` del F1 (AC-FRUT-02) pero con la empresa SIEMPRE
      saliendo de `sesion.empresaClienteId` (jamás de una columna del CSV, mismo
      candado que el alta individual AC-FPOR-08) y cada fila naciendo `solicitado` a
      mano, no del default `aceptado` de la tabla (0036). Todo-o-nada, misma elección
      provisional que AC-FRUT-02 y ligada a la MISMA pregunta (la 4, hermana de la 6 de
      la spec 03). Ruta `POST /cliente/api/encargos/importar`, declarada en
      `rutas/manifiesto.json` (`sin_recurso`). UI: sección «Importar CSV» de
      `cliente/nuevo/page.tsx` — input de archivo y botón deshabilitados con
      `navigator.onLine` + eventos `online`/`offline` (§5.7), banner
      `csv-sin-conexion` mientras dura. `e2e/portal-importar-csv.spec.ts` 8/8 en
      PRIMER PLANO: CSV bueno crea `solicitado`, replay no duplica, íntegramente
      inválido ⇒ 422 con 0 filas, lote mixto no deja entrar la fila mala (invariante
      bajo cualquier semántica de la pregunta 4), columnas faltantes, archivo vacío,
      la empresa nunca sale del CSV, y offline real (`context().setOffline`)
      deshabilita el control en la UI real con sesión de navegador.
      `bash packages/metodo/scripts/check.sh --full --app=flota` en verde.
- [x] (P1) Liquidación con disputa: la pantalla lista las liquidaciones de SU empresa
      (abierta→cerrada→pagada) línea por línea; disputa por línea con motivo tipado
      dentro de la ventana de 7 días ⇒ disputa registrada y visible; fuera de la
      ventana o con motivo fuera del catálogo ⇒ 422 tipado y 0 filas — t0 PROVISIONAL
      para que el fixture sea construible: la ventana corre desde el paso de la
      liquidación a `cerrada` (el maestro fija solo la duración, §0; sujeto a la
      Pregunta al dueño 3, ajustable en UNA constante); drill-down línea→evidencia a 1
      clic; e2e contra el seed A (trae 1 liquidación disputada por línea) (§3.E1.9,
      §0, §10) — oráculo: CI [AC-FPOR-10]. Probado: el motor entero ya vivía en la BD
      desde AC-FTAR-06/07 (`disputar_linea()` 0066, vistas 0067); esta vuelta cerró la
      superficie HTTP del portal (`/cliente/api/motivos-disputa`,
      `/cliente/api/liquidacion-lineas/[id]/{disputa,evidencia}`) y la pantalla
      `cliente/liquidaciones` con `?id=` (lista de líneas, drill-down a 1 clic,
      formulario de disputa con idempotencia por `client_uuid`).
      `e2e/portal-liquidacion-disputa.spec.ts` 9/9 en PRIMER PLANO (camino dorado,
      replay/doble-tap, los tres 422 tipados del §4.2, 404 de línea inexistente, UI
      real con sesión de navegador, y sin sesión ⇒ 404). `manifiesto.json` con sus
      casos de cruce; `pnpm check:full --app=flota` en verde.
- [x] (P2) Encargos con evidencia: el detalle de un encargo propio muestra estado,
      resultado (exito|fallo|parcial) y la evidencia asociada (`evidence` §4.6, binarios
      referenciados por sha256), sin exponer el orden global de la ruta, paradas de
      terceros ni curvas de SOC (§3.E1.10, §4.6) — oráculo: CI [AC-FPOR-11]. Probado:
      `resultadoDelEncargoCliente` (`servidor/portal-cliente.ts`) lee la fila VIGENTE de
      `entregas_pod` (cerrada, sin supersede) del encargo y la evidencia colgada de su
      parada, confinado por `empresa_cliente_id` de la sesión — devuelve `null` sin
      entrega y, con ella, `{resultado, metodo_entrega, motivo_etiqueta, event_time,
      evidencias}` con cada evidencia `{tipo, capturada_en, sha256}`, cero columnas de
      `orden`/`ruta_id`/`parada_id`/SOC. `GET /cliente/api/encargos/[id]` (AC-FPOR-06) lo
      suma al payload; UI en `/cliente/encargos?id=` (mismo criterio `?id=` que
      AC-FPOR-10) con estado vacío cuando aún no hay entrega. `e2e/portal-encargo-detalle.spec.ts`
      5/5 en PRIMER PLANO: resultado `null` sin entrega, éxito con dos evidencias (una con
      sha256, una sin binario), fallo con `motivo_etiqueta`, ninguno de los tres cuerpos
      expone la parada de un TERCERO en la MISMA ruta ni su `orden`, la lista enlaza al
      detalle y el detalle real (sesión de navegador) muestra estado/resultado/evidencia,
      y el estado vacío accionable sin entrega. `bash packages/metodo/scripts/check.sh
      --full --app=flota` en verde (18 OK, 1 saltado que no aplica a flota).
- [x] (P2) GUI del portal conforme a plataforma — gate GUI aplicado al portal; los
      sub-checks se reportan como ítems verificables INDIVIDUALES para que un rojo
      localice: (a) las 4 pantallas nacen con los 4 estados obligatorios (vacío
      accionable / carga / error es-CL con recuperación / sin conexión); (b)
      axe+Lighthouse verdes (4.5:1 texto, 3:1 UI, targets §0); (c) formatos es-CL y
      cero strings visibles en inglés (grep); (d) dark mode automático de las 4
      pantallas (tema local propio del portal, mismo criterio que `HOY_TEMA_CSS` de
      AC-FSEM-12) — el theming COMPLETO del tenant (logo + acento derivado vía CSS
      custom properties del bootstrap, §5.1) es AC-FMIG-02 (módulo 08, aún no
      construida) y el portal lo hereda sin trabajo adicional cuando esa AC cierre,
      igual que ya lo hace «Hoy»: ver AC-FPOR-18; (e) e2e del portal corre DOS veces
      (terminología base y extrema del tenant B) sin cambiar un selector; (f) snapshot
      375px con términos al máximo largo (§5.7, §0, §5.1, §9.2) — oráculo: CI
      [AC-FPOR-12]. Probado: `TEMA_PORTAL_CSS` (`cliente/tema-portal.ts`) inyecta
      `--portal-*` con par claro/oscuro vía `prefers-color-scheme` en las 4 pantallas;
      `portal-terminologia.ts` resuelve `?terminologia=extremo` con los mismos
      `data-testid`; estados de carga/error/vacío/offline en cada pantalla
      (`conexion.ts`, `EstadoError`, CTAs de vacío). `e2e/portal-aa-estados.spec.ts`
      30/30 en PRIMER PLANO: los 4 estados por pantalla, axe wcag2aa claro y oscuro sin
      violaciones de `color-contrast`, grep de inglés, fondo distinto entre esquemas,
      terminología base vs extrema sin cambiar selector, snapshot 375px sin recorte.
      `bash packages/metodo/scripts/check.sh --full --app=flota` en verde (18 OK, 1
      saltado que no aplica a flota).
- [ ] (P2) Theming completo del tenant aplicado al portal: logo + acento derivado vía
      CSS custom properties del `tenant_theme` inyectadas desde el bootstrap,
      reemplazando el par `--portal-*` local de AC-FPOR-12 una vez exista la
      infraestructura de AC-FMIG-02 (módulo 08, «Theming por filas», aún no
      construida); sin AC-FMIG-02 este ítem no tiene qué consumir — BLOQUEADO, no
      abandonado (§5.1, §9.2) — oráculo: CI [AC-FPOR-18]
- [ ] (P3) Gap de cobertura hallado por AC-FPOR-13: e2e explícito de «empresa X del
      tenant contra la línea/evidencia de liquidación de la empresa Y» sobre
      `POST /cliente/api/liquidacion-lineas/[id]/disputa` y
      `GET /cliente/api/liquidacion-lineas/[id]/evidencia` — el código de
      `disputarLineaDelCliente`/`evidenciaDeLineaDelCliente`
      (`servidor/portal-cliente.ts`) ya confirma la propiedad de la línea contra la
      empresa de la sesión ANTES de mutar/leer (no es un bypass), pero ningún e2e lo
      demuestra con datos reales entre dos empresas del mismo tenant, a diferencia de
      `portal-aislamiento.spec.ts` que sí lo hace para los 4 GET del portal — oráculo:
      CI [AC-FPOR-19]
- [x] (P2) Revisión adversarial del hito «portal» sin hallazgos críticos abiertos:
      datos malformados, doble-tap, red cortada a mitad de flujo, empresa A viendo lo
      de B, tenant A contra B, covering array; hallazgos → ítems del plan (§9.4) —
      oráculo: humano [AC-FPOR-13]
  - Revisión de código contra las 6 categorías, sobre TODO el perímetro `/cliente/*` +
    selector de modo (rutas, `servidor/portal-cliente.ts`, `servidor/portal.ts`,
    `servidor/gobierno.ts`, `dominio/manifest-cliente.ts`, `dominio/portal-ruta.ts`,
    las 4 pantallas). **Datos malformados**: JSON roto/cuerpo ausente cae en catch en
    TODAS las rutas mutadoras; IDs no-UUID rebotan `noExiste()` antes de tocar la BD.
    **Empresa A viendo lo de B**: cada lectura/mutación filtra explícito por
    `empresa_cliente_id = sesion.empresaClienteId` (el pool es `flota_admin`, RLS no
    alcanza) — incluidas las dos rutas anidadas que el AC pide mirar con atención
    (`liquidacion-lineas/[id]/disputa` y `.../evidencia`: la propiedad de la línea se
    confirma ANTES de mutar/leer). **Tenant A contra B**: `cruce-tenant.spec.ts`
    (autogenerada del manifiesto) cubre las 4 lecturas y las 4 mutaciones del portal
    con comparación de huella de B. **Covering array**: módulo OFF, empresa sin datos,
    lote CSV mixto — cubiertos por `portal-modulo-apagado`/`portal-aa-estados`/
    `portal-importar-csv`.spec.ts.
  - **Hallazgo CRÍTICO, arreglado en este commit**: el alta individual del portal
    (`cliente/nuevo/page.tsx`) nunca mandaba `client_uuid` — a diferencia de CADA otro
    formulario mutador del producto (`bandeja`, `turno/abrir`, `turno/cerrar`,
    `FormularioDeDisputa` de este mismo portal). Como `encargos.client_uuid` es
    NULLable y `unique(tenant_id, client_uuid)` no deduplica NULL, un doble-tap o un
    reintento tras un corte de red a mitad del submit creaba un encargo DUPLICADO real
    y facturable, sin ninguna guarda server-side (solo el `disabled` del botón). Fix:
    un `client_uuid` por intento (`useState(() => crypto.randomUUID())`), renovado
    SOLO tras un alta exitosa — mismo patrón que `FormularioDeDisputa`. Test nuevo:
    `e2e/portal-encargos-alta.spec.ts` («doble-tap / reintento con el MISMO
    client_uuid deja UNA sola fila»).
  - **Hallazgo NO crítico, arreglado en este commit**: `EdicionDeEncargo.guardar()`
    (`cliente/encargos/page.tsx`) cerraba el formulario de corrección ante CUALQUIER
    422 con `mensaje` (que es prácticamente todos), no solo `ya_aceptado` — el usuario
    perdía el feedback de por qué falló su corrección (p. ej. bultos fuera de rango)
    porque el formulario se desmontaba en el mismo tick que aparecía el error. Fix:
    solo cierra en `error === "ya_aceptado"`. Test nuevo en el mismo e2e («un rebote
    de bultos NO cierra el formulario de corrección»).
  - **Hallazgos NO críticos, registrados como ítems nuevos del plan** (§9.4, sin
    tocar código de otro AC en este commit): (a) `fecha_servicio` nunca se valida
    como fecha antes del cast `::date` en `crearEncargo`/`editarEncargo`
    (`servidor/encargos.ts`) — un valor no-fecha sube como 500 no tipado en vez del
    422 que el resto del código respeta; función COMPARTIDA por el portal y por
    `bandeja/page.tsx` del operador (AC-FRUT-01/03), así que el fix queda fuera de
    este AC — nuevo AC-FRUT-25 (spec 03). (b) el mismo patrón de `client_uuid` que
    esta revisión encontró y cerró en el portal existe TAL CUAL en
    `bandeja/page.tsx` (`client_uuid: crypto.randomUUID()` generado de nuevo en CADA
    llamada a `guardar()`, sin `enviando` que desactive el botón): un doble-tap ahí
    también duplicaría un encargo — mismo AC-FRUT-25. (c) sin caso e2e explícito
    «empresa X contra la línea/evidencia de empresa Y del mismo tenant» sobre
    `POST .../disputa` y `GET .../evidencia` — el código está correcto por lectura
    (sin bypass), es gap de cobertura — nuevo AC-FPOR-19 (este mismo módulo).
  - Verificación: `bash packages/metodo/scripts/check.sh --full --app=flota` en
    verde, con los dos e2e nuevos citados corriendo en PRIMER PLANO.
- [ ] (P2) Piloto A (e-auto DaaS) en producción — umbral del maestro, sin
      ampliaciones (DONE-adopción es definición CERRADA del §10): 7 días de producción
      operando con rutas manuales y ≥90% de entregas con evidencia (los umbrales que
      §10 fija para el piloto A vía §3.E2), medidos por Alexis en el panel como parte
      de DONE-adopción — JAMÁS bloquea el DONE-software del loop (§10, §3.E2, §9.2) —
      oráculo: producción [AC-FPOR-14]
- [x] (P1) Conmutación autorizada y auditada: solo `admin_tenant` conmuta el modo
      (cualquier otro rol ⇒ 403 y 0 filas); cada conmutación escribe `audit_trail`
      (§3, §5.4, §5.5) — oráculo: CI [AC-FPOR-15]. Probado: la mitad de la
      autorización ya la ejercía `guardia()` (`servidor/gobierno.ts`, ROL_DE_GOBIERNO =
      `admin_tenant`) que usa `/api/gobierno/modo`, y el barrido genérico de
      `e2e/gobierno.spec.ts` [AC-FIDN-12] la cubre automáticamente por manifiesto (403 y
      0 filas para rol no-dueño sobre CADA ruta `/api/gobierno/*`). Faltaba la mitad del
      `audit_trail`: `tenant_info` no lleva el trigger genérico `auditar()` (solo el de
      la empresa implícita, 0039) y engancharlo pedía una migración fuera de alcance del
      motor (AGENTS.md, esquema de sesión supervisada). Se escribió a mano en
      `conmutarModo` (`servidor/modo.ts`), mismo patrón que `registrarAcceso` de
      `soporte.ts` para lo que tampoco cuelga de ese trigger — un `insert into
      audit_trail` con `tabla='tenant_info'`, `operacion='UPDATE'` y el antes/después del
      modo, en la MISMA transacción que la mutación y el evento. Nuevo test
      `[AC-FPOR-15]` en `e2e/modo.spec.ts`: dos conmutaciones dejan dos filas nuevas en
      `audit_trail` con su antes/después exactos. `pnpm --filter flota exec playwright
      test e2e/modo.spec.ts e2e/gobierno.spec.ts` en PRIMER PLANO (20/20) y
      `bash packages/metodo/scripts/check.sh --full --app=flota` en verde.
- [x] (P1) Semántica del preset: la conmutación cambia el entitlement efectivo
      (`override ?? plan`, §4.4) del grupo DaaS SIN mutar `plan_features` (fila
      compartida por los tenants del plan) ni filas de otro tenant, y rige recién en
      el próximo bootstrap (§3, §4.4, §5.5; el congelamiento por turno de
      `config_version_id` lo manda §5.5/§4.4 y su verificación pertenece al módulo
      dueño de `turnos` — aquí no se abre turno) — oráculo: CI [AC-FPOR-16]. Probado:
      la fórmula cruda (`entitlement_efectivo`, recorte→override→plan) ya la ejercía
      `db/flota/suite-bd/control.test.mjs` [AC-FTEN-22]; faltaba probar el efecto por
      el camino REAL de la app —`conmutarModo`/`PATCH /api/gobierno/modo`, el mismo de
      AC-FPOR-15— acotado al propio tenant, y la congelación del §4.4. Nuevo
      `e2e/preset-modo.spec.ts`: un plan propio con las 4 features del contratante y un
      tenant vecino (control-only, `estado='suspendido'` para no entrar en el barrido
      del exportador) que comparte ese plan — conmutar a `mi_flota` apaga las 4 en el
      propio y dice ON en el vecino, y `plan_features` queda con las mismas filas
      antes/después; y sellando `config_version` con `crear_config_version()` antes y
      después de conmutar (sin abrir turno), la versión YA sellada queda con el valor
      viejo —append-only— y solo la sellada DESPUÉS ve el cambio, mientras que
      `entitlement_efectivo()` en `control` ya lo refleja de inmediato (la distinción
      que hace cierto «rige recién en el próximo bootstrap»). `npx playwright test
      e2e/preset-modo.spec.ts` 2/2 en PRIMER PLANO y
      `bash packages/metodo/scripts/check.sh --full --app=flota` en verde. [AC-FPOR-16]
- [x] (P1) Empresa implícita en mi_flota — efecto observable (el trigger es del
      módulo 03, §4.5; aquí solo se aserta su efecto): un tenant recién provisionado
      en modo `mi_flota` tiene exactamente UNA `empresa_cliente` — la implícita, la
      propia (§3, §4.5) — oráculo: CI [AC-FPOR-17]. Probado: el efecto se aserta por el
      camino REAL del alta (`provisionar()`, el servicio que consume el wizard —
      AC-FPOR-01), no sobre una base rellenada a mano como hace el fixture del centinela
      11. Faltaban las dos mitades que el alta no escribía: la identidad de la empresa
      dueña (`rutDeLaEmpresa`/`razonSocial` → `tenant_info`, sin la cual el trigger 0039
      no crea nada y no rebota) y la RÉPLICA del modo en `tenant_info` (§7.2: el trigger
      no puede cruzar a `control`) — el alta lo escribía SOLO en `control.tenants`, así
      que un tenant dado de alta en `daas` nacía con la réplica en su default `mi_flota`
      y se llevaba una empresa implícita que el §3 no le da. La escritura va después de
      hornear `tenant_actual()`, porque `empresas_cliente` lleva
      `check (tenant_id = tenant_actual())`. Nueva
      `db/flota/suite-bd/empresa-implicita.test.mjs`: alta en `mi_flota` ⇒ exactamente
      una fila, `implicita`, con el RUT y la razón social del tenant y su `tenant_id`;
      el mismo alta en `daas` ⇒ cero (la implícita es efecto del MODO, no del alta); la
      segunda implícita rebota contra el índice parcial `empresas_cliente_una_implicita`;
      e identidad a medias rebota antes de tocar el cluster. 4/4 en verde y
      `bash packages/metodo/scripts/check.sh --full --app=flota` en verde.

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
