import type { Pool, PoolClient } from "pg";
import { resolverSesion, type Sesion } from "./sesion.ts";
import { poolDe } from "./conexion.ts";
import { codigoNuevo, hashDeCodigo, expiraEn } from "../dominio/invitaciones.ts";
import { FORMATOS, ROLES, type Rol } from "../../../../packages/nucleo-comun/src/constants.ts";

// El plano de control exclusivo del dueño [AC-FIDN-12] — §4.3, §5.4, §3.E1.14.
//
// LO QUE ESTE ARCHIVO ES: la capa que convierte la lógica de dominio de los ACs anteriores en
// actos de gobierno con un dueño, un rastro y un rebote. Aprobar, revocar, rotar y otorgar ya
// estaban escritos y probados (FIDN-03, 04, 06, 08, 09, 11); lo que faltaba era QUIÉN puede
// invocarlos y qué queda escrito cuando lo hace.
//
// ─── LAS TRES RESPUESTAS, Y POR QUÉ NO SON LA MISMA ───────────────────────────────────
//
//   · sin sesión válida ⇒ 404 PELADO. Para quien no es de la casa, el panel del dueño no
//     existe. Un 401 sería la confirmación de que la ruta está ahí y de que el identificador
//     que se probó es real — y sobre `/api/gobierno/invitaciones/<id>` eso ES el oráculo de
//     enumeración que el §0 cierra con «404 jamás 403».
//   · sesión válida con rol distinto de `admin_tenant` ⇒ 403 y CERO filas. Lo pide el AC con
//     esas palabras, y es lo correcto: el operador SÍ es de la casa. Esconderle la puerta lo
//     dejaría reportando «no me anda» sobre algo que funciona; decirle «esto es del dueño» es
//     una respuesta que se puede actuar.
//   · recurso de identidad de OTRO tenant ⇒ 404. Sale gratis y por construcción: cada tenant
//     es su propia base (§4.1) y la consulta corre contra la base que el ruteo eligió, así que
//     un id de B sencillamente no está. No hay una rama que lo trate: hay una ausencia.
//
// La asimetría entre la primera y la segunda es el punto: el 403 informa a quien ya está
// adentro; el 404 no le informa nada a quien está afuera.
//
// ─── EL RASTRO ────────────────────────────────────────────────────────────────────────
//
// Cada acto escribe `audit_trail` (por trigger, desde AC-FIDN-01) Y un evento del catálogo
// (§4.6), EN LA MISMA TRANSACCIÓN que la mutación. No es prolijidad: un evento escrito
// después del commit es un evento que un fallo de red deja sin escribir, y el panel de
// auditoría pasaría a decir menos actos de los que ocurrieron — que es la única forma en que
// una bitácora miente sin que nadie mienta.
//
// El ACTOR viaja en el evento y no en `audit_trail`: el trigger del §4.6 escribe el antes y
// el después de la fila, y hacerle llegar la identidad de la sesión exigiría un GUC por
// transacción en cada puerta —una más que olvidar—. `eventos.actor_id` ya existe para esto y
// se llena donde el actor se conoce de verdad, que es acá.

/** Los tipos de evento del plano de control. La lista la SIEMBRA `0014_gobierno_del_dueno.sql`
 *  en la plantilla; acá está su nombre en el código. Si las dos se separan, el `insert … select`
 *  de `registrarEvento` no encuentra el tipo y el acto entero rebota: la deriva se ve el mismo
 *  día, y no el día que alguien lee la auditoría y le faltan filas. */
export const EVENTOS = {
  invitacion_emitida: "gobierno.invitacion_emitida",
  invitacion_pausada: "gobierno.invitacion_pausada",
  invitacion_reanudada: "gobierno.invitacion_reanudada",
  invitacion_revocada: "gobierno.invitacion_revocada",
  solicitud_aprobada: "gobierno.solicitud_aprobada",
  solicitud_rechazada: "gobierno.solicitud_rechazada",
  dispositivo_revocado: "gobierno.dispositivo_revocado",
  /** El andén se enrola sin persona dueña y es un activo del TENANT (§5.4 F-D) [AC-FIDN-07]:
   *  darlo de alta es un acto del dueño y por eso su evento es `gobierno.*`. */
  anden_enrolado: "gobierno.anden_enrolado",
  puente_emitido: "gobierno.puente_emitido",
  pin_definido: "gobierno.pin_definido",
  usuario_desbloqueado: "gobierno.usuario_desbloqueado",
  soporte_otorgado: "gobierno.soporte_otorgado",
  soporte_revocado: "gobierno.soporte_revocado",
  // La passkey se registra al PRIMER uso de «transferir propiedad» (§5.4 F-H, Pregunta 4
  // respondida el 11-ago-2026) [AC-FIDN-13]: no hay un paso de setup aparte.
  passkey_registrada: "gobierno.passkey_registrada",
  propiedad_transferida: "gobierno.propiedad_transferida",
  // El §5.4 pone «alta, edición de capacidades/documentos y desactivación de VEHÍCULOS»
  // dentro del plano de control exclusivo del dueño, en la misma lista que aprobar accesos y
  // revocar aparatos. Por eso su evento es `gobierno.*` y no de otro dominio: es lo que hace
  // que el alta de un vehículo aparezca en la auditoría de accesos que el dueño lee (§3.E1.15).
  vehiculo_creado: "gobierno.vehiculo_creado",
  vehiculo_editado: "gobierno.vehiculo_editado",
  vehiculo_desactivado: "gobierno.vehiculo_desactivado",
  vehiculo_reactivado: "gobierno.vehiculo_reactivado",
  documento_cargado: "gobierno.documento_cargado",
  documento_eliminado: "gobierno.documento_eliminado",
  // El selector de modo (§3) cambia qué módulos ve la operación entera: es un acto del dueño y
  // por eso su evento es `gobierno.*`, en la misma auditoría donde él lee los accesos.
  modo_conmutado: "gobierno.modo_conmutado",
} as const;

