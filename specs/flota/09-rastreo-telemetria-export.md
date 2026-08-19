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
- [ ] (P1) La posición viaja por el MISMO motor de sync (§4.6): lote con `posiciones` +
      capturas mezcladas ⇒ 2xx siempre; sin red encola y el replay-on-online la aterriza;
      e2e móvil offline→online con la cola verificada — oráculo: CI [AC-FTEL-03]
- [ ] (P1) Torre de control honesta (§5.7, §11): mapa del gestor con última posición por
      vehículo en ruta y ANTIGÜEDAD visible; posición de más de 10 min se marca
      «desactualizada» (umbral en constants.ts, familia canónica §0); sin posiciones ⇒
      estado vacío accionable; e2e con dos vehículos y relojes distintos — oráculo: CI
      [AC-FTEL-04]
- [ ] (P1) El contratante jamás ve posiciones (§4.3): política en BD (0 filas por el
      camino del rol `cliente`) + el manifest del portal no incluye el mapa; suite de
      aislamiento extendida con la tabla nueva — oráculo: CI [AC-FTEL-05]
- [ ] (P1) `telefono_gps` en el registro por datos de `ProveedorTelemetria` (§4.9, §11):
      activar/desactivar la implementación es UPDATE de una fila, cero cambios de código
      de pantalla; el gate de ganchos pasa de exigir «solo declarada» a exigir «las del
      registro» sin aflojar el resto — oráculo: CI [AC-FTEL-06]
- [ ] (P1) Export de PODs por rango (§11): gestor elige rango + empresa ⇒ CSV es-CL con
      separador `;`, fechas dd-mm-aaaa, CLP entero, resultado por ítem, devoluciones y
      hash de evidencia; columna `temperatura` presente y vacía; pgTAP del generador +
      e2e de descarga con conteos contra la BD — oráculo: CI [AC-FTEL-07]
- [ ] (P2) Eco-score v1 sin hardware (§11): consumo declarado vs presupuesto energético
      por chofer/semana; la pantalla nombra qué mide y qué NO («no es medición en tiempo
      real»); división por cero (sin rutas con presupuesto) ⇒ estado vacío, jamás un
      score inventado — oráculo: CI [AC-FTEL-08]
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
