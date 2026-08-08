"use client";
// AC-DES-07 (specs/kilopan/04-despacho-reparto.md): escáner de cámara full-screen para
// F3 Cargar van — MEJORA PROGRESIVA sobre la captura manual de AC-DES-06, que sigue
// siendo el camino primario en iOS (PROMPT_MAESTRO.md §7). El botón ni se muestra si el
// dispositivo no tiene getUserMedia, y cualquier fallo (permiso denegado, cámara
// inexistente) cierra el escáner y deja el teclado propio intacto debajo — nunca bloquea.
// Misma regla que EscanerTed y la foto del POD: la cámara se abre SOLO in-app por
// getUserMedia, jamás <input type=file> a galería.
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/library";
import { semantico, acentos } from "@kilopan/miga/tokens.ts";

// `torch` (linterna) es un constraint no estándar (sin soporte en lib.dom.d.ts) que
// Chrome/Android sí implementa vía MediaStreamTrack — se declara acá en vez de usar
// `any`/`@ts-ignore` (vedados por AGENTS.md).
interface RestriccionesTorch extends MediaTrackConstraintSet {
  torch?: boolean;
}
interface CapacidadesTorch extends MediaTrackCapabilities {
  torch?: boolean;
}

// Beep de escaneo exitoso sintetizado con Web Audio (sin asset de audio): 880 Hz, ~150 ms.
function pitarExito() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const ganancia = ctx.createGain();
    osc.frequency.value = 880;
    ganancia.gain.value = 0.2;
    osc.connect(ganancia);
    ganancia.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => void ctx.close();
  } catch {
    // Autoplay bloqueado u otro motivo: el beep es un extra, jamás bloquea el escaneo.
  }
}

export function EscanerBulto({ onLeido }: { onLeido: (codigo: string) => void }) {
  const [soportado, setSoportado] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linternaOn, setLinternaOn] = useState(false);
  const [linternaDisponible, setLinternaDisponible] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lectorRef = useRef<BrowserMultiFormatReader | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  // Detección en el cliente (no en SSR): si no hay cámara, el botón ni se muestra y el
  // teclado propio de AC-DES-06 queda como único camino — eso es la mejora progresiva.
  useEffect(() => {
    setSoportado(
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  function cerrar() {
    lectorRef.current?.reset();
    lectorRef.current = null;
    trackRef.current = null;
    setLinternaOn(false);
    setLinternaDisponible(false);
    setAbierto(false);
  }

  // Al desmontar, soltar la cámara sí o sí: un stream vivo deja el LED encendido y
  // bloquea la cámara para el resto de la app (foto del POD, EscanerTed).
  useEffect(() => () => lectorRef.current?.reset(), []);

  async function abrir() {
    setError(null);
    setAbierto(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const capacidades = track?.getCapabilities() as CapacidadesTorch | undefined;
      setLinternaDisponible(!!capacidades?.torch);

      const lector = new BrowserMultiFormatReader();
      lectorRef.current = lector;
      await lector.decodeFromStream(stream, videoRef.current!, (resultado) => {
        if (!resultado) return;
        const codigo = resultado.getText().trim();
        if (!codigo) return;
        if (typeof navigator.vibrate === "function") navigator.vibrate(200);
        pitarExito();
        cerrar();
        onLeido(codigo);
      });
    } catch {
      setError("No se pudo abrir la cámara — sigue con el teclado");
      cerrar();
    }
  }

  // Linterna: 48 px, alcanzable con el pulgar en el borde inferior de la pantalla
  // full-screen (§5 «apps scanner-first»). Degradación silenciosa si el equipo no la
  // soporta (Safari/iOS no implementa `torch`): el botón ni aparece (linternaDisponible).
  async function alternarLinterna() {
    const track = trackRef.current;
    if (!track) return;
    const encender = !linternaOn;
    try {
      const restriccion: RestriccionesTorch = { torch: encender };
      await track.applyConstraints({ advanced: [restriccion] });
      setLinternaOn(encender);
    } catch {
      setError("La linterna no está disponible en este equipo");
    }
  }

  if (!soportado) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void abrir()}
        style={{
          padding: "12px 16px",
          backgroundColor: "transparent",
          color: acentos.kilopan,
          border: `2px solid ${acentos.kilopan}`,
          borderRadius: 8,
          fontSize: 16,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        Escanear con cámara
      </button>
      {error ? (
        <p role="alert" style={{ margin: "8px 0 0 0", fontSize: 13, color: semantico.error }}>
          {error}
        </p>
      ) : null}

      {abierto ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "#000",
            // Por encima de la BarraPestanas (zIndex 40) y de la modal de override
            // (zIndex 100): full-screen de verdad, nada de la app queda visible detrás.
            zIndex: 200,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ flex: 1, width: "100%", objectFit: "cover" }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              padding: 16,
              background: "linear-gradient(rgba(0,0,0,0.6), transparent)",
            }}
          >
            <p style={{ margin: 0, color: "#fff", fontSize: 15 }}>
              Apunta al código del bulto
            </p>
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 24,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 16,
            }}
          >
            {linternaDisponible ? (
              <button
                type="button"
                onClick={() => void alternarLinterna()}
                aria-label="Linterna"
                aria-pressed={linternaOn}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  border: "none",
                  backgroundColor: linternaOn ? acentos.kilopan : "rgba(255,255,255,0.9)",
                  fontSize: 22,
                  cursor: "pointer",
                }}
              >
                🔦
              </button>
            ) : null}
            <button
              type="button"
              onClick={cerrar}
              style={{
                minHeight: 48,
                padding: "0 24px",
                borderRadius: 24,
                border: "none",
                backgroundColor: "rgba(255,255,255,0.9)",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Cerrar y teclear a mano
            </button>
          </div>
          {error ? (
            <p
              role="alert"
              style={{
                position: "absolute",
                bottom: 84,
                left: 16,
                right: 16,
                margin: 0,
                textAlign: "center",
                fontSize: 13,
                color: semantico.alerta,
              }}
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