/** Los eventos del TERRENO. No llevan el prefijo `gobierno.` y no es un detalle: la auditoría
 *  de accesos del §3.E1.15 filtra por ese prefijo, y un turno por vehículo y por día ahogaría
 *  los actos del dueño bajo el ruido de la operación. */
export const EVENTOS_OPERACION = {
  /** La rotación del andén es del TERRENO y no del dueño [AC-FIDN-07]: pasa varias veces por
   *  turno y con el prefijo `gobierno.` ahogaría los actos del dueño en la auditoría del
   *  §3.E1.15, que es exactamente lo que el comentario de arriba evita. */
  anden_identidad_rotada: "anden.identidad_rotada",
  turno_abierto: "turno.abierto",
  lectura_registrada: "lectura.registrada",
  lectura_soc_fuera_de_rango: "lectura.soc_fuera_de_rango",
  lectura_odometro_retrocedido: "lectura.odometro_retrocedido",
  lectura_reloj_desfasado: "lectura.reloj_desfasado",
  lectura_sin_turno: "lectura.sin_turno",
  lectura_modulo_apagado: "lectura.modulo_apagado",
  lectura_exceso_de_soc: "lectura.exceso_de_soc",
  chequeo_registrado: "chequeo.registrado",
  chequeo_defecto: "chequeo.defecto",
  defecto_en_curso: "defecto.en_curso",
  defecto_resuelto: "defecto.resuelto",
  defecto_bloqueante: "defecto.bloqueante",
  energia_sesion_cerrada: "energia.sesion_cerrada",
  turno_cerrado_forzado: "turno.cerrado_forzado",
  turno_cerrado: "turno.cerrado",
  encargo_creado: "encargo.creado",
  encargo_aceptado: "encargo.aceptado",
  encargo_editado: "encargo.editado",
  encargo_reintentado: "encargo.reintentado",
  agenda_bloque_creado: "agenda.bloque_creado",
  agenda_bloque_borrado: "agenda.bloque_borrado",
  agenda_semana_duplicada: "agenda.semana_duplicada",
  ruta_creada: "ruta.creada",
  ruta_publicada: "ruta.publicada",
  encargo_asignado: "encargo.asignado",
  motivo_apagado: "motivo.apagado",
  motivo_encendido: "motivo.encendido",
  manifiesto_confirmado: "manifiesto.confirmado",
  manifiesto_discrepancia: "manifiesto.discrepancia",
  manifiesto_documento_asociado: "manifiesto.documento_asociado",
  manifiesto_item_bajado: "manifiesto.item_bajado",
  custodia_traspasada: "custodia.traspasada",
  custodia_corregida: "custodia.corregida",
  // La captura que entra DEGRADADA [AC-FRUT-10]. Uno por flag y no uno genérico: «cuántas
  // cargas salieron sin documento» y «cuántos teléfonos tienen la hora corrida» son preguntas
  // distintas, y con un código único las dos obligan a abrir el jsonb de cada evento.
  custodia_manifiesto_incompleto: "custodia.manifiesto_incompleto",
  custodia_item_sin_dte: "custodia.item_sin_dte",
  custodia_reloj_desfasado: "custodia.reloj_desfasado",
  custodia_modulo_apagado: "custodia.modulo_apagado",
  custodia_sha256_mismatch: "custodia.sha256_mismatch",
  // El cierre de la ruta y su ecuación por empresa [AC-FRUT-11]. El descuadrado lleva código
  // propio porque es lo que alimenta la señal Caja/custodia del semáforo (Anexo B): contarlo
  // desde un evento genérico obligaría a abrir el jsonb de cada cierre del mes.
  cierre_ruta_cerrada: "cierre.ruta_cerrada",
  cierre_descuadrado: "cierre.descuadrado",
  // La clasificación táctil materializó el detalle de un `devuelto` [AC-FRUT-21].
  devolucion_registrada: "devolucion.registrada",
  // El terreno cerró una parada y su captura aterrizó por el motor de sync [AC-FPOD-03]. UNO
  // solo para las cuatro variantes de F4: el resultado y el método de entrega son atributos del
  // mismo hecho —la parada se cerró—, no hechos distintos (§4.5, §5.2 F4).
  entrega_pod_capturada: "entrega.pod_capturada",
  // La regla de oro aplicada al reloj de la captura de POD [AC-FPOD-05]: la entrega aterriza
  // igual y este flag deja dicho que el aparato traía la hora corrida (§0, §4.6).
  entrega_reloj_desfasado: "entrega.reloj_desfasado",
  // El módulo apagado en la config CONGELADA del turno [AC-FPOD-06] — §0 HTTP, §5.5, §4.4: la
  // entrega aterriza igual y este flag deja dicho que el módulo estaba apagado cuando se capturó.
  entrega_modulo_apagado: "entrega.modulo_apagado",
  // Captura de un aparato revocado hace más de `REVOCACION.ventana_horas` [AC-FPOD-07] — §4.3.
  // Solo la TARDÍA tiene evento propio: la que llega dentro de la ventana se explica por falta
  // de señal y se marca con su flag sin abrir rastro (`dominio/revocacion.ts`, AC-FIDN-09) — un
  // evento por cada aparato que pasó la noche sin cobertura ahogaría el que sí importa.
  entrega_post_revocacion_tardia: "entrega.post_revocacion_tardia",
  // El undo que llegó DESPUÉS del replay [AC-FPOD-08] — §4.7: la captura ya está en el orden
  // autoritativo, así que la corrección es una fila NUEVA que la supersede con su motivo, jamás
  // un UPDATE (§7.4). Con motivo `undo` queda excluida del métrico de gaming del §10 por la
  // definición SQL de `pods_supersedidos_semanal`, no por un filtro repetido en cada panel.
  entrega_pod_deshecha: "entrega.pod_deshecha",
  // La secuencia monotónica del dispositivo saltó un número al aterrizar esta captura
  // [AC-FPOD-10] — §4.7: evicción del outbox o manipulación, jamás pérdida silenciosa. La
  // captura entra igual (centinela 4: rechazos = 0); esto solo deja dicho que hay que revisarla.
  entrega_secuencia_hueco: "entrega.secuencia_hueco",
  // El binario de una evidencia del POD no re-hasheó como el sha256 que viajó ANTES en la
  // mutación [AC-FPOD-19] — §4.6. Mismo criterio que `custodia.sha256_mismatch`: la evidencia
  // entra igual, con el hash REAL, jamás rebota (la foto es mejora progresiva, §7.6).
  entrega_sha256_mismatch: "entrega.sha256_mismatch",
  // El POD que aterrizó sin el sub-manifiesto por empresa de su carga confirmado [AC-FRUT-23] —
  // KR-29, §7.3 (art. 55 DL 825), §9.3.4. Código propio y no `custodia.manifiesto_incompleto`:
  // aquel es del andén (una carga que se confirmó incompleta) y este es de la entrega (una carga
  // que nunca se confirmó), y contarlos juntos obligaría a abrir el jsonb de cada uno.
  entrega_sin_manifiesto_confirmado: "entrega.sin_manifiesto_confirmado",
} as const;

