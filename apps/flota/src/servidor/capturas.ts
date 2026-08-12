import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { enActo, registrarEvento, EVENTOS_OPERACION, esUuid } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { versionVigente, estadoDeFeature, FEATURES } from "./config.ts";
import {
  clasificarCapturaPod,
  dejaRastro,
  severidadDeFlag,
  esHuecoDeSecuencia,
  maximaConSecuencia,
  type FlagDeCapturaPod,
} from "../dominio/pod-sync.ts";
import type { TipoDeEvidencia } from "../dominio/pod-terreno.ts";
import { candadoDeLaParadaEn } from "./paradas.ts";

// El aterrizaje de las capturas del POD que trae el replay del outbox [AC-FPOD-03] — §4.2
// (regla de oro), §4.6 (eventos append-only, doble reloj, `client_uuid`), §5.2 F4, §3.E1.7.
//
// ─── ESTA ES LA MITAD QUE HACE VERDADERA LA OTRA ──────────────────────────────────
//
// «Al volver la señal el replay vacía la cola sin intervención del operario» es una frase con
// dos sujetos: el aparato, que reintenta solo, y el servidor, que de verdad se queda con lo que
// le llega. Sin este segundo, vaciar la cola sería BORRARLA — y la pantalla diría «sincronizado»
// sobre entregas que no existen en ninguna parte. Es exactamente el antipatrón de la foto del
// POD que «subía» hasheando un texto (aprendizaje de AGENTS.md), y por eso acá el hecho aterriza
// en `eventos`, que el §4.6 declara ORDEN AUTORITATIVO del tenant y origen de toda proyección.
//
// ─── LO QUE ESTE AC NO HACE ───────────────────────────────────────────────────────
//
// La fila `entregas_pod` con el detalle write-once + supersede es AC-FPOD-11; el catálogo de
// degradaciones (SOC fuera de rango, odómetro menor, el drift de reloj del §0 ⇒ flag + `review_queue`) es
// AC-FPOD-05; el replay DOBLE probado contra la doble llave del §4.6 es AC-FPOD-04. Acá está el
// mínimo que hace del vaciado de la cola un hecho y no un borrado: el evento con su doble reloj,
// su `client_uuid` y el detalle de la variante en el payload.
//
// ─── POR QUÉ NO SE VALIDA LA PARADA ───────────────────────────────────────────────
//
// El §4.2 pone la validación BLOQUEANTE en el cliente, contra el snapshot congelado del turno, y
// deja a este lado sin derecho a decir que no: el mundo físico ya ocurrió. Una parada que no
// está en esta base no es motivo de rebote — y tampoco es una fuga: cada tenant es una BD propia
// (§4.1), así que una captura con el identificador de una parada del vecino aterriza en la base
// de QUIEN la manda y deja la del vecino sin una sola fila (§9.3.2, centinela 2).
//
// Lo único que rebota 422 es lo que no es una captura: un cuerpo sin `client_uuid`, sin parada o
// con una hora del aparato ilegible. Eso no es un dato del terreno degradado, es una llamada mal
// formada, y guardarla en silencio dejaría hechos sin sujeto ni reloj.

/** Una captura tal como viaja desde el outbox: snake_case, como el resto del contrato HTTP. */
export type CapturaEntrante = {
  clientUuid: string;
  paradaId: string;
  tsDispositivo: Date;
  tzOffsetMin: number;
  resultado: string;
  metodoEntrega: string | null;
  motivoId: string | null;
  items: unknown;
  evidencias: unknown;
  /** El turno cuya config CONGELADA juzga esta captura (§4.4) [AC-FPOD-06]. `null` cuando la
   *  entrega no tiene turno asociado — juzga contra la vigente, igual que `lecturas.ts`. */
  turnoId: string | null;
  /** La secuencia monotónica del dispositivo [AC-FPOD-10] — §4.7. `null` cuando no viene o llegó
   *  ilegible (un cuerpo mal formado, no un dato del terreno degradado): una versión vieja de la
   *  PWA que todavía no manda el campo no puede convertirse en un rebote 422. Sin ella no hay
   *  con qué comparar, así que la captura simplemente no participa en la detección de huecos. */
  secuenciaDispositivo: number | null;
  /** El `client_uuid` de la captura que ESTA corrige [AC-FPOD-08] (§4.7): el undo que llegó
   *  cuando el replay ya había ocurrido. `null` en toda captura de terreno. */
  supersedeDe: string | null;
  /** Por qué. `undo` es el deshacer de 8 s del chofer, EXCLUIDO del métrico de gaming del §10
   *  por la definición SQL de `pods_supersedidos_semanal` [AC-FPOD-08]. */
  motivo: string | null;
};

