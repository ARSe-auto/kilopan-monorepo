# Matriz de compatibilidad KiloRuta → Plataforma FLOTA (E1)

Fuente de los criterios: `docs/PROMPT_MAESTRO_KILORUTA.md` (690 líneas, leído íntegro),
SUPERSEDIDO por `docs/PROMPT_MAESTRO_FLOTA.md` (encabezado y Anexo C del maestro FLOTA:
sus criterios de diseño quedan incorporados como criterios DE PLATAFORMA; su alcance
operativo = pack `vertical-panaderia` + seeds del tenant B «Rutapan»).

**Relación con la lista congelada del hito (a):** esta matriz es el artefacto del
CONSOLIDADOR (prueba de compatibilidad del primer tenant real). La lista CONGELADA
`docs/criterios-kiloruta.txt` (IDs KR cerrados + N explícito, aprobada por Alexis) y la
`docs/matriz-kiloruta.md` mecánica del repo (`ID | tabla/constraint | test`) se producen
como AC-FTEN-18/AC-FTEN-19 en el hito (a); esta matriz es su insumo directo.

Estados: **cubierto** (spec+AC de FLOTA lo satisfacen) · **parcial** (satisfecho en parte,
con hueco explícito) · **pendiente** (no cubierto en E1 — nota honesta del porqué).

IDs KR estables (jamás se renumeran), en orden de lectura del maestro de KiloRuta
(§2 → §3.1–3.7 → §4–§10). Todos los AC-ID citados fueron verificados uno por uno contra
las specs 00–08 de esta carpeta.