/** Todo código que `registrarEvento` acepta tiene que estar sembrado en `evento_tipo`: si los
 *  dos se separan, el `insert … select` no encuentra el tipo y el acto entero se deshace. */
export type CodigoDeEvento =
  | (typeof EVENTOS)[keyof typeof EVENTOS]
  | (typeof EVENTOS_OPERACION)[keyof typeof EVENTOS_OPERACION];

/** El rol que gobierna. Uno solo, y sale del canónico §0 en vez de escribirse a mano. */
export const ROL_DE_GOBIERNO: Rol = "admin_tenant";

// ─── La guardia ───────────────────────────────────────────────────────────────────────

export type Acto = { pool: Pool; sesion: Sesion; slug: string };
export type Guardia = { tipo: "ok"; acto: Acto } | { tipo: "rebote"; respuesta: Response };

/** El 404 del panel: sin cuerpo y sin cabeceras propias. Lo que no dice es el punto. */
export const noExiste = () => new Response(null, { status: 404 });
const NO_EXISTE = noExiste;

/**
 * ¿Tiene forma de identificador de la casa? Se pregunta ANTES de consultar porque un
 * `where id = 'hola'` no devuelve cero filas: rebota 22P02 y el handler responde 500 — y un
 * 500 sobre `/api/gobierno/<algo>` distingue «id mal formado» de «id que no está», que es la
 * mitad de un oráculo de enumeración. Mal formado y ausente tienen que verse igual: 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (valor: string): boolean => UUID.test(valor);

const NO_ES_TUYO = () =>
  Response.json(
    { error: "solo_el_dueno", mensaje: "Esta acción es del dueño de la cuenta." },
    { status: 403 },
  );

/**
 * Resuelve tenant + sesión + rol para una ruta de gobierno. Devuelve el acto, o la respuesta
 * exacta que hay que dar.
 *
 * Es UNA función y no un chequeo repetido en cada handler a propósito: nueve puertas con la
 * misma regla escrita nueve veces son nueve lugares donde falta una línea, y la que falta es
 * siempre la del endpoint que se agregó apurado un viernes.
 */