/** El acuse por captura. `aceptada` es lo que el aparato usa para SACARLA de la cola: sin ese
 *  acuse la captura se queda, que es lo que impide que un 2xx vacíe una cola sin guardar nada. */
export type AcuseDeCaptura = {
  client_uuid: string;
  aceptada: true;
  repetida: boolean;
  /** Lo que no cuadró, y que igual entró [AC-FPOD-05, AC-FPOD-06, AC-FPOD-07]. Vacío = captura
   *  limpia. */
  flags: FlagDeCapturaPod[];
  /** La versión de config con la que se juzgó. El §0 la pide en la respuesta: sin ella, quien
   *  mira un `modulo_apagado` no puede saber CUÁL configuración estaba vigente al entrar
   *  [AC-FPOD-06]. */
  config_version_id: string;
};

/** Las cuatro salidas de F4 (§4.5: `resultado exito|fallo|parcial`). */
const RESULTADOS = ["exito", "fallo", "parcial"];

export function capturaBienFormada(c: Partial<CapturaEntrante>): boolean {
  return (
    typeof c.clientUuid === "string" &&
    esUuid(c.clientUuid) &&
    typeof c.paradaId === "string" &&
    esUuid(c.paradaId) &&
    c.tsDispositivo instanceof Date &&
    !Number.isNaN(c.tsDispositivo.getTime()) &&
    Number.isInteger(c.tzOffsetMin) &&
    typeof c.resultado === "string" &&
    RESULTADOS.includes(c.resultado) &&
    // El supersede es opcional, pero si viene tiene que APUNTAR a algo: un `supersede_de` que no
    // es un identificador deja una corrección sin original y el métrico del §10 sin sujeto
    // [AC-FPOD-08]. No es terreno degradado, es una llamada mal formada.
    (c.supersedeDe === null || c.supersedeDe === undefined || esUuid(c.supersedeDe))
  );
}

/**
 * Aterriza un LOTE de capturas. En lote porque lo que el aparato tiene que vaciar es una cola:
 * mandarlas de a una obligaría a coordinar N respuestas para saber si quedó vacía, y en el
 * subterráneo donde la señal vuelve por diez segundos, N viajes son N oportunidades de cortarse.
 *
 * Cada captura se resuelve por separado dentro de UNA transacción: el replay del outbox trae
 * capturas de paradas distintas y de horas distintas, y una que falle no puede llevarse las que
 * ya estaban bien — pero tampoco pueden aterrizar a medias, porque lo que el aparato borra de su
 * cola es lo que este acuse le confirma.
 *
 * ─── LA REGLA DE ORO, CON RELOJ [AC-FPOD-05] ────────────────────────────────────────
 *
 * Después de aterrizar el hecho se clasifica el desfase de reloj (`dominio/pod-sync.ts`): si el
 * `ts_dispositivo` que trajo la captura se aleja de `record_time` más de `RELOJ.drift_max_
 * minutos` (§0), se deja dicho con un evento `entrega.reloj_desfasado` y una fila en
 * `review_queue` — la captura YA aterrizó, nada de esto la rebota ni la deshace (centinela 4
 * §9.3: rechazos = 0). Solo se clasifica en la primera llegada: un replay que ve `previo[0]`
 * se va por el `continue` de arriba y no repite el flag.
 */

// `post_revocacion` (dentro de la ventana de 72h) no tiene entrada acá a propósito: `dejaRastro`
// la filtra ANTES de llegar a este mapa, así que el tipo la excluye — un flag nuevo que alguien
// agregue a `FLAGS_DE_CAPTURA_POD` sin decidir si deja rastro rompe la build, no el runtime
// [AC-FPOD-07].
const EVENTO_DE_FLAG: Record<
  Exclude<FlagDeCapturaPod, "post_revocacion">,
  (typeof EVENTOS_OPERACION)[keyof typeof EVENTOS_OPERACION]
> = {
  modulo_apagado: EVENTOS_OPERACION.entrega_modulo_apagado,
  reloj_desfasado: EVENTOS_OPERACION.entrega_reloj_desfasado,
  // Solo la tardía: la que llega DENTRO de la ventana se marca con su flag y no abre rastro
  // (§4.3; `dominio/revocacion.ts`, AC-FIDN-09) [AC-FPOD-07].
  post_revocacion_tardia: EVENTOS_OPERACION.entrega_post_revocacion_tardia,
  // El hueco de la secuencia monotónica del dispositivo [AC-FPOD-10] — §4.7.
  secuencia_hueco: EVENTOS_OPERACION.entrega_secuencia_hueco,
  // El binario de una evidencia no re-hasheó como el sha256 prometido [AC-FPOD-19] — §4.6.
  sha256_mismatch: EVENTOS_OPERACION.entrega_sha256_mismatch,
  // El POD llegó por sync sin el manifiesto de su carga confirmado [AC-FRUT-23] — KR-29, §7.3.
  sin_manifiesto_confirmado: EVENTOS_OPERACION.entrega_sin_manifiesto_confirmado,
};