| ID | Criterio KiloRuta (origen) | Dónde lo satisface FLOTA (spec · AC) | Estado |
|---|---|---|---|
| KR-01 | Variable norte IFD: CLP devengado ÷ furgón-día, computable de `liquidacion_lineas` (§2) | SUPERSEDIDO por decisión del dueño #2 del maestro FLOTA: la norte de plataforma es la EEVD (§2 FLOTA). La sustancia (todo peso devengado enlazado a evidencia) vive en 06 · AC-FTAR-03/04. El IFD como métrica por tenant NO se computa en ninguna spec E1 | pendiente (supersedido por EEVD; métrica IFD no existe en E1) |
| KR-02 | 100% del devengo enlazado a su evidencia; cero líneas manuales (§2/§3.7) | 06 · AC-FTAR-03 (solo SECURITY DEFINER crea líneas; INSERT directo 42501; sin endpoint manual), AC-FTAR-04 (línea = exactamente UNA evidencia, UNIQUE) | cubierto |
| KR-03 | Doble reloj: fecha del devengo por reloj del dispositivo; el del servidor manda para el resto (§2/§4) | §4.6 FLOTA (event_time+tz_offset / record_time) · 04 · AC-FPOD-05/21; devengo por `event_time` en 06 · AC-FTAR-03 | cubierto |
| KR-04 | Furgón-día operativo por EVENTO de apertura (no snapshot); recarga/mantención jamás en el denominador (§2) | 02 · AC-FVEH-20 (denominador de `eevd_semanal` = turnos abiertos, computado de eventos append-only; los bloques recarga/mantención no son turnos abiertos). Turno anulado: pregunta 7 de la spec 02 | cubierto |
| KR-05 | Identidad RUT validado módulo 11 + PIN 4 dígitos; roles operativos fijos (§3.1) | 01 · AC-FIDN-01/06/17 (FLOTA mejora: argon2id en vez de bcrypt; enum de 6 roles ⊇ los 4 de KR con admin=admin_tenant) | cubierto |
| KR-06 | Dispositivos enrolados; secreto emitido UNA vez; revocación sin DELETE (§3.1/§4) | 01 · AC-FIDN-04 (emisión única contra clave pública) y AC-FIDN-09 (revocado_at soft) | cubierto |
| KR-07 | Firma puntual ≠ sesión: PIN en dispositivo ajeno solo deja evento, jamás desplaza la sesión propia (§3.1/§9 centinela 3 KR) | 01 · AC-FIDN-10 y 03 · AC-FRUT-09 (centinela 12 FLOTA); PODs posteriores del titular válidos | cubierto |
| KR-08 | Validar PIN sin señal: pin_hash de los usuarios del turno cacheado en el dispositivo enrolado (§3.1) | Ninguna spec lo cierra: la spec 03 (pregunta 7) deja explícitamente abierto cómo se verifica el PIN de OTRO usuario offline (¿hash en snapshot vs validación diferida + flag?) | pendiente (pregunta abierta 03-7) |
| KR-09 | 1 sesión activa concurrente por usuario; desplazamiento auditado; auto-bloqueo a PIN 10 min (§4 sesiones_operador) | El maestro FLOTA no fija duración/caducidad/re-autenticación de sesiones; la spec 01 lo eleva como pregunta 1. Nada implementable hoy | pendiente (pregunta abierta 01-1) |
| KR-10 | Empresa cliente de primera clase: quién paga y liquida, separada del receptor (§3.2) | 03 · AC-FRUT-14 (`empresas_cliente` §4.5) y 06 · AC-FTAR-01 (rate card por empresa) | cubierto |
| KR-11 | Rate card por empresa con catálogo cerrado y tope de conceptos activos (KR: 3) (§3.2/§4 tarifas) | 06 · AC-FTAR-01 — catálogo FLOTA de 5 con máx 4 activos; los 3 de KR caben (por_entrega, por_bulto, por_bloque→`por_bloque_horas`) | cubierto |
| KR-12 | Tarifas append-only con vigencia histórica; UPDATE de precio ⇒ RAISE (§4 tarifas) | 06 · AC-FTAR-02 | cubierto |
| KR-13 | CLP entero con `round_clp()` calculado por la BD; la UI jamás reimplementa redondeos (§4/§7) | 00 · AC-FTEN-09; 06 · AC-FTAR-03 (grep cero float/aritmética fuera de BD); 08 · AC-FMIG-05 (la UI solo formatea) | cubierto |
| KR-14 | Agenda del vehículo con bloques que reservan ventana; recarga/mantención como agenda pura (§3.3) | 02 · AC-FVEH-07 (bloques ruta/recarga/mantencion/descanso con EXCLUDE) y AC-FVEH-08 (recarga es plan Y captura — FLOTA amplía a captura del cierre) | cubierto |
| KR-15 | «Duplicar semana» clona los bloques REALES de 7 días atrás; la semana real es la plantilla (§3.3) | 02 · AC-FVEH-07 (colisiones con bloques existentes: pregunta 12 de la spec 02) | cubierto |
| KR-16 | Apertura de turno compacta en una pantalla: checklist + odómetro + SOC (§3.3) | 02 · AC-FVEH-10 (F3 ≤9 acciones, teclado propio; FLOTA fija presupuesto de toques en vez de «una pantalla» literal) | cubierto |
| KR-17 | Checklist fijo de 8 ítems SOLO en la primera apertura del día por furgón, con severidad por ítem (§3.3/§4 chequeos) | Parcial: los checklists llegan como filas de `vertical_template.checklists[]` (00 · AC-FTEN-12; seeds 08 · AC-FMIG-15/18; ítems del pack: pregunta 10 de la spec 02). La condición «solo primera apertura del día» y el n=8 NO existen en el maestro FLOTA ni en spec alguna | parcial |
| KR-18 | Semáforo «Alcanza / No alcanza — recarga antes» textual al abrir (§3.3/§5 FC1) | 02 · AC-FVEH-09/10 (FLOTA reemplaza el `soc_minimo_pct` fijo de KR por la fórmula única del §0 — mejora deliberada; texto jamás solo color, 7:1) | cubierto |
| KR-19 | SOC bajo o ítem bloqueante fallado JAMÁS exige admin: UN toque de confirmación + evento + cola (§4 chequeos/§5 FC1) | 02 · AC-FVEH-10 (§7.6 FLOTA: confirmación auditada de UN toque; `bloqueante` real solo lo marca el operador) y AC-FVEH-04 | cubierto |
| KR-20 | Cierre de turno mínimo: odómetro + SOC + reporte de daño opcional (§3.3/§5 FC5) | 02 · AC-FVEH-21 (F5 ≤6 con chequeo post OK-por-defecto y nota opcional; el daño entra por la cadena defecto→issue de AC-FVEH-04) | cubierto |
| KR-21 | Encargo en <10 s con 3 campos digitados (empresa + destino + bultos; fecha default hoy) (§3.4) | 03 · AC-FRUT-01 (≤4 acciones; el «<10 s» es racional del presupuesto) | cubierto |
| KR-22 | «Duplicar encargos de ayer» como gesto masivo (§3.4) | 03 · AC-FRUT-17 | cubierto |
| KR-23 | Estados del encargo: intermedias por triggers, finales SOLO trigger de entregas; `anulado` prohibido tras POD (§3.4/§4) | Parcial: finales solo-por-trigger y edición hasta aceptación en 03 · AC-FRUT-03. La regla explícita «anulado prohibido tras POD» cae dentro de la máquina de estados NO enumerada por el maestro FLOTA (pregunta 1 de la spec 03) | parcial |
| KR-24 | Reintento = encargo NUEVO con `reintento_de` al fallido, conservando historia (§3.4) | 03 · AC-FRUT-03 (patrón OptimoRoute §6 FLOTA) | cubierto |
| KR-25 | Sub-manifiesto POR parada de carga y POR EMPRESA, firmado EN el punto; declarado vs contado; discrepancia registrada en el punto (§3.5) | 03 · AC-FRUT-07 (cifra 96px, «Conforme» 1 toque, undo 8 s, ≤4 acciones) | cubierto |
| KR-26 | DTE asociado ANTES de abandonar la parada (escaneo TED o tipo+folio manual como fallback primario) (§3.5/§7) | 03 · AC-FRUT-08 (folio manual obligatorio como fallback — §7.6 FLOTA: jamás depender de cámara) | cubierto |
| KR-27 | «Bajar del manifiesto»: la mercadería se queda, flag + evento + excepción; las otras empresas JAMÁS rehenes; sin override silencioso (§3.5/§7) | 03 · AC-FRUT-08 (vía explícita con evento y auditoría) y AC-FRUT-10 (degradación 2xx + cola) | cubierto |
| KR-28 | Doble firma responsable↔chofer por PIN al confirmar; UNA firma sella ambas si son la misma persona (§3.5/§4 manifiestos) | 03 · AC-FRUT-09 (firmas `libero` + `recibio_conforme`; una si misma persona) | cubierto |
| KR-29 | Ninguna parada de entrega se abre sin manifiesto confirmado — ancla del art. 55 (§3.5/§4 paradas) | El maestro FLOTA ancla el art. 55 en el DTE-gate del manifiesto (§7.3) pero NO trae el candado «entrega no abre sin manifiesto confirmado», y ningún AC de las specs lo asserta (la validación bloqueante del cliente §4.2 podría subsumirlo, pero nadie lo especifica) | pendiente (proponer para la lista congelada o descartar con nota del dueño) |
| KR-30 | Encargo mínimo creado EN ANDÉN por el responsable durante la recepción, offline, con evento (§3.5) | Parcial: el seed B lo exige y lo siembra 08 · AC-FMIG-18 («1 encargo creado en andén», §10 FLOTA); la CLASE de esa creación (PLANIFICACIÓN rebota vs CAPTURA offline) está bloqueada por la pregunta 3 de la spec 03 — la vía offline de KR no está garantizada aún | parcial |
| KR-31 | Custodia legal: recepción, traspaso y entrega/devolución como hechos inmutables con identidad (C. Comercio 166) (§4 eventos/§7) | 03 · AC-FRUT-09/10 (firmas + `custody_transfer` + eventos append-only; 42501 a UPDATE/DELETE; supersede con original intacta) y AC-FRUT-21 (devolución como hecho con su captura) | cubierto |
| KR-32 | Ruta maestra recurrente con orden editable a mano; sin VRP (§3.6) | 03 · AC-FRUT-06 (drag & drop solo escritorio; VRP explícitamente E2) | cubierto |
| KR-33 | App del chofer lineal «siguiente parada» con UNA acción primaria; POD ≤4 toques (§3.6/§5 FC3) | 04 · AC-FPOD-01/02 (feliz = 2 acciones exactas — supera el ≤4 de KR); 08 · AC-FMIG-21 (una acción primaria por pantalla) | cubierto |
| KR-34 | Receptor precargado desde el destino (contacto_nombre) y editable en el POD (§4 destinos/§5 FC3) | No cubierto: `destinos` de FLOTA (§4.5) no trae contacto y el POD feliz de 2 acciones no captura receptor; el maestro FLOTA no exige receptor en E1 (evidencia extra solo vía stop_requirement, y no existe tipo «receptor») | pendiente (decisión de plataforma: relajado; llevar a la lista congelada solo si el dueño lo repone) |
| KR-35 | `dejado_en_punto` de primera clase; con bultos > umbral exige encuadre y queda flageado a la cola (§3.6) | 04 · AC-FPOD-02/17 (`parametros.bultos_max_sin_receptor`; valor seed: pregunta 1 de la spec 04; cámara denegada degrada con flag) | cubierto |
| KR-36 | No entregado = motivo de catálogo cerrado; parcial admitido (§3.6) | 04 · AC-FPOD-02 (3 acciones; parcial por ítem con stepper — FLOTA lo mejora a nivel ítem) y 03 · AC-FRUT-13 (motivos por tenant). Nota: la foto obligatoria de la no-entrega KR se relaja a mejora progresiva (§7.6 FLOTA, decisión de plataforma) | cubierto |
| KR-37 | 100% offline con «Entregada — por sincronizar» y contador real de cola (§3.6/§5) | 04 · AC-FPOD-03 (+AC-FPOD-22 estados) | cubierto |
| KR-38 | Refresco PULL del delta de ruta en cada sync (banner «Ruta actualizada: +1 parada»; el operador ve si el teléfono la recibió) (§3.6/§5 FO2) | No cubierto en E1: el snapshot FLOTA se congela al publicar (§5.2 F1, 04 · R7) y ninguna spec trae delta de ruta en curso ni indicador «recibido en el teléfono»; la re-planificación de pendientes es E2 (§3.E2) | pendiente |
| KR-39 | La parada de entrega agrupa N encargos de N empresas al mismo destino como caso normal (§4 paradas) | 03 · AC-FRUT-04 (UNA parada, desglose por empresa conservado) | cubierto |
| KR-40 | Ecuación de cierre POR EMPRESA (cargado = entregado + devuelto + faltante); la ruta NO cierra descuadrada; clasificación táctil del descuadre (§3.6/§4 cierres) | 03 · AC-FRUT-11 (función SECURITY DEFINER; descuadre por sync degrada 2xx + cola, coherente con la regla de oro) y AC-FRUT-21 (la parte `devuelto` materializa filas de `devoluciones`) | cubierto |
| KR-41 | Cierre forzado administrativo del operador para turno sin cierre (evento + datos flageados, sin alimentar monotonicidad) (§3.6/§4 chequeos) | No cubierto en E1: el semáforo detecta el turno sin cerrar (05 · AC-FSEM-08, rojo) pero la ACCIÓN de cierre forzado no existe en el maestro FLOTA ni en spec alguna | pendiente |
| KR-42 | GPS denegado bloquea en el cliente y lo dice; precisión mala JAMÁS bloquea (§4 entregas) | 04 · AC-FPOD-12 — con la lectura FLOTA: lo bloqueado es la captura de coordenadas, no el POD (pregunta 2 de la spec 04); GPS off por defecto por minimización 21.719 (§3.E1.15). El literal KR (lat/lng NOT NULL en el POD) queda relajado por decisión de plataforma | cubierto (relajado respecto de KR; confirmar en la lista congelada) |
| KR-43 | POD inmutable una vez cerrado; corrección = supersede; foto write-once por sha256 (§4/§7) | 04 · AC-FPOD-08/11/19 (write-once + UNIQUE parcial + supersede + sha256 antes del binario) | cubierto |
| KR-44 | Odómetro monotónico contra el chequeo vigente (degrada a flag al sync); proyección del vehículo SOLO por trigger desde el chequeo vigente (§4 furgones/chequeos) | 02 · AC-FVEH-05 — FLOTA fija monotonicidad SUAVE (flag siempre, jamás rebote §4.6), más permisiva que el rebote online de KR: compatible hacia el lado que jamás pierde capturas | cubierto (nota: KR rebotaba online; FLOTA degrada siempre) |
| KR-45 | Devengo por UNA función SECURITY DEFINER al cerrar cada entrega/devolución/bloque (evento-driven, no batch) (§3.7) | 06 · AC-FTAR-03 (fuente única SECURITY DEFINER). El maestro FLOTA no fija el MOMENTO (evento-driven vs corte); la spec 06 tampoco — queda a diseño del build | cubierto (momento no fijado) |
| KR-46 | Liquidación semanal por empresa `abierta→cerrada→pagada`; inmutable desde cerrada (§3.7/§4) | 06 · AC-FTAR-05 (transiciones solo adelante; cerrada congela); periodicidad semanal dura vs parámetro: pregunta 1 de la spec 06 (el seed §10 es semanal) | cubierto |
| KR-47 | Disputa por línea con nota registrada (§3.7) | 06 · AC-FTAR-06 y 07 · AC-FPOR-10 — FLOTA amplía: motivo TIPADO + ventana 7 días + el cliente disputa directo desde el portal; el operador puede registrar la recibida por otro canal | cubierto |
| KR-48 | Preliquidación = PDF exportado de la liquidación abierta, compartido fuera de la app (§3.7/§5 FO5) | No cubierto en E1: ninguna spec FLOTA trae export PDF de liquidación; el canal FLOTA es el portal del contratante (07) con drill-down línea→evidencia. Si el tenant B lo exige, es ítem nuevo para el dueño | pendiente |
| KR-49 | Factura: la emite el operador por su vía SII y la app SOLO registra el folio; jamás emite DTE (§3.7/§7) | 06 · AC-FTAR-08 (registro manual vía `reference_document` + grep de firmas de estructura DTE); 03 · AC-FRUT-08 | cubierto |
| KR-50 | Panel «Hoy» con bandeja viva de excepciones y acciones (reintentar mañana / devolver / contactar) (§3.7/§5 FO3) | Parcial: bandeja y accionabilidad en 05 · AC-FSEM-01/04/05 (playbook por señal; «llamar» y «reasignar» en N2, AC-FSEM-20); «reintentar» existe como duplicación con historia (03 · AC-FRUT-03/17); la devolución YA tiene tabla y captura (03 · AC-FRUT-21) pero nace SOLO de la clasificación táctil del descuadre en el cierre F5 — «devolver» como acción desde la bandeja de excepciones no existe y su origen adicional está en la pregunta 9 de la spec 03 | parcial |
| KR-51 | Vencimientos visibles: revisión técnica, permiso de circulación, próximo servicio por km (§3.7/§4 furgones) | Parcial: documentos con vencimiento y recordatorios en 02 · AC-FVEH-17 (revisión técnica, permiso, SOAP §3.E1.3); «próximo servicio por km» NO existe en FLOTA (catálogo de tipos: pregunta 2 de la spec 02; mantención por km no es documento con fecha) | parcial |
| KR-52 | Bloque furgón-turno dedicado a UNA empresa como unidad de venta (turnos.empresa_cliente_id; devengo por bloque) (§3.3/§4 turnos) | Parcial y AHORA DECLARADO: el concepto `por_bloque_horas` existe (06 · AC-FTAR-01/03) pero el esquema FLOTA §4.5 no trae la atribución turno/bloque→empresa que KR resolvía con `turnos.empresa_cliente_id`. La spec 06 lo eleva como pregunta al dueño 12 con AC-FTAR-14 BLOQUEADO en esa aserción, y la spec 02 declara el pendiente sin agregar columna alguna (Dependencias, aguas abajo). Nada se implementa hasta la respuesta | parcial (bloqueo declarado: 06 · p. 12 → AC-FTAR-14) |
| KR-53 | Regla de oro: invariantes de PLANIFICACIÓN rebotan online; CAPTURAS jamás rebotan al sync (flag + evento + cola) (§4) | 00 · AC-FTEN-06 (clasificación en DDL + linter); 04 · AC-FPOD-05/20 (motor); 02 · AC-FVEH-05; 03 · AC-FRUT-10; centinelas 4 y 5 | cubierto |
| KR-54 | Replay doble de CUALQUIER mutación ⇒ count(*)=1 por client_uuid (§4/§9 centinela 1 KR) | 04 · AC-FPOD-04 (centinela 1 FLOTA); 00 · AC-FTEN-08 (contrato de idempotencia en DDL) | cubierto |
| KR-55 | EXCLUDE de agenda WHERE estado<>'anulado': anular y reemplazar idéntico PASA; el solape real rebota (§4/§9 centinela 5 KR) | 02 · AC-FVEH-06/07 — el WHERE está; el caso positivo explícito «reemplazo idéntico pasa» no está enunciado como aserción y conviene explicitarlo al congelar la lista KR (test barato) | cubierto (nota para la lista congelada) |
| KR-56 | El chofer JAMÁS ve CLP — regla de rol probada con el rol real (§5 FC5/§7) | 00 · AC-FTEN-21 (patrón RLS); 02 · AC-FVEH-08; 06 · AC-FTAR-09 (centinela 10: SELECT 0 filas + INSERT de recarga pasa) | cubierto |
| KR-57 | Enteros duros: bultos 1–500, CLP entero; RUT módulo 11; lat/lng caja Chile (§4 unidades) | 03 · AC-FRUT-01 (bultos) y AC-FRUT-15 (lat/lng); 00 · AC-FTEN-09 (CLP); 01 · AC-FIDN-17 (RUT) | cubierto |
| KR-58 | DTE con UNIQUE(tipo, folio, emisor), tipos 33/39/52/61, solo registrado (§4 documento_tributario) | 00 · AC-FTEN-14 (DDL con UNIQUE; creador ÚNICO, y la spec 03 ya lo declara así); 03 · AC-FRUT-08/10 (creación/liga de filas desde F2); 06 · AC-FTAR-08 (folio de la liquidación). Residuo abierto: la CLASE `COMMENT ON TABLE` de `reference_document` está declarada CAPTURA por la spec 03 y PLANIFICACIÓN por la spec 06 — hay que dirimirla con el dueño antes de escribir la migración (el maestro no la clasifica) | cubierto (clase del COMMENT por dirimir) |
| KR-59 | Sistema Miga íntegro: cifra 96/700 tabular-nums con test, teclado propio ≥64px, botón primario 56px anclado, undo 8 s en vez de modales, ÚNICA modal = manifiesto incompleto, ningún estado solo por color, es-CL (§5) | 08 · AC-FMIG-01/03/05; 04 · AC-FPOD-08 (undo, cero modales); 03 · AC-FRUT-07/08 (única modal); dark mode FLOTA de serie (§5.1) supera el «solo claro» del MVP KR | cubierto |
| KR-60 | Estados obligatorios de todo listado + AA medible (axe, targets, VoiceOver en flujos clave, 200%, cero aria-label vacíos) (§5) | 08 · AC-FMIG-10/11/20 (+AC-FMIG-12 humano); 04 · AC-FPOD-22/23/24; 05 · AC-FSEM-12; 07 · AC-FPOR-12 | cubierto |
| KR-61 | Seed panadero realista: 2 EV48 (90 bultos), 4 panaderías, 2 rutas de madrugada consolidadas (12 y 9 paradas), manifiestos con DTEs, encargo de andén, reintento, descuadre clasificado, liquidación cerrada con folio y pagada (§10) | 08 · AC-FMIG-18 — el tenant B «Rutapan» del §10 FLOTA reproduce el seed KR casi literal; la farmacia (bloque $45.000) y la distribuidora ($3.500) del seed KR viven en el tenant A e-auto DaaS | cubierto |
| KR-62 | SOC DECLARADO manda: sin telemetría/OBD/OCPP en MVP; semáforo sobre SOC declarado (§3-FUERA/§4) | 02 · AC-FVEH-05 (`fuente='declarada'`) y AC-FVEH-14 (`ProveedorTelemetria` con única implementación `declarada`; telemetría real = E4). FLOTA añade la fórmula única de rango (§0) donde KR prohibía el motor aritmético — supersedido a favor de FLOTA por diseño | cubierto (mejora deliberada de plataforma) |
| KR-63 | La devolución es ESTRUCTURAL, no excepción: tabla `devoluciones` con su captura (bultos + motivo + evidencia) y conservación contra lo cargado (§3.6/§4 devoluciones, §6 Bimbo DSD) | 03 · AC-FRUT-21 — `devoluciones` nace en el módulo 03 (creador ÚNICO), clase CAPTURA, con `client_uuid` idempotente, viaja por el motor de sync del 04 (2xx siempre, replay doble ⇒ 1 fila) y cuadra la ecuación por empresa vía AC-FRUT-11; el seed A «1 devolución» devenga exactamente 1 línea `por_devolucion` (06 · AC-FTAR-04/14). Origen adicional desde una no-entrega de F4: pregunta 9 de la spec 03 | cubierto |

