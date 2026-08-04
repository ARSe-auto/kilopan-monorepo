"use client";
import { useCallback, useEffect, useState } from "react";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";
import { EstadoCargando, EstadoVacio, EstadoError } from "@kilopan/miga/componentes/index.tsx";
import { formatearKg, formatearFechaHora } from "@/comun/formato.ts";
import { Pantalla } from "../Pantalla.tsx";
import { useSesion } from "../SesionCliente.tsx";

interface Pesaje {
  id: string;
  gramos: number;
  destino: "mostrador" | "reparto" | "merma";
  motivo_merma: string | null;
  foto_sha256: string | null;
  foto_estado: "pendiente_subida" | "subida" | null;
  recibido_at: string;
  producto_nombre: string;
  maestro_nombre: string;
}
interface Maestro {
  id: string;
  nombre: string;
}

const ETIQUETA_DESTINO: Record<Pesaje["destino"], string> = {
  mostrador: "Mostrador",
  reparto: "Reparto",
  merma: "Merma",
};
const COLOR_DESTINO: Record<Pesaje["destino"], string> = {
  mostrador: acentos.kilopan,
  reparto: "#1D4ED8",
  merma: semantico.error,
};

// Historial acumulativo de pesajes, con fecha, hora y foto (docs/BITACORA.md
// 2026-07-27, encargo de Alexis: "tiene cada maestro una lista visible, acumulativo,
// con registro de hora y fecha... puede incorporar foto de la balanza?"). No existía
// ninguna pantalla ni endpoint para esto — se construyó de cero sobre datos que
// pan.pesajes ya guardaba (usuario_id, capturado/recibido_at, foto_sha256) sin usarlos
// para nada visible.
//
// El maestro ve SIEMPRE el suyo, sin selector — es su propio registro de trabajo. El
// admin puede acotar a un maestro o ver la panadería entera.
export default function HistorialPage() {
  const sesion = useSesion();
  const [maestros, setMaestros] = useState<Maestro[]>([]);
  const [filtroUsuarioId, setFiltroUsuarioId] = useState(""); // "" = todos (solo admin)
  const [pesajes, setPesajes] = useState<Pesaje[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorCarga, setErrorCarga] = useState(false);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);

  const esAdmin = sesion?.rol === "admin";

  useEffect(() => {
    if (!esAdmin) return;
    fetch("/api/usuarios?rol=maestro")
      .then((r) => r.json())
      .then((d) => setMaestros(d.usuarios ?? []))
      .catch(() => undefined);
  }, [esAdmin]);

  const cargarPrimeraPagina = useCallback(() => {
    setCargando(true);
    setErrorCarga(false);
    const qs = filtroUsuarioId ? `?usuarioId=${encodeURIComponent(filtroUsuarioId)}` : "";
    fetch(`/api/pesajes${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        setPesajes(d.pesajes ?? []);
        setCursor(d.siguienteCursor ?? null);
      })
      .catch(() => setErrorCarga(true))
      .finally(() => setCargando(false));
  }, [filtroUsuarioId]);

  useEffect(() => {
    if (sesion && (sesion.rol === "admin" || sesion.rol === "maestro")) cargarPrimeraPagina();
  }, [sesion, cargarPrimeraPagina]);

  function cargarMas() {
    if (!cursor || cargandoMas) return;
    setCargandoMas(true);
    const params = new URLSearchParams({ antes: cursor });
    if (filtroUsuarioId) params.set("usuarioId", filtroUsuarioId);
    fetch(`/api/pesajes?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setPesajes((actuales) => [...actuales, ...(d.pesajes ?? [])]);
        setCursor(d.siguienteCursor ?? null);
      })
      .catch(() => undefined)
      .finally(() => setCargandoMas(false));
  }

  if (sesion && sesion.rol !== "admin" && sesion.rol !== "maestro") {
    return (
      <Pantalla titulo="Historial de pesaje">
        <p style={{ color: superficie.textoDim }}>Esta pantalla es solo para administradores y maestros.</p>
      </Pantalla>
    );
  }

  return (
    <Pantalla titulo={esAdmin ? "Historial de pesaje" : "Mi historial"}>
      {esAdmin ? (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim, margin: "0 0 8px" }}>Ver de</p>
          <select
            value={filtroUsuarioId}
            onChange={(e) => setFiltroUsuarioId(e.target.value)}
            style={{
              minHeight: 44,
              width: "100%",
              borderRadius: 12,
              border: `1px solid ${superficie.hairline}`,
              padding: "0 14px",
              fontSize: 17,
              background: "#fff",
            }}
          >
            <option value="">Todos los maestros</option>
            {maestros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* AC-H0-11: los tres estados desde miga. El error trae su botón de reintentar —
          antes decía «inténtalo de nuevo» y no había con qué. */}
      {cargando ? (
        <EstadoCargando filas={4} />
      ) : errorCarga ? (
        <EstadoError mensaje="No se pudo cargar el historial. Revisa la conexión." alReintentar={cargarPrimeraPagina} />
      ) : pesajes.length === 0 ? (
        <EstadoVacio
          mensaje={esAdmin && !filtroUsuarioId ? "Todavía no hay pesajes registrados." : "Todavía no has pesado nada."}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {pesajes.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: superficie.tarjeta,
                border: `1px solid ${superficie.hairline}`,
                borderRadius: 12,
                padding: 12,
              }}
            >
              {p.foto_sha256 && p.foto_estado === "subida" ? (
                <button
                  type="button"
                  onClick={() => setFotoAmpliada(p.foto_sha256)}
                  aria-label={`Ver la foto de ${p.producto_nombre}, ${formatearFechaHora(new Date(p.recibido_at))}`}
                  style={{
                    flexShrink: 0,
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    padding: 0,
                    border: `1px solid ${superficie.hairline}`,
                    overflow: "hidden",
                    background: "#000",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- foto servida
                      por /api/fotos, que exige sesión: next/image no puede optimizar un
                      recurso que no es público, y este es un thumbnail de 56px, no una
                      imagen de portada. */}
                  <img
                    src={`/api/fotos?sha256=${p.foto_sha256}`}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={(e) => {
                      (e.currentTarget.closest("button") as HTMLElement | null)?.style.setProperty("display", "none");
                    }}
                  />
                </button>
              ) : p.foto_sha256 ? (
                // La panadería exige foto y esta bandeja la tiene camino a subir (cola
                // offline): mostrar un hueco vacío se leería como "no hay foto", que no
                // es lo mismo que "todavía no llegó".
                <div
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    background: superficie.fondo,
                    border: `1px dashed ${superficie.hairline}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    color: superficie.textoFaint,
                    textAlign: "center",
                  }}
                >
                  Subiendo…
                </div>
              ) : null}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{p.producto_nombre}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {formatearKg(p.gramos)}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                  {/* flex:1 + minWidth:0 + nowrap/ellipsis: sin esto, "27-07-2026 00:54 ·
                      Pedro Maestro" partía a una segunda línea a media palabra cuando el
                      nombre era largo — el mismo defecto de <Pantalla> que ya se
                      encontró y corrigió hoy, esta vez en una fila de lista. */}
                  <span
                    style={{
                      fontSize: 13,
                      color: superficie.textoFaint,
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatearFechaHora(new Date(p.recibido_at))}
                    {esAdmin && !filtroUsuarioId ? ` · ${p.maestro_nombre}` : ""}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: COLOR_DESTINO[p.destino], flexShrink: 0 }}>
                    {ETIQUETA_DESTINO[p.destino]}
                    {p.destino === "merma" && p.motivo_merma ? ` · ${p.motivo_merma}` : ""}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {cursor ? (
            <button
              type="button"
              onClick={cargarMas}
              disabled={cargandoMas}
              style={{
                minHeight: 44,
                marginTop: 4,
                borderRadius: 12,
                border: `1px solid ${superficie.hairline}`,
                background: "#fff",
                fontWeight: 700,
                fontSize: 14,
                color: superficie.textoDim,
              }}
            >
              {cargandoMas ? "Cargando…" : "Cargar más"}
            </button>
          ) : null}
        </div>
      )}

      {fotoAmpliada ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Foto de la báscula"
          onClick={() => setFotoAmpliada(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,.92)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- misma foto servida
              por /api/fotos; acá se ve completa, ampliada por el maestro/admin. */}
          <img
            src={`/api/fotos?sha256=${fotoAmpliada}`}
            alt="Foto de la báscula al momento de pesar"
            style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 12 }}
          />
          <button
            type="button"
            onClick={() => setFotoAmpliada(null)}
            style={{
              marginTop: 16,
              minHeight: 44,
              padding: "0 20px",
              borderRadius: 100,
              border: "none",
              background: "#fff",
              fontWeight: 700,
              fontSize: 14,
              color: superficie.texto,
            }}
          >
            Cerrar
          </button>
        </div>
      ) : null}
    </Pantalla>
  );
}
