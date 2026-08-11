"use client";

import { useEffect, useRef, useState } from "react";
import {
  BotonPrimario,
  CifraGrande,
  SelectorUnToque,
  TecladoNumerico,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { UNDO } from "../../../../../packages/nucleo-comun/src/constants.ts";
import { pedir } from "../../cliente/aparato.ts";
import { replayar } from "../../cliente/outbox.ts";
import { textoDelCandado, type CandadoDeEntrega } from "../../dominio/candado-entrega.ts";
import {
  sacarDeLaCola,
  iniciarRecorrido,
  paradaActual,
  llegar,
  entregar,
  entregarParcial,
  noEntregar,
  dejarEnPunto,
  exigeEncuadre,
  requisitosPendientes,
  cerrarLaVentana,
  terminado,
  type EvidenciaCapturada,
  type ParadaDeRuta,
  type Recorrido,
  type TipoDeEvidencia,
} from "../../dominio/pod-terreno.ts";
import { colaAlArrancar, deshacerCaptura, outboxDeRecorrido } from "../../dominio/outbox-undo.ts";
import { guardarOutbox, leerOutbox, type Identidad } from "../../cliente/outbox-local.ts";
import { identidadDelAparato } from "../../cliente/identidad.ts";
import { vaciarOutboxAjeno } from "../../cliente/outbox-multiusuario.ts";
import { siguienteSecuenciaDispositivo } from "../../cliente/secuencia-dispositivo.ts";
import { capturarFoto } from "../../cliente/camara.ts";
import { capturarGps } from "../../cliente/gps.ts";

// La tarjeta de la parada de entrega (F4) [AC-FRUT-22, AC-FPOD-01] — KR-29, §4.2, §5.2 F4,
// §5.3, §4.7, §7.6.
//
// ─── EL CANDADO ES EN EL CLIENTE, CONTRA EL SNAPSHOT ──────────────────────────────
//
// El §4.2 lo fija así: la validación bloqueante corre acá, no en el servidor (que jamás
// rechaza una captura — §4.6, §9.3.4). Mientras el sub-manifiesto por empresa de la parada de
// carga que abastece esta entrega no esté confirmado, «Llegué» sencillamente NO se ofrece: no
// hay botón gris, no hay candado mudo, no hay modal (§7.6) — hay texto que dice qué falta y
// cuál es la vía, las dos que existen: confirmar en el andén, o bajar el ítem del manifiesto
// (AC-FRUT-08).
//
// ─── EL TEXTO SALE DE LA MISMA FUENTE QUE EL SERVIDOR ─────────────────────────────
//
// `textoDelCandado` es la función pura de `dominio/candado-entrega.ts`: el servidor la usa (vía
// `candadoDeLaEntrega`) para decidir QUÉ manda, y este componente la usa para decidir QUÉ dice.
// Escribir la frase acá, aparte, sería una segunda copia que se desalinea el día que alguien
// ajuste una — el mismo motivo por el que `dominio/custodia.ts` es una función y no un texto
// repetido en cada pantalla.
//
// ─── DOS TOQUES, Y NINGUNO DE ELLOS ES UNA CONFIRMACIÓN ──────────────────────────
//
// «Llegué» (1) → «Entregado» (1) y la tarjeta que queda a la vista ya es la de la parada
// siguiente (§5.2 F4, §5.3). El bucle vive en `dominio/pod-terreno.ts` y no acá: el presupuesto
// de toques es un contrato que se defiende con una máquina probada, no con la forma de un JSX.
//
// La única confirmación es la banda de deshacer que se abre por `UNDO.ventana_ms` (§4.7): cero
// modales (§7.6). No cuesta una acción porque no hay que tocarla para seguir — el chofer ya
// está caminando a la parada siguiente mientras corre.
/** Un motivo del catálogo del tenant (§4.5, AC-FRUT-13): el mismo sirve para «no entregado»
 *  (`paradas.motivo_id`) y para `motivo_item` de la variante parcial (§4.5) — no hay un
 *  catálogo separado por variante. */
export type MotivoDisponible = { id: string; etiqueta: string };

/** Los modos de la tarjeta en la parada actual [AC-FPOD-02]. `elegir` es el camino feliz
 *  —«Entregado» a un toque— con el stepper de la parcial a la vista y las otras dos variantes
 *  cerradas como salida secundaria. La parcial NO tiene modo propio: su stepper vive sobre la
 *  entrega abierta, y ese toque que no se cobra es lo que la deja en 3 acciones y, con un
 *  requisito de evidencia encima, en las 4 que el §5.2 F4 fija como techo del operario. */
type ModoDeCierre = "elegir" | "no_entregado" | "dejado_en_punto";

/** El texto es-CL de cada tipo del enum de evidencia (§4.6), resuelto por el TIPO que la parada
 *  trae en sus datos. Es un `Record` completo a propósito: agregar un valor al enum sin darle
 *  etiqueta no compila, en vez de dejarle al chofer un requisito sin nombre. Cero condicionales
 *  por vertical — acá no se nombra ni un solo vertical (§4.6). */
const ETIQUETA_DE_EVIDENCIA: Record<TipoDeEvidencia, string> = {
  firma: "Firmar la recepción",
  foto: "Sacar la foto",
  lectura: "Registrar la lectura",
  indicador_visual: "Mirar el indicador",
  archivo_logger: "Adjuntar el registro",
  documento: "Adjuntar el documento",
  pin_destinatario: "Pedir el PIN al destinatario",
  escaneo_codigo: "Escanear el código",
};

export default function TarjetaDeEntrega({
  secuencia,
  candados,
  indice,
  motivos,
  bultosMaxSinReceptor,
}: {
  secuencia: ParadaDeRuta[];
  /** El candado de cada parada, CONGELADO en la primera carga [AC-FPOD-03]: la validación
   *  bloqueante corre en el cliente contra el snapshot (§4.2), no contra un viaje por parada que
   *  en el subterráneo no vuelve. */
  candados: Record<string, CandadoDeEntrega>;
  indice: number;
  motivos: MotivoDisponible[];
  bultosMaxSinReceptor: number | null;
}) {
  const [recorrido, setRecorrido] = useState<Recorrido>(() =>
    iniciarRecorrido(secuencia, Math.max(indice, 0)),
  );
  const [modo, setModo] = useState<ModoDeCierre>("elegir");
  // Parcial: cantidad tecleada (texto crudo del teclado propio) y motivo por ítem ajustado
  // (§4.5: `motivo_item` es por ítem, no por parada).
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivoPorItem, setMotivoPorItem] = useState<Record<string, string>>({});
  // No entregado: un solo motivo, de `paradas.motivo_id`.
  const [motivoNoEntrega, setMotivoNoEntrega] = useState<string | null>(null);
  // Dejado en punto: si el encuadre ya se capturó (AC-FPOD-17 decide CÓMO se llena este booleano
  // — cámara concedida, denegada y su degradación —; acá solo se lee).
  const [encuadreCapturado, setEncuadreCapturado] = useState(false);
  // Los `stop_requirement` de esta parada que ya se cumplieron (§4.6).
  const [evidencias, setEvidencias] = useState<EvidenciaCapturada[]>([]);
  // GPS denegado [AC-FPOD-12] (§7.6): el aviso visible al operario, y el candado que evita
  // volver a pedirle el permiso al navegador una vez que ya sabemos que lo negó — el mismo
  // motivo por el que la ventana de undo no reintenta un guardado que ya sabe que va a fallar.
  const [gpsDenegado, setGpsDenegado] = useState(false);
  const gpsPermisoDenegadoRef = useRef(false);

  function volverAElegir() {
    setModo("elegir");
    setCantidades({});
    setMotivoPorItem({});
    setMotivoNoEntrega(null);
    setEncuadreCapturado(false);
  }

  const parada = paradaActual(recorrido);
  const paradaId = parada?.id ?? null;
  const enVentana = recorrido.captura?.clientUuid ?? null;
  const enCola = recorrido.cola.length;

  useEffect(() => {
    // Nueva parada: el modo y lo tecleado de la anterior no le sirven a esta. Sin esto, un
    // «Parcial» a medio llenar sobreviviría al avance automático y quedaría flotando sobre una
    // parada que no es la que lo originó. Los setters de React son estables entre renders, así
    // que inlinearlos acá no le agrega dependencias al efecto (a diferencia de llamar a una
    // función declarada en el cuerpo del componente).
    setModo("elegir");
    setCantidades({});
    setMotivoPorItem({});
    setMotivoNoEntrega(null);
    setEncuadreCapturado(false);
    setEvidencias([]);
    setGpsDenegado(false);
  }, [paradaId]);

  // ─── LA LECTURA PUNTUAL DE GPS AL LLEGAR [AC-FPOD-12] (§7.6, §3.E1.15) ────────────
  //
  // Una sola lectura por parada, disparada por el mismo toque de «Llegué» — nunca seguimiento
  // continuo (la minimización del §3.E1.15 es sobre ESO, no sobre una lectura suelta). Si el
  // operario ya negó el permiso una vez, no se lo vuelve a pedir (el navegador lo negaría
  // igual) y el aviso se repone directo desde el candado.
  useEffect(() => {
    if (!recorrido.llegada || parada === null) return;
    if (gpsPermisoDenegadoRef.current) {
      setGpsDenegado(true);
      return;
    }
    let vivo = true;
    void capturarGps().then((resultado) => {
      if (!vivo) return;
      if (resultado.motivo === "permiso_denegado") gpsPermisoDenegadoRef.current = true;
      setGpsDenegado(resultado.avisar);
    });
    return () => {
      vivo = false;
    };
  }, [paradaId, recorrido.llegada]);

  // ─── EL REPLAY, SIN QUE EL CHOFER TOQUE NADA [AC-FPOD-03] ────────────────────────
  //
  // Dos disparos, que son los que el §4.7 llama camino PRINCIPAL: al montar la pantalla
  // (replay-on-startup) y cuando el navegador avisa que volvió la señal (replay-on-online). Nada
  // de Background Sync: Safari no la tiene y el §7.6 prohíbe depender de ella.
  //
  // El tercer disparo es que la cola CREZCA: una captura cuya ventana de undo venció con señal
  // no tiene por qué esperar a que la red se caiga y vuelva para salir.
  const replayando = useRef(false);
  useEffect(() => {
    let vivo = true;
    async function vaciar() {
      // Un solo lote a la vez: el `online` del navegador llega repetido y dos replays en vuelo
      // mandarían la misma captura dos veces. La llave de idempotencia del §0 lo aguanta, pero
      // gastar dos viajes de radio en el mismo hecho es lo que no aguanta la batería del turno.
      if (replayando.current || recorrido.cola.length === 0) return;
      replayando.current = true;
      try {
        const confirmadas = await replayar(recorrido.cola, (cuerpo) =>
          pedir("/api/sync/capturas", { method: "POST", body: cuerpo }),
        );
        // Cero rechazo a la vista (§5.7): un lote que no llegó devuelve cero acuses, la cola
        // queda igual y el chofer sigue viendo su contador. No hay error que mostrarle porque no
        // hay nada que él pueda decidir.
        if (vivo && confirmadas.length > 0) setRecorrido((r) => sacarDeLaCola(r, confirmadas));
      } finally {
        replayando.current = false;
      }
    }
    void vaciar();
    window.addEventListener("online", vaciar);
    return () => {
      vivo = false;
      window.removeEventListener("online", vaciar);
    };
    // `recorrido.cola` entera y no solo su largo: sacar dos y capturar una deja el largo igual y
    // la cola distinta, y ese lote nuevo también tiene que salir.
  }, [recorrido.cola]);

  // La ventana de undo: ocho segundos en los que el toque todavía no es un hecho. Vencida, la
  // captura pasa a la cola que el motor de sync replayea (AC-FPOD-03/04). El plazo sale de
  // `UNDO.ventana_ms` y no de un número escrito acá: la familia canónica del §0 es la fuente.
  useEffect(() => {
    if (enVentana === null) return undefined;
    const temporizador = window.setTimeout(() => setRecorrido(cerrarLaVentana), UNDO.ventana_ms);
    return () => window.clearTimeout(temporizador);
  }, [enVentana]);

  // ─── EL OUTBOX DURABLE [AC-FPOD-08] (§4.7) ───────────────────────────────────────
  //
  // Al montar —y solo en el navegador: el almacén no existe en el render del servidor— vuelve lo
  // que la sesión anterior dejó escrito. Una app que murió a los tres segundos del toque
  // —batería, el sistema que la cierra— reabre con esa captura en la cola, y el efecto de replay
  // de arriba la manda sin que el chofer toque nada. Lo que quedó en `pending_undo` pasa a
  // `por_replicar`: la ventana era del gesto, no del archivo.
  //
  // En un efecto y no en el inicializador de `useState` porque este componente se renderiza
  // también en el servidor: leer el disco ahí es un `window` que no existe, y sembrarlo solo en
  // el cliente desalinearía la hidratación de la sección «por sincronizar».
  //
  // ─── LA IDENTIDAD SE RESUELVE ANTES DE TOCAR EL DISCO [AC-FPOD-09] ────────────────
  //
  // El outbox vive particionado por (tenant, usuario) —§4.7—: leer o escribir sin saber de QUIÉN
  // es la partición volvería a la llave única que este AC elimina. `identidadDelAparato()` no
  // pega a la red (deriva del secreto que ya está en IndexedDB), así que resuelve offline igual
  // que el resto de este efecto.
  const [identidad, setIdentidad] = useState<Identidad | null>(null);
  useEffect(() => {
    let vivo = true;
    void identidadDelAparato().then((resuelta) => {
      if (vivo) setIdentidad(resuelta);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const [outboxCargado, setOutboxCargado] = useState(false);
  useEffect(() => {
    if (identidad === null) return;
    const guardado = colaAlArrancar(leerOutbox(window.localStorage, identidad));
    setRecorrido((r) => (guardado.length === 0 ? r : { ...r, cola: [...guardado, ...r.cola] }));
    setOutboxCargado(true);
  }, [identidad]);

  // Y se escribe INMEDIATAMENTE, no al vencer la ventana (§4.7). Este efecto corre en el commit
  // del mismo toque que cerró la parada, así que la captura queda en el aparato con su
  // `pending_undo` antes de que el chofer levante el dedo. Diferirlo hasta los 8 s es exactamente
  // el hueco por el que se pierde la entrega cuando el teléfono se apaga a los 3.
  //
  // Salvo antes de que el disco se haya leído: guardar la cola vacía del primer render borraría
  // justo lo que el efecto de arriba está por recuperar. Escribe bajo la llave de LA identidad
  // resuelta — jamás la de otra que haya usado antes este mismo aparato (§4.7) [AC-FPOD-09].
  useEffect(() => {
    if (!outboxCargado || identidad === null) return;
    guardarOutbox(window.localStorage, identidad, outboxDeRecorrido(recorrido));
  }, [outboxCargado, identidad, recorrido.captura, recorrido.cola]);

  // ─── LO QUE OTRA IDENTIDAD DEJÓ ESPERANDO EN ESTE MISMO APARATO [AC-FPOD-09] ──────
  //
  // Si A capturó offline y después B se autenticó en este teléfono, el outbox de A sigue en el
  // disco bajo SU partición (`outbox-local.ts` ya lo protege de que B lo pise) — pero nadie más
  // que este efecto lo va a mandar, porque la cola visible de la pantalla es la de B. Corre en
  // los mismos dos disparos que el replay de arriba (al montar y al volver la señal) y en
  // silencio: el operario actual jamás se entera de que el aparato también vació una cola ajena.
  useEffect(() => {
    if (identidad === null) return;
    // Ninguna de las dos llamadas toca `setState`: no hay nada que desmontar en carrera, a
    // diferencia del replay de la cola visible de arriba.
    function vaciarAjeno() {
      void vaciarOutboxAjeno(window.localStorage, identidad, (cuerpo) =>
        pedir("/api/sync/capturas", { method: "POST", body: cuerpo }),
      );
    }
    vaciarAjeno();
    window.addEventListener("online", vaciarAjeno);
    return () => window.removeEventListener("online", vaciarAjeno);
  }, [identidad]);

  /**
   * El toque de «Deshacer», con la rama que corresponde al estado REAL de la captura
   * [AC-FPOD-08] (§4.7): dentro de la ventana se cancela y no sale del aparato; si el
   * temporizador ganó la carrera y ya está en la cola, la corrección es un supersede con
   * motivo `undo` —dos filas, la original intacta (§7.4)— que el métrico de gaming del §10
   * excluye por definición SQL. Sin esta segunda rama, el toque a los 7,9 s se perdía en
   * silencio y la entrega salía igual.
   */
  function deshacerToque() {
    setRecorrido((r) => deshacerCaptura(r, selloDelAparato()).recorrido);
  }

  function selloDelAparato() {
    return {
      clientUuid: crypto.randomUUID(),
      tsDispositivo: new Date().toISOString(),
      tzOffsetMin: -new Date().getTimezoneOffset(),
      // La secuencia monotónica del dispositivo [AC-FPOD-10] — §4.7. Se reserva en el mismo
      // gesto que el resto del sello: dos toques seguidos jamás comparten número.
      secuenciaDispositivo: siguienteSecuenciaDispositivo(window.localStorage),
    };
  }

  function entregado() {
    setRecorrido((r) => entregar(r, selloDelAparato(), evidencias));
  }

  // La evidencia que ESTA parada exige [AC-FPOD-02]: pendientes primero, y hasta que no quede
  // ninguna las salidas de entrega efectuada no se ofrecen. El flujo se arma por DATOS: lo que
  // decide qué se pide es la fila de `stop_requirement`, jamás el vertical del tenant (§4.6).
  const pendientes = parada === null ? [] : requisitosPendientes(parada, evidencias);

  // Cámara denegada ⇒ el requisito `foto` se cumple igual, sin foto y con flag — jamás
  // bloquea el cierre de la parada [AC-FPOD-12] (§7.6, §3.E1.7). `capturarFoto` nunca lanza:
  // resuelve el permiso, no el binario (eso es AC-FPOD-19).
  async function capturarEvidencia(requisitoId: string, tipo: TipoDeEvidencia) {
    if (tipo === "foto") await capturarFoto();
    setEvidencias((previas) => [...previas, { requisitoId, tipo }]);
  }

  // Variante parcial [AC-FPOD-02]: acción final del stepper — cierra la parada Y avanza, igual
  // que «Entregado» del camino feliz. Solo entran los ítems con cantidad tecleada Y motivo; los
  // que el chofer no tocó se entregaron completos.
  function confirmarParcial() {
    if (parada === null) return;
    const ajustes = parada.items
      .filter(
        (it) =>
          cantidades[it.id] !== undefined &&
          cantidades[it.id] !== "" &&
          motivoPorItem[it.id] !== undefined,
      )
      .map((it) => {
        const entregada = Number(cantidades[it.id]!.replace(",", "."));
        return {
          itemId: it.id,
          qtyEntregada: entregada,
          qtyRechazada: it.qtyPlanificada - entregada,
          motivoId: motivoPorItem[it.id]!,
        };
      });
    setRecorrido((r) => entregarParcial(r, ajustes, selloDelAparato(), evidencias));
    volverAElegir();
  }

  // Variante no entregado [AC-FPOD-02]: motivo + confirmar, 3 acciones exactas.
  function confirmarNoEntregado() {
    if (motivoNoEntrega === null) return;
    setRecorrido((r) => noEntregar(r, motivoNoEntrega, selloDelAparato()));
    volverAElegir();
  }

  // Variante dejado en punto [AC-FPOD-02]: entrega EFECTUADA sin receptor (§4.5). El dominio
  // rechaza el cierre si falta el encuadre exigido —acá solo se ofrece o no el paso, el candado
  // real vive en `dejarEnPunto`/`exigeEncuadre`.
  function confirmarDejadoEnPunto() {
    setRecorrido((r) =>
      dejarEnPunto(r, selloDelAparato(), { encuadreCapturado, bultosMaxSinReceptor }, evidencias),
    );
    volverAElegir();
  }

  // El candado sale del snapshot que vino con la pantalla, no de un viaje por parada: sin señal
  // el viaje no vuelve y la tarjeta que el chofer necesita no aparece (§4.2, §3.E1.7).
  const candado = paradaId === null ? null : (candados[paradaId] ?? null);

  return (
    <main data-testid="tarjeta-de-entrega">
      <h1 style={titulo}>Parada de entrega</h1>

      {/* Cero modales (§7.6): la banda no tapa la pantalla ni pide un toque para seguir. */}
      {recorrido.captura !== null && (
        <section data-testid="banda-undo" style={banda}>
          <p style={{ ...cuerpo, margin: 0 }}>Entregado. Se guarda en unos segundos.</p>
          <BotonPrimario testid="deshacer" variante="neutro" onClick={deshacerToque}>
            Deshacer
          </BotonPrimario>
        </section>
      )}

      {terminado(recorrido) && (
        <section data-testid="ruta-terminada" style={bloque}>
          <p style={cuerpo}>
            Terminaste las entregas de esta ruta. Capturadas: {recorrido.cola.length}.
          </p>
        </section>
      )}

      {parada !== null && (
        <section data-testid="parada-actual" style={bloque}>
          {/* Qué + dónde + ventana + «7 de 23» en la cifra operativa del §0 (§5.2 F4). */}
          <div data-testid="contador-paradas">
            <CifraGrande valor={String(recorrido.indice + 1)} unidad={`de ${recorrido.paradas.length}`} />
          </div>
          <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>{parada.destino}</p>
          <p style={pieDim}>
            {parada.bultos} bultos{parada.ventana === null ? "" : ` · ${parada.ventana}`}
          </p>
        </section>
      )}

      {/* La cola de salida, con el contador REAL [AC-FPOD-03] (§5.2 F4, §5.7): lo que se muestra
          es `cola.length`, el largo del arreglo que el replay tiene que vaciar — jamás un cartel
          fijo de «sincronizando». Cero rechazo a la vista: mientras no haya señal esto es todo
          lo que el chofer ve de su entrega, y dice que ESTÁ ENTREGADA. */}
      {enCola > 0 && (
        <section data-testid="por-sincronizar" style={banda}>
          <p style={{ ...cuerpo, margin: 0 }}>Entregada — por sincronizar</p>
          <p style={{ ...pieDim, margin: 0 }}>
            <span data-testid="contador-cola" style={{ fontVariantNumeric: "tabular-nums" }}>
              {enCola}
            </span>{" "}
            {enCola === 1 ? "entrega esperando señal" : "entregas esperando señal"}
          </p>
        </section>
      )}

      {/* GPS denegado [AC-FPOD-12] (§7.6): aviso visible, cero modal — lo bloqueado es SOLO la
          coordenada, jamás el cierre de la parada ni su sync. */}
      {gpsDenegado && (
        <section data-testid="aviso-gps-denegado" style={banda}>
          <p style={{ ...cuerpo, margin: 0 }}>
            Sin ubicación — permiso de GPS denegado. La entrega se sigue guardando igual.
          </p>
        </section>
      )}

      {candado !== null && !candado.abierta && (
        <section data-testid="candado-cerrado" style={bloque}>
          {/* Texto, jamás modal (§7.6): dice qué falta y cuál es la vía. */}
          <p style={cuerpo}>{textoDelCandado(candado)}</p>
        </section>
      )}

      {candado !== null && candado.abierta && !recorrido.llegada && (
        <section data-testid="candado-abierto" style={bloque}>
          <p style={cuerpo}>El manifiesto de la carga está confirmado. Podés empezar la entrega.</p>
          <BotonPrimario testid="llegue" onClick={() => setRecorrido(llegar)}>
            Llegué
          </BotonPrimario>
        </section>
      )}

      {candado !== null && candado.abierta && recorrido.llegada && modo === "elegir" && parada !== null && (
        <section data-testid="entrega-en-curso" style={bloque}>
          {/* La evidencia que esta parada exige, ANTES de poder darla por entregada
              [AC-FPOD-02]. Sin filas en `stop_requirement` —lo normal en E1— esta sección no
              existe y el camino feliz sigue costando sus dos toques (AC-FPOD-01). */}
          {pendientes.length > 0 ? (
            <div data-testid="evidencia-exigida" style={bloque}>
              <p style={cuerpo}>Esta parada pide evidencia antes de cerrarla.</p>
              {pendientes.map((req) => (
                <BotonPrimario
                  key={req.id}
                  testid={`requisito-${req.id}`}
                  onClick={() => capturarEvidencia(req.id, req.tipo)}
                >
                  {ETIQUETA_DE_EVIDENCIA[req.tipo]}
                </BotonPrimario>
              ))}
            </div>
          ) : (
            <>
              <p style={cuerpo}>Entrega abierta.</p>
              <BotonPrimario testid="entregado" onClick={entregado}>
                Entregado
              </BotonPrimario>

              {/* Parcial [AC-FPOD-02]: stepper por ítem + motivo_item (§4.5), a la vista sobre
                  la entrega abierta y sin toque propio de apertura — con un solo ítem cuesta 3
                  acciones: la cantidad, el motivo, confirmar. */}
              <div data-testid="modo-parcial-panel" style={bloque}>
                {parada.items.map((it) => (
                  <div key={it.id} data-testid={`ajuste-item-${it.id}`} style={bloque}>
                    <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>
                      {it.empresa} — planificado {it.qtyPlanificada}
                    </p>
                    <div data-testid={`cantidad-item-${it.id}`}>
                      <TecladoNumerico
                        valor={cantidades[it.id] ?? ""}
                        onCambiar={(v) => setCantidades((prev) => ({ ...prev, [it.id]: v }))}
                      />
                    </div>
                    {cantidades[it.id] !== undefined && cantidades[it.id] !== "" && (
                      <div data-testid={`motivo-item-${it.id}`}>
                        <SelectorUnToque
                          opciones={motivos.map((m) => ({ valor: m.id, etiqueta: m.etiqueta }))}
                          valor={motivoPorItem[it.id] ?? null}
                          onCambiar={(motivoId) =>
                            setMotivoPorItem((prev) => ({ ...prev, [it.id]: motivoId }))
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
                {/* Basta UN ítem ajustado: los demás se entregaron completos, y cobrarle un
                    toque por cada uno sería subir el conteo por bultos que sí llegaron. */}
                {parada.items.some(
                  (it) =>
                    cantidades[it.id] !== undefined &&
                    cantidades[it.id] !== "" &&
                    motivoPorItem[it.id] !== undefined,
                ) && (
                  <BotonPrimario testid="confirmar-parcial" onClick={confirmarParcial}>
                    Confirmar entrega parcial
                  </BotonPrimario>
                )}
              </div>

              <BotonPrimario
                testid="modo-dejado-en-punto"
                variante="neutro"
                onClick={() => setModo("dejado_en_punto")}
              >
                Dejado en punto
              </BotonPrimario>
            </>
          )}

          {/* «No pude entregar» se ofrece SIEMPRE, con evidencia pendiente o sin ella: el
              requisito es evidencia DE LA ENTREGA y una parada fallida no tiene ninguna que
              dar — el local cerrado no firma (§4.2, §7.6). */}
          <BotonPrimario testid="modo-no-entregado" variante="neutro" onClick={() => setModo("no_entregado")}>
            No pude entregar
          </BotonPrimario>
        </section>
      )}

      {/* No entregado [AC-FPOD-02]: motivo de catálogo + confirmar, 3 acciones exactas. */}
      {candado !== null && candado.abierta && recorrido.llegada && modo === "no_entregado" && (
        <section data-testid="modo-no-entregado-panel" style={bloque}>
          <div data-testid="motivo-no-entrega">
            <SelectorUnToque
              opciones={motivos.map((m) => ({ valor: m.id, etiqueta: m.etiqueta }))}
              valor={motivoNoEntrega}
              onCambiar={setMotivoNoEntrega}
            />
          </div>
          <BotonPrimario testid="volver-a-elegir" variante="neutro" onClick={volverAElegir}>
            Volver
          </BotonPrimario>
          {motivoNoEntrega !== null && (
            <BotonPrimario testid="confirmar-no-entregado" onClick={confirmarNoEntregado}>
              Confirmar
            </BotonPrimario>
          )}
        </section>
      )}

      {/* Dejado en punto [AC-FPOD-02]: de primera clase (§4.5), 3 acciones cuando el encuadre
          se exige (§4.4), menos cuando no. */}
      {candado !== null && candado.abierta && recorrido.llegada && modo === "dejado_en_punto" && parada !== null && (
        <section data-testid="modo-dejado-en-punto-panel" style={bloque}>
          {exigeEncuadre(parada, bultosMaxSinReceptor) && !encuadreCapturado && (
            <BotonPrimario testid="encuadrar-dejado-en-punto" onClick={() => setEncuadreCapturado(true)}>
              Encuadrar bultos
            </BotonPrimario>
          )}
          <BotonPrimario testid="volver-a-elegir" variante="neutro" onClick={volverAElegir}>
            Volver
          </BotonPrimario>
          {(!exigeEncuadre(parada, bultosMaxSinReceptor) || encuadreCapturado) && (
            <BotonPrimario testid="confirmar-dejado-en-punto" onClick={confirmarDejadoEnPunto}>
              Confirmar
            </BotonPrimario>
          )}
        </section>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pieDim = { fontSize: tipografia.pie.tamano, color: superficie.textoDim, margin: 0 };
const bloque = { display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas };
const banda = {
  ...bloque,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