export async function guardia(cabeceras: Headers): Promise<Guardia> {
  const bd = cabeceras.get("x-flota-tenant-bd");
  const slug = cabeceras.get("x-flota-tenant-slug");
  if (!bd || !slug) return { tipo: "rebote", respuesta: NO_EXISTE() };

  const pool = poolDe(bd);
  const veredicto = await resolverSesion(pool, cabeceras.get("authorization"));
  if (veredicto.tipo !== "valida") return { tipo: "rebote", respuesta: NO_EXISTE() };
  if (veredicto.sesion.rol !== ROL_DE_GOBIERNO) return { tipo: "rebote", respuesta: NO_ES_TUYO() };

  return { tipo: "ok", acto: { pool, sesion: veredicto.sesion, slug } };
}

/** La otra mitad: una sesión CUALQUIERA del tenant, para el canje del código puente — que lo
 *  hace el operario en su propio aparato y no el dueño (§5.4, Pregunta 2). */
export async function sesionDelTenant(
  cabeceras: Headers,
): Promise<{ tipo: "ok"; acto: Acto } | { tipo: "rebote"; respuesta: Response }> {
  const bd = cabeceras.get("x-flota-tenant-bd");
  const slug = cabeceras.get("x-flota-tenant-slug");
  if (!bd || !slug) return { tipo: "rebote", respuesta: NO_EXISTE() };
  const pool = poolDe(bd);
  const veredicto = await resolverSesion(pool, cabeceras.get("authorization"));
  if (veredicto.tipo !== "valida") return { tipo: "rebote", respuesta: NO_EXISTE() };
  return { tipo: "ok", acto: { pool, sesion: veredicto.sesion, slug } };
}

/** El acto del motor de sync de capturas, con el dato extra que ningún otro acto necesita. */
export type ActoDeCaptura = Acto & { revocadoEn: Date | null };

/**
 * La tercera mitad, y la única con el corte al REVÉS [AC-FPOD-07] — §4.3, §4.2. Todo el resto
 * de este archivo (`guardia`, `sesionDelTenant`) trata un aparato revocado como si no existiera:
 * eso es correcto HACIA ADELANTE (planificación, lectura, cualquier pantalla) y es exactamente
 * lo que hace que «revocar en 1 toque» signifique algo. Pero la captura que ese mismo aparato
 * trae de ANTES de la revocación no es una petición nueva, es trabajo del terreno que ya
 * ocurrió — y el §4.2 prohíbe de frente que una CAPTURA rebote. Por eso, y SOLO para
 * `/api/sync/capturas`, una sesión "revocada" con identidad (`resolverSesion`) no se bota: se
 * deja pasar con `revocadoEn`, y es `dominio/pod-sync.ts` (reusando `dominio/revocacion.ts`,
 * AC-FIDN-09) quien decide si la captura entra en cuarentena o con severidad alta — pero JAMÁS
 * si entra.
 *
 * Ninguna otra ruta debe usar esto: reabriría la sesión que el dueño acaba de cerrar.
 */
export async function sesionParaSincronizarCapturas(
  cabeceras: Headers,
): Promise<{ tipo: "ok"; acto: ActoDeCaptura } | { tipo: "rebote"; respuesta: Response }> {
  const bd = cabeceras.get("x-flota-tenant-bd");
  const slug = cabeceras.get("x-flota-tenant-slug");
  if (!bd || !slug) return { tipo: "rebote", respuesta: NO_EXISTE() };
  const pool = poolDe(bd);
  const veredicto = await resolverSesion(pool, cabeceras.get("authorization"));
  if (veredicto.tipo === "valida") {
    return { tipo: "ok", acto: { pool, sesion: veredicto.sesion, slug, revocadoEn: null } };
  }
  if (veredicto.tipo === "invalida" && veredicto.motivo === "revocada") {
    return {
      tipo: "ok",
      acto: { pool, sesion: veredicto.sesion, slug, revocadoEn: veredicto.revocadoEn },
    };
  }
  return { tipo: "rebote", respuesta: NO_EXISTE() };
}

// ─── El acto: una transacción que muta y registra, o no hace ninguna de las dos ────────

