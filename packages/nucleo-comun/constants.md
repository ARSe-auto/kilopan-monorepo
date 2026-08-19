# Familia canónica de constantes — Plataforma FLOTA

<!-- GENERADO por packages/nucleo-comun/scripts/generar-constants-md.mjs. NO editar a mano:
     la fuente es packages/nucleo-comun/src/constants.ts y un test compara los dos. -->

Vista legible de `packages/nucleo-comun/src/constants.ts`, que es la fuente ÚNICA de la
familia del §0 del maestro para componentes Y tests. Un número mágico de esta familia
escrito fuera del archivo canónico pone el build en rojo (`db/flota/gate-constantes.mjs`).

## Constantes

| Grupo | Valor | Qué es |
|---|---|---|
| `CAPACIDAD` | dispositivos_con_turno_abierto = 2000 · usuarios_concurrentes_por_celula = 5000 · replays_por_segundo = 100 · p95_bootstrap_ms = 400 · p95_sync_ms = 250 | Oráculo del k6 semanal, en pipeline aparte del gate de 10 min (§0, §9.2). */ |
| `CIFRA_OPERATIVA` | tamano_px = 96 · peso = 700 · variante_numerica = `tabular-nums` | La cifra que se lee desde medio metro con las manos ocupadas (§0, §5.7). */ |
| `CONTRASTE` | texto = 4.5 · ui = 3 · cifra_operativa_y_semaforos = 7 | Contraste mínimo (§5.7). El 7:1 es para sol directo sobre la cifra y los semáforos. */ |
| `DINERO` | moneda = `CLP` · tipo_sql = `bigint` · decimales = 0 · funcion_redondeo = `round_clp()` · tipos_sql_prohibidos = `numeric` · `float` · `double precision` · `real` · `money` | Dinero (§0, §4.8, §7.5). */ |
| `DTE` | tipos_referenciables = 33 · 39 · 52 · 61 · unicidad = `UNIQUE(tipo, folio, emisor)` · emite_la_app = false | Documentos tributarios que la app REFERENCIA. Jamás emite (§7.3, art. 97 N°4 CT). */ |
| `EV` | factor_consumo_default = 0.85 · factor_consumo_override = `parametros.factor_consumo` · reserva_pct_default = 15 · reserva_override = `parametros.reserva_pct` · umbrales_alerta_pct = 30 · 20 · 15 · 10 · fuente_por_defecto = `declarada` | Energía EV — la fórmula es ÚNICA y la reserva se resta en UN solo lugar (§0). rango_efectivo = autonomia_nominal_km × soh × factor_consumo      ← SIN reserva max_distance   = soc% × rango_efectivo − reserva_km               ← acá sí Restarla dos veces es el error clásico: deja al vehículo «sin alcance» con media batería. |
| `EXPORTADOR` | cadencia_min = 5 · ventana_alineada_al_reloj = true · pendientes_hasta_su_hito = `eevd_semanal (hito c)` · `backlog_sync_max_min (hito e)` | Job exportador de agregados técnicos a la BD `control` (§4.1). La cadencia la dictó Alexis el 09-ago-2026 (Pregunta al dueño 8): cada 5 minutos. Con eso los «2 intervalos» del Anexo B son 10 minutos, coherentes con el otro umbral de esa misma tabla («errores >5% por 15 min»). Son agregados chicos por tenant: el costo es despreciable y el panel cross-tenant se siente vivo sin ser tiempo real. No lleva patrón en CIFRAS_VIGILADAS a propósito: un `5` suelto aparece en cualquier parte y una vigilancia así sería ruido que alguien apaga a la semana. |
| `FORMATOS` | locale = `es-CL` · zona_horaria = `America/Santiago` · ejemplo_dinero = `$12.500` · ejemplo_fecha = `dd-mm-aaaa` · ejemplo_rut = `12.345.678-5` · validacion_rut = `modulo 11` | Formatos es-CL. Cero strings visibles en inglés (§0 Formatos, grep del gate). */ |
| `GRANT_SOPORTE` | duraciones_horas = 24 · 168 · expiracion_automatica = true · encendido_por_defecto = false | Grant de soporte: soporte SIN god-mode (§0, §4.3, §7.9). */ |
| `GRILLA` | base_px = 8 · radio_tarjeta_px = 12 · radio_control = `capsula` | Grilla y esquinas (§5.1). Todo espacio es múltiplo de la base; cero valores sueltos. */ |
| `HTTP` | recurso_ajeno = 404 · modulo_apagado = 403 · sync_captura = 200 · rebote_planificacion = 422 · flag_modulo_apagado = `modulo_apagado` · tenant_suspendido = 503 | Códigos HTTP con significado cerrado (§0, §7.2). */ |
| `IDEMPOTENCIA` | columna = `client_uuid` · tipo = `uuid v7 generado en el dispositivo` · restriccion = `UNIQUE(tenant_id, client_uuid)` · al_reintentar = `ON CONFLICT DO NOTHING` · filas_tras_replay_doble = 1 | Idempotencia de toda mutación offline (§0, §4.7). */ |
| `IDENTIDAD_DE_FILA` | generador = `uuidv7()` · version_uuid = 7 · prohibidos = `bigint (delata volumen y es adivinable)` · `uuid v4 (sin orden temporal)` | PK de toda tabla de dominio: UUIDv7 generado EN SERVIDOR — jamás bigint, jamás v4 (§0). */ |
| `INVITACION` | multiuso = true · expira_dias = 7 · revocable_en_toques = 1 · distribucion = `share-sheet del dueño` · codigo_corto_largo = 8 · codigo_corto_alfabeto = `23456789ABCDEFGHJKMNPQRSTUVWXYZ` | Invitación de enrolamiento (§0, §5.4). Da derecho a SOLICITAR, jamás a entrar. */ |
| `LABELS` | largo_max = navegacion = 12 · titulo = 24 · descripcion = 40 · requiere_singular_y_plural = true · caracteres_prohibidos = `#` · `$` · `%` · `;` · `<` · `=` · `>` | Labels renombrables por el tenant (§0, §4.4, §5.1). */ |
| `PIN` | digitos = 4 · hash = `argon2id` · intentos_hasta_bloqueo = 5 · ambito_del_bloqueo = `usuario` · backoff = `server-side` · backoff_inicial_segundos = 30 · backoff_factor = 2 · backoff_tope_segundos = 900 · backoff_se_resetea_con_acierto = true | PIN de operario (§0, §4.3). */ |
| `PLAZOS_LEGALES` | pago_dias = 30 · reclamo_factura_dias = 8 · disputa_liquidacion_dias = 7 | Plazos legales chilenos (§0, Anexo A). Cableados: la app es para Chile. */ |
| `RASTREO` | umbral_desactualizada_min = 10 | Torre de control del gestor (§0, §11, §5.7, AC-FTEL-04). El umbral que decide cuándo una posición deja de presentarse como fresca. Se mide contra `posiciones.recibida_en` —el reloj del SERVIDOR— y jamás contra `capturada_en` —el reloj del TELÉFONO—: ese es justamente el punto del doble reloj (§4.6, comentario de la 0075): un teléfono con la hora adulterada no puede maquillar la antigüedad que ve el gestor. |
| `RELOJ` | drift_max_minutos = 5 | Doble reloj: el del dispositivo y el del servidor (§0, §4.6). */ |
| `REVOCACION` | ventana_horas = 72 · flag_dentro = `post_revocacion` · flag_fuera = `post_revocacion_tardia` | Revocación de un dispositivo (§4.3, §5.4 F-F, centinela 4 del §9.3). El efecto es INMEDIATO del lado del servidor, pero el aparato pudo estar sin señal y traer capturas de antes: esas entran igual —la captura del terreno JAMÁS rebota (§4.2)— y se clasifican por cuán vieja es la ventana. El corte lo fija el maestro en el §4.3. |
| `ROLES` | `admin_tenant` · `operador` · `chofer` · `responsable_carga` · `responsable_tecnico` · `cliente` | Enum FIJO de roles. Los packs de vertical NO crean roles (§0, §4.3). */ |
| `ROLES_SIN_DINERO` | `chofer` · `responsable_carga` | Roles que JAMÁS ven un peso: regla en la BD, no en la UI (§0, §4.8). */ |
| `SEMAFORO` | tarjetas_max = 6 · umbrales_por_senal = `amarillo` · `rojo` · `recuperacion` · estados_excepcion = `nueva` · `reconocida` · `resuelta` · polling_segundos = min = 15 · max = 30 | Semáforo «Hoy» (§0, §5.6). */ |
| `SESION` | personal_caduca = false · pin_para = `firmar` · `rotar identidad en el andén` · anden_inactividad_minutos = 3 | Sesiones (§4.3, §5.4). La regla la dictó Alexis el 09-ago-2026 (spec 01, pregunta 1). En el teléfono PERSONAL la sesión no caduca mientras el dispositivo siga enrolado y sin revocar: no se pide PIN al abrir la PWA. El aparato YA es el segundo factor —enrolado, con secreto propio, revocable en 1 toque con efecto inmediato— así que el PIN en cada apertura sumaría toques al presupuesto del §5.3 sin agregar seguridad que la revocación no dé; y la fricción empuja a dejar la app abierta todo el turno, que es lo que se quería evitar. El ANDÉN es otra cosa: es un aparato compartido donde rotan identidades, y ahí la sesión sí cierra por inactividad. |
| `SOC` | minimo = 0 · maximo = 100 · tabla_con_check = `vehiculos.soc` · tabla_sin_check = `reading.valor_int` · capturas_max_por_turno = 3 | SOC: el CHECK de rango vive en UN solo lugar (§0 fila SOC, §4.2, centinela 4). En la PROYECCIÓN `vehiculos.soc` hay CHECK 0–100 y un trigger que clampa y marca flag. En la CAPTURA `reading.valor_int` NO hay CHECK de rango: una lectura fuera de rango entra con flag. Poner el CHECK ahí haría rebotar una captura, y una captura jamás rebota. |
| `TACTIL` | operativo_min = 48 · tecla_min = 64 · boton_primario = 56 · piso_wcag = 24 | Targets táctiles, en px CSS (§0, §5.7). Terreno: guantes, frío, sol, apuro. */ |
| `TARIFAS` | conceptos = `por_entrega` · `por_bulto` · `por_bloque_horas` · `por_devolucion` · `por_intento_fallido` · activos_max_por_empresa = 4 · zonas_max = 5 · modificadores = `zona` · `recargo_horario` | Tarificación: catálogo CERRADO (§0, §3.E1.8). Un concepto nuevo es cambio de contrato. */ |
| `TELEMETRIA` | proveedores_del_registro = `declarada` · `telefono_gps` | ProveedorTelemetria (§4.9, §11) — el catálogo de implementaciones REALES del registro por datos. E1 admitía una sola (`declarada`, la que usa `EV.fuente_por_defecto`); la enmienda §11 (E1.5, 18-ago-2026) suma `telefono_gps` porque el teléfono del chofer ya trae GPS y no exige hardware, a diferencia de OBD/OEM que sigue como punto de extensión (§3-FUERA) hasta que el dueño elija proveedor. La FILA de `proveedor_telemetria` (migración 0077) es la que decide si cada una está activa — esta lista es solo el catálogo cerrado de códigos válidos, la misma frontera que vigila `db/flota/gate-ganchos-e1.mjs` del lado del código-fuente. |
| `TENANCY` | patron_bd = `t_<slug>` · patron_rol_app = `app_t_<slug>` · rol_migraciones = `migrator` · tenant_canario = `t_canary` · plantilla = `tenant_template` · bd_control = `control` · tabla_identidad = `tenant_info` · funcion_constante_bd = `tenant_actual()` · instancia_dedicada_construida = false | Tenancy física: UNA base de datos por tenant (§0, §4.1). */ |
| `TENANT_ESTADOS` | `activo` · `suspendido` · `archivado` | Estados de un tenant en `control.tenants` (§4.1). Enum CERRADO: el tipo vive en la BD (`tenant_estado`) y esta lista es su espejo en el código. Un cuarto estado es una decisión del dueño y una migración, jamás una cadena suelta en un `if`. |
| `TIPOGRAFIA` | familia = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` · escala_pt = titulo_grande = 34 · cuerpo = 17 · subtitulo = 15 · pie = 13 · minimo = 11 | Tipografía estructural de Miga (§5.1). NO configurable por el tenant: el tenant personaliza EXACTAMENTE tres cosas —logo, un acento y la terminología—, y ninguna es esta. La familia es la del SISTEMA, jamás una webfont: se pinta con el primer frame, sin bajar un byte. En un andén a las 5 AM con 4G malo, una webfont es una pantalla en blanco. |
| `UNDO` | ventana_ms = 8000 · estado_local = `pending_undo` · motivo_supersede = `undo` | Undo: la ÚNICA confirmación de una captura. Cero modales en terreno (§0, §4.7, §7.6). */ |
| `UNIDADES` | energia = nombre = `Wh` · tipo_sql = `int` · temperatura = nombre = `centésimas de °C` · tipo_sql = `int` · factor = 100 · humedad = nombre = `décimas de %` · tipo_sql = `int` · factor = 10 · soc = nombre = `% entero` · tipo_sql = `smallint` · distancia = nombre = `km` · tipo_sql = `int` | Unidades enteras. Jamás float: un decimal flotante en una lectura es un bug esperando (§0). */ |

## Cifras vigiladas por el grep-gate

Lista CERRADA. Para las cifras inconfundibles el patrón es el número; para las que también
son números comunes, el patrón exige contexto — un guard que salta con cualquier `5` del
código se desactiva solo a la semana.

| Constante | Valor | Patrón que la delata fuera del archivo canónico |
|---|---|---|
| `UNDO.ventana_ms` | 8000 | `(?<![\w-])8000(?![\w-])` |
| `EV.factor_consumo_default` | 0.85 | `\b0\.85\b` |
| `CONTRASTE.texto` | 4.5 | `\b4\.5\s*:\s*1|(?<!§)\b4\.5\b(?=\s*[,;)\]])` |
| `CIFRA_OPERATIVA.tamano_px` | 96 | `\b96\s*px\b|font-?[Ss]ize[^\n]{0,12}\b96\b` |
| `CIFRA_OPERATIVA.peso` | 700 | `font-?[Ww]eight[^\n]{0,12}\b700\b` |
| `TIPOGRAFIA.familia` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | `-apple-system` |
| `TIPOGRAFIA.escala_pt` | `34/17/15/13/11` | `font-?[Ss]ize[^\n]{0,14}(?<!\d)(?:34|17|15|13|11)(?!\d)` |
| `GRILLA.base_px` | 8 | `\b8\s*px\b|(?:gap|padding|margin)[^\n]{0,14}\b8\b` |
| `GRILLA.radio_tarjeta_px` | 12 | `border-?[Rr]adius[^\n]{0,14}(?<!\d)12(?!\d)` |
| `TACTIL.boton_primario` | 56 | `\b56\s*px\b|min-?[Hh]eight[^\n]{0,14}\b56\b` |
| `TACTIL.tecla_min` | 64 | `\b64\s*px\b|min-?[HhWw](?:eight|idth)[^\n]{0,14}\b64\b` |
| `TACTIL.operativo_min` | 48 | `\b48\s*px\b|min-?[HhWw](?:eight|idth)[^\n]{0,14}\b48\b` |
| `TACTIL.piso_wcag` | 24 | `\b24\s*px\b` |
| `EV.umbrales_alerta_pct` | `30/20/15/10` | `\b30\s*,\s*20\s*,\s*15\s*,\s*10\b` |
| `CAPACIDAD.p95_bootstrap_ms` | 400 | `p95[^\n]{0,24}\b400\b` |
| `CAPACIDAD.p95_sync_ms` | 250 | `p95[^\n]{0,24}\b250\b` |
| `CAPACIDAD.dispositivos_con_turno_abierto` | 2000 | `\b2\.?000\b(?=[^\n]{0,32}dispositivo)` |
| `PIN.digitos` | 4 | `[Pp][Ii][Nn][^\n]{0,24}\b4\s*(?:d[ií]gitos?|digits?)\b` |
| `PIN.intentos_hasta_bloqueo` | 5 | `(?:lockout|intentos)[^\n]{0,24}\b5\b` |
| `RELOJ.drift_max_minutos` | 5 | `drift[^\n]{0,24}\b5\b` |
| `RASTREO.umbral_desactualizada_min` | 10 | `(?:desactualizad|antig[üu]edad)[^\n]{0,32}\b10\b` |
| `INVITACION.expira_dias` | 7 | `(?:invitaci[oó]n|invitation)[^\n]{0,32}\b7\s*d[ií]as?\b` |
| `PLAZOS_LEGALES.pago_dias` | 30 | `(?:21\.131|pago)[^\n]{0,24}\b30\s*d[ií]as?\b` |
| `PLAZOS_LEGALES.reclamo_factura_dias` | 8 | `(?:19\.983|reclamo)[^\n]{0,24}\b8\s*d[ií]as?\b` |
| `PLAZOS_LEGALES.disputa_liquidacion_dias` | 7 | `disputa[^\n]{0,24}\b7\s*d[ií]as?\b` |
| `TARIFAS.activos_max_por_empresa` | 4 | `(?:m[aá]x|max)[^\n]{0,16}\b4\s*(?:conceptos|activos)\b` |
| `SEMAFORO.tarjetas_max` | 6 | `(?:m[aá]x|max)[^\n]{0,16}\b6\s*tarjetas\b` |
| `SOC.capturas_max_por_turno` | 3 | `(?:m[aá]x|max)[^\n]{0,24}\b3\s*capturas\b` |
| `PIN.backoff_inicial_segundos` | 30 | `backoff[^\n]{0,24}\b30\b` |
| `PIN.backoff_tope_segundos` | 900 | `(?:backoff|tope)[^\n]{0,24}\b(?:900\s*s|15\s*min)` |
| `INVITACION.codigo_corto_largo` | 8 | `c[oó]digo\s+corto[^\n]{0,24}\b8\b` |
| `SESION.anden_inactividad_minutos` | 3 | `(?:inactividad|and[eé]n)[^\n]{0,24}\b3\s*min` |
| `REVOCACION.ventana_horas` | 72 | `(?:revocaci[oó]n|revocado|cuarentena|post_revocacion)[^\n]{0,40}\b72\b` |
