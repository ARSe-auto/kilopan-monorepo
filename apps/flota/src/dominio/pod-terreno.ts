// El bucle de terreno de F4: el camino feliz de la entrega [AC-FPOD-01] y sus variantes
// cerradas [AC-FPOD-02] — §5.2 F4, §5.3, §0 (undo 8 s), §4.5, §4.4, §4.6, §4.7, §7.6.
//
// ─── DOS ACCIONES, Y LA SEGUNDA YA DEJÓ AL CHOFER EN LA PARADA SIGUIENTE ──────────
//
// El §5.2 F4 fija el camino feliz en DOS toques exactos: «Llegué» (1) → «Entregado» (1). El
// §5.3 lo convierte en contrato: «una feature que sube el conteo del camino feliz no se
// mergea». Un contrato así no se defiende con disciplina, se defiende con una máquina: acá el
// avance a la parada siguiente es parte de `entregar`, no un gesto aparte. Nadie puede agregarle
// un «Siguiente» sin que el conteo suba y el e2e se ponga rojo.
//
// ─── LAS VARIANTES CERRADAS, JAMÁS MÁS DE 4 ACCIONES [AC-FPOD-02] ────────────────
//
// El §5.2 F4 cierra tres variantes más, cada una con su propio techo:
//
//   · `entregarParcial` — stepper por ítem (un campo de teclado propio = 1 acción, §5.3) +
//     motivo_item por ítem ajustado (§4.5); con una parada de un solo ítem cuesta 3: la
//     cantidad, el motivo, confirmar. El stepper NO tiene un toque propio de «abrir el modo»
//     —está a la vista sobre la entrega abierta— y esa es la razón por la que la variante más
//     cara sigue cabiendo bajo el techo cuando la parada además exige evidencia (abajo).
//   · `noEntregar` — motivo de catálogo + confirmar: 3 acciones exactas, fijas por el maestro.
//   · `dejarEnPunto` — de primera clase (§4.5: modo `dejado_en_punto` ES entrega efectuada,
//     nunca motivo de no-entrega): 3 acciones cuando `parada.bultos` supera
//     `parametros.bultos_max_sin_receptor` (§4.4) —abrir el modo, el encuadre, confirmar—, y
//     menos cuando no lo supera, porque el encuadre no se pide.
//
// ─── LA EVIDENCIA EXTRA LA PIDEN LOS DATOS, NO EL VERTICAL [AC-FPOD-02] ──────────
//
// «Evidencia extra solo si `stop_requirement` la exige … el operario nunca supera 4 acciones»
// (§5.2 F4). Los requisitos llegan CON la parada —los deriva del cargo_type el publicar del día
// (§4.6, AC-FRUT-04)— y acá son un dato más: `requisitosPendientes` dice cuáles faltan y los
// cierres de una entrega EFECTUADA no son transición mientras quede alguno obligatorio. Ninguna
// función de este archivo pregunta de qué vertical es el tenant: si mañana el frío exige un
// `indicador_visual`, la parada lo trae en `requisitos` y el flujo se arma solo.
//
// El techo de 4 se sostiene sumado, que es como lo cuenta el operario: un requisito obligatorio
// cuesta 1 acción, y la variante más cara —parcial de un ítem, 3— queda en 4 exactas con él.
//
// `noEntregar` es la única salida que NO los exige, y es una decisión con motivo: el requisito es
// evidencia DE LA ENTREGA, y una parada fallida no tiene ninguna que dar —el local cerrado no
// firma—. Exigírsela dejaría al chofer sin manera de cerrar la parada, que es exactamente el
// rebote en terreno que el §4.2 y el §7.6 prohíben. Su evidencia es el `motivo_id` del catálogo.
//
// Las tres reusan `cerrarParada`: la misma disciplina de `entregar` (cierra la ventana de la
// captura anterior si seguía pendiente, dispara `pending_undo`, avanza el índice, apaga
// `llegada`) para que el undo de 8 s y el avance automático sean UNA sola implementación y no
// tres que puedan desalinearse.
//
// La degradación por cámara denegada (encuadre sin permiso) y el chequeo DDL-only de los
// tipos de evidencia `pin_destinatario`/`escaneo_codigo` son AC-FPOD-17. El covering array 2-way
// sobre los flags visibles es AC-FPOD-18. Acá `dejarEnPunto` solo sabe que el encuadre SE
// CAPTURÓ o no —un booleano que la pantalla decide cómo llenar—, nunca por qué no se pudo.
//
// ─── EL UNDO DE 8 s ES LA ÚNICA CONFIRMACIÓN, Y POR ESO NO ES UNA ACCIÓN ──────────
//
// Cero modales en terreno (§7.6): el toque de «Entregado» ya escribió la captura y abrió una
// ventana de `UNDO.ventana_ms` para deshacerla (§4.7). Dentro de esa ventana la captura está en
// `pending_undo` y NO ha salido del dispositivo — deshacerla la cancela ANTES del replay y no
// deja rastro, que es exactamente lo que el §4.7 pide. Vencida la ventana pasa a la cola, que
// es lo que el motor de sync replayea.
//
// ─── DÓNDE TERMINA ESTE AC Y EMPIEZA EL DE AL LADO ───────────────────────────────
//
// Acá vive la CONDUCTA del bucle: cuántas acciones cuesta, cuándo avanza, qué hace el undo. La
// cola de salida es la frontera declarada con el resto del módulo 04:
//
//   · persistirla en IndexedDB partida por (tenant, usuario) y replayarla al arrancar y al
//     volver la señal es AC-FPOD-03/04/08/09/10;
//   · la fila `entregas_pod` donde aterriza en el servidor es AC-FPOD-11, y su DDL es trabajo
//     de sesión supervisada — el motor no crea migraciones.
//
// Por eso la captura es un DATO completo desde ya (client_uuid UUIDv7 del §0, doble reloj
// `ts_dispositivo`+`tz_offset_min` del §4.6): el AC que la replaye no tiene que inventarle
// campos, solo llevarla.

