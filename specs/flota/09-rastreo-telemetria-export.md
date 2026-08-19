# 09 — Rastreo en vivo, telemetría y export (etapa E1.5)

Fuente: §11
Módulo de la etapa E1.5 (enmienda del dueño, 18-ago-2026): las funciones que imotion.cl
vende como «Plataforma i Motion» y que el §3 dejaba FUERA pasan a compromiso de producto.
Principio: primero lo que no necesita hardware — el teléfono del chofer ya trae GPS; lo
que exige proveedor (OBD/OEM, sensores de frío) queda CONDICIONADO con su esquema listo.
Chile solamente: es-CL, CLP entero, dd-mm-aaaa (§0). Privacidad bajo §7.8 (Ley 21.719):
la base de licitud del rastreo es la ejecución del contrato, y el rastreado SIEMPRE puede
ver que está siendo rastreado.

## 1. Posición en vivo (teléfono del chofer, solo en turno)

- La posición es CAPTURA (§4.2, §4.6): se registra en el cliente durante TURNO ABIERTO,
  viaja por el motor de sync existente (outbox, replay, idempotencia por `client_uuid`),
  jamás rebota (2xx siempre) y degrada offline a cola local. Fuera de turno el cliente NO
  captura — no es una preferencia: es minimización del §7.8.
- Tabla `posiciones` (PK UUIDv7, `tenant_id` con CHECK, FK compuesta a `turnos`,
  `client_uuid` único por tenant): lat/lng con CHECK de caja Chile, `precision_m`,
  `capturada_en` + `tz_offset_min` (doble reloj §4.6), `fuente` = enum cerrado
  (`telefono_gps`). Append-only como todo hecho (§7.4).
- El chofer VE su propio estado de rastreo en la app: desde cuándo, y que se apaga al
  cerrar turno.

## 2. Torre de control (mapa de flota del gestor)

- Pantalla del gestor: última posición conocida por vehículo EN RUTA, con la ANTIGÜEDAD
  del dato siempre visible («hace 2 min», «hace 40 min») — el mapa degrada, no inventa
  (§5.7). Sin posiciones, estado vacío honesto.
- El contratante NO ve el mapa de flota (§4.3: ve solo su rebanada; la posición del
  vehículo es economía operativa del operador).

## 3. Telemetría como registro por datos (gancho §4.9)

- `telefono_gps` se registra como implementación REAL de `ProveedorTelemetria` en el
  catálogo por datos; activar una implementación jamás toca pantallas (§4.6). OBD/OEM
  sigue como punto de extensión hasta que el dueño elija proveedor.

## 4. Export de PODs por rango

- Función de usuario del gestor: rango de fechas + empresa contratante ⇒ CSV es-CL
  (`;`, dd-mm-aaaa, CLP entero) con entregas, resultado por ítem (parciales y
  devoluciones), y referencia de evidencia (tipo + hash sha256 cuando exista binario).
  Columna de temperatura RESERVADA (vacía hasta que exista el dato del punto 5): el día
  que llegue el sensor, el export no cambia de forma.

## 5. Frío (condicionado a hardware) y eco-score v1 (sin hardware)

- Temperatura: DDL ya existe (`thermal_profile`/`alarm_rule`, DDL-only). Captura y UI
  entran cuando el dueño elija sensor (Pregunta 2). Nada se construye antes.
- Eco-score v1: eficiencia por chofer y semana = consumo DECLARADO vs
  `km_presupuesto_energia` de sus rutas. La pantalla dice QUÉ mide (eficiencia
  energética declarada) y qué NO (no es medición de manejo en tiempo real).

## Criterios de aceptación

