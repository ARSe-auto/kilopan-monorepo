// FAMILIA CANÓNICA DE CONSTANTES DE LA PLATAFORMA FLOTA — §0 del maestro.
//
// Fuente ÚNICA para componentes Y tests. `constants.md` se GENERA desde este archivo
// (`node packages/nucleo-comun/scripts/generar-constants-md.mjs`) y nunca se edita a mano.
//
// La regla que le da sentido: **un número mágico de esta familia escrito fuera de este
// archivo pone el build en rojo** (§0). El grep-gate vive en `db/flota/gate-constantes.mjs`
// y la lista de lo que vigila está más abajo, en `CIFRAS_VIGILADAS` — dentro de este mismo
// archivo a propósito, para que agregar una constante y olvidar su vigilancia sea un acto
// visible en el mismo diff y no una omisión silenciosa.
//
// Todo lo de acá es DATO, jamás lógica: cero funciones, cero consultas, cero condicionales.

/** PK de toda tabla de dominio: UUIDv7 generado EN SERVIDOR — jamás bigint, jamás v4 (§0). */
export const IDENTIDAD_DE_FILA = {
  /** Función del servidor que genera la PK. Nativa desde PostgreSQL 18. */
  generador: "uuidv7()",
  version_uuid: 7,
  /** Prohibidos como PK de dominio, con su razón. */
  prohibidos: ["bigint (delata volumen y es adivinable)", "uuid v4 (sin orden temporal)"],
} as const;

/** Idempotencia de toda mutación offline (§0, §4.7). */
export const IDEMPOTENCIA = {
  columna: "client_uuid",
  tipo: "uuid v7 generado en el dispositivo",
  restriccion: "UNIQUE(tenant_id, client_uuid)",
  al_reintentar: "ON CONFLICT DO NOTHING",
  /** Centinela 1 (§9.3): replay doble de CUALQUIER mutación ⇒ exactamente 1 fila. */
  filas_tras_replay_doble: 1,
} as const;

/** Tenancy física: UNA base de datos por tenant (§0, §4.1). */
export const TENANCY = {
  /** Nombre de la BD de un tenant. `<slug>` es el subdominio. */
  patron_bd: "t_<slug>",
  /** Rol de aplicación del tenant: NOSUPERUSER, NOBYPASSRLS, sin ownership. */
  patron_rol_app: "app_t_<slug>",
  /** Rol separado que aplica migraciones. La app jamás lo usa. */
  rol_migraciones: "migrator",
  /** Tenant sintético al que el runner migra PRIMERO (§4.1, centinela 13). */
  tenant_canario: "t_canary",
  /** Plantilla versionada del repo: 4ª vida de todo cambio de esquema. */
  plantilla: "tenant_template",
  /** Plano de control. Sin datos operativos de dominio. */
  bd_control: "control",
  /** Fila única por BD tenant con el id y el slug del tenant. */
  tabla_identidad: "tenant_info",
  /**
   * El CHECK de `tenant_id` en toda tabla de dominio compara contra esta función.
   *
   * El §4.1 lo escribe como `CHECK (tenant_id = (SELECT id FROM tenant_info))`, que
   * PostgreSQL RECHAZA: «cannot use subquery in check constraint» (verificado contra
   * PostgreSQL 18.4 antes de escribir una línea de DDL). La forma implementable —y la
   * única segura ante `pg_restore`, donde las funciones se crean antes de que llegue el
   * COPY de los datos— es una función IMMUTABLE con el uuid del tenant HORNEADO como
   * literal en el momento de la provisión. Un invariante verifica que coincida siempre
   * con `tenant_info.id`.
   */
  funcion_constante_bd: "tenant_actual()",
  /** Instancia dedicada del plan Empresa: documentada, NO construida en MVP (§0, §4.1). */
  instancia_dedicada_construida: false,
} as const;

/** Enum FIJO de roles. Los packs de vertical NO crean roles (§0, §4.3). */
export const ROLES = [
  "admin_tenant",
  "operador",
  "chofer",
  "responsable_carga",
  "responsable_tecnico",
  "cliente",
] as const;
export type Rol = (typeof ROLES)[number];

/** Roles que JAMÁS ven un peso: regla en la BD, no en la UI (§0, §4.8). */
export const ROLES_SIN_DINERO = ["chofer", "responsable_carga"] as const;