## Resumen

- **Criterios mapeados:** 63 (KR-01…KR-63). IDs estables: KR-01…KR-63 conservan su
  significado; jamás se renumera lo ya emitido.
- **Cubiertos:** 49 · **Parciales:** 6 (KR-17, KR-23, KR-30, KR-50, KR-51, KR-52) ·
  **Pendientes/no cubiertos en E1:** 8 (KR-01, KR-08, KR-09, KR-29, KR-34, KR-38,
  KR-41, KR-48).
- **Cambios respecto de la revisión anterior de esta matriz** (todos verificados leyendo
  las specs, no reportes): KR-63 pasa de *pendiente* a *cubierto* (la tabla y captura de
  `devoluciones` ya tienen creador único con AC propio: 03 · AC-FRUT-21); KR-52 pasa de
  «bloqueante NO declarado» a *bloqueo declarado* (06 · pregunta 12 + AC-FTAR-14
  bloqueado + pendiente declarado en la spec 02); KR-58 pierde la doble declaración de
  dueño de `lot`/`reference_document` (00 es el creador único y la spec 03 ya lo dice)
  pero conserva un residuo nuevo: la CLASE del `COMMENT ON TABLE` de
  `reference_document` está contradicha entre 03 (CAPTURA) y 06 (PLANIFICACIÓN).