- [x] (P1) Privacidad del rastreo (§7.8, §11): el cliente captura posición SOLO con turno
      abierto — pgTAP: INSERT de posición con turno cerrado rebota en la BD (constraint
      contra `turnos.estado`), y e2e: al cerrar turno la captura se detiene y la app del
      chofer muestra «rastreo apagado»; con turno abierto muestra «en ruta, rastreado
      desde HH:MM». El aviso al chofer no es configurable ni removible por el tenant —
      oráculo: CI [AC-FTEL-01]
      Probado: tabla `posiciones` (tenant 0074) con trigger `posiciones_exige_turno_abierto`;
      pgTAP `0038_posiciones_solo_turno_abierto.sql` (rebote con turno cerrado, 0 filas,
      append-only) y e2e `rastreo.spec.ts` (banner «rastreado desde HH:MM» con turno abierto,
      «Rastreo apagado» al cerrar, aviso no removible). `check.sh --full --app=flota` VERDE.
- [x] (P1) `posiciones` como CAPTURA del §4.6: nace en `tenant_template` con tenant_id
      horneado, append-only (UPDATE/DELETE ⇒ 42501 también para el migrador), idempotencia
      por `client_uuid` (replay doble ⇒ una fila), caja Chile en el CHECK y doble reloj —
      pgTAP nuevo con las seis invariantes — oráculo: CI [AC-FTEL-02]
      Probado: migración `0075_posiciones_captura_completa.sql` (tenant/, o sea plantilla y
      cada `t_<slug>`) suma `client_uuid` con UNIQUE (tenant_id, client_uuid), `precision_m`,
      `tz_offset_min`, `recibida_en` y `fuente posicion_fuente`, más los CHECK de caja Chile,
      huso y precisión. pgTAP `0039_posiciones_captura_completa.sql`, 31 pruebas, una sección
      por invariante: (1) tenant_id horneado —DEFAULT `tenant_actual()`, CHECK, y un tenant
      ajeno rebota 23514—; (2) UPDATE/DELETE/TRUNCATE ⇒ 42501 corriendo como dueño o
      superusuario, o sea por el trigger y no por un REVOKE; (3) replay doble del mismo
      `client_uuid` ⇒ 1 fila, y sin ON CONFLICT ⇒ 23505; (4) (0,0) y un punto europeo rebotan,
      Arica y Punta Arenas entran; (5) los dos relojes por separado y el teléfono adelantado
      NO rebota (§4.2); (6) `fuente` enum cerrado y precisión de 900 m que entra igual.
      `check.sh --full --app=flota` VERDE (18 pasos OK, 0 fallidos).
- [x] (P1) La posición viaja por el MISMO motor de sync (§4.6): lote con `posiciones` +
      capturas mezcladas ⇒ 2xx siempre; sin red encola y el replay-on-online la aterriza;
      e2e móvil offline→online con la cola verificada — oráculo: CI [AC-FTEL-03]
      Probado: e2e/rastreo-outbox.spec.ts (offline→online, lote mixto posiciones+metricas
      2xx, idempotencia por client_uuid); unit gate-capturas-sin-rechazo.test.mjs (12/12).
      El AC-ABIERTO que dejó f8ca264 eran DOS rojos del mismo defecto, no dos defectos:
      `estado-de-rastreo.tsx` capturaba por el outbox pero nunca mostraba «por
      sincronizar» con el contador real de la cola (§5.7) — y como
      `gate-capturas-sin-rechazo.mjs` corre su chequeo en el top-level del módulo,
      hasta IMPORTARLO desde el test (`gate-capturas-sin-rechazo.test.mjs`) heredaba el
      `process.exit(1)`, tumbando la suite entera antes de correr un solo test. Se agregó
      la sección «Posición — por sincronizar» (mismo patrón que
      `recarga/tarjeta-de-recarga.tsx` y `entrega/tarjeta-de-entrega.tsx`) y una
      aserción nueva en rastreo-outbox.spec.ts que la ejercita en el tramo offline.
      `check.sh --full --app=flota` VERDE (18 pasos OK, 0 fallidos).