/** Dinero (§0, §4.8, §7.5). */
export const DINERO = {
  moneda: "CLP",
  tipo_sql: "bigint",
  /** Entero en unidad menor. El peso chileno no tiene decimales en circulación. */
  decimales: 0,
  /** ÚNICA función de redondeo. La UI formatea; jamás redondea (§7.5). */
  funcion_redondeo: "round_clp()",
  tipos_sql_prohibidos: ["numeric", "float", "double precision", "real", "money"],
} as const;

/** Unidades enteras. Jamás float: un decimal flotante en una lectura es un bug esperando (§0). */
export const UNIDADES = {
  energia: { nombre: "Wh", tipo_sql: "int" },
  temperatura: { nombre: "centésimas de °C", tipo_sql: "int", factor: 100 },
  humedad: { nombre: "décimas de %", tipo_sql: "int", factor: 10 },
  soc: { nombre: "% entero", tipo_sql: "smallint" },
  distancia: { nombre: "km", tipo_sql: "int" },
} as const;

/**
 * SOC: el CHECK de rango vive en UN solo lugar (§0 fila SOC, §4.2, centinela 4).
 *
 * En la PROYECCIÓN `vehiculos.soc` hay CHECK 0–100 y un trigger que clampa y marca flag.
 * En la CAPTURA `reading.valor_int` NO hay CHECK de rango: una lectura fuera de rango
 * entra con flag. Poner el CHECK ahí haría rebotar una captura, y una captura jamás rebota.
 */
export const SOC = {
  minimo: 0,
  maximo: 100,
  tabla_con_check: "vehiculos.soc",
  tabla_sin_check: "reading.valor_int",
  /** Máximo de capturas de SOC por turno; validado en el CLIENTE (§0, §4.2). */
  capturas_max_por_turno: 3,
} as const;

/**
 * Tipografía estructural de Miga (§5.1). NO configurable por el tenant: el tenant
 * personaliza EXACTAMENTE tres cosas —logo, un acento y la terminología—, y ninguna es
 * esta.
 *
 * La familia es la del SISTEMA, jamás una webfont: se pinta con el primer frame, sin
 * bajar un byte. En un andén a las 5 AM con 4G malo, una webfont es una pantalla en
 * blanco.
 */
export const TIPOGRAFIA = {
  familia: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  /**
   * Escala iOS del §5.1, en pt. Cinco peldaños, estrictamente descendente. La cifra
   * operativa (96) NO es un peldaño de esta escala: es su propio token, porque no se
   * usa como texto sino como instrumento de lectura a distancia (ver CIFRA_OPERATIVA).
   */
  escala_pt: {
    titulo_grande: 34,
    cuerpo: 17,
    subtitulo: 15,
    pie: 13,
    minimo: 11,
  },
} as const;

/** Grilla y esquinas (§5.1). Todo espacio es múltiplo de la base; cero valores sueltos. */
export const GRILLA = {
  base_px: 8,
  radio_tarjeta_px: 12,
  /** Los CONTROLES no llevan radio en px sino cápsula: radio = mitad de la altura. */
  radio_control: "capsula",
} as const;

/** Targets táctiles, en px CSS (§0, §5.7). Terreno: guantes, frío, sol, apuro. */
export const TACTIL = {
  operativo_min: 48,
  tecla_min: 64,
  boton_primario: 56,
  /** Piso absoluto de WCAG. Por debajo no entra nada, ni decorativo. */
  piso_wcag: 24,
} as const;

/** La cifra que se lee desde medio metro con las manos ocupadas (§0, §5.7). */
export const CIFRA_OPERATIVA = {
  tamano_px: 96,
  peso: 700,
  /** Sin esto los dígitos bailan al actualizarse y el número se vuelve ilegible. */
  variante_numerica: "tabular-nums",
} as const;

/** Contraste mínimo (§5.7). El 7:1 es para sol directo sobre la cifra y los semáforos. */
export const CONTRASTE = {
  texto: 4.5,
  ui: 3,
  cifra_operativa_y_semaforos: 7,
} as const;

/** Undo: la ÚNICA confirmación de una captura. Cero modales en terreno (§0, §4.7, §7.6). */
export const UNDO = {
  ventana_ms: 8000,
  estado_local: "pending_undo",
  /** Deshecho después del replay: supersede con este motivo, EXCLUIDO del métrico de gaming. */
  motivo_supersede: "undo",
} as const;

