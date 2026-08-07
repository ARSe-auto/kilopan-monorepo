"use client";

import { useState, useEffect } from "react";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";

type Evento = {
  id: string;
  tipo: string;
  entidad: string;
  entidad_id: string | null;
  payload: Record<string, unknown>;
  usuario_nombre: string | null;
  usuario_rut: string | null;
  dispositivo_nombre: string | null;
  at: string;
};

export function PantallaAuditoria({
  usuarios,
  dispositivos,
}: {
  usuarios: Array<{ id: string; nombre: string; rut: string }>;
  dispositivos: Array<{ id: string; nombre: string }>;
}) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [usuarioFiltro, setUsuarioFiltro] = useState("");
  const [dispositivoFiltro, setDispositivoFiltro] = useState("");

  useEffect(() => {
    const cargar = async () => {
      setCargando(true);
      const params = new URLSearchParams();
      if (usuarioFiltro) params.append("usuario_id", usuarioFiltro);
      if (dispositivoFiltro) params.append("dispositivo_id", dispositivoFiltro);

      try {
        const r = await fetch(`/api/auditoria?${params.toString()}`);
        if (!r.ok) throw new Error("Error cargando eventos");
        const { eventos } = await r.json();
        setEventos(eventos);
      } catch (e) {
        console.error(e);
      } finally {
        setCargando(false);
      }
    };

    const t = setTimeout(cargar, 300);
    return () => clearTimeout(t);
  }, [usuarioFiltro, dispositivoFiltro]);

  return (
    <section
      style={{
        background: superficie.tarjeta,
        border: `1px solid ${superficie.hairline}`,
        borderRadius: 16,
        padding: 24,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Auditoría por usuario y dispositivo</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 13, color: superficie.textoFaint, display: "block", marginBottom: 4 }}>
            Usuario
          </label>
          <select
            value={usuarioFiltro}
            onChange={(e) => setUsuarioFiltro(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: 16,
              border: `1px solid ${superficie.hairline}`,
              borderRadius: 8,
              background: superficie.fondo,
              color: superficie.texto,
            }}
          >
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 13, color: superficie.textoFaint, display: "block", marginBottom: 4 }}>
            Dispositivo
          </label>
          <select
            value={dispositivoFiltro}
            onChange={(e) => setDispositivoFiltro(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: 16,
              border: `1px solid ${superficie.hairline}`,
              borderRadius: 8,
              background: superficie.fondo,
              color: superficie.texto,
            }}
          >
            <option value="">Todos</option>
            {dispositivos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {cargando ? (
        <p style={{ color: superficie.textoDim }}>Cargando…</p>
      ) : eventos.length === 0 ? (
        <p style={{ color: superficie.textoDim }}>Sin eventos.</p>
      ) : (
        <div
          style={{
            maxHeight: 400,
            overflowY: "auto",
            border: `1px solid ${superficie.hairline}`,
            borderRadius: 8,
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${superficie.hairline}` }}>
                <th style={{ textAlign: "left", padding: 8, fontSize: 12, color: superficie.textoFaint }}>
                  Hora
                </th>
                <th style={{ textAlign: "left", padding: 8, fontSize: 12, color: superficie.textoFaint }}>
                  Tipo
                </th>
                <th style={{ textAlign: "left", padding: 8, fontSize: 12, color: superficie.textoFaint }}>
                  Usuario
                </th>
                <th style={{ textAlign: "left", padding: 8, fontSize: 12, color: superficie.textoFaint }}>
                  Dispositivo
                </th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((e) => {
                const fecha = new Date(e.at);
                const hora = fecha.toLocaleTimeString("es-CL", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
                return (
                  <tr
                    key={e.id}
                    style={{
                      borderBottom: `1px solid ${superficie.hairline}`,
                      fontSize: 13,
                    }}
                    title={JSON.stringify(e.payload, null, 2)}
                  >
                    <td style={{ padding: 8, color: superficie.texto }}>{hora}</td>
                    <td style={{ padding: 8, color: semantico.ok }}>{e.tipo}</td>
                    <td style={{ padding: 8, color: superficie.texto }}>
                      {e.usuario_nombre || "—"}
                    </td>
                    <td style={{ padding: 8, color: superficie.texto }}>
                      {e.dispositivo_nombre || "—"}
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
