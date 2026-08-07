"use client";
// AC-DTE-03. Mejora progresiva: escaneo del PDF417 (TED) para rellenar el panel
// «Registrar documento del SII» sin teclear. El camino primario en iOS sigue siendo la
// captura manual (§7) — este botón solo aparece si el dispositivo tiene cámara, y
// cualquier fallo (permiso denegado, timbre ilegible) devuelve al usuario al ingreso
// manual, que nunca se va. La cámara se abre solo in-app por getUserMedia, igual que la
// foto del POD: nunca un <input type=file> a la galería.
import { useEffect, useRef, useState } from "react";
import { BrowserPDF417Reader } from "@zxing/library";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";
import { parsearTed, type TedLeido } from "@/comun/ted.ts";

export function EscanerTed({ onLeido }: { onLeido: (ted: TedLeido) => void }) {
  const [soportado, setSoportado] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lectorRef = useRef<BrowserPDF417Reader | null>(null);

  // Detección en el cliente (no en SSR): si no hay cámara, el botón ni se muestra y el
  // panel manual queda intacto — eso es lo que hace de esto una mejora progresiva.
  useEffect(() => {
    setSoportado(
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  const cerrar = () => {
    lectorRef.current?.reset();
    lectorRef.current = null;
    setAbierto(false);
  };

  // Al desmontar, soltar la cámara sí o sí: dejar el stream vivo enciende el LED del
  // teléfono para siempre y bloquea la cámara para la foto del POD.
  useEffect(() => () => lectorRef.current?.reset(), []);

  async function escanear() {
    setError(null);
    setAbierto(true);
    const lector = new BrowserPDF417Reader();
    lectorRef.current = lector;
    try {
      await lector.decodeFromVideoDevice(null, videoRef.current!, (resultado) => {
        if (!resultado) return;
        try {
          const ted = parsearTed(resultado.getText());
          cerrar();
          onLeido(ted);
        } catch (e) {
          // Timbre ilegible o de otro tipo: se avisa y se sigue apuntando; el usuario
          // puede cerrar y teclear a mano en cualquier momento.
          setError(e instanceof Error ? e.message : "No se pudo leer el timbre");
        }
      });
    } catch {
      setError("No se pudo abrir la cámara — registra el documento a mano");
      cerrar();
    }
  }

  if (!soportado) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {abierto ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: "100%", borderRadius: 12, background: "#000", aspectRatio: "4 / 3", objectFit: "cover" }}
          />
          <p style={{ margin: 0, fontSize: 13, color: superficie.textoDim }}>
            Apunta al código de barras (PDF417) del documento.
          </p>
          <button
            type="button"
            onClick={cerrar}
            style={{ minHeight: 44, borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14 }}
          >
            Cerrar cámara y teclear a mano
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={escanear}
          style={{ minHeight: 44, borderRadius: 10, border: `2px solid ${acentos.kilopan}`, background: "#FEF3E2", fontWeight: 700, fontSize: 14 }}
        >
          Escanear código del documento
        </button>
      )}
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: semantico.error }}>{error}</p>
      ) : null}
    </div>
  );
}