/**
 * Con qué configuración se juzga esta captura, y si el módulo de encargos estaba encendido en
 * ella [AC-FPOD-06] — §4.4, §5.5.
 *
 * La CONGELADA del turno manda, no la vigente: un turno corre entero con una versión, y apagar
 * el módulo a mitad de la jornada no puede cambiar cómo se juzga lo que ese turno sigue
 * capturando en la calle sin señal. Mismo patrón que `lecturas.ts` (AC-FVEH-18) y
 * `manifiestos.ts` (AC-FRUT-10): la parada de POD vive bajo el mismo módulo de encargos/rutas.
 *
 * SIN CONFIGURAR cuenta como encendido — la ausencia no es una decisión humana con motivo.
 */
async function configDeLaCaptura(
  c: PoolClient,
  slug: string,
  turnoId: string | null,
): Promise<{ configVersionId: string; moduloEncendido: boolean }> {
  let configVersionId: string | null = null;
  if (turnoId) {
    const { rows } = await c.query<{ id: string }>(
      "select config_version_id::text as id from turnos where id = $1",
      [turnoId],
    );
    configVersionId = rows[0]?.id ?? null;
  }
  configVersionId ??= await versionVigente(c, slug);
  const estado = await estadoDeFeature(c, configVersionId, FEATURES.modulo_encargos);
  return { configVersionId, moduloEncendido: estado !== false };
}

/** La huella del enrolamiento es un sha256 en hexa (`dominio/secretos.ts::hashDeSecreto`), lo
 *  mismo que el aparato deriva offline en `cliente/identidad.ts` [AC-FPOD-09]. */
const HUELLA_DE_ENROLAMIENTO = /^[0-9a-f]{64}$/;

/**
 * A nombre de QUIÉN aterriza este lote [AC-FPOD-09] — §4.7: «las capturas de A persisten
 * firmadas por el enrolamiento y se replayean aunque B esté autenticado».
 *
 * Quien transmite y quien capturó son la misma persona en el 99 % del tráfico, y ahí esto no
 * hace nada: sin huella —o con una que esta base no conoce— manda la sesión que trae el lote.
 * La excepción es el flush de una partición ajena (`cliente/outbox-multiusuario.ts`): el
 * teléfono cambió de dueño y las capturas de A salen con la credencial de B. Atribuirlas a B
 * sería registrar en `eventos` —el orden autoritativo del §4.6, del que cuelga la liquidación
 * del §3.E1.9— que la entrega la hizo quien solo prestó el aparato.
 *
 * La huella NO autentica nada: quien manda el lote ya se autenticó con su propio secreto y esta
 * guardia no le da acceso a ninguna fila que no tuviera. Lo único que decide es a qué aparato
 * enrolado del MISMO tenant se le anota el hecho, y solo resuelve si el hash calza con un
 * `dispositivos.secreto_hash` de esta base — un valor inventado no crea un actor, cae al
 * `fallback`. El aparato revocado también atribuye: sus capturas de antes del corte son las del
 * §4.3 que AC-FPOD-07 deja entrar, y borrarles el autor sería perder justo lo que hay que revisar.
 */
async function firmaDelEnrolamiento(
  c: PoolClient,
  enrolamiento: string | null,
  sesion: Sesion,
): Promise<Sesion> {
  if (enrolamiento === null || !HUELLA_DE_ENROLAMIENTO.test(enrolamiento)) return sesion;
  const { rows } = await c.query<{ dispositivo_id: string; usuario_id: string | null }>(
    `select d.id::text as dispositivo_id, u.id::text as usuario_id
       from dispositivos d
       left join usuarios u on u.persona_id = d.persona_id and u.activo
      where d.secreto_hash = $1
      order by u.creado_en
      limit 1`,
    [enrolamiento],
  );
  const firma = rows[0];
  // NINGÚN aparato personal tiene ese secreto: puede ser la huella de un operario en un
  // dispositivo de ANDÉN [AC-FIDN-07] — §4.7, centinela 9. Ahí la partición del outbox no puede
  // ser el hash del secreto, porque el secreto es del aparato y no cambia cuando los operarios
  // rotan por PIN: las tres entregas de A y la de B compartirían llave y quedarían todas a
  // nombre de quien estuviera autenticado al sincronizar. `sesiones_anden.huella` es la llave
  // por PAREJA (aparato, operario), y es lo que devuelve a A su entrega.
  if (!firma) return await firmaDeAnden(c, enrolamiento, sesion);
  return {
    ...sesion,
    dispositivoId: firma.dispositivo_id,
    // Un aparato de andén no tiene persona dueña (§4.3): el hecho se le anota al APARATO y el
    // actor sigue siendo quien lo sincronizó, que es la única identidad humana que hubo.
    usuarioId: firma.usuario_id ?? sesion.usuarioId,
  };
}