import { UNDO } from "../../../../packages/nucleo-comun/src/constants.ts";

/** El presupuesto del §5.3, escrito UNA vez: «entrega feliz = 2 exactas». */
export const ENTREGA_FELIZ_ACCIONES = 2;

/** Un ítem de la parada, con lo que el stepper de la variante parcial necesita mostrar y
 *  ajustar (§4.5: `items(qty_planificada/entregada/rechazada, motivo_item)`). */
export type ItemDeParada = {
  id: string;
  /** La razón social, para que el stepper diga DE QUIÉN es el bulto que se está ajustando —
   *  la agrupación multi-empresa (§3.E1.5) hace que una parada pueda tener ítems de más de
   *  una empresa. */
  empresa: string;
  qtyPlanificada: number;
};

/** Los tipos del enum `evidencia_tipo` del §4.6, la MISMA lista para POD y verticales. Se
 *  declara acá y no se deriva de la BD porque la pantalla tiene que saber, en tiempo de
 *  compilación, que le puso texto es-CL a todos: un tipo nuevo en el enum sin su etiqueta es un
 *  requisito que el chofer vería sin nombre. */
export type TipoDeEvidencia =
  | "firma"
  | "foto"
  | "lectura"
  | "indicador_visual"
  | "archivo_logger"
  | "documento"
  | "pin_destinatario"
  | "escaneo_codigo";

/** Una fila de `stop_requirement` (§4.6): qué evidencia pide ESTA parada y en qué orden. La
 *  deriva del cargo_type el publicar del día (AC-FRUT-04); acá viaja como dato de la parada. */
export type RequisitoDeEvidencia = {
  id: string;
  tipo: TipoDeEvidencia;
  obligatorio: boolean;
  orden: number;
};

/** Un requisito ya satisfecho en terreno. El binario y su sha256 —cómo VIAJA la evidencia— son
 *  AC-FPOD-19; acá se registra QUÉ requisito quedó cumplido, que es lo que abre el cierre. */
export type EvidenciaCapturada = { requisitoId: string; tipo: TipoDeEvidencia };