/** Labels renombrables por el tenant (§0, §4.4, §5.1). */
export const LABELS = {
  largo_max: { navegacion: 12, titulo: 24, descripcion: 40 },
  /** Ambos obligatorios: sin plural la UI improvisa y queda en inglés o en spanglish. */
  requiere_singular_y_plural: true,
  caracteres_prohibidos: ["#", "$", "%", ";", "<", "=", ">"],
} as const;

/** Códigos HTTP con significado cerrado (§0, §7.2). */
export const HTTP = {
  /** Recurso de otro tenant: 404 SIEMPRE. Un 403 confirmaría que el recurso existe. */
  recurso_ajeno: 404,
  /** Módulo apagado: 403, y SOLO en endpoints de planificación o lectura. */
  modulo_apagado: 403,
  /** Sync de captura: 2xx SIEMPRE. El mundo físico ya ocurrió (§4.2). */
  sync_captura: 200,
  /** Rebote de planificación: error tipado. */
  rebote_planificacion: 422,
  /** Flag con el que entra una captura de un módulo que se apagó con el turno abierto. */
  flag_modulo_apagado: "modulo_apagado",
  /**
   * Semántica de fallo del ruteo por subdominio, dictada por Alexis el 09-ago-2026
   * (Pregunta 9 de la spec 00) y cableada en AC-FTEN-05:
   *
   *   subdominio sin tenant en `control` → 404 (no se revela si el subdominio existe)
   *   tenant `suspendido`                → 503 con página propia en es-CL, cero acceso a su BD
   *   tenant `archivado`                 → 404, como si no existiera
   *
   * El 404 de los dos extremos es el MISMO de `recurso_ajeno` a propósito: si el subdominio
   * inexistente y el archivado respondieran distinto, la diferencia sería el oráculo que
   * revela cuáles existen.
   */
  tenant_suspendido: 503,
} as const;

/**
 * Estados de un tenant en `control.tenants` (§4.1). Enum CERRADO: el tipo vive en la BD
 * (`tenant_estado`) y esta lista es su espejo en el código. Un cuarto estado es una decisión
 * del dueño y una migración, jamás una cadena suelta en un `if`.
 */
export const TENANT_ESTADOS = ["activo", "suspendido", "archivado"] as const;
export type TenantEstado = (typeof TENANT_ESTADOS)[number];

/** Oráculo del k6 semanal, en pipeline aparte del gate de 10 min (§0, §9.2). */
export const CAPACIDAD = {
  dispositivos_con_turno_abierto: 2000,
  usuarios_concurrentes_por_celula: 5000,
  replays_por_segundo: 100,
  p95_bootstrap_ms: 400,
  p95_sync_ms: 250,
} as const;

/** Doble reloj: el del dispositivo y el del servidor (§0, §4.6). */
export const RELOJ = {
  /** Por encima de esto se marca flag. JAMÁS se rebota: el teléfono puede estar mal. */
  drift_max_minutos: 5,
} as const;

/**
 * Torre de control del gestor (§0, §11, §5.7, AC-FTEL-04).
 *
 * El umbral que decide cuándo una posición deja de presentarse como fresca. Se mide contra
 * `posiciones.recibida_en` —el reloj del SERVIDOR— y jamás contra `capturada_en` —el reloj del
 * TELÉFONO—: ese es justamente el punto del doble reloj (§4.6, comentario de la 0075): un
 * teléfono con la hora adulterada no puede maquillar la antigüedad que ve el gestor.
 */
export const RASTREO = {
  /** Más de esto sin una posición nueva ⇒ la UI la marca «desactualizada» (§5.7: el mapa
   *  degrada, no inventa; una posición de hace 40 min mostrada como «en vivo» es una mentira). */
  umbral_desactualizada_min: 10,
} as const;