/**
 * La otra clase de huella: la de un operario en un dispositivo de andén [AC-FIDN-07] — §5.4 F-D.
 *
 * Resuelve a la PAREJA (aparato, operario) aunque esa identidad ya esté cerrada —el operario se
 * fue del andén hace horas y su outbox recién sale ahora—, que es el caso entero del centinela 9.
 * Igual que la otra: no autentica nada, y una huella que esta base no conoce cae a la sesión que
 * transmite en vez de rebotar (§4.2).
 */
async function firmaDeAnden(c: PoolClient, huella: string, sesion: Sesion): Promise<Sesion> {
  const { rows } = await c.query<{ dispositivo_id: string; usuario_id: string }>(
    `select s.dispositivo_id::text as dispositivo_id, s.usuario_id::text as usuario_id
       from sesiones_anden s where s.huella = $1`,
    [huella],
  );
  const firma = rows[0];
  if (!firma) return sesion;
  return { ...sesion, dispositivoId: firma.dispositivo_id, usuarioId: firma.usuario_id };
}

/** Deja dicho que la captura entró degradada: un evento y una fila de «Por revisar» POR FLAG
 *  (§5.6 se lee por origen; una fila genérica obligaría a abrir el jsonb de cada una). La
 *  captura YA aterrizó en `eventos` — esto nunca la rebota ni la deshace [AC-FPOD-05]. */
async function dejarDichoQueDegrado(
  c: PoolClient,
  datos: {
    flags: readonly Exclude<FlagDeCapturaPod, "post_revocacion">[];
    paradaId: string;
    sesion: Sesion;
    nota: string;
  },
): Promise<void> {
  for (const flag of datos.flags) {
    await registrarEvento(c, {
      codigo: EVENTO_DE_FLAG[flag],
      objetoTabla: "paradas",
      objetoId: datos.paradaId,
      sesion: datos.sesion,
      payload: { flag },
    });
    await c.query("insert into review_queue (origen, severidad, nota) values ($1, $2, $3)", [
      `entrega.${flag}`,
      severidadDeFlag(flag),
      datos.nota,
    ]);
  }
}

/**
 * Persiste la captura como el HECHO write-once del §4.5 [AC-FRUT-23]: una fila de `entregas_pod`
 * por CADA encargo que la parada entrega. Es lo que le faltaba al camino feliz de 2 acciones
 * («Llegué»→«Entregado») para estar completo — hasta acá la entrega existía como evento y como
 * proyección, pero no como la declaración por encargo de la que cuelga la liquidación (§3.E1.9).
 *
 * ─── POR QUÉ POR ENCARGO Y NO POR PARADA ──────────────────────────────────────────
 *
 * El write-once del §4.5 es `UNIQUE(encargo) WHERE cerrada AND supersede IS NULL`: el sujeto de
 * la unicidad es el encargo, no la parada. Una entrega consolidada de varias empresas (§3.E1.5)
 * cierra varios encargos de una vez, y con una fila por parada la liquidación de cada empresa
 * tendría que deducirse de un join en vez de leer su propia declaración.
 *
 * ─── QUÉ NO ESCRIBE, A PROPÓSITO ──────────────────────────────────────────────────
 *
 * Ninguna fila de `evidence`. El tipo que respalda la entrega feliz sin foto ni firma es la
 * Pregunta al dueño 4 de la spec 04, sin responder: inventarle un tipo acá dejaría el numerador
 * EEVD del §2 calculándose contra una decisión que nadie tomó.
 *
 * ─── Y POR QUÉ NINGUNA RAMA DE ACÁ REBOTA ────────────────────────────────────────
 *
 * Sigue rigiendo el centinela 4 (§9.3.4: rechazos = 0). Por eso el `motivo_id` que no existe en
 * esta base se guarda como `null` en vez de romper la FK, el supersede sin motivo o sin autor
 * entra como fila suelta en vez de violar el CHECK del §7.4, y el segundo POD cerrado del mismo
 * encargo cae en el `on conflict do nothing` del índice parcial: la primera declaración es la que
 * vale (write-once), y la vía para cambiarla es el supersede, jamás un rebote al terreno.
 */