/** Una parada de entrega de la ruta, tal como la tarjeta la muestra (§5.2 F4). */
export type ParadaDeRuta = {
  id: string;
  orden: number;
  destino: string;
  /** La ventana prometida, ya formateada en es-CL, o `null` si la parada no tiene. */
  ventana: string | null;
  bultos: number;
  items: ItemDeParada[];
  /** Lo que ESTA parada exige antes de darla por entregada (§4.6). Vacío es lo normal en E1. */
  requisitos: RequisitoDeEvidencia[];
};

/** El resultado de la máquina de estados de la parada (§4.5: `resultado exito|fallo|parcial`). */
export type ResultadoDeEntrega = "exito" | "fallo" | "parcial";

/** Cómo se cerró una entrega EXITOSA: con receptor, o dejada en el punto sin él (§4.5: modo
 *  `dejado_en_punto` es entrega efectuada, no motivo de no-entrega). `null` en `fallo` y en
 *  `parcial`, que no tienen método de entrega. */
export type MetodoDeEntrega = "receptor" | "dejado_en_punto" | null;

/** El ajuste de UN ítem de la variante parcial: cuánto se entregó de verdad y por qué el resto
 *  no. `qtyRechazada` se deriva de `qtyPlanificada - qtyEntregada` —no es un campo del teclado
 *  aparte: pedirlo dos veces sería una acción más sobre un dato que ya está en la resta—, así
 *  que acá viaja calculado, no vuelto a preguntar. */
export type ItemAjustado = {
  itemId: string;
  qtyEntregada: number;
  qtyRechazada: number;
  motivoId: string;
};

/** La captura de una entrega, con lo que el §0 y el §4.6 exigen que viaje con ella. */
export type CapturaDeEntrega = {
  paradaId: string;
  clientUuid: string;
  tsDispositivo: string;
  tzOffsetMin: number;
  resultado: ResultadoDeEntrega;
  metodoEntrega: MetodoDeEntrega;
  /** El motivo de la NO-entrega (§4.5: `paradas.motivo_id`). `null` salvo en `fallo`. */
  motivoId: string | null;
  /** El desglose por ítem de una entrega `parcial`. `null` en `exito` y en `fallo`. */
  items: ItemAjustado[] | null;
  /** Los `stop_requirement` que se cumplieron para poder cerrar esta parada (§4.6). */
  evidencias: EvidenciaCapturada[];
  estado: typeof UNDO.estado_local | "por_replicar";
  /** La secuencia monotónica de ESTE dispositivo [AC-FPOD-10] — §4.7: crece de a uno en cada
   *  captura que el aparato cierra (terreno o supersede), nunca se reinicia mientras el aparato
   *  siga vivo. No es el `client_uuid` —ese identifica el hecho, esto ordena la HISTORIA del
   *  aparato— y es lo que el servidor usa para notar un hueco (evicción del outbox o
   *  manipulación) sin depender de que el reloj del teléfono esté bien. */
  secuenciaDispositivo: number;
  /** El `client_uuid` de la captura que ESTA corrige, cuando el undo llegó después del replay
   *  [AC-FPOD-08] — §4.7. `null` en toda captura de terreno. */
  supersedeDe: string | null;
  /** Por qué se supersedió. `undo` es el deshacer de 8 s del chofer, EXCLUIDO del métrico de
   *  gaming del §10 por definición SQL [AC-FPOD-08]. `null` cuando no supersede a nadie. */
  motivoSupersede: typeof UNDO.motivo_supersede | null;
};

/** Una captura recién cerrada en terreno, antes de que `cerrarParada` le ponga lo que toda
 *  captura del outbox lleva: su estado y el par supersede (vacío — el terreno no corrige, cierra
 *  paradas) [AC-FPOD-08]. */
type CapturaDeTerreno = Omit<CapturaDeEntrega, "estado" | "supersedeDe" | "motivoSupersede">;

/** El sello del dispositivo en el momento del toque: lo pone quien llama, para que la máquina
 *  siga siendo pura y el test pueda fijar el reloj. */