/**
 * Declara QUIÉN pregunta, para las políticas de fila del §4.8 y del §7.2 [AC-FRUT-12].
 *
 * Las dos familias de RLS de la base leen GUCs: la de dinero mira `app.current_role` para no
 * mostrarle montos al chofer, y la de empresa mira además `app.current_empresa` para confinar al
 * rol `cliente`. Hasta este AC nadie los escribía desde la app —solo las suites de
 * `db/flota/suite-bd/`—, así que las políticas estaban probadas y no protegían nada en runtime.
 *
 * Va con `set_config(..., true)`: LOCAL a la transacción. Un `set` de sesión sobreviviría a la
 * conexión devuelta al pool y el request siguiente heredaría el rol del anterior — que es
 * exactamente el peor error posible acá: un chofer viendo lo del dueño porque le tocó su
 * conexión. Por eso toda lectura que necesite política abre transacción, aunque no escriba.
 */
async function declararQuienPregunta(c: PoolClient, sesion?: Sesion): Promise<void> {
  if (!sesion) return;
  await c.query("select set_config('app.current_role', $1, true)", [sesion.rol]);
  await c.query("select set_config('app.current_empresa', $1, true)", [
    sesion.empresaClienteId ?? "",
  ]);
}

export async function enActo<T>(
  pool: Pool,
  fn: (c: PoolClient) => Promise<T>,
  sesion?: Sesion,
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    await declararQuienPregunta(cliente, sesion);
    const salida = await fn(cliente);
    await cliente.query("commit");
    return salida;
  } catch (error) {
    await cliente.query("rollback");
    throw error;
  } finally {
    cliente.release();
  }
}

/**
 * Una LECTURA con las políticas de fila activas [AC-FRUT-12].
 *
 * Existe por el mismo motivo que `enActo` recibe la sesión: un `pool.query` suelto no puede
 * declarar el rol, porque el `set_config` local necesita una transacción y el de sesión
 * contaminaría la conexión siguiente. Abrir una transacción para leer parece caro y no lo es —
 * `read only` le dice al planificador que no va a haber escrituras— y es el precio de que la
 * política sea una garantía y no una intención.
 */
export async function enLectura<T>(
  pool: Pool,
  sesion: Sesion,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin read only");
    await declararQuienPregunta(cliente, sesion);
    return await fn(cliente);
  } finally {
    await cliente.query("rollback");
    cliente.release();
  }
}

/**
 * El huso de Chile en minutos, con su horario de verano resuelto por la base de datos de husos
 * del sistema. La app está cableada a Chile (§0): no hay un huso por tenant que elegir.
 *
 * `tz_offset_min` no se puede dejar en 0 «porque es del servidor»: el §4.6 lo pide para que
 * una fecha guardada se pueda volver a leer como la vio quien la produjo, y un cero convierte
 * cada acto de gobierno de enero en uno que ocurrió cuatro horas más tarde de lo que dice el
 * reloj de la persona que lo hizo.
 */
