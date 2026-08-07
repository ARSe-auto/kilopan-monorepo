"use client";
import { useEffect, useState, useCallback } from "react";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { Pantalla } from "../../../Pantalla.tsx";

// AC-PERF-05: cablear paginación por cursor (keyset) desde AC-PERF-03 a una pantalla
// de historial de entregas. El endpoint ya existe; esta pantalla lo consume y scrollea
// sin offset, manteniendo el cursor estable si entran entregas nuevas.

interface Entrega {
  id: string;
  receptor_nombre: string;
  gramos_entregados: number;
  foto_sha256: string | null;
  foto_estado: string;
  gps_degradado: boolean;
  gps_fuera_de_zona: boolean;
  recibido_at: string;
  capturado_at: string;
  razon_social: string;
  correlativo_pedido: number;
  es_parcial: boolean;
  gramos_pedidos: number;
}

interface RespuestaEntregas {
  entregas: Entrega[];
  proximoCursor: string | null;
}

export default function HistorialEntregasPage() {
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [cargando, setCargando] = useState(false);
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proximoCursor, setProximoCursor] = useState<string | null>(null);
  const [filtroRevision, setFiltroRevision] = useState(false);

  const cargarEntregas = useCallback(async (cursor: string | null = null) => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (cursor) params.append("cursor", cursor);
      if (filtroRevision) params.append("porRevisar", "1");

      const r = await fetch(`/api/entregas?${params}`);
      if (!r.ok) throw new Error(String(r.status));
      const datos: RespuestaEntregas = await r.json();

      if (cursor) {
        setEntregas((prev) => [...prev, ...datos.entregas]);
      } else {
        setEntregas(datos.entregas);
      }
      setProximoCursor(datos.proximoCursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`No se pudo cargar el historial: ${msg}`);
    } finally {
      setCargando(false);
    }
  }, [filtroRevision]);

  // Cargar primera página al montar y cuando cambia el filtro
  useEffect(() => {
    setCargandoInicial(true);
    setEntregas([]);
    setProximoCursor(null);
    cargarEntregas(null).finally(() => setCargandoInicial(false));
  }, [filtroRevision, cargarEntregas]);

  const cargarMas = () => {
    if (proximoCursor && !cargando) {
      cargarEntregas(proximoCursor);
    }
  };

  const indicadorProblema = (e: Entrega) => {
    const problemas = [];
    if (e.es_parcial) problemas.push("Parcial");
    if (e.gps_degradado) problemas.push("GPS degradado");
    if (e.gps_fuera_de_zona) problemas.push("Fuera de zona");
    if (e.foto_estado === "pendiente_subida") problemas.push("Foto pendiente");
    return problemas;
  };

  return (
    <Pantalla titulo="Historial de entregas" ancho={800}>
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            <input
              type="checkbox"
              checked={filtroRevision}
              onChange={(e) => setFiltroRevision(e.target.checked)}
              style={{ width: 20, height: 20, cursor: "pointer" }}
            />
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              Solo entregas por revisar
            </span>
          </label>
        </div>

        {cargandoInicial ? (
          <p style={{ color: superficie.textoDim, fontSize: 14, textAlign: "center" }}>
            Cargando historial…
          </p>
        ) : error ? (
          <p style={{ color: semantico.error, fontSize: 14 }} role="alert">
            {error}
          </p>
        ) : entregas.length === 0 ? (
          <p style={{ color: superficie.textoDim, fontSize: 14, textAlign: "center" }}>
            Sin entregas para mostrar.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {entregas.map((e) => {
                const problemas = indicadorProblema(e);
                return (
                  <div
                    key={e.id}
                    style={{
                      background: superficie.tarjeta,
                      border: `1px solid ${problemas.length > 0 ? semantico.alerta : superficie.hairline}`,
                      borderRadius: 12,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>
                          {e.razon_social}
                        </p>
                        <p style={{ margin: "4px 0 0", fontSize: 13, color: superficie.textoFaint }}>
                          Pedido #{e.correlativo_pedido} · {e.receptor_nombre}
                        </p>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 13, color: superficie.textoDim }}>
                        <p style={{ margin: 0 }}>
                          {new Date(e.recibido_at).toLocaleDateString("es-CL")}
                        </p>
                        <p style={{ margin: "2px 0 0" }}>
                          {new Date(e.recibido_at).toLocaleTimeString("es-CL", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                      <div>
                        <span style={{ color: superficie.textoDim }}>Entregado: </span>
                        <span style={{ fontWeight: 600 }}>
                          {e.gramos_entregados}g
                        </span>
                      </div>
                      <div>
                        <span style={{ color: superficie.textoDim }}>Pedido: </span>
                        <span style={{ fontWeight: 600 }}>
                          {e.gramos_pedidos}g
                        </span>
                      </div>
                      {e.foto_sha256 && (
                        <div style={{ color: semantico.ok }}>✓ Foto</div>
                      )}
                    </div>

                    {problemas.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          paddingTop: 4,
                          borderTop: `1px solid ${superficie.hairline}`,
                        }}
                      >
                        {problemas.map((p) => (
                          <span
                            key={p}
                            style={{
                              background: semantico.alerta,
                              color: "#fff",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                            }}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {proximoCursor && (
              <button
                type="button"
                onClick={cargarMas}
                disabled={cargando}
                style={{
                  minHeight: 44,
                  padding: "0 16px",
                  borderRadius: 12,
                  border: `1px solid ${superficie.hairline}`,
                  background: "#fff",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: cargando ? "wait" : "pointer",
                  opacity: cargando ? 0.6 : 1,
                }}
              >
                {cargando ? "Cargando…" : "Cargar más entregas"}
              </button>
            )}

            {!proximoCursor && entregas.length > 0 && (
              <p style={{ textAlign: "center", color: superficie.textoDim, fontSize: 13 }}>
                Fin del historial
              </p>
            )}
          </>
        )}
      </section>
    </Pantalla>
  );
}