/** PIN de operario (§0, §4.3). */
export const PIN = {
  digitos: 4,
  hash: "argon2id",
  intentos_hasta_bloqueo: 5,
  /** POR USUARIO, jamás por dispositivo: en el andén rotan varios sobre el mismo aparato. */
  ambito_del_bloqueo: "usuario",
  backoff: "server-side",
  /**
   * La curva la dictó Alexis el 09-ago-2026 (spec 01, pregunta 9): la espera se DUPLICA a
   * partir de medio minuto y se topa. Quien se equivoca de verdad es casi siempre el operario
   * con guantes a las 4am, y una espera corta que crece sola lo frena sin dejarlo tirado.
   *
   * El tope no es cosmético: el bloqueo es por usuario, pero el que espera es el turno, y sin
   * él un aparato de andén queda inutilizable toda la madrugada.
   */
  backoff_inicial_segundos: 30,
  backoff_factor: 2,
  backoff_tope_segundos: 900,
  /** Un PIN correcto resetea el contador: la penalización castiga la racha, no la historia. */
  backoff_se_resetea_con_acierto: true,
} as const;

/**
 * Energía EV — la fórmula es ÚNICA y la reserva se resta en UN solo lugar (§0).
 *
 *   rango_efectivo = autonomia_nominal_km × soh × factor_consumo      ← SIN reserva
 *   max_distance   = soc% × rango_efectivo − reserva_km               ← acá sí
 *
 * Restarla dos veces es el error clásico: deja al vehículo «sin alcance» con media batería.
 */
export const EV = {
  factor_consumo_default: 0.85,
  factor_consumo_override: "parametros.factor_consumo",
  reserva_pct_default: 15,
  reserva_override: "parametros.reserva_pct",
  /** Banners no bloqueantes al chofer, en % de SOC. */
  umbrales_alerta_pct: [30, 20, 15, 10],
  fuente_por_defecto: "declarada",
} as const;

/** Semáforo «Hoy» (§0, §5.6). */
export const SEMAFORO = {
  tarjetas_max: 6,
  /**
   * Histéresis: el umbral que APAGA la alarma es distinto del que la enciende. Sin esto
   * una señal en el borde parpadea toda la mañana y el dueño deja de mirarla.
   */
  umbrales_por_senal: ["amarillo", "rojo", "recuperacion"],
  estados_excepcion: ["nueva", "reconocida", "resuelta"],
  /** Refresco por polling con ETag. Nada de WebSockets ni SSE en v1 (§5.6). */
  polling_segundos: { min: 15, max: 30 },
} as const;

/** Invitación de enrolamiento (§0, §5.4). Da derecho a SOLICITAR, jamás a entrar. */
export const INVITACION = {
  multiuso: true,
  expira_dias: 7,
  revocable_en_toques: 1,
  /**
   * Distribución y código de respaldo, dictados por Alexis el 09-ago-2026 (spec 01,
   * pregunta 5): el dueño comparte el link/QR desde SU teléfono con el share-sheet del
   * sistema. Sin pasarela de SMS ni de WhatsApp — cero integraciones, y sin el modo de falla
   * que un proveedor de mensajería mete en el camino crítico: el mensaje que no llegó.
   */
  distribucion: "share-sheet del dueño",
  /**
   * El código se dicta en voz alta en un galpón ruidoso y se teclea con guantes, así que el
   * alfabeto no tiene los pares que se confunden al oído ni a la vista: sin 0/O, sin 1/I/L.
   * Con 8 caracteres en este alfabeto hay del orden de 10^12 combinaciones, para un token
   * que además expira y se revoca en 1 toque.
   */
  codigo_corto_largo: 8,
  codigo_corto_alfabeto: "23456789ABCDEFGHJKMNPQRSTUVWXYZ",
} as const;

/**
 * Revocación de un dispositivo (§4.3, §5.4 F-F, centinela 4 del §9.3).
 *
 * El efecto es INMEDIATO del lado del servidor, pero el aparato pudo estar sin señal y traer
 * capturas de antes: esas entran igual —la captura del terreno JAMÁS rebota (§4.2)— y se
 * clasifican por cuán vieja es la ventana. El corte lo fija el maestro en el §4.3.
 */
export const REVOCACION = {
  ventana_horas: 72,
  flag_dentro: "post_revocacion",
  flag_fuera: "post_revocacion_tardia",
} as const;

/**
 * Sesiones (§4.3, §5.4). La regla la dictó Alexis el 09-ago-2026 (spec 01, pregunta 1).
 *
 * En el teléfono PERSONAL la sesión no caduca mientras el dispositivo siga enrolado y sin
 * revocar: no se pide PIN al abrir la PWA. El aparato YA es el segundo factor —enrolado, con
 * secreto propio, revocable en 1 toque con efecto inmediato— así que el PIN en cada apertura
 * sumaría toques al presupuesto del §5.3 sin agregar seguridad que la revocación no dé; y la
 * fricción empuja a dejar la app abierta todo el turno, que es lo que se quería evitar.
 *
 * El ANDÉN es otra cosa: es un aparato compartido donde rotan identidades, y ahí la sesión sí
 * cierra por inactividad.
 */