- [x] (P1) Torre de control honesta (§5.7, §11): mapa del gestor con última posición por
      vehículo en ruta y ANTIGÜEDAD visible; posición de más de 10 min se marca
      «desactualizada» (umbral en constants.ts, familia canónica §0); sin posiciones ⇒
      estado vacío accionable; e2e con dos vehículos y relojes distintos — oráculo: CI
      [AC-FTEL-04]
      Probado: `dominio/torre-de-control.ts::antiguedadDePosicion` — función PURA contra
      `recibida_en` (reloj del SERVIDOR, jamás `capturada_en`), con `RASTREO.umbral_desactualizada_min`
      (10) de `packages/nucleo-comun/src/constants.ts`; unit `torre-de-control.test.ts` cubre el
      umbral exacto (no desactualizada) y un segundo pasado (sí), y que un reloj de teléfono
      adelantado no maquilla la antigüedad. `/api/torre-de-control` (admin_tenant/operador,
      nunca `cliente` — AC-FTEL-05) sirve `vehiculosEnRuta()`: turno abierto sin posición
      degrada a «Sin posición aún» y sin marcador en el mapa, en vez de inventar coordenadas.
      e2e `torre-de-control.spec.ts`: dos vehículos con turno abierto y sin posición (fila y
      mapa degradan por PATENTE — no por conteo total, porque el tenant `hechos` es compartido
      con `rastreo.spec.ts`/`rastreo-outbox.spec.ts` de AC-FTEL-01/03); dos relojes de servidor
      distintos (uno fresco, uno a 20 min pasado el umbral con `capturada_en` reciente que NO
      lo maquilla); y 404 pelado sin sesión. El mapa usa un ícono propio por vehículo
      (`torre-marcador-<patente>`) en vez del pin por defecto de Leaflet, indistinguible entre
      vehículos, para poder probar «degrada, no inventa» por patente en un tenant compartido.
      `check.sh --full --app=flota` VERDE (18 pasos OK, 0 fallidos).
- [x] (P1) El contratante jamás ve posiciones (§4.3): política en BD (0 filas por el
      camino del rol `cliente`) + el manifest del portal no incluye el mapa; suite de
      aislamiento extendida con la tabla nueva — oráculo: CI [AC-FTEL-05]
      Probado: migración `0076_posiciones_sin_cliente.sql` — `posiciones` con RLS y las dos
      políticas del patrón: `posiciones_base` permisiva y `sin_posiciones_para_el_cliente`
      RESTRICTIVE **FOR ALL** (no solo `FOR SELECT`), que niega cuando
      `app.current_role = 'cliente'`. No lleva rebanada por `empresa_cliente_id` como
      `encargos`/`items`/`paradas`: una posición es del VEHÍCULO y un turno carga encargos de
      varias empresas, así que el §4.3 la excluye ENTERA — mismo caso que `rutas` en la 0040.
      `db/flota/suite-bd/confinamiento.test.mjs` la ejerce con el rol de app REAL
      (`app_t_<slug>`, NOSUPERUSER, sin `BYPASSRLS`) sobre un fixture con vehículo, turno
      abierto y una posición encima: el `cliente` con empresa declarada ve 0 filas, el
      `cliente` SIN empresa declarada también (la política mira el ROL, no la empresa) y su
      INSERT rebota por la política. El UPDATE no se asevera porque no hay nada que aseverar:
      `posiciones` es append-only por REVOKE + trigger, y el 42501 le llega a todo rol. Su
      POSITIVO —sin el cual «0 filas» lo cumpliría una política que devuelve cero siempre—
      es el test del operador sin rol declarado, que sí ve exactamente esa posición. La misma
      suite extiende a `posiciones` la verificación de «RLS + sus DOS políticas».
      Del lado del portal, `apps/flota/src/dominio/manifest-cliente.test.ts` prueba que
      ningún módulo de `MODULOS_PORTAL_CLIENTE` apunta a `/torre-de-control` (AC-FTEL-04),
      con cualquier clave: la cuenta de «EXACTAMENTE 4 pantallas» detecta un quinto módulo
      cualquiera, esta nombra CUÁL no puede ser ninguno de los cuatro. El 403 de
      `/api/torre-de-control` (AC-FTEL-04) sigue siendo la primera capa; esta es la segunda,
      la que no depende de que nadie recuerde el chequeo.
      `check.sh --full --app=flota` VERDE (18 pasos OK, 0 fallidos).