export type SelloDelAparato = {
  clientUuid: string;
  tsDispositivo: string;
  tzOffsetMin: number;
  /** La secuencia monotónica del dispositivo para ESTE cierre [AC-FPOD-10] — §4.7. La asigna
   *  quien llama (`cliente/secuencia-dispositivo.ts`), con el mismo criterio que `clientUuid`:
   *  la máquina se queda pura y el test fija el valor sin tocar el disco. */
  secuenciaDispositivo: number;
};

export type Recorrido = {
  paradas: ParadaDeRuta[];
  /** La parada en la que está el chofer. Igual a `paradas.length` cuando la ruta terminó. */
  indice: number;
  /** «Llegué» ya tocado en la parada actual. */
  llegada: boolean;
  /** La captura dentro de su ventana de 8 s: todavía no salió del dispositivo. */
  captura: CapturaDeEntrega | null;
  /** Las capturas cuya ventana venció, esperando el replay del motor de sync. */
  cola: CapturaDeEntrega[];
};

/** `cola` arranca con lo que el outbox durable traía de la sesión anterior [AC-FPOD-08]: una app
 *  que se cerró con capturas sin replicar las vuelve a tener al abrir, o el hecho se perdería
 *  justo en el aparato que el §4.7 declara su único dueño mientras no hay señal. */
export function iniciarRecorrido(
  paradas: ParadaDeRuta[],
  indice = 0,
  cola: CapturaDeEntrega[] = [],
): Recorrido {
  return { paradas, indice, llegada: false, captura: null, cola };
}

export function paradaActual(r: Recorrido): ParadaDeRuta | null {
  return r.paradas[r.indice] ?? null;
}

/** Acción 1 de 2. Sobre una parada que ya no existe —la ruta terminó— no hace nada. */
export function llegar(r: Recorrido): Recorrido {
  if (paradaActual(r) === null || r.llegada) return r;
  return { ...r, llegada: true };
}

/**
 * El cierre común a las cuatro formas de terminar una parada: la ventana de la captura
 * ANTERIOR se cierra sola si esta nueva llega antes de vencer (dos entregas seguidas son lo
 * normal en un pasillo de galería, y perder la primera por rápido sería perder un hecho del
 * mundo), la nueva nace en `pending_undo`, el índice avanza y «Llegué» se apaga para la parada
 * que sigue. Una sola implementación para que el undo de 8 s y el avance automático no puedan
 * desalinearse entre el camino feliz y sus variantes (§5.2 F4, §4.7).
 */
function cerrarParada(r: Recorrido, captura: CapturaDeTerreno): Recorrido {
  return {
    ...r,
    cola: r.captura === null ? r.cola : [...r.cola, { ...r.captura, estado: "por_replicar" }],
    // Nace en `pending_undo` y con el par supersede vacío: una captura de terreno cierra una
    // parada, jamás corrige otra captura (§4.7) [AC-FPOD-08].
    captura: { ...captura, estado: UNDO.estado_local, supersedeDe: null, motivoSupersede: null },
    indice: r.indice + 1,
    llegada: false,
  };
}

/**
 * Acción 2 de 2 del camino feliz: escribe la captura en `pending_undo` Y avanza a la parada
 * siguiente.
 *
 * El avance va ACÁ y no en un toque propio: el §5.2 F4 lo llama «avance automático», y un
 * «Siguiente» aparte serían tres acciones donde el §5.3 fija dos.
 *
 * Entregar sin haber llegado no es una transición del bucle: la tarjeta no ofrece «Entregado»
 * antes de «Llegué», y una máquina que igual lo aceptara dejaría que un doble toque sobre la
 * pantalla anterior cerrara una parada donde el camión nunca estuvo.
 */