export const SESION = {
  personal_caduca: false,
  /** El PIN queda para lo que significa algo: firmar, y rotar identidad en el andén. */
  pin_para: ["firmar", "rotar identidad en el andén"],
  anden_inactividad_minutos: 3,
} as const;

/**
 * Job exportador de agregados técnicos a la BD `control` (§4.1).
 *
 * La cadencia la dictó Alexis el 09-ago-2026 (Pregunta al dueño 8): cada 5 minutos. Con eso
 * los «2 intervalos» del Anexo B son 10 minutos, coherentes con el otro umbral de esa misma
 * tabla («errores >5% por 15 min»). Son agregados chicos por tenant: el costo es despreciable
 * y el panel cross-tenant se siente vivo sin ser tiempo real.
 *
 * No lleva patrón en CIFRAS_VIGILADAS a propósito: un `5` suelto aparece en cualquier parte y
 * una vigilancia así sería ruido que alguien apaga a la semana.
 */
export const EXPORTADOR = {
  cadencia_min: 5,
  /** La ventana se alinea al reloj: dos corridas de la misma ventana actualizan una fila. */
  ventana_alineada_al_reloj: true,
  /** Campos sin fuente operativa al cierre del hito (a). NULL declarado, jamás cero inventado. */
  pendientes_hasta_su_hito: ["eevd_semanal (hito c)", "backlog_sync_max_min (hito e)"],
} as const;

/** Grant de soporte: soporte SIN god-mode (§0, §4.3, §7.9). */
export const GRANT_SOPORTE = {
  duraciones_horas: [24, 168],
  expiracion_automatica: true,
  encendido_por_defecto: false,
} as const;

/** Plazos legales chilenos (§0, Anexo A). Cableados: la app es para Chile. */
export const PLAZOS_LEGALES = {
  /** Ley 21.131 — pago a 30 días. */
  pago_dias: 30,
  /** Ley 19.983 — 8 días para reclamar una factura. */
  reclamo_factura_dias: 8,
  /** Ventana para disputar una línea de liquidación. */
  disputa_liquidacion_dias: 7,
} as const;

/** Tarificación: catálogo CERRADO (§0, §3.E1.8). Un concepto nuevo es cambio de contrato. */
export const TARIFAS = {
  conceptos: [
    "por_entrega",
    "por_bulto",
    "por_bloque_horas",
    "por_devolucion",
    "por_intento_fallido",
  ],
  activos_max_por_empresa: 4,
  zonas_max: 5,
  /** Zona y recargo horario son MODIFICADORES de por_entrega, jamás conceptos. */
  modificadores: ["zona", "recargo_horario"],
} as const;

/** Formatos es-CL. Cero strings visibles en inglés (§0 Formatos, grep del gate). */
export const FORMATOS = {
  locale: "es-CL",
  zona_horaria: "America/Santiago",
  ejemplo_dinero: "$12.500",
  ejemplo_fecha: "dd-mm-aaaa",
  ejemplo_rut: "12.345.678-5",
  /** El RUT se valida con módulo 11 al escribir, no al enviar (§4.3). */
  validacion_rut: "modulo 11",
} as const;

/** Documentos tributarios que la app REFERENCIA. Jamás emite (§7.3, art. 97 N°4 CT). */
export const DTE = {
  tipos_referenciables: [33, 39, 52, 61],
  unicidad: "UNIQUE(tipo, folio, emisor)",
  emite_la_app: false,
} as const;

/**
 * CIFRAS VIGILADAS por el grep-gate (§0: «número mágico de esta familia hardcodeado fuera
 * del archivo canónico ⇒ build rojo»).
 *
 * Lista CERRADA y declarada acá para que agregar una constante sin su vigilancia se vea en
 * el mismo diff. `patron` es el fuente de una expresión regular: para las cifras
 * inconfundibles (8000, 0.85) basta el número; para las que también son números comunes
 * (48, 24, 5) el patrón EXIGE contexto, porque un guard que salta con cualquier `5` del
 * código se desactiva solo a la semana.
 */
