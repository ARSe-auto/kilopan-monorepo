"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BotonPrimario,
  CifraGrande,
  EstadoCargando,
  EstadoError,
  EstadoVacio,
  SelectorUnToque,
  TecladoNumerico,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { UNDO } from "../../../../../packages/nucleo-comun/src/constants.ts";
import { pedir } from "../../cliente/aparato.ts";
import { textoDelCandado, type EmpresaDeLaEntrega } from "../../dominio/candado-entrega.ts";
import {
  iniciarRecorrido,
  paradaActual,
  llegar,
  entregar,
  entregarParcial,
  noEntregar,
  dejarEnPunto,
  exigeEncuadre,
  deshacer,
  cerrarLaVentana,
  terminado,
  type ParadaDeRuta,
  type Recorrido,
} from "../../dominio/pod-terreno.ts";

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
/** Lo que devuelve el endpoint, en la forma en que VIAJA: snake_case, como la BD.
 *
 *  No es `EmpresaDeLaEntrega[]`: ese es el tipo del DOMINIO, en camelCase. Declararlo aquí
 *  hacía que TypeScript diera por buena una traducción que no existía, y el `.map` de abajo
 *  —que sí traduce— quedaba leyendo una propiedad que el tipo juraba tener. La frontera entre
 *  el JSON y el dominio es exactamente este par de tipos: si los unificamos, el día que la
 *  columna cambie de nombre nadie se entera hasta que la pantalla muestre vacío. */
export type EmpresaEnRespuesta = { id: string; razon_social: string };
export type RespuestaCandado = { abierta: boolean; empresas_faltantes: EmpresaEnRespuesta[] };

/** Un motivo del catálogo del tenant (§4.5, AC-FRUT-13): el mismo sirve para «no entregado»
 *  (`paradas.motivo_id`) y para `motivo_item` de la variante parcial (§4.5) — no hay un
 *  catálogo separado por variante. */
export type MotivoDisponible = { id: string; etiqueta: string };

/** Los cuatro modos de la tarjeta en la parada actual [AC-FPOD-02]. `elegir` es el camino
 *  feliz —«Entregado» a un toque— con las tres variantes cerradas como salida secundaria. */
type ModoDeCierre = "elegir" | "parcial" | "no_entregado" | "dejado_en_punto";

