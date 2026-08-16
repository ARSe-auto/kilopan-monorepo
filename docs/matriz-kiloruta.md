# Matriz KiloRuta — de criterio congelado a constraint y test [AC-FTEN-19]

**Qué es esto.** El consumo MECÁNICO de `docs/criterios-kiloruta.txt`: cada uno de los N
criterios congelados de KiloRuta mapeado a la tabla o restricción de FLOTA que lo sostiene y al
test que lo prueba. `db/flota/gate-matriz-kiloruta.mjs` verifica tres cosas en cada corrida del
gate: que haya exactamente N filas, que cada ID aparezca UNA vez, y que **cada test referenciado
exista de verdad en el repo**.

**Por qué existe.** «FLOTA es compatible con KiloRuta» es una afirmación que, sin esto, se
sostiene leyendo dos documentos en paralelo y confiando. La lista congelada dice QUÉ hay que
cumplir; esta matriz dice DÓNDE está cumplido y QUÉ lo prueba, y el gate impide que la respuesta
apunte a un test que alguien renombró o borró. Un criterio que apunta a un test inexistente es
peor que uno sin mapear: se lee como cubierto.

**Por qué hay filas sin test.** Los 63 criterios cubren los ocho módulos, y hoy están
construidos el 00 y el 01. Una fila cuyo AC todavía no se construyó no puede referenciar un test
que no existe, y no se la deja en blanco: lleva un marcador DECLARADO con el AC y el hito que la
va a cerrar, y el gate los CUENTA y los imprime siempre — mismo criterio que las exenciones de
rutas de AC-FTEN-26. Una fila pendiente en silencio sería una fila que nadie vuelve a mirar.
El gate exige además que haya **al menos un test real referenciado**: con todas las filas
pendientes, la tercera verificación pasaría sin haber comprobado nada.

**Cómo se referencia un test.** `ruta/al/archivo::fragmento del nombre del test`. El fragmento
es una subcadena literal que tiene que aparecer en el archivo — así el gate atrapa tanto el
archivo borrado como el test renombrado, sin depender de parsear JavaScript.

**Lo que esta matriz NO hace:** no cambia la lista congelada. Si un criterio quedó mal
clasificado, se corrige allá, con la firma del dueño, y acá se refleja.

## La matriz

