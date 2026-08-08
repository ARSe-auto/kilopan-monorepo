"use client";
import { useCallback, useEffect, useState } from "react";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";
import { EstadoCargando, EstadoVacio, EstadoError } from "@kilopan/miga/componentes/index.tsx";
import { formatearKg, formatearFechaHora } from "@/comun/formato.ts";
import { Pantalla } from "../Pantalla.tsx";
import { useSesion } from "../SesionCliente.tsx";
import { puedeEntrar } from "../navegacion.ts";

const ETIQUETA_MOTIVO: Record<string, string> = {
  quemado: "Quemado",
  sobrante_dia: "Sobrante del día",
  devolucion_cliente: "Devolución",
  otro: "Otro",
};

interface Merma {
  id: string;
  gramos: number;
  motivo_merma: string;
  estado_merma: string;
  recibido_at: string;
  producto_nombre: string;
  maestro_nombre: string;
}

// AC-MERM-02: UI de resolución de mermas al día siguiente. Lista mermas pendientes
// que el maestro o admin pueden resolver a 'confirmada_perdida' o 'recuperada_con_venta'.
export default function ResolverMermasPage() {
  const sesion = useSesion();
  const puedeMaestro = puedeEntrar(sesion?.rol, "/pesar");
  const esAdmin = sesion?.rol === "admin";
  const autorizado = sesion && (esAdmin || puedeMaestro);

  const [mermas, setMermas] = useState<Merma[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  const cargarMermas = useCallback(() => {
    if (!autorizado) return;
    setCargando(true);
    setError(false);
    setMensajeExito(null);

    fetch("/api/pesajes?limite=100")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        const pesajes = (d.pesajes ?? []) as (Merma & { destino: string })[];
        const mermasPendientes = pesajes.filter(
          (p) => p.destino === "merma" && p.estado_merma === "pendiente"
        ) as Merma[];
        setMermas(mermasPendientes);
      })
      .catch(() => setError(true))
      .finally(() => setCargando(false));
  }, [autorizado]);

  useEffect(() => {
    cargarMermas();
  }, [cargarMermas]);

  async function resolver(mermaId: string, nuevoEstado: "confirmada_perdida" | "recuperada_con_venta") {
    setResolviendo(mermaId);
    try {
      const res = await fetch("/api/pesajes/resolver-merma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pesajeId: mermaId, nuevoEstado }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Error al resolver la merma");
        return;
      }

      setMensajeExito("Merma resuelta correctamente");
      setMermas((actuales) => actuales.filter((m) => m.id !== mermaId));
      setTimeout(() => setMensajeExito(null), 3000);
    } catch {
      alert("Error de red al resolver la merma");
    } finally {
      setResolviendo(null);
    }
  }

  if (!autorizado) {
    return (
      <Pantalla titulo="No autorizado" bajada="No tienes permisos para resolver mermas." ancho={700}>
        <EstadoVacio mensaje="Solo admin y maestros pueden resolver mermas." />
      </Pantalla>
    );
  }

  return (
    <Pantalla
      titulo="Resolver mermas"
      bajada="Mermas del día anterior sin resolver. Cambia su estado a confirmada o recuperada."
      ancho={700}
    >
      {cargando && <EstadoCargando />}

      {error && <EstadoError mensaje="Error al cargar las mermas" alReintentar={cargarMermas} />}

      {!cargando && !error && mermas.length === 0 && (
        <EstadoVacio mensaje="Todas las mermas han sido resueltas." />
      )}

      {mensajeExito && (
        <div
          style={{
            background: `${semantico.ok}22`,
            border: `1px solid ${semantico.ok}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            color: semantico.ok,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          ✓ {mensajeExito}
        </div>
      )}

      {!cargando && !error && mermas.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {mermas.map((merma) => (
            <li
              key={merma.id}
              style={{
                background: superficie.tarjeta,
                border: `1px solid ${superficie.hairline}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>{merma.producto_nombre}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: superficie.textoDim }}>
                    {formatearKg(merma.gramos)} · {ETIQUETA_MOTIVO[merma.motivo_merma] || merma.motivo_merma}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: superficie.textoDim }}>
                    Por {merma.maestro_nombre} · {formatearFechaHora(new Date(merma.recibido_at))}
                  </p>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => resolver(merma.id, "confirmada_perdida")}
                  disabled={resolviendo === merma.id}
                  style={{
                    minHeight: 44,
                    borderRadius: 8,
                    border: `1px solid ${superficie.hairline}`,
                    fontSize: 14,
                    fontWeight: 600,
                    color: superficie.textoDim,
                    background: superficie.fondo,
                    cursor: resolviendo === merma.id ? "default" : "pointer",
                    opacity: resolviendo === merma.id ? 0.6 : 1,
                  }}
                >
                  {resolviendo === merma.id ? "..." : "Confirmar perdida"}
                </button>
                <button
                  type="button"
                  onClick={() => resolver(merma.id, "recuperada_con_venta")}
                  disabled={resolviendo === merma.id}
                  style={{
                    minHeight: 44,
                    borderRadius: 8,
                    border: "none",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#FFFFFF",
                    background: acentos.kilopan,
                    cursor: resolviendo === merma.id ? "default" : "pointer",
                    opacity: resolviendo === merma.id ? 0.6 : 1,
                  }}
                >
                  {resolviendo === merma.id ? "..." : "Recuperada con venta"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Pantalla>
  );
}