- [x] (P1) `telefono_gps` en el registro por datos de `ProveedorTelemetria` (§4.9, §11):
      activar/desactivar la implementación es UPDATE de una fila, cero cambios de código
      de pantalla; el gate de ganchos pasa de exigir «solo declarada» a exigir «las del
      registro» sin aflojar el resto — oráculo: CI [AC-FTEL-06]
      Probado: DOS migraciones y no una, porque PostgreSQL no deja USAR un valor de enum en la
      misma transacción que lo agrega y el runner corre cada archivo en la suya —
      `0077_telefono_gps_en_lectura_fuente.sql` mete el valor en `lectura_fuente` (el enum del
      que cuelga `proveedor_telemetria.fuente`, tabla que existe desde la 0007 y que NO se
      recrea) y `0078_telefono_gps_en_el_registro.sql` siembra la fila activa. Aplicadas sobre
      las 43 bases del cluster + plantilla + canario, `migrar verificar` VERDE.
      El «sin aflojar el resto» era el riesgo real y no era retórico: `honestidad_de_la_alarma()`
      (0007) preguntaba `bool_and(fuente = 'declarada')`, o sea que una SEGUNDA fila activa
      cualquiera la volvía permisiva sola — registrar el GPS del teléfono habría desbloqueado
      las alarmas térmicas acumulativas de todos los tenants sin que nadie comprara una sonda y
      sin poner rojo ningún test de la 0007. La 0078 cambia la pregunta a «¿alguna fuente activa
      MIDE temperatura sola?», escrita por su complemento (`declarada`, `telefono_gps`): el
      teléfono mide posición, no temperatura, así que tampoco sostiene «estuvo N minutos fuera
      de rango» (§7.7).
      pgTAP `0040_registro_de_telemetria.sql`: las dos filas del registro y ninguna de E4;
      desactivar y reactivar `telefono_gps` con un UPDATE (con el `is` que verifica que la fila
      mandó, no una constante); el UNIQUE que impide registrarla dos veces; y los tres casos de
      la matriz — declarada+telefono_gps activas ⇒ 23514, `telefono_gps` como ÚNICA activa ⇒
      23514 (no es «cuántas», es «si alguna mide») y el positivo con `sonda_vehiculo` registrada,
      sin el cual un trigger que rechazara siempre pasaría los dos anteriores. pgTAP 0004 (enum
      cerrado) y 0005 (registro + matriz) actualizados; `hechos.test.mjs` asevera las dos filas
      en la plantilla.
      Del lado del código, `gate-ganchos-e1.mjs` cambia `FUENTE_UNICA` por
      `FUENTES_DEL_REGISTRO` y falla de arranque si esa lista y `FUENTES_DE_E4` se solapan —
      con la misma fuente en las dos, cuál gana dependería del orden del bucle. Sus mutantes
      arman el fixture DESDE la lista (una implementación futura del §11 no queda sin positivo)
      y `FUENTES_DE_E4` sigue intacta: OBD/OCPP/`api_fabricante`/`sonda_vehiculo`/`archivo_logger`
      siguen prohibidas en el árbol. `check.sh --full --app=flota` VERDE.