async function persistirPod(
  c: PoolClient,
  datos: {
    captura: CapturaEntrante;
    sesion: Sesion;
  },
): Promise<void> {
  const { captura, sesion } = datos;

  const { rows: encargos } = await c.query<{ encargo_id: string }>(
    "select distinct encargo_id::text as encargo_id from items where parada_id = $1 order by encargo_id",
    [captura.paradaId],
  );
  // Sin ítems no hay encargo al que anotarle el POD. Pasa con una parada que no está en esta base
  // —lo que el §9.3.2 exige que NO sea un rebote ni una fuga— y con una parada de recarga, que no
  // entrega nada. El evento ya aterrizó: no se pierde nada.
  if (encargos.length === 0) return;

  // El motivo de catálogo, validado contra ESTA base. Un identificador que el aparato trae de
  // otra ruta —o de un catálogo que el dueño apagó— no puede llevarse puesta la transacción por
  // una FK: se guarda sin motivo, que es exactamente lo que hay que revisar después.
  let motivoId: string | null = null;
  if (captura.motivoId !== null && esUuid(captura.motivoId)) {
    const { rows } = await c.query("select 1 from motivos where id = $1", [captura.motivoId]);
    motivoId = rows[0] ? captura.motivoId : null;
  }

  // La corrección del §7.4: la fila NUEVA apunta a la que corrige. `supersede_de` viaja como el
  // `client_uuid` de la captura original —lo único que el aparato conoce—, así que hay que
  // resolverlo a la fila. Los dos CHECKs del esquema exigen motivo Y autor: sin cualquiera de los
  // dos la corrección sería anónima o sin razón, indistinguible de una adulteración, y entonces
  // esto NO es un supersede — entra como declaración suelta y el `on conflict` de abajo decide.
  const motivo = captura.motivo === null ? "" : captura.motivo.trim();
  const puedeSuperseder = captura.supersedeDe !== null && motivo !== "" && sesion.usuarioId !== null;

  for (const { encargo_id } of encargos) {
    let supersedeId: string | null = null;
    if (puedeSuperseder) {
      const { rows } = await c.query<{ id: string }>(
        "select id::text as id from entregas_pod where client_uuid = $1 and encargo_id = $2",
        [captura.supersedeDe, encargo_id],
      );
      supersedeId = rows[0]?.id ?? null;
    }

    await c.query(
      `insert into entregas_pod
         (encargo_id, parada_id, resultado, metodo_entrega, motivo_id, cerrada,
          supersede_id, supersede_motivo, actor_id, dispositivo_id,
          event_time, tz_offset_min, client_uuid)
       values ($1, $2, $3::parada_resultado, $4, $5, true, $6, $7, $8, $9, $10, $11, $12)
         on conflict (tenant_id, encargo_id) where cerrada and supersede_id is null do nothing`,
      [
        encargo_id,
        captura.paradaId,
        captura.resultado,
        captura.metodoEntrega,
        motivoId,
        supersedeId,
        supersedeId === null ? null : motivo,
        sesion.usuarioId,
        sesion.dispositivoId,
        captura.tsDispositivo,
        captura.tzOffsetMin,
        // La llave del aparato identifica la CAPTURA, que es una por parada, y la unicidad de
        // esta tabla es por tenant: en una entrega consolidada las N filas no pueden compartirla.
        // La lleva la primera y las demás van sin ella — inventarles una derivada pondría en una
        // columna del cliente un valor que el cliente nunca emitió. La idempotencia del replay no
        // depende de esto: `aterrizarCapturas` corta ANTES, contra `eventos.client_uuid`, y en la
        // misma transacción que estas filas.
        encargo_id === encargos[0]!.encargo_id ? captura.clientUuid : null,
      ],
    );
  }
}