export function entregar(
  r: Recorrido,
  sello: SelloDelAparato,
  evidencias: EvidenciaCapturada[] = [],
): Recorrido {
  const parada = paradaActual(r);
  if (parada === null || !r.llegada) return r;
  if (requisitosPendientes(parada, evidencias).length > 0) return r;

  return cerrarParada(r, {
    paradaId: parada.id,
    clientUuid: sello.clientUuid,
    tsDispositivo: sello.tsDispositivo,
    tzOffsetMin: sello.tzOffsetMin,
    secuenciaDispositivo: sello.secuenciaDispositivo,
    resultado: "exito",
    metodoEntrega: "receptor",
    motivoId: null,
    items: null,
    evidencias,
  });
}

/**
 * Los requisitos OBLIGATORIOS de la parada que todavía no se capturaron, en el orden en que la
 * parada los pide (§4.6). Vacío = la parada se puede cerrar como entrega efectuada.
 *
 * Los no obligatorios quedan fuera a propósito: el `obligatorio` de `stop_requirement` es
 * exactamente la columna que distingue «hay que capturarlo» de «se puede», y tratarlos igual
 * convertiría un opcional en un bloqueo que nadie configuró.
 */
export function requisitosPendientes(
  parada: ParadaDeRuta,
  capturadas: EvidenciaCapturada[],
): RequisitoDeEvidencia[] {
  const ya = new Set(capturadas.map((e) => e.requisitoId));
  return parada.requisitos
    .filter((req) => req.obligatorio && !ya.has(req.id))
    .sort((a, b) => a.orden - b.orden);
}

/**
 * Variante parcial [AC-FPOD-02]: stepper por ítem + `motivo_item` (§4.5). Sin llegar, o sin
 * ajustar al menos un ítem, no es una transición — un «Parcial» que cierra la parada sin haber
 * tocado ningún ítem no es distinguible de un doble toque accidental.
 *
 * Viajan SOLO los ítems ajustados: los que el chofer no tocó se entregaron completos, y pedirle
 * que los confirme uno por uno sería cobrarle una acción por cada bulto que sí llegó bien.
 */
export function entregarParcial(
  r: Recorrido,
  ajustes: ItemAjustado[],
  sello: SelloDelAparato,
  evidencias: EvidenciaCapturada[] = [],
): Recorrido {
  const parada = paradaActual(r);
  if (parada === null || !r.llegada || ajustes.length === 0) return r;
  if (requisitosPendientes(parada, evidencias).length > 0) return r;

  return cerrarParada(r, {
    paradaId: parada.id,
    clientUuid: sello.clientUuid,
    tsDispositivo: sello.tsDispositivo,
    tzOffsetMin: sello.tzOffsetMin,
    secuenciaDispositivo: sello.secuenciaDispositivo,
    resultado: "parcial",
    metodoEntrega: null,
    motivoId: null,
    items: ajustes,
    evidencias,
  });
}

/**
 * Variante no entregado [AC-FPOD-02]: motivo de catálogo + confirmar, 3 acciones exactas fijas
 * por el §5.2 F4 (la tarjeta las cuenta: abrir el modo, el motivo, confirmar).
 *
 * La ÚNICA salida que no mira `stop_requirement`: el requisito es evidencia de la entrega, y
 * acá no hubo entrega de la que dar ninguna. Exigirle la firma de un receptor que no está sería
 * dejar la parada sin manera de cerrarse (§4.2, §7.6); su evidencia es el motivo del catálogo.
 */
export function noEntregar(r: Recorrido, motivoId: string, sello: SelloDelAparato): Recorrido {
  const parada = paradaActual(r);
  if (parada === null || !r.llegada) return r;

  return cerrarParada(r, {
    paradaId: parada.id,
    clientUuid: sello.clientUuid,
    tsDispositivo: sello.tsDispositivo,
    tzOffsetMin: sello.tzOffsetMin,
    secuenciaDispositivo: sello.secuenciaDispositivo,
    resultado: "fallo",
    metodoEntrega: null,
    motivoId,
    items: null,
    evidencias: [],
  });
}