- [x] (P1) Export de PODs por rango (§11): gestor elige rango + empresa ⇒ CSV es-CL con
      separador `;`, fechas dd-mm-aaaa, CLP entero, resultado por ítem, devoluciones y
      hash de evidencia; columna `temperatura` presente y vacía; pgTAP del generador +
      e2e de descarga con conteos contra la BD — oráculo: CI [AC-FTEL-07]
      Probado: `/api/export-pods` (admin_tenant/operador, mismo criterio que
      `/api/torre-de-control` AC-FTEL-04) corre `podsPorRango` dentro de `enLectura` —la RLS de
      la sesión filtra por tenant y por `items.empresa_cliente_id` sin join adicional (§7.2)— y
      `filasACsv` arma el CSV es-CL: `;`, `dd-mm-aaaa` por split de texto (nunca `Date`+huso,
      que correría la fecha un día), `resultado_item` con el vocabulario de `parada_resultado`
      (0037: NULL es `pendiente`, nunca `fallo`), y la columna `temperatura` reservada y SIEMPRE
      vacía. Unit `dominio/export-pods.test.ts` (resultado por ítem, fecha, escapado RFC 4180,
      hash ausente sin binario). e2e `export-pods.spec.ts`: CSV con las 3 filas del rango+empresa
      contra conteo real de la BD (éxito/parcial/fallo), la empresa vecina en la MISMA parada
      filtrada afuera, 422 con parámetros inválidos y 404 pelado sin sesión. El export es un
      route handler de Next (`apps/flota/src/app/api/export-pods/route.ts`) y su header estándar
      `content-disposition` (para el nombre del archivo descargado) colisionaba en texto con la
      tabla DDL-only `disposition` del §4.9 (gancho de frío, sin UI en E1) — `gate-ganchos-e1.mjs`
      ahora descarta esa ocurrencia puntual antes de buscar la tabla, con su propio positivo y
      negativo en `gate-ganchos-e1.test.mjs` para que la excepción no vuelva a aflojar la
      detección real. `check.sh --full --app=flota` VERDE.
- [x] (P2) Eco-score v1 sin hardware (§11): consumo declarado vs presupuesto energético
      por chofer/semana; la pantalla nombra qué mide y qué NO («no es medición en tiempo
      real»); división por cero (sin rutas con presupuesto) ⇒ estado vacío, jamás un
      score inventado — oráculo: CI [AC-FTEL-08]
      Probado: `calcularEcoScoreSemanal` (dominio, pura) agrega por chofer+semana solo las
      rutas con `km_presupuesto_energia` positivo — las que no lo tienen cargado se
      DESCUENTAN del denominador, jamás entran como cero — y sin ninguna ruta con
      presupuesto devuelve `{ tipo: "vacio" }`, nunca un `consumoPct` inventado; unit
      `dominio/eco-score.test.ts` (suma de dos rutas antes de dividir, división por cero,
      rutas sin presupuesto descontadas, 0% real vs. vacío, agrupación por chofer Y semana,
      consumo sobre 100% sin techo, y el texto exacto del aviso). `servidor/eco-score.ts`
      arma las filas desde la BD real: quién manejó sale de `eventos` sobre `turno.abierto`
      (no existe `turnos.chofer_id`, agregarlo es DDL de sesión supervisada) y el
      kilometraje declarado es MAX-MIN de `reading` de magnitud `odometro` dentro de ESE
      turno, nunca la proyección global `vehiculos.odometro` que mezclaría turnos de días
      distintos. `/api/eco-score` con el mismo criterio de acceso que `/api/torre-de-control`
      (admin_tenant/operador, AC-FTEL-04) sirve el aviso literal (`AVISO_ECO_SCORE`) junto a
      los datos para que pantalla y dominio nunca puedan decir cosas distintas; la pantalla
      `/eco-score` lo muestra siempre visible, con estado vacío accionable cuando no hay
      ninguna fila. `check.sh --full --app=flota` VERDE.
- [ ] (P2) CONDICIONADO a la Pregunta 2 (sensor de frío): captura de temperatura hacia
      `thermal_profile` y alarma por `alarm_rule` con la UI del §5.7 — no se construye
      hasta que el dueño elija hardware — oráculo: CI [AC-FTEL-09]
- [ ] (P2) Validación en vivo: Alexis ve el mapa moviéndose con un teléfono real en un
      vehículo real (oráculo humano — DONE-adopción, no bloquea el loop) [AC-FTEL-10]

## Preguntas al dueño

1. **OBD/OEM:** ¿qué proveedor de telemetría vehicular se integra (EV48 vía e-auto u
   otro), y con qué prioridad frente al resto de E1.5?
2. **Sensor de frío:** ¿qué hardware de temperatura se usa (marca/protocolo)? AC-FTEL-09
   queda condicionado hasta esta respuesta.
3. **Retención de posiciones:** ¿cuántos días se conservan las posiciones crudas antes de
   agregarse/purgarse? (El §7.8 pide minimización; propongo 30 días crudo + agregado
   permanente por ruta, a confirmar.)