export async function aterrizarCapturas(
  pool: Pool,
  sesion: Sesion,
  slug: string,
  entrantes: CapturaEntrante[],
  // Cuándo se revocó el aparato que manda este lote; `null` si sigue vigente [AC-FPOD-07] — §4.3.
  // Lo trae `sesionParaSincronizarCapturas`, la única guardia que deja pasar una sesión revocada.
  revocadoEn: Date | null,
  // La huella del enrolamiento que CAPTURÓ este lote [AC-FPOD-09] — §4.7. `null` en el camino
  // normal, donde quien transmite es quien capturó; con valor cuando el aparato está vaciando la
  // partición de una identidad que ya no es la activa.
  enrolamiento: string | null = null,
): Promise<AcuseDeCaptura[]> {
  if (entrantes.length === 0) return [];

  return enActo(
    pool,
    async (c) => {
      // El acto sigue siendo de quien manda el lote —la auditoría del §7.4 registra quién hizo la
      // llamada—; lo que la firma cambia es a nombre de quién queda el HECHO en `eventos`.
      const firma = await firmaDelEnrolamiento(c, enrolamiento, sesion);

      // La secuencia monotónica del dispositivo [AC-FPOD-10] — §4.7. El lote entero comparte el
      // mismo `firma.dispositivoId` (la firma se calcula UNA vez arriba, no por captura), así
      // que basta con leer y escribir `dispositivos.secuencia_maxima` una vez por llamada. El
      // `for update` serializa contra otro lote del MISMO dispositivo en vuelo — dos réplicas
      // del outbox mandando a la vez no pueden pisarse la máxima.
      let secuenciaMaxima: number | null = null;
      const necesitaSecuencia = entrantes.some((e) => e.secuenciaDispositivo !== null);
      if (necesitaSecuencia) {
        const { rows } = await c.query<{ secuencia_maxima: string | null }>(
          "select secuencia_maxima from dispositivos where id = $1 for update",
          [firma.dispositivoId],
        );
        secuenciaMaxima = rows[0]?.secuencia_maxima == null ? null : Number(rows[0].secuencia_maxima);
      }

      const acuses: AcuseDeCaptura[] = [];
      for (const captura of entrantes) {
        // El replay es el camino PRINCIPAL (§4.7), así que llega repetido por diseño: al
        // arrancar la app y al volver la señal. Se pregunta ANTES de insertar porque
        // `UNIQUE(tenant_id, client_uuid)` rebota 23505 y ese rebote se llevaría puesto el lote
        // entero — la idempotencia del §0 tiene que verse como «ya estaba», no como un error.
        const { rows: previo } = await c.query<{ id: string }>(
          "select id::text as id from eventos where client_uuid = $1",
          [captura.clientUuid],
        );

        const { configVersionId, moduloEncendido } = await configDeLaCaptura(c, slug, captura.turnoId);

        // Solo las capturas NUEVAS avanzan la máxima [AC-FPOD-10]: un replay que ya aterrizó no
        // puede volver a competir por el mismo número, y recalcular su hueco contra la máxima ya
        // avanzada daría un veredicto distinto al que se dejó dicho la primera vez.
        let secuenciaHueco = false;
        if (!previo[0] && captura.secuenciaDispositivo !== null) {
          secuenciaHueco = esHuecoDeSecuencia(secuenciaMaxima, captura.secuenciaDispositivo);
          secuenciaMaxima = maximaConSecuencia(secuenciaMaxima, captura.secuenciaDispositivo);
        }

        // El candado del servidor [AC-FRUT-23] — KR-29, §7.3: la MISMA lectura que le sirve el
        // snapshot al cliente (`servidor/paradas.ts`), acá dentro de la transacción que aterriza
        // la captura. Una parada que no es de entrega —o que no está en esta base (§9.3.2)— no
        // tiene candado que mirar, y `undefined` es justamente eso: no se juzga.
        const estadoDeLaParada = await candadoDeLaParadaEn(c, captura.paradaId);
        const manifiestoConfirmado =
          estadoDeLaParada.tipo === "entrega" ? estadoDeLaParada.abierta : undefined;

        const flags = clasificarCapturaPod({
          tsDispositivo: captura.tsDispositivo,
          recibidaEn: new Date(),
          moduloEncendido,
          revocadoEn,
          secuenciaHueco,
          manifiestoConfirmado,
        });

        if (previo[0]) {
          // El replay NO vuelve a degradar (§5.6, §9.3.1): los flags viajan igual en la
          // respuesta —el aparato tiene que poder mostrar qué quedó marcado— pero no escriben
          // evento ni fila de revisión de más.
          acuses.push({
            client_uuid: captura.clientUuid,
            aceptada: true,
            repetida: true,
            flags,
            config_version_id: configVersionId,
          });
          continue;
        }

        // El undo post-replay aterriza como una fila NUEVA que supersede a la original, jamás
        // como un UPDATE (§7.4, §4.7) [AC-FPOD-08]: quedan DOS filas y la primera se sigue
        // leyendo tal como el terreno la mandó. El código distinto es lo que le da al métrico de
        // gaming del §10 algo que contar sin abrir el jsonb de cada captura, y el `motivo` del
        // payload es lo que la definición SQL de `pods_supersedidos_semanal` excluye cuando dice
        // `undo`.
        const esSupersede = captura.supersedeDe !== null;
        await registrarEvento(c, {
          codigo: esSupersede
            ? EVENTOS_OPERACION.entrega_pod_deshecha
            : EVENTOS_OPERACION.entrega_pod_capturada,
          objetoTabla: "paradas",
          objetoId: captura.paradaId,
          // Firmado por el enrolamiento que capturó, no por el que transmitió [AC-FPOD-09].
          sesion: firma,
          // El doble reloj del §4.6: `event_time` es cuándo el chofer tocó «Entregado» —puede
          // ser de hace tres horas, sin señal— y `record_time` lo pone la BD al aterrizar.
          eventTime: captura.tsDispositivo,
          tzOffsetMin: captura.tzOffsetMin,
          clientUuid: captura.clientUuid,
          payload: {
            resultado: captura.resultado,
            metodo_entrega: captura.metodoEntrega,
            motivo_id: captura.motivoId,
            items: captura.items ?? null,
            evidencias: captura.evidencias ?? [],
            supersede_de: captura.supersedeDe,
            motivo: captura.motivo,
            secuencia_dispositivo: captura.secuenciaDispositivo,
          },
        });

        // Y el HECHO write-once del §4.5, que es lo que hace completo al camino feliz de dos
        // acciones [AC-FRUT-23]. Después del evento y no antes: `eventos` es el orden autoritativo
        // (§4.6) y `entregas_pod` la declaración por encargo que cuelga de él.
        await persistirPod(c, { captura, sesion: firma });

        // `post_revocacion` viaja en el acuse (el aparato tiene que poder mostrar la cuarentena)
        // pero no deja rastro: filtrarla ACÁ, y no en `dejarDichoQueDegrado`, es lo que evita que
        // el mapa `EVENTO_DE_FLAG` necesite una entrada que nunca se usaría [AC-FPOD-07].
        const flagsConRastro = flags.filter(dejaRastro);
        if (flagsConRastro.length > 0) {
          await dejarDichoQueDegrado(c, {
            flags: flagsConRastro,
            paradaId: captura.paradaId,
            // Misma firma que el hecho que degradó: quien revise «Por revisar» tiene que ver el
            // aparato que capturó, no el que hizo de cartero [AC-FPOD-09].
            sesion: firma,
            nota: `Captura de POD para la parada ${captura.paradaId} — config_version_id ${configVersionId}`,
          });
        }

        acuses.push({
          client_uuid: captura.clientUuid,
          aceptada: true,
          repetida: false,
          flags,
          config_version_id: configVersionId,
        });
      }

      if (necesitaSecuencia) {
        await c.query("update dispositivos set secuencia_maxima = $1 where id = $2", [
          secuenciaMaxima,
          firma.dispositivoId,
        ]);
      }

      return acuses;
    },
    sesion,
  );
}

