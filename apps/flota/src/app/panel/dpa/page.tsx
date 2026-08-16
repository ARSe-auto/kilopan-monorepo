"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EstadoError,
  EstadoCargando,
  ChipEstadoConexion,
  BotonPrimario,
  useEscaladaDeCarga,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, semantico as colorSemantico, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import type { SeccionDpa } from "@kilopan/miga/dpa.ts";
import { pedir } from "../../../cliente/aparato.ts";
import { useEstadoDeCola } from "../../../cliente/cola.ts";

// El DPA en términos del tenant [AC-FMIG-22] — §3.E1.15, §7.8, §5.1, §5.5.
//
// SIN CSS LIBRE NI BUILD POR CLIENTE (§5.1): la pantalla se arma con los MISMOS tokens y
// componentes de Miga que `/panel/funciones` y `/panel/terminologia` — nada de estilos propios
// del tenant, nada que dependa de un build distinto por cuenta.
//
// ALCANZABLE ≤2 NIVELES (§5.1): `/panel/dpa` es la misma profundidad que sus dos hermanas —
// `dpa.test.ts` en `packages/miga` lo aserta sobre `DPA_RUTA` sin necesidad de un navegador.
//
// LA ACEPTACIÓN ES DE `admin_tenant` Y NADA MÁS (§5.4): esta pantalla ya vive detrás de
// `guardia()` en `/api/gobierno/dpa` — un rol distinto ve 403 al pedir el GET, así que ni
// siquiera llega a ver el botón «Aceptar».
export default function PanelDpa() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState(false);
  const [aceptando, setAceptando] = useState(false);
  const [rebote, setRebote] = useState<string | null>(null);
  const demorado = useEscaladaDeCarga(!error && !estado);
  const cola = useEstadoDeCola();

  const cargar = useCallback(async () => {
    setError(false);
    const respuesta = await pedir("/api/gobierno/dpa").catch(() => null);
    if (!respuesta?.ok) return setError(true);
    setEstado((await respuesta.json()) as Estado);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function aceptar() {
    setAceptando(true);
    setRebote(null);
    const respuesta = await pedir("/api/gobierno/dpa", { method: "POST" }).catch(() => null);
    setAceptando(false);
    if (!respuesta?.ok) {
      setRebote("No se pudo registrar la aceptación. Revisá tu conexión.");
      return;
    }
    await cargar();
  }

  return (
    <main data-testid="panel-dpa">
      <h1 style={titulo}>Acuerdo de tratamiento de datos</h1>
      <div data-testid="conexion-dpa" style={{ marginTop: semantico.espacio.entreControles }}>
        <ChipEstadoConexion pendientes={cola.pendientes} online={cola.online} />
      </div>
      {error && (
        <EstadoError mensaje="No se pudo leer el documento. Revisá tu conexión." alReintentar={() => void cargar()} />
      )}
      {!error && !estado && <EstadoCargando avisoDemora={demorado ? "Sigue cargando…" : undefined} />}
      {estado && (
        <>
          <p data-testid="version-dpa" style={pie}>
            Versión {estado.version}
          </p>
          <ul data-testid="secciones-dpa" style={lista}>
            {estado.secciones.map((s: SeccionDpa) => (
              <li key={s.id} data-testid={`seccion-dpa-${s.id}`} style={tarjeta}>
                <h2 style={subtitulo}>{s.titulo}</h2>
                <p style={cuerpoTexto}>{s.cuerpo}</p>
              </li>
            ))}
          </ul>
          {estado.aceptado ? (
            <p data-testid="dpa-aceptado" style={textoAceptado}>
              Aceptado el {new Date(estado.aceptadoEn!).toLocaleDateString("es-CL")}.
            </p>
          ) : (
            <BotonPrimario testid="aceptar-dpa" disabled={aceptando} onClick={() => void aceptar()}>
              {aceptando ? "Registrando…" : "Aceptar"}
            </BotonPrimario>
          )}
          {rebote && (
            <p data-testid="rebote-dpa" role="alert" style={textoRebote}>
              {rebote}
            </p>
          )}
        </>
      )}
    </main>
  );
}

type Estado = {
  version: string;
  secciones: SeccionDpa[];
  aceptado: boolean;
  versionAceptada: string | null;
  aceptadoEn: string | null;
};

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = { fontSize: tipografia.titulo.tamano, fontWeight: tipografia.titulo.peso, margin: 0 };
const cuerpoTexto = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto, margin: 0 };
const pie = { fontSize: tipografia.pie.tamano, color: superficie.textoDim, marginTop: semantico.espacio.entreControles };
const lista = {
  listStyle: "none",
  padding: 0,
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const tarjeta = {
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
  display: "grid",
  gap: semantico.espacio.entreControles,
};
const textoAceptado = {
  ...cuerpoTexto,
  marginTop: semantico.espacio.entreTarjetas,
  color: colorSemantico.ok,
  fontWeight: enfasis.medio,
};
const textoRebote = {
  ...cuerpoTexto,
  marginTop: semantico.espacio.entreControles,
  color: colorSemantico.error,
  fontWeight: enfasis.medio,
};
