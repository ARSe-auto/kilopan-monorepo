"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EstadoVacio,
  EstadoError,
  EstadoCargando,
  BotonPrimario,
  useEscaladaDeCarga,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, semantico as colorSemantico, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../../cliente/aparato.ts";

// Panel «Funciones» del panel admin [AC-FMIG-08] — §5.5, §5.4.
//
// LA REGLA QUE PINTA CADA FILA es la del §5.5, sin matices: OFF siempre se puede tocar;
// ON solo si la función viene incluida en el plan del tenant — si no, la fila queda en
// locked-state con upsell, y el botón de encender ni siquiera se ofrece (el 422 del
// servidor es el oráculo real; esto es solo que la pantalla no invite a chocar con él).
//
// EL LOCKED-STATE CON UPSELL VIVE SOLO ACÁ, jamás en la PWA de terreno (§5.5): esta
// pantalla es del panel admin, así que es el único lugar del producto donde "no está en tu
// plan" se dice con esas palabras.
export default function PanelFunciones() {
  const [funciones, setFunciones] = useState<Funcion[] | null>(null);
  const [error, setError] = useState(false);
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const [rebotePorFuncion, setRebotePorFuncion] = useState<Record<string, string>>({});
  // AC-FMIG-10 (§5.7): skeleton desde el primer render, y la escalada al aviso recién
  // pasados los 400 ms — nunca antes, para no parpadear en la carga normal.
  const demorado = useEscaladaDeCarga(!error && !funciones);

  const cargar = useCallback(async () => {
    setError(false);
    const respuesta = await pedir("/api/gobierno/funciones").catch(() => null);
    if (!respuesta?.ok) return setError(true);
    const { funciones: f } = (await respuesta.json()) as { funciones: Funcion[] };
    setFunciones(f);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function alternar(lookupKey: string, encender: boolean) {
    setMoviendo(lookupKey);
    setRebotePorFuncion((previo) => ({ ...previo, [lookupKey]: "" }));
    const respuesta = await pedir("/api/gobierno/funciones", {
      method: "PATCH",
      body: JSON.stringify({ lookup_key: lookupKey, enabled: encender }),
    }).catch(() => null);
    setMoviendo(null);
    if (!respuesta) {
      setRebotePorFuncion((previo) => ({
        ...previo,
        [lookupKey]: "No se pudo guardar. Revisá tu conexión.",
      }));
      return;
    }
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { mensaje?: string };
      setRebotePorFuncion((previo) => ({
        ...previo,
        [lookupKey]: cuerpo.mensaje ?? "No se pudo mover esa función.",
      }));
      return;
    }
    await cargar();
  }

  return (
    <main data-testid="panel-funciones">
      <h1 style={titulo}>Funciones</h1>
      {error && (
        <EstadoError mensaje="No se pudieron leer las funciones. Revisá tu conexión." alReintentar={() => void cargar()} />
      )}
      {!error && !funciones && <EstadoCargando avisoDemora={demorado ? "Sigue cargando…" : undefined} />}
      {funciones && funciones.length === 0 && (
        <EstadoVacio mensaje="Este tenant todavía no tiene funciones en su catálogo." />
      )}
      {funciones && funciones.length > 0 && (
        <ul data-testid="lista-funciones" style={lista}>
          {funciones.map((f) => {
            const bloqueada = !f.habilitada && !f.enPlan;
            return (
              <li key={f.lookupKey} data-testid={`fila-funcion-${f.lookupKey}`} style={fila}>
                <div style={filaCabecera}>
                  <span style={nombreFuncion}>{f.lookupKey}</span>
                  <span data-testid={`estado-${f.lookupKey}`} style={estadoTexto(f.habilitada, bloqueada)}>
                    {f.habilitada ? "Encendida" : bloqueada ? "Bloqueada (fuera de plan)" : "Apagada"}
                  </span>
                </div>
                {bloqueada && (
                  <p data-testid={`upsell-${f.lookupKey}`} style={textoUpsell}>
                    Esta función no está incluida en tu plan. Pedí que te la agreguen para encenderla.
                  </p>
                )}
                <div style={acciones}>
                  {f.habilitada ? (
                    <BotonPrimario
                      testid={`apagar-${f.lookupKey}`}
                      variante="neutro"
                      disabled={moviendo === f.lookupKey}
                      onClick={() => void alternar(f.lookupKey, false)}
                    >
                      {moviendo === f.lookupKey ? "Apagando…" : "Apagar"}
                    </BotonPrimario>
                  ) : (
                    <BotonPrimario
                      testid={`encender-${f.lookupKey}`}
                      variante="acento"
                      disabled={bloqueada || moviendo === f.lookupKey}
                      onClick={() => void alternar(f.lookupKey, true)}
                    >
                      {moviendo === f.lookupKey ? "Encendiendo…" : "Encender"}
                    </BotonPrimario>
                  )}
                </div>
                {rebotePorFuncion[f.lookupKey] && (
                  <p data-testid={`rebote-${f.lookupKey}`} role="alert" style={textoRebote}>
                    {rebotePorFuncion[f.lookupKey]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

type Funcion = {
  lookupKey: string;
  module: string;
  habilitada: boolean;
  enPlan: boolean;
  porOverride: boolean;
  motivo: string | null;
};

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const lista = {
  listStyle: "none",
  padding: 0,
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const fila = {
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
  display: "grid",
  gap: semantico.espacio.entreControles,
};
const filaCabecera = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: grilla.base };
const nombreFuncion = { ...cuerpo, fontWeight: enfasis.medio };
const acciones = { display: "grid", gap: semantico.espacio.entreControles, minHeight: componente.objetivoTactil.altoMinPx };
const textoRebote = { ...cuerpo, margin: 0, color: colorSemantico.error, fontWeight: enfasis.medio };
const textoUpsell = { ...cuerpo, margin: 0, color: superficie.texto };
const estadoTexto = (habilitada: boolean, bloqueada: boolean) => ({
  ...cuerpo,
  fontWeight: enfasis.medio,
  color: habilitada ? colorSemantico.ok : bloqueada ? colorSemantico.error : superficie.texto,
});