// ─── El binario de una evidencia: el hash viaja ANTES, el binario después [AC-FPOD-19] ────────
// §4.6, §7.6, §4.2.
//
// El §4.6 lo fija literal: «el sha256 viaja en la mutación ANTES del binario; mismatch al
// re-hashear ⇒ flag, no rebote». Mismo contrato que `registrarFotoDeManifiesto` (AC-FRUT-10)
// ya cierra para la foto de custodia — acá es el mismo transporte para `evidencias` de una
// parada de POD, que puede traer más de una (firma Y foto en la misma entrega, §4.6).
//
// La promesa no viaja suelta: vive en el payload del evento `entrega.pod_capturada` (o su
// corrección `entrega.pod_deshecha`) que `aterrizarCapturas` ya escribió — eventos es append-only
// y ORDEN AUTORITATIVO (§4.6), así que nadie pudo moverla después para que calzara con lo que
// subió. Se lee la más reciente para esa parada: un supersede puede declarar una promesa nueva.

// No se enumera acá el catálogo de `TipoDeEvidencia` (a diferencia de `pod-terreno.ts`, que sí lo
// declara como TIPO): repetirlo como array de valores en `apps/flota/src/servidor` es exactamente
// la siembra que `gate-seeds-pin-destinatario.mjs`/`gate-seeds-escaneo-codigo.mjs` prohíben —esos
// ganchos son DDL-only en E1 (§4.9, AC-FPOD-17) y ver su string en código de servidor es la señal
// que el gate persigue, sin poder distinguir «lo estoy sembrando» de «lo estoy validando». La
// autoridad sobre qué `tipo` es válido es el enum `evidencia_tipo` de la 0002: un valor que no
// esté en él rebota en el INSERT de más abajo, no acá.
function esTipoDeEvidencia(valor: unknown): valor is TipoDeEvidencia {
  return typeof valor === "string" && valor.length > 0;
}

