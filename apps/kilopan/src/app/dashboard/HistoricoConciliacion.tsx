"use client";

import { useState, useEffect } from "react";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { formatearKg, formatearFechaISO } from "@/comun/formato.ts";

type Dia = {
  fecha: string;
  g_pesados: string;
  g_venta: string;
  g_pod_ok: string;
  g_merma_tipificada: string;
  g_merma_recuperada: string;
  tck: string | null;
};

function haceUnaSemanaISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return formatearFechaISO(d);
}

// AC-DASH-09: histórico con rango de fechas y exportación CSV de pan.conciliacion_diaria.
export function HistoricoConciliacion() {
  const [desde, setDesde] = useState(haceUnaSemanaISO());
  const [hasta, setHasta] = useState(formatearFechaISO(new Date()));
  const [dias, setDias] = useState<Dia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (desde > hasta) {
      setError("La fecha de inicio no puede ser posterior a la fecha de término.");
      return;
    }
    setError(null);
    const controlador = new AbortController();
    const cargar = async () => {
      setCargando(true);
      try {
        const r = await fetch(`/api/conciliacion-historico?desde=${desde}&hasta=${hasta}`, {
          signal: controlador.signal,
        });
        if (!r.ok) throw new Error("Error cargando el histórico");
        const { dias } = await r.json();
        setDias(dias);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) console.error(e);
      } finally {
        setCargando(false);
      }
    };
    cargar();
    return () => controlador.abort();
  }, [desde, hasta]);

  const estiloInput = {
    width: "100%",
    padding: "8px 12px",
    fontSize: 16,
    border: `1px solid ${superficie.hairline}`,
    borderRadius: 8,
    background: superficie.fondo,
    color: superficie.texto,
  } as const;

  return (
    <section
      style={{
        background: superficie.tarjeta,
        border: `1px solid ${superficie.hairline}`,
        borderRadius: 16,
        padding: 24,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Histórico de conciliación</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, marginBottom: 16, alignItems: "end" }}>
        <div>
          <label style={{ fontSize: 13, color: superficie.textoFaint, display: "block", marginBottom: 4 }}>
            Desde
          </label>
          <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} style={estiloInput} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: superficie.textoFaint, display: "block", marginBottom: 4 }}>
            Hasta
          </label>
          <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} style={estiloInput} />
        </div>
        <a
          href={`/api/conciliacion-historico?desde=${desde}&hasta=${hasta}&formato=csv`}
          download
          aria-disabled={!!error}
          style={{
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 700,
            borderRadius: 8,
            background: error ? superficie.hairline : semantico.ok,
            color: error ? superficie.textoFaint : "#fff",
            textDecoration: "none",
            textAlign: "center",
            pointerEvents: error ? "none" : "auto",
          }}
        >
          Exportar CSV
        </a>
      </div>

      {error ? (
        <p style={{ color: semantico.error }}>{error}</p>
      ) : cargando ? (
        <p style={{ color: superficie.textoDim }}>Cargando…</p>
      ) : dias.length === 0 ? (
        <p style={{ color: superficie.textoDim }}>Sin conciliación en ese rango de fechas.</p>
      ) : (
        <div style={{ maxHeight: 400, overflowY: "auto", border: `1px solid ${superficie.hairline}`, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${superficie.hairline}` }}>
                <th style={{ textAlign: "left", padding: 8, fontSize: 12, color: superficie.textoFaint }}>Fecha</th>
                <th style={{ textAlign: "right", padding: 8, fontSize: 12, color: superficie.textoFaint }}>Pesados</th>
                <th style={{ textAlign: "right", padding: 8, fontSize: 12, color: superficie.textoFaint }}>Vendidos</th>
                <th style={{ textAlign: "right", padding: 8, fontSize: 12, color: superficie.textoFaint }}>Entregados</th>
                <th style={{ textAlign: "right", padding: 8, fontSize: 12, color: superficie.textoFaint }}>Merma</th>
                <th style={{ textAlign: "right", padding: 8, fontSize: 12, color: superficie.textoFaint }}>TCK</th>
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => {
                const tckPct = d.tck == null ? null : Math.round(Number(d.tck) * 100);
                return (
                  <tr key={d.fecha} style={{ borderBottom: `1px solid ${superficie.hairline}`, fontSize: 13 }}>
                    <td style={{ padding: 8, color: superficie.texto }}>{d.fecha}</td>
                    <td style={{ padding: 8, textAlign: "right", fontVariantNumeric: "tabular-nums", color: superficie.texto }}>
                      {formatearKg(Number(d.g_pesados))}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", fontVariantNumeric: "tabular-nums", color: superficie.texto }}>
                      {formatearKg(Number(d.g_venta))}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", fontVariantNumeric: "tabular-nums", color: superficie.texto }}>
                      {formatearKg(Number(d.g_pod_ok))}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", fontVariantNumeric: "tabular-nums", color: superficie.texto }}>
                      {formatearKg(Number(d.g_merma_tipificada))}
                    </td>
                    <td
                      style={{
                        padding: 8,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 700,
                        color: tckPct == null ? superficie.textoFaint : tckPct >= 95 ? semantico.ok : semantico.alerta,
                      }}
                    >
                      {tckPct == null ? "—" : `${tckPct}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
