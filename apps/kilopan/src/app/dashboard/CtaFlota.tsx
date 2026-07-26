"use client";
import { useState } from "react";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";

// Los dos CTA de «Tu flota». Antes eran botones que NO HACÍAN NADA: el dueño los
// tocaba, no pasaba nada, y el interés se perdía — aunque las tablas de leads y sus
// grants existían desde la migración 0005 y solo faltaba el endpoint (auditoría de
// experiencia). Ahora piden el contacto, exigen consentimiento explícito
// (AC-DASH-02/03, además del CHECK de la BD) y confirman que quedó registrado.
export function CtaFlota({
  kmMes,
  ahorroEstimadoClp,
  paradasMes,
}: {
  kmMes: number;
  ahorroEstimadoClp: number;
  paradasMes: number;
}) {
  const [abierto, setAbierto] = useState<"eauto" | "kiloruta" | null>(null);
  const [contacto, setContacto] = useState("");
  const [consentimiento, setConsentimiento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  async function enviar() {
    if (!abierto || enviando) return;
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: abierto,
          contacto,
          consentimiento,
          kmMes,
          ...(abierto === "eauto" ? { ahorroEstimadoClp } : { paradasMes }),
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) {
        setMensaje({ tipo: "error", texto: cuerpo.error ?? "No se pudo registrar" });
        return;
      }
      setMensaje({ tipo: "ok", texto: "Listo — te van a contactar a ese dato." });
      setAbierto(null);
      setContacto("");
      setConsentimiento(false);
    } catch {
      setMensaje({ tipo: "error", texto: "Sin conexión con el servidor" });
    } finally {
      setEnviando(false);
    }
  }

  const campo = {
    minHeight: 44,
    borderRadius: 10,
    border: `1px solid ${superficie.hairline}`,
    padding: "0 12px",
    fontSize: 16,
    width: "100%",
  } as const;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => { setAbierto(abierto === "eauto" ? null : "eauto"); setMensaje(null); }}
          style={{ minHeight: 44, padding: "12px 16px", borderRadius: 12, border: "none", background: acentos.kilopan, color: "#fff", fontWeight: 700, fontSize: 14 }}
        >
          Quiero que e-auto me contacte
        </button>
        <button
          type="button"
          onClick={() => { setAbierto(abierto === "kiloruta" ? null : "kiloruta"); setMensaje(null); }}
          style={{ minHeight: 44, padding: "12px 16px", borderRadius: 12, border: "none", background: acentos.kiloruta, color: "#fff", fontWeight: 700, fontSize: 14 }}
        >
          Prefiero que alguien más reparta por mí
        </button>
      </div>

      {abierto ? (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            value={contacto}
            onChange={(e) => setContacto(e.target.value)}
            placeholder="Tu teléfono o correo"
            style={campo}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={consentimiento}
              onChange={(e) => setConsentimiento(e.target.checked)}
              style={{ width: 24, height: 24, flexShrink: 0 }}
            />
            <span>Autorizo que compartan este dato para que me contacten.</span>
          </label>
          <button
            type="button"
            onClick={enviar}
            disabled={enviando || !contacto.trim() || !consentimiento}
            style={{
              minHeight: 44, padding: "12px 16px", borderRadius: 12, border: "none",
              background: enviando || !contacto.trim() || !consentimiento ? "#B8AFA2" : acentos.kilopan,
              color: "#fff", fontWeight: 700, fontSize: 14,
            }}
          >
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      ) : null}

      {mensaje ? (
        <p
          role={mensaje.tipo === "ok" ? "status" : "alert"}
          style={{ marginTop: 10, fontSize: 14, color: mensaje.tipo === "ok" ? semantico.ok : semantico.error }}
        >
          {mensaje.texto}
        </p>
      ) : null}
    </div>
  );
}