export default function TarjetaDeEntrega({
  secuencia,
  indice,
  motivos,
  bultosMaxSinReceptor,
}: {
  secuencia: ParadaDeRuta[];
  indice: number;
  motivos: MotivoDisponible[];
  bultosMaxSinReceptor: number | null;
}) {
  const [recorrido, setRecorrido] = useState<Recorrido>(() =>
    iniciarRecorrido(secuencia, Math.max(indice, 0)),
  );
  const [datos, setDatos] = useState<RespuestaCandado | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  // Estado online/offline para mostrar "sin conexión con contador real de cola" [AC-FPOD-22]
  const [online, setOnline] = useState(typeof navigator !== "undefined" && navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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

  const cargar = useCallback(async () => {
    setError(null);
    setDatos(null);
    // Terminada la ruta no hay candado que leer, y el de la parada anterior tiene que irse: un
    // «Llegué» sobreviviente sobre una parada que ya no está sería un toque sin destino.
    if (paradaId === null) return undefined;
    const respuesta = await pedir(`/api/paradas/${paradaId}/entrega`).catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo leer el candado de esta parada. Revisá tu conexión.");
    setDatos((await respuesta.json()) as RespuestaCandado);
    return undefined;
  }, [paradaId]);

  useEffect(() => {
    void cargar();
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
  }, [cargar]);

  // La ventana de undo: ocho segundos en los que el toque todavía no es un hecho. Vencida, la
  // captura pasa a la cola que el motor de sync replayea (AC-FPOD-03/04). El plazo sale de
  // `UNDO.ventana_ms` y no de un número escrito acá: la familia canónica del §0 es la fuente.
  useEffect(() => {
    if (enVentana === null) return undefined;
    const temporizador = window.setTimeout(() => setRecorrido(cerrarLaVentana), UNDO.ventana_ms);
    return () => window.clearTimeout(temporizador);
  }, [enVentana]);

  function selloDelAparato() {
    return {
      clientUuid: crypto.randomUUID(),
      tsDispositivo: new Date().toISOString(),
      tzOffsetMin: -new Date().getTimezoneOffset(),
    };
  }

  function entregado() {
    setRecorrido((r) => entregar(r, selloDelAparato()));
  }

  // Variante parcial [AC-FPOD-02]: acción final del stepper — cierra la parada Y avanza, igual
  // que «Entregado» del camino feliz. Solo entran los ítems con cantidad tecleada Y motivo.
  function confirmarParcial() {
    if (parada === null) return;
    const ajustes = parada.items
      .filter((it) => cantidades[it.id] !== undefined && motivoPorItem[it.id] !== undefined)
      .map((it) => {
        const entregada = Number(cantidades[it.id]!.replace(",", "."));
        return {
          itemId: it.id,
          qtyEntregada: entregada,
          qtyRechazada: it.qtyPlanificada - entregada,
          motivoId: motivoPorItem[it.id]!,
        };
      });
    setRecorrido((r) => entregarParcial(r, ajustes, selloDelAparato()));
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
      dejarEnPunto(r, selloDelAparato(), { encuadreCapturado, bultosMaxSinReceptor }),
    );
    volverAElegir();
  }

  const candado =
    datos === null
      ? null
      : datos.abierta
        ? ({ abierta: true } as const)
        : ({
            abierta: false,
            empresasFaltantes: datos.empresas_faltantes.map(
              (e): EmpresaDeLaEntrega => ({ id: e.id, razonSocial: e.razon_social }),
            ),
          } as const);

  return (
    <main data-testid="tarjeta-de-entrega">
      <h1 style={titulo}>Parada de entrega</h1>

      {/* Cero modales (§7.6): la banda no tapa la pantalla ni pide un toque para seguir. */}
      {recorrido.captura !== null && (
        <section data-testid="banda-undo" style={banda}>
          <p style={{ ...cuerpo, margin: 0 }}>Entregado. Se guarda en unos segundos.</p>
          <BotonPrimario testid="deshacer" variante="neutro" onClick={() => setRecorrido(deshacer)}>
            Deshacer
          </BotonPrimario>
        </section>
      )}

      {!online && recorrido.cola.length > 0 && (
        <section data-testid="sin-conexion" style={banda}>
          <p style={{ ...cuerpo, margin: 0 }}>Sin conexión. Se sincronizará cuando tengas señal.</p>
          <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>Capturadas: {recorrido.cola.length}</p>
        </section>
      )}

      {!terminado(recorrido) && parada === null && (
        <section data-testid="ruta-vacia">
          <EstadoVacio mensaje="Esta ruta no tiene paradas de entrega. Revisá con tu supervisor." />
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

      {parada !== null && error !== null && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}
      {parada !== null && error === null && candado === null && <EstadoCargando filas={2} />}

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

      {candado !== null && candado.abierta && recorrido.llegada && modo === "elegir" && (
        <section data-testid="entrega-en-curso" style={bloque}>
          <p style={cuerpo}>Entrega abierta.</p>
          <BotonPrimario testid="entregado" onClick={entregado}>
            Entregado
          </BotonPrimario>
          {/* Las variantes cerradas del §5.2 F4 [AC-FPOD-02], jamás más de 4 acciones: cada
              botón abre su propio modo — el toque de abrirlo YA es la primera acción. */}
          <div style={{ display: "flex", gap: grilla.base, flexWrap: "wrap" }}>
            <BotonPrimario testid="modo-parcial" variante="neutro" onClick={() => setModo("parcial")}>
              Parcial
            </BotonPrimario>
            <BotonPrimario testid="modo-no-entregado" variante="neutro" onClick={() => setModo("no_entregado")}>
              No pude entregar
            </BotonPrimario>
            <BotonPrimario testid="modo-dejado-en-punto" variante="neutro" onClick={() => setModo("dejado_en_punto")}>
              Dejado en punto
            </BotonPrimario>
          </div>
        </section>
      )}

      {/* Parcial [AC-FPOD-02]: stepper por ítem + motivo_item (§4.5). Con un solo ítem, el
          techo del §5.3 es 4 acciones exactas — abrir, la cantidad, el motivo, confirmar. */}
      {candado !== null && candado.abierta && recorrido.llegada && modo === "parcial" && parada !== null && (
        <section data-testid="modo-parcial-panel" style={bloque}>
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
          <BotonPrimario testid="volver-a-elegir" variante="neutro" onClick={volverAElegir}>
            Volver
          </BotonPrimario>
          {parada.items.every(
            (it) =>
              cantidades[it.id] !== undefined &&
              cantidades[it.id] !== "" &&
              motivoPorItem[it.id] !== undefined,
          ) && (
            <BotonPrimario testid="confirmar-parcial" onClick={confirmarParcial}>
              Confirmar
            </BotonPrimario>
          )}
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