export function offsetChileMin(ahora: Date): number {
  const partes = new Intl.DateTimeFormat("es-CL", {
    timeZone: FORMATOS.zona_horaria,
    timeZoneName: "longOffset",
  }).formatToParts(ahora);
  const nombre = partes.find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /GMT([+-])(\d{1,2}):(\d{2})/.exec(nombre);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Escribe el evento del acto. Va con `insert … select` contra el catálogo y NO con un
 * `insert into evento_tipo … on conflict`: un código mal escrito tiene que rebotar, no
 * inaugurar un tipo de evento nuevo que en el panel se ve igual de legítimo que los buenos.
 */
export async function registrarEvento(
  c: PoolClient,
  datos: {
    codigo: CodigoDeEvento;
    objetoTabla: string;
    objetoId: string;
    sesion: Sesion;
    payload?: Record<string, unknown>;
    /** El doble reloj del §4.6 cuando el hecho NO ocurrió recién: una captura de terreno pasó
     *  cuando el aparato dice que pasó, y `record_time` (que la BD pone sola) es cuándo lo supo
     *  el servidor. Sin esto, una entrega capturada sin señal ayer se lee como de hoy — y el
     *  orden autoritativo del §4.6 deja de poder explicar por qué llegó tarde [AC-FPOD-03]. */
    eventTime?: Date;
    tzOffsetMin?: number;
    /** La llave de idempotencia del outbox (§0): con ella, el replay de la misma captura no
     *  escribe un segundo hecho — `UNIQUE(tenant_id, client_uuid)` lo impide en la BD. */
    clientUuid?: string | null;
  },
): Promise<string> {
  const ahora = new Date();
  const cuando = datos.eventTime ?? ahora;
  const { rows } = await c.query<{ id: string }>(
    `insert into eventos
       (tipo_id, objeto_tabla, objeto_id, actor_id, dispositivo_id, event_time, tz_offset_min, payload, client_uuid)
     select t.id, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::uuid
       from evento_tipo t where t.codigo = $1
     returning id::text as id`,
    [
      datos.codigo,
      datos.objetoTabla,
      datos.objetoId,
      datos.sesion.usuarioId,
      datos.sesion.dispositivoId,
      cuando,
      datos.tzOffsetMin ?? offsetChileMin(cuando),
      JSON.stringify(datos.payload ?? {}),
      datos.clientUuid ?? null,
    ],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(
      `el tipo de evento «${datos.codigo}» no está en el catálogo de esta base: ` +
        "el acto se deshace entero antes que quedar sin rastro (§3.E1.14)",
    );
  }
  return id;
}

// ─── Invitaciones (§5.4 F-A) ──────────────────────────────────────────────────────────

export type RolInvitable = Exclude<Rol, "admin_tenant" | "cliente">;

/**
 * Los roles que este panel puede invitar. Los dos que faltan NO son un olvido:
 *
 *  · `cliente` se invita DESDE la ficha de la empresa contratante, con su id embebido —lo
 *    dictó Alexis el 09-ago-2026 (Pregunta 3)— para que aprobar siga siendo 1 toque y no una
 *    decisión con un selector. Emitirlo desde acá dejaría un `cliente` sin empresa, que el
 *    CHECK de `usuarios` rebota recién al aprobar: el dueño se enteraría un día después, con
 *    la persona esperando.
 *  · `admin_tenant` se transfiere con passkey (§5.4 F-H, AC-FIDN-13). Si el panel pudiera
 *    fabricar un segundo dueño con una invitación, la ceremonia de la passkey sería
 *    decorativa: el camino corto para tomar la cuenta sería no usarla.
 */
export const ROLES_INVITABLES: readonly RolInvitable[] = ROLES.filter(
  (r): r is RolInvitable => r !== "admin_tenant" && r !== "cliente",
);

export type Emitida = { id: string; codigo: string; expiraAt: Date };

export async function emitirInvitacion(
  pool: Pool,
  sesion: Sesion,
  rol: RolInvitable,
): Promise<Emitida> {
  const codigo = codigoNuevo();
  const expiraAt = expiraEn(new Date());
  return enActo(pool, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into invitaciones (rol, token_hash, expira_at, creada_por)
       values ($1::rol_usuario, $2, $3, $4) returning id::text as id`,
      [rol, hashDeCodigo(codigo), expiraAt, sesion.usuarioId],
    );
    const id = rows[0]!.id;
    await registrarEvento(c, {
      codigo: EVENTOS.invitacion_emitida,
      objetoTabla: "invitaciones",
      objetoId: id,
      sesion,
      // El código en claro JAMÁS entra al payload: el evento es append-only (§7.4), así que
      // una credencial ahí sería una credencial que no se puede retirar nunca más.
      payload: { rol },
    });
    // Se devuelve UNA vez, al dueño que lo emitió, para que lo comparta con el share-sheet
    // de su teléfono (Pregunta 5). En la base queda solo el hash.
    return { id, codigo, expiraAt };
  });
}

export type AccionInvitacion = "pausar" | "reanudar" | "revocar";

const SQL_INVITACION: Record<AccionInvitacion, string> = {
  // La pausa NO mueve `expira_at` (§5.4, AC-FIDN-03): una pausada el día 6 y reanudada el 9
  // está vencida, y eso es lo correcto — el plazo acota la ventana, no cuenta uso.
  pausar: "update invitaciones set pausada_at = now() where id = $1 and pausada_at is null and revocada_at is null",
  reanudar: "update invitaciones set pausada_at = null where id = $1 and revocada_at is null",
  // Revocar gana sobre todo y no se deshace: es el acto deliberado del dueño (§5.4 F-F).
  revocar: "update invitaciones set revocada_at = now() where id = $1 and revocada_at is null",
};

const EVENTO_INVITACION: Record<AccionInvitacion, CodigoDeEvento> = {
  pausar: EVENTOS.invitacion_pausada,
  reanudar: EVENTOS.invitacion_reanudada,
  revocar: EVENTOS.invitacion_revocada,
};

/** `null` cuando la invitación no está en ESTA base —o sea, cuando no existe para este
 *  tenant— y `false` cuando existe pero la acción no cambia nada. */
export async function cambiarInvitacion(
  pool: Pool,
  sesion: Sesion,
  invitacionId: string,
  accion: AccionInvitacion,
): Promise<boolean | null> {
  return enActo(pool, async (c) => {
    const { rows } = await c.query("select 1 from invitaciones where id = $1", [invitacionId]);
    if (rows.length === 0) return null;
    const { rowCount } = await c.query(SQL_INVITACION[accion], [invitacionId]);
    if ((rowCount ?? 0) === 0) return false;
    await registrarEvento(c, {
      codigo: EVENTO_INVITACION[accion],
      objetoTabla: "invitaciones",
      objetoId: invitacionId,
      sesion,
    });
    return true;
  });
}

/** El listado del panel. Sin `token_hash`: de la base no sale nada con lo que entrar. */
export async function listarInvitaciones(pool: Pool) {
  const { rows } = await pool.query(
    `select i.id::text as id, i.rol::text as rol, i.expira_at, i.pausada_at, i.revocada_at,
            i.creada_en,
            (select count(*)::int from solicitudes_acceso s where s.invitacion_id = i.id) as solicitudes
       from invitaciones i
      order by i.creada_en desc`,
  );
  return rows;
}

// ─── Solicitudes: el badge del §5.4 y la decisión de 1 toque ──────────────────────────

/**
 * Las pendientes. El RUT sale ENTERO y no enmascarado, y tiene que ser así — quien
 * mira esta pantalla es el `admin_tenant` decidiendo si esa persona entra a su empresa, y
 * decidir con `**.***.***-5` no es decidir. La máscara del §7.8 es para los LOGS, que los lee
 * cualquiera con acceso al servidor; esto es el dato en manos de quien lo necesita, y queda
 * en `audit_trail` que lo miró.
 */
export async function listarSolicitudes(pool: Pool) {
  const { rows } = await pool.query(
    `select s.id::text as id, s.tipo::text as tipo, s.rut_propuesto, s.nombre_propuesto,
            s.creada_en, i.rol::text as rol
       from solicitudes_acceso s
       left join invitaciones i on i.id = s.invitacion_id
      where s.estado = 'pendiente'
      order by s.creada_en asc`,
  );
  return rows;
}

// ─── Inventario de dispositivos y revocación en 1 toque (§5.4 F-F) ────────────────────

export async function inventarioDeDispositivos(pool: Pool) {
  const { rows } = await pool.query(
    `select d.id::text as id, d.tipo::text as tipo, d.is_standalone, d.storage_persisted,
            d.enrolado_en, d.revocado_at, u.rol::text as rol, p.nombre
       from dispositivos d
       left join personas p on p.id = d.persona_id
       left join usuarios u on u.persona_id = d.persona_id
      order by d.revocado_at nulls first, d.enrolado_en desc nulls last`,
  );
  return rows;
}

export async function revocarAparato(
  pool: Pool,
  sesion: Sesion,
  dispositivoId: string,
): Promise<boolean | null> {
  return enActo(pool, async (c) => {
    const { rows } = await c.query("select 1 from dispositivos where id = $1", [dispositivoId]);
    if (rows.length === 0) return null;
    const { rowCount } = await c.query(
      "update dispositivos set revocado_at = now() where id = $1 and revocado_at is null",
      [dispositivoId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await registrarEvento(c, {
      codigo: EVENTOS.dispositivo_revocado,
      objetoTabla: "dispositivos",
      objetoId: dispositivoId,
      sesion,
    });
    return true;
  });
}

// ─── PIN: el código puente y el desbloqueo (§5.4, Pregunta 2 respondida) ──────────────

/**
 * El dueño emite el puente; el operario define el PIN. Emitir uno ANULA el anterior en la
 * misma transacción: el índice parcial exige como mucho uno vivo, y sin la anulación el
 * segundo intento del dueño —el que hace cuando el operario no anotó bien el primero—
 * rebotaría con un error de restricción en vez de hacer lo obvio.
 */
export async function emitirCodigoPuente(
  pool: Pool,
  sesion: Sesion,
  usuarioId: string,
): Promise<{ codigo: string } | null> {
  const codigo = codigoNuevo();
  return enActo(pool, async (c) => {
    const { rows } = await c.query("select 1 from usuarios where id = $1 and activo", [usuarioId]);
    if (rows.length === 0) return null;
    await c.query(
      "update codigos_puente set anulado_en = now() where usuario_id = $1 and usado_en is null and anulado_en is null",
      [usuarioId],
    );
    const { rows: nuevos } = await c.query<{ id: string }>(
      `insert into codigos_puente (usuario_id, token_hash, emitido_por)
       values ($1, $2, $3) returning id::text as id`,
      [usuarioId, hashDeCodigo(codigo), sesion.usuarioId],
    );
    await registrarEvento(c, {
      codigo: EVENTOS.puente_emitido,
      objetoTabla: "codigos_puente",
      objetoId: nuevos[0]!.id,
      sesion,
      payload: { usuario_id: usuarioId },
    });
    return { codigo };
  });
}

export async function desbloquearUsuario(
  pool: Pool,
  sesion: Sesion,
  usuarioId: string,
): Promise<boolean | null> {
  return enActo(pool, async (c) => {
    const { rows } = await c.query("select 1 from usuarios where id = $1", [usuarioId]);
    if (rows.length === 0) return null;
    await c.query(
      "update usuarios set intentos_fallidos = 0, bloqueado_hasta = null where id = $1",
      [usuarioId],
    );
    await registrarEvento(c, {
      codigo: EVENTOS.usuario_desbloqueado,
      objetoTabla: "usuarios",
      objetoId: usuarioId,
      sesion,
    });
    return true;
  });
}

export type CanjeDePuente = "ok" | "codigo_invalido";

/**
 * El canje, del lado del operario. Tres condiciones y las tres importan: el código existe, no
 * se usó ni se anuló, y es EL DE ESTA SESIÓN. La tercera es la que hace que el código dictado
 * en voz alta no sea una credencial: quien lo escuche de al lado no tiene el aparato enrolado
 * de la persona, y sin él el código no abre nada.
 *
 * `pinHash` llega ya calculado por quien llama: el argon2id vive en `servidor/pin.ts` y este
 * módulo no vuelve a elegir algoritmo.
 */
export async function canjearCodigoPuente(
  pool: Pool,
  sesion: Sesion,
  codigo: string,
  pinHash: string,
): Promise<CanjeDePuente> {
  return enActo(pool, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `update codigos_puente set usado_en = now()
        where token_hash = $1 and usuario_id = $2 and usado_en is null and anulado_en is null
        returning id::text as id`,
      [hashDeCodigo(codigo), sesion.usuarioId],
    );
    const puente = rows[0];
    if (!puente) return "codigo_invalido";

    // Fijar el PIN y limpiar el lockout es UN acto: quien llega hasta acá es alguien que
    // olvidó su PIN, y devolverle una credencial nueva con el contador de intentos de la
    // credencial vieja lo dejaría bloqueado con un PIN que sí se sabe.
    await c.query(
      "update usuarios set pin_hash = $2, intentos_fallidos = 0, bloqueado_hasta = null where id = $1",
      [sesion.usuarioId, pinHash],
    );
    await registrarEvento(c, {
      codigo: EVENTOS.pin_definido,
      objetoTabla: "codigos_puente",
      objetoId: puente.id,
      sesion,
    });
    return "ok";
  });
}

// ─── Auditoría de accesos, incluidas las sesiones de soporte (§4.3, §7.9) ─────────────

/**
 * La bitácora del §3.E1.15, leída de las DOS fuentes que la escriben y no de una tercera
 * tabla que habría que mantener al día: los eventos de gobierno (`eventos`, con su actor) y
 * el begin/end de cada acceso de soporte espejado en `audit_trail` por AC-FIDN-11.
 *
 * Las dos son append-only (§7.4), así que esta pantalla no puede mostrar menos de lo que
 * ocurrió ni siquiera con el rol dueño de la base en la mano.
 */
export async function auditoriaDeAccesos(pool: Pool, limite = 200) {
  const { rows } = await pool.query(
    `select 'gobierno' as origen, e.id::text as id, t.codigo as que, e.record_time as cuando,
            e.actor_id::text as actor_id, p.nombre as actor, e.objeto_tabla, e.objeto_id::text as objeto_id,
            e.payload
       from eventos e
       join evento_tipo t on t.id = e.tipo_id
       left join usuarios u on u.id = e.actor_id
       left join personas p on p.id = u.persona_id
      where t.codigo like 'gobierno.%'
      union all
     select 'soporte' as origen, a.id::text as id,
            'soporte.' || coalesce(a.despues->>'momento', 'acceso') as que, a.ocurrido_en as cuando,
            null as actor_id, a.despues->>'quien' as actor, a.tabla as objeto_tabla,
            a.registro_id::text as objeto_id, a.despues as payload
       from audit_trail a
      where a.tabla = 'soporte'
      order by cuando desc
      limit $1`,
    [limite],
  );
  return rows;
}

// ─── El id de este tenant, para hablar con el plano de control ────────────────────────

/**
 * `grants_soporte` vive en `control` y su FK apunta a `control.tenants(id)` (§4.1), así que el
 * id que hace falta es el DEL PLANO DE CONTROL y se resuelve por slug.
 *
 * NO SE LEE DE `tenant_info`, y la diferencia no es de estilo: hoy los dos ids NO coinciden.
 * `provisionar()` genera el uuid de `tenant_info` dentro de la base del tenant y el alta en
 * `control.tenants` la hace otro —el fixture, o mañana el wizard de AC-FMIG-14— con su propio
 * default. Es la deuda que el traspaso ya listaba («la provisión sigue sin registrar el tenant
 * en control.tenants»), y este endpoint es el primero que la topa. Usar `tenant_info` acá
 * habría dado una violación de FK en el primer grant emitido en producción.
 *
 * El slug tampoco llega de afuera: lo SOBRESCRIBE `servidor.mjs` con el veredicto del ruteo
 * después de consultar `control` (AC-FTEN-05). Si viniera del cliente, el dueño de A revocaría
 * los grants de B mandando una cabecera.
 */
export async function tenantIdEnControl(slug: string): Promise<string> {
  const { rows } = await poolDe("control").query<{ id: string }>(
    "select id::text as id from tenants where slug = $1",
    [slug],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("el tenant del ruteo no está en el plano de control");
  return id;
}