/**
 * Variante dejado en punto [AC-FPOD-02]: de primera clase (§4.5 — es entrega EFECTUADA, jamás
 * motivo de no-entrega). El encuadre fotográfico se exige SOLO si `parada.bultos` supera
 * `parametros.bultos_max_sin_receptor` (§4.4); con el parámetro sin sembrar (`null` — Pregunta
 * al dueño 1 de la spec 04, sin responder) no hay umbral contra el que comparar y el encuadre
 * nunca se exige, para no bloquear una entrega real por una pregunta que el dueño no contestó.
 *
 * `encuadreCapturado` es un booleano puro: SI se capturó o no. Cómo se llena —cámara concedida,
 * cámara denegada y su degradación a flag— es AC-FPOD-17; acá solo se hace cumplir el umbral.
 */
export function dejarEnPunto(
  r: Recorrido,
  sello: SelloDelAparato,
  opciones: { encuadreCapturado: boolean; bultosMaxSinReceptor: number | null },
  evidencias: EvidenciaCapturada[] = [],
): Recorrido {
  const parada = paradaActual(r);
  if (parada === null || !r.llegada) return r;
  if (requisitosPendientes(parada, evidencias).length > 0) return r;

  const encuadreExigido = exigeEncuadre(parada, opciones.bultosMaxSinReceptor);
  if (encuadreExigido && !opciones.encuadreCapturado) return r;

  return cerrarParada(r, {
    paradaId: parada.id,
    clientUuid: sello.clientUuid,
    tsDispositivo: sello.tsDispositivo,
    tzOffsetMin: sello.tzOffsetMin,
    secuenciaDispositivo: sello.secuenciaDispositivo,
    resultado: "exito",
    metodoEntrega: "dejado_en_punto",
    motivoId: null,
    items: null,
    evidencias,
  });
}

/** Si esta parada exige el encuadre fotográfico para poder dejarla en punto (§4.4, §5.2 F4). La
 *  pantalla la usa para decidir si ofrece el paso de encuadre ANTES de mostrar «Confirmar». */
export function exigeEncuadre(parada: ParadaDeRuta, bultosMaxSinReceptor: number | null): boolean {
  return bultosMaxSinReceptor !== null && parada.bultos > bultosMaxSinReceptor;
}

/**
 * El undo dentro de la ventana: la captura se cancela ANTES del replay y jamás sale del
 * dispositivo (§4.7). Devuelve al chofer a la parada que deshizo, y con «Llegué» ya dado: es
 * donde estaba parado cuando se equivocó de botón, no dos pasos atrás.
 */
export function deshacer(r: Recorrido): Recorrido {
  if (r.captura === null) return r;
  const vuelveA = r.paradas.findIndex((p) => p.id === r.captura?.paradaId);
  return { ...r, captura: null, indice: vuelveA === -1 ? r.indice : vuelveA, llegada: vuelveA !== -1 };
}

/** Vencida la ventana, la captura es un hecho: pasa a la cola que el motor de sync replayea. */
export function cerrarLaVentana(r: Recorrido): Recorrido {
  if (r.captura === null) return r;
  return { ...r, captura: null, cola: [...r.cola, { ...r.captura, estado: "por_replicar" }] };
}

/**
 * El replay confirmó estas capturas: salen de la cola [AC-FPOD-03].
 *
 * Sacarlas por `clientUuid` y no vaciar la cola entera es lo que hace que el vaciado sea un
 * HECHO y no un borrado: solo se va lo que el servidor acusó por su llave de idempotencia (§0).
 * Una respuesta parcial —tres de cinco, porque la señal se cortó a mitad del lote— deja las dos
 * que faltan esperando el próximo intento, en vez de perderlas creyendo que llegaron.
 *
 * Lo que está DENTRO de la ventana de undo no se toca: todavía no salió del dispositivo (§4.7).
 */
export function sacarDeLaCola(r: Recorrido, confirmadas: readonly string[]): Recorrido {
  if (confirmadas.length === 0) return r;
  const acusadas = new Set(confirmadas);
  return { ...r, cola: r.cola.filter((c) => !acusadas.has(c.clientUuid)) };
}

/** La ruta terminó: no quedan paradas por delante. */
export function terminado(r: Recorrido): boolean {
  return paradaActual(r) === null;
}