export const CIFRAS_VIGILADAS = [
  // El límite es `[\w-]` y no `\b`: con `\b8000\b` el patrón mordía DENTRO de un uuid
  // (`00000000-0000-7000-8000-000000000000`, el centinela de `tenant_template`), porque el
  // guion es un no-palabra y abre frontera. Un guard que se dispara con un uuid es un guard
  // que alguien apaga a la semana.
  { nombre: "UNDO.ventana_ms", valor: 8000, patron: String.raw`(?<![\w-])8000(?![\w-])` },
  { nombre: "EV.factor_consumo_default", valor: 0.85, patron: String.raw`\b0\.85\b` },
  // El `(?<!§)` no es un ablande: es la diferencia entre el contraste mínimo y una CITA al
  // §4.5 del maestro —«operación: vehículos, agenda»—, que el módulo 02 nombra en cada
  // archivo. Sin él, escribir «(§4.5)» ponía el gate rojo por citar la constitución, y un
  // guard que se dispara con la fuente es un guard que alguien apaga a la semana (mismo
  // criterio que el uuid con `8000` adentro). Lo ejerce un mutante propio en las dos
  // direcciones: la cita no dispara, el número suelto sí.
  { nombre: "CONTRASTE.texto", valor: 4.5, patron: String.raw`\b4\.5\s*:\s*1|(?<!§)\b4\.5\b(?=\s*[,;)\]])` },
  { nombre: "CIFRA_OPERATIVA.tamano_px", valor: 96, patron: String.raw`\b96\s*px\b|font-?[Ss]ize[^\n]{0,12}\b96\b` },
  { nombre: "CIFRA_OPERATIVA.peso", valor: 700, patron: String.raw`font-?[Ww]eight[^\n]{0,12}\b700\b` },
  // AC-FMIG-01: los tokens estructurales del §5.1 entran a la vigilancia junto con
  // `packages/miga`, que hasta hoy quedaba fuera del alcance del gate.
  { nombre: "TIPOGRAFIA.familia", valor: TIPOGRAFIA.familia, patron: String.raw`-apple-system` },
  // Un peldaño de la escala escrito a mano como tamaño de fuente. Se exige el contexto
  // `fontSize`/`font-size` porque 34, 17, 15, 13 y 11 son números corrientes en cualquier
  // otro lugar, y un guard que salta con cualquier 15 se apaga solo a la semana.
  {
    nombre: "TIPOGRAFIA.escala_pt",
    valor: "34/17/15/13/11",
    // El límite de la derecha es `(?!\d)` y no `\b`: entre dígito y letra NO hay frontera
    // de palabra, así que `\b34\b` no mordía `font-size: 34px` — la forma más común de
    // escribirlo a mano. Lo pilló el test que ejerce cada patrón contra su propia muestra.
    patron: String.raw`font-?[Ss]ize[^\n]{0,14}(?<!\d)(?:34|17|15|13|11)(?!\d)`,
  },
  // La base de la grilla copiada como `8px` o como separación suelta (`gap`, `padding`,
  // `margin`). Ambas formas son la misma duplicación con distinta ropa.
  {
    nombre: "GRILLA.base_px",
    valor: 8,
    patron: String.raw`\b8\s*px\b|(?:gap|padding|margin)[^\n]{0,14}\b8\b`,
  },
  { nombre: "GRILLA.radio_tarjeta_px", valor: 12, patron: String.raw`border-?[Rr]adius[^\n]{0,14}(?<!\d)12(?!\d)` },
  { nombre: "TACTIL.boton_primario", valor: 56, patron: String.raw`\b56\s*px\b|min-?[Hh]eight[^\n]{0,14}\b56\b` },
  { nombre: "TACTIL.tecla_min", valor: 64, patron: String.raw`\b64\s*px\b|min-?[HhWw](?:eight|idth)[^\n]{0,14}\b64\b` },
  { nombre: "TACTIL.operativo_min", valor: 48, patron: String.raw`\b48\s*px\b|min-?[HhWw](?:eight|idth)[^\n]{0,14}\b48\b` },
  { nombre: "TACTIL.piso_wcag", valor: 24, patron: String.raw`\b24\s*px\b` },
  { nombre: "EV.umbrales_alerta_pct", valor: "30/20/15/10", patron: String.raw`\b30\s*,\s*20\s*,\s*15\s*,\s*10\b` },
  { nombre: "CAPACIDAD.p95_bootstrap_ms", valor: 400, patron: String.raw`p95[^\n]{0,24}\b400\b` },
  { nombre: "CAPACIDAD.p95_sync_ms", valor: 250, patron: String.raw`p95[^\n]{0,24}\b250\b` },
  { nombre: "CAPACIDAD.dispositivos_con_turno_abierto", valor: 2000, patron: String.raw`\b2\.?000\b(?=[^\n]{0,32}dispositivo)` },
  { nombre: "PIN.digitos", valor: 4, patron: String.raw`[Pp][Ii][Nn][^\n]{0,24}\b4\s*(?:d[ií]gitos?|digits?)\b` },
  { nombre: "PIN.intentos_hasta_bloqueo", valor: 5, patron: String.raw`(?:lockout|intentos)[^\n]{0,24}\b5\b` },
  { nombre: "RELOJ.drift_max_minutos", valor: 5, patron: String.raw`drift[^\n]{0,24}\b5\b` },
  {
    nombre: "RASTREO.umbral_desactualizada_min",
    valor: 10,
    patron: String.raw`(?:desactualizad|antig[üu]edad)[^\n]{0,32}\b10\b`,
  },
  { nombre: "INVITACION.expira_dias", valor: 7, patron: String.raw`(?:invitaci[oó]n|invitation)[^\n]{0,32}\b7\s*d[ií]as?\b` },
  { nombre: "PLAZOS_LEGALES.pago_dias", valor: 30, patron: String.raw`(?:21\.131|pago)[^\n]{0,24}\b30\s*d[ií]as?\b` },
  { nombre: "PLAZOS_LEGALES.reclamo_factura_dias", valor: 8, patron: String.raw`(?:19\.983|reclamo)[^\n]{0,24}\b8\s*d[ií]as?\b` },
  { nombre: "PLAZOS_LEGALES.disputa_liquidacion_dias", valor: 7, patron: String.raw`disputa[^\n]{0,24}\b7\s*d[ií]as?\b` },
  { nombre: "TARIFAS.activos_max_por_empresa", valor: 4, patron: String.raw`(?:m[aá]x|max)[^\n]{0,16}\b4\s*(?:conceptos|activos)\b` },
  { nombre: "SEMAFORO.tarjetas_max", valor: 6, patron: String.raw`(?:m[aá]x|max)[^\n]{0,16}\b6\s*tarjetas\b` },
  { nombre: "SOC.capturas_max_por_turno", valor: 3, patron: String.raw`(?:m[aá]x|max)[^\n]{0,24}\b3\s*capturas\b` },
  // Respuestas del dueño del 09-ago-2026 a la spec 01 (preguntas 9, 5 y 1). Entran acá y no
  // solo al objeto de arriba porque el valor escrito de nuevo en un test o en un endpoint es
  // el que se queda viejo: el AC los asierta contra la constante, jamás contra el número.
  { nombre: "PIN.backoff_inicial_segundos", valor: 30, patron: String.raw`backoff[^\n]{0,24}\b30\b` },
  { nombre: "PIN.backoff_tope_segundos", valor: 900, patron: String.raw`(?:backoff|tope)[^\n]{0,24}\b(?:900\s*s|15\s*min)` },
  { nombre: "INVITACION.codigo_corto_largo", valor: 8, patron: String.raw`c[oó]digo\s+corto[^\n]{0,24}\b8\b` },
  { nombre: "SESION.anden_inactividad_minutos", valor: 3, patron: String.raw`(?:inactividad|and[eé]n)[^\n]{0,24}\b3\s*min` },
  // El patrón exige la palabra de la revocación al lado, y no es prolijidad: en el repo ya
  // vive OTRO 72 con otro significado —el plazo de aviso de brecha que el dueño fijó para
  // el runbook (AC-FTEN-25)—. Un patrón que solo mirara el número los confundiría, y
  // «importá la constante» sería un consejo equivocado para la mitad de los casos.
  { nombre: "REVOCACION.ventana_horas", valor: 72, patron: String.raw`(?:revocaci[oó]n|revocado|cuarentena|post_revocacion)[^\n]{0,40}\b72\b` },
] as const;