- Los pendientes y parciales se reparten en cuatro clases honestas:
  1. **Supersedidos por decisión del maestro FLOTA** (KR-01 IFD→EEVD; parte de KR-42 y
     KR-62): no son huecos — son la plataforma corrigiendo a KiloRuta; deben quedar
     anotados así en la lista congelada para que el gate no los exija.
  2. **Bloqueados por pregunta abierta ya registrada en una spec** (KR-08 → 03-7,
     KR-09 → 01-1, KR-23 → 03-1, KR-30 → 03-3, KR-52 → 06-12): se cierran cuando Alexis
     responda; ninguno se implementa por adelantado.
  3. **Fuera de E1 sin decisión explícita del maestro FLOTA** (KR-29 candado
     manifiesto→entrega, KR-34 receptor precargado, KR-38 delta de ruta en curso,
     KR-41 cierre forzado, KR-48 PDF de preliquidación, el «próximo servicio por km» de
     KR-51, el checklist de 8 ítems «solo primera apertura» de KR-17): son las omisiones
     REALES a resolver con el dueño al aprobar `docs/criterios-kiloruta.txt`
     (AC-FTEN-18) — entrar a E1, diferir con nota, o descartar.
  4. **Residuo de coherencia entre specs, sin decisión del dueño todavía:** la clase
     PLANIFICACIÓN|CAPTURA de `reference_document` (KR-58) — el linter (AC-FTEN-06)
     exige UNA clase y el maestro no la fija; falta la pregunta al dueño equivalente a
     la que ya existe para `lot` (00 · p. 11).
- La operación del tenant B (Rutapan) es viable en E1 con lo cubierto: consolidación
  multi-panadería, custodia con DTE, POD offline, devoluciones, ecuación de cierre y
  liquidación con evidencia están completos. Los huecos operativos concretos que quedan
  para el pan de madrugada son KR-08 (PIN sin señal en milk-run), KR-30 (encargo de
  andén offline) y KR-48 (canal de preliquidación).
