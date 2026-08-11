import type { Pool, PoolClient } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION, esUuid } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { versionVigente, estadoDeFeature, FEATURES } from "./config.ts";
import {
  clasificarCapturaPod,
  dejaRastro,
  severidadDeFlag,
  type FlagDeCapturaPod,
} from "../dominio/pod-sync.ts";

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

export async function aterrizarCapturas(
  pool: Pool,
  sesion: Sesion,
  slug: string,
  entrantes: CapturaEntrante[],
  // Cuándo se revocó el aparato que manda este lote; `null` si sigue vigente [AC-FPOD-07] — §4.3.
  // Lo trae `sesionParaSincronizarCapturas`, la única guardia que deja pasar una sesión revocada.
  revocadoEn: Date | null,
): Promise<AcuseDeCaptura[]> {
  if (entrantes.length === 0) return [];

  return enActo(
    pool,
    async (c) => {
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
        const flags = clasificarCapturaPod({
          tsDispositivo: captura.tsDispositivo,
          recibidaEn: new Date(),
          moduloEncendido,
          revocadoEn,
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
          sesion,
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
          },
        });

        // `post_revocacion` viaja en el acuse (el aparato tiene que poder mostrar la cuarentena)
        // pero no deja rastro: filtrarla ACÁ, y no en `dejarDichoQueDegrado`, es lo que evita que
        // el mapa `EVENTO_DE_FLAG` necesite una entrada que nunca se usaría [AC-FPOD-07].
        const flagsConRastro = flags.filter(dejaRastro);
        if (flagsConRastro.length > 0) {
          await dejarDichoQueDegrado(c, {
            flags: flagsConRastro,
            paradaId: captura.paradaId,
            sesion,
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
      return acuses;
    },
    sesion,
  );
}