const SHA256_HEX = /^[0-9a-f]{64}$/i;

export type BinarioDeEvidenciaRegistrado =
  | { tipo: "ok"; evidence_id: string; repetida: boolean; flags: FlagDeCapturaPod[] }
  | { tipo: "requisito_no_encontrado" };

/**
 * Recibe el binario de una evidencia de POD y lo contrasta con el sha256 que ya viajó en la
 * mutación de la captura.
 *
 * NUNCA rebota por el contenido: sin promesa, con promesa que no calza o con el módulo apagado,
 * la evidencia entra igual — es mejora progresiva, jamás dependencia (§7.6). Lo único que
 * contesta «no existe» es un `requisito_id` que esta parada nunca declaró: no es degradar una
 * captura, es no tener a qué colgarla.
 */
export async function registrarBinarioDeEvidencia(
  pool: Pool,
  sesion: Sesion,
  slug: string,
  datos: {
    paradaId: string;
    requisitoId: string;
    contenidoB64: string;
    clientUuid: string | null;
    tsDispositivo: string;
    tzOffsetMin: number;
    turnoId: string | null;
  },
): Promise<BinarioDeEvidenciaRegistrado> {
  return enActo(
    pool,
    async (c) => {
      const { rows: evento } = await c.query<{ evidencias: unknown }>(
        `select e.payload -> 'evidencias' as evidencias
           from eventos e join evento_tipo t on t.id = e.tipo_id
          where e.objeto_tabla = 'paradas' and e.objeto_id = $1
            and t.codigo in ('entrega.pod_capturada', 'entrega.pod_deshecha')
          order by e.id desc limit 1`,
        [datos.paradaId],
      );
      const evidencias = Array.isArray(evento[0]?.evidencias)
        ? (evento[0]!.evidencias as Record<string, unknown>[])
        : [];
      const prometida = evidencias.find((e) => e.requisitoId === datos.requisitoId);
      if (!prometida || !esTipoDeEvidencia(prometida.tipo)) {
        return { tipo: "requisito_no_encontrado" };
      }
      const shaPrometido =
        typeof prometida.sha256 === "string" && SHA256_HEX.test(prometida.sha256)
          ? prometida.sha256
          : null;

      const binario = Buffer.from(datos.contenidoB64, "base64");
      const shaRecalculado = createHash("sha256").update(binario).digest("hex");

      const { moduloEncendido } = await configDeLaCaptura(c, slug, datos.turnoId);

      const flags = clasificarCapturaPod({
        tsDispositivo: new Date(datos.tsDispositivo),
        recibidaEn: new Date(),
        moduloEncendido,
        revocadoEn: null,
        secuenciaHueco: false,
        shaPrometido,
        shaRecalculado,
      });

      // Se guarda el hash REAL. Guardar el prometido dejaría una fila que dice que el archivo es
      // otro del que tenemos, y entonces el sha256 write-once del §4.6 no probaría nada.
      const { rows } = await c.query<{ id: string }>(
        `insert into evidence (tipo, objeto_tabla, objeto_id, sha256, capturada_en, tz_offset_min, client_uuid)
         values ($1, 'paradas', $2, decode($3, 'hex'), $4, $5, $6)
           on conflict (tenant_id, client_uuid) do nothing
         returning id::text as id`,
        [
          prometida.tipo,
          datos.paradaId,
          shaRecalculado,
          datos.tsDispositivo,
          datos.tzOffsetMin,
          datos.clientUuid,
        ],
      );

      if (!rows[0]) {
        // Replay del outbox: la evidencia ya estaba. No se degrada de nuevo — repetir el aviso
        // contaría dos veces un binario que se subió una vez (§9.3.1).
        const { rows: previa } = await c.query<{ id: string }>(
          "select id::text as id from evidence where client_uuid = $1",
          [datos.clientUuid],
        );
        return { tipo: "ok", evidence_id: previa[0]!.id, repetida: true, flags };
      }

      const flagsConRastro = flags.filter(dejaRastro);
      if (flagsConRastro.length > 0) {
        await dejarDichoQueDegrado(c, {
          flags: flagsConRastro,
          paradaId: datos.paradaId,
          sesion,
          nota: `Evidencia (${prometida.tipo}) de la parada ${datos.paradaId}, requisito ${datos.requisitoId}.`,
        });
      }

      return { tipo: "ok", evidence_id: rows[0].id, repetida: false, flags };
    },
    sesion,
  );
}