| ID | tabla / constraint | test (ruta::nombre) |
|---|---|---|
| KR-01 | — (supersedido: la norte es la EEVD, §2) | — (supersedido: AC-FTAR-03/04 · hito f) |
| KR-02 | linea_devengo (creador SECURITY DEFINER único) | — (pendiente: AC-FTAR-03/04 · hito f) |
| KR-03 | eventos.event_time + tz_offset_min / record_time (§4.6) | db/flota/suite-bd/hechos.test.mjs::[AC-FTEN-24] las tablas del §4.6 nacen en |
| KR-04 | vista eevd_semanal | db/flota/pgtap/0013_eevd_semanal.sql::dos vehículos con turno abierto el mismo día |
| KR-05 | personas.rut CHECK personas_rut_modulo_11 · usuarios.rol enum rol_usuario | db/flota/suite-bd/identidad.test.mjs::[AC-FIDN-01] un RUT con dígito verificador equivocado NO entra |
| KR-06 | dispositivos.secreto_hash · dispositivos.revocado_at (revocación soft) | apps/flota/e2e/aprobacion.spec.ts::[AC-FIDN-04] una SEGUNDA aprobación de la misma solicitud rebota y no re-emite |
| KR-07 | firmas (persona_id, dispositivo_id) append-only | apps/flota/e2e/firmas.spec.ts::[AC-FIDN-10] CENTINELA 12: la sesión del titular sigue intacta |
| KR-08 | — (bloqueado: pregunta 03-7) | — (bloqueado: pregunta 03-7) |
| KR-09 | — (bloqueado: pregunta 01-1) | — (bloqueado: pregunta 01-1 — ver la nota de abajo) |
| KR-10 | empresas_cliente (§4.5) | — (pendiente: AC-FRUT-14 · hito d) |
| KR-11 | rate_card · concepto_tarifa (catálogo cerrado, máx 4 activos) | — (pendiente: AC-FTAR-01 · hito f) |
| KR-12 | tarifas append-only con vigencia | — (pendiente: AC-FTAR-02 · hito f) |
| KR-13 | round_clp() · columnas *_clp en bigint (linter del §7.5) | db/flota/lint-migraciones.test.mjs::en bigint pasa (el guard no es un no-op al revés) |
| KR-14 | bloques_agenda con EXCLUDE de ventana | apps/flota/e2e/agenda.spec.ts::el solapado rebota 422 con 0 filas |
| KR-15 | bloques_agenda (duplicar semana) | apps/flota/e2e/agenda.spec.ts::clona los bloques REALES de 7 días atrás |
| KR-16 | turnos + chequeo pre (odómetro, SOC) | apps/flota/e2e/apertura.spec.ts::el turno quedó con su chequeo y sus dos lecturas colgando |
| KR-17 | vertical_template.checklists[] | db/flota/pgtap/0002_verticales_grupos_y_parametros.sql::has_column('vertical_template', 'checklists') |
| KR-18 | proyección vehiculos.soc + fórmula de rango del §0 | apps/flota/e2e/tablero.spec.ts::el tablero aplica la fórmula única y descuenta la reserva UNA vez |
| KR-19 | eventos + review_queue (confirmación de 1 toque) | apps/flota/e2e/apertura.spec.ts::un ítem fallado NO bloquea la apertura, y la pantalla lo dice |
| KR-20 | cierre de turno (odómetro, SOC, defecto→issue) | apps/flota/e2e/apertura.spec.ts::el cierre entra en el presupuesto, con la nota adentro |
| KR-21 | encargos (empresa + destino + bultos) | — (pendiente: AC-FRUT-01 · hito d) |
| KR-22 | encargos (duplicar de ayer) | — (pendiente: AC-FRUT-17 · hito d) |
| KR-23 | encargos.estado (finales por trigger de entregas) | — (pendiente: AC-FRUT-03 · hito d · cláusula en pregunta 03-1) |
| KR-24 | encargos.reintento_de | — (pendiente: AC-FRUT-03 · hito d) |
| KR-25 | manifiestos por parada de carga y por empresa | — (pendiente: AC-FRUT-07 · hito d) |
| KR-26 | reference_document UNIQUE (tipo, folio, emisor) | — (pendiente: AC-FRUT-08 · hito d) |
| KR-27 | bajada de manifiesto (flag + evento + excepción) | — (pendiente: AC-FRUT-08/10 · hito d) |
| KR-28 | firmas.significado (doble firma responsable↔chofer) | — (pendiente: AC-FRUT-09 · hito d) |
| KR-29 | candado entrega←manifiesto confirmado | — (pendiente: AC-FRUT-22 (D1, nuevo) · hito d) |
| KR-30 | encargo creado en andén, offline | — (pendiente: AC-FMIG-18 · hito g · clase en pregunta 03-3) |
| KR-31 | custody_transfer (recepción, traspaso, entrega/devolución) | — (pendiente: AC-FRUT-09/10/21 · hito d) |
| KR-32 | rutas maestras con orden editable | — (pendiente: AC-FRUT-06 · hito d) |
| KR-33 | entregas_pod (feliz = 2 acciones) | — (pendiente: AC-FPOD-01/02 · hito e) |
| KR-34 | — (descartado: D3) | — (descartado: D3, firmada 08-ago-2026) |
| KR-35 | entregas_pod.dejado_en_punto + parametros.bultos_max_sin_receptor | — (pendiente: AC-FPOD-02/17 · hito e) |
| KR-36 | motivo de no entrega (catálogo cerrado) + parcial por ítem | — (pendiente: AC-FPOD-02 / AC-FRUT-13 · hito e) |
| KR-37 | outbox (§4.7) + contador de cola | — (pendiente: AC-FPOD-03/22 · hito e) |
| KR-38 | — (diferido a E2: D4) | — (diferido: D4, firmada 08-ago-2026) |
| KR-39 | paradas (N encargos de N empresas al mismo destino) | — (pendiente: AC-FRUT-04 · hito d) |
| KR-40 | ecuación de cierre por empresa | — (pendiente: AC-FRUT-11/21 · hito d) |
| KR-41 | cierre forzado administrativo del turno | apps/flota/e2e/turnos.spec.ts::con motivo del catálogo cierra, deja rastro y NO toca la proyección |
| KR-42 | captura de coordenadas (GPS off por omisión, §7.8) | — (pendiente: AC-FPOD-12 · hito e) |
| KR-43 | entregas_pod inmutable + evidence write-once por sha256 | — (pendiente: AC-FPOD-08/11/19 · hito e) |
| KR-44 | reading (odómetro) + trigger de proyección vehiculos.soc | db/flota/pgtap/0012_proyeccion_de_lecturas.sql::un odómetro menor NO arrastra la proyección hacia atrás |
| KR-45 | función SECURITY DEFINER única de devengo | — (pendiente: AC-FTAR-03 · hito f) |
| KR-46 | liquidaciones abierta→cerrada→pagada | — (pendiente: AC-FTAR-05 · hito f) |
| KR-47 | disputa por línea con motivo tipado | — (pendiente: AC-FTAR-06 / AC-FPOR-10 · hito f) |
| KR-48 | — (descartado: D5) | — (descartado: D5, firmada 08-ago-2026) |
| KR-49 | reference_document (SOLO registro; cero emisión de DTE) | — (pendiente: AC-FTAR-08 / AC-FRUT-08 · hito f) |
| KR-50 | review_queue como bandeja del panel Hoy | — (pendiente: AC-FSEM-01/04/05/20 · hito e · cláusula en pregunta 03-9) |
| KR-51 | vehiculo_documentos.vence_el | db/flota/pgtap/0014_vehiculo_documentos.sql::un documento que venció AYER sí está vencido |
| KR-52 | atribución turno/bloque→empresa | — (pendiente: AC-FTAR-14 · hito f · bloqueado en pregunta 06-12) |
| KR-53 | COMMENT ON TABLE con clase de la regla de oro (linter §4.2) | db/flota/lint-migraciones.test.mjs::exigencia 5 — un COMMENT sin clase de la regla de oro ⇒ rojo |
| KR-54 | UNIQUE (tenant_id, client_uuid) en las tablas de captura | db/flota/suite-bd/identidad.test.mjs::[AC-FIDN-01] el replay de una firma no crea una segunda fila (centinela 1) |
| KR-55 | EXCLUDE de solape en turnos (con WHERE estado<>'anulado') y en bloques_agenda (sin WHERE: un bloque se borra) | db/flota/pgtap/0011_turnos.sql::el EXCLUDE excluye los anulados, como pide el §4.5 |
| KR-56 | política RESTRICTIVE FOR SELECT de aplicar_rls_de_dinero(regclass) | db/flota/suite-bd/dinero.test.mjs::[AC-FTEN-21] el chofer NO ve montos pero su captura con costo NULL entra sin rebote |
| KR-57 | rut_valido() módulo 11 · lista congelada de RUTs sintéticos | packages/nucleo-comun/src/rut.test.ts::[AC-FIDN-17] la lista congelada entera: los válidos pasan y los inválidos no |
| KR-58 | reference_document UNIQUE (tipo, folio, emisor); tipos 33/39/52/61 | — (pendiente: AC-FTEN-14 (DDL) · AC-FTAR-08 · hito f · clase en pregunta 00-13) |
| KR-59 | tokens de Miga (§5.1) + teclado propio + botón primario | packages/miga/src/estructura.test.ts::la escala es la del §5.1, completa y estrictamente descendente |
| KR-60 | estados obligatorios de listado + gate axe/targets | — (pendiente: AC-FMIG-10/11/20 · hito g) |
| KR-61 | seed del tenant B «Rutapan» | — (pendiente: AC-FMIG-18 · hito g) |
| KR-62 | reading.fuente='declarada' + ProveedorTelemetria | db/flota/gate-ganchos-e1.test.mjs::cada fuente de E4 dispara si alguien la escribe como cadena |
| KR-63 | devoluciones (clase CAPTURA, client_uuid idempotente) | — (pendiente: AC-FRUT-21 · hito d) |


## Observaciones para el dueño

**KR-09 quedó desactualizado por su propia respuesta.** El criterio pide «una sesión activa por
usuario, desplazamiento auditado, auto-bloqueo a PIN» y estaba `bloqueado` esperando la pregunta
01-1 sobre duración de sesiones. Alexis la respondió el 09-ago-2026 en el sentido CONTRARIO: en
el teléfono personal la sesión no caduca mientras el aparato siga enrolado, y no se pide PIN al
abrir la PWA (AC-FIDN-09). O sea que la sustancia del criterio no se va a implementar, y no por
un olvido sino por una decisión tomada. La clase que le corresponde hoy es `supersedido`, no
`bloqueado` — pero la lista está CONGELADA y reclasificar exige un commit con firma del dueño,
así que queda anotado acá y no se toca allá.

**KR-08 sigue bloqueado de verdad** (pregunta 03-7, validar PIN sin señal): es un hueco
operativo real del milk-run de madrugada y no tiene respuesta todavía.
