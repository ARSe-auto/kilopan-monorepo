"use client";
import { useCallback, useEffect, useState } from "react";
import {
  BotonPrimario,
  ChipEstadoConexion,
  TecladoNumerico,
} from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico, acentos, tabularNums } from "@kilopan/miga/tokens.ts";
import { useEnLinea } from "@/comun/useEnLinea.ts";
import { Pantalla } from "../Pantalla.tsx";
import { EscanerBulto } from "../EscanerBulto.tsx";

interface Bulto {
  id: string;
  codigo: string;
  correlativo: number;
  cargado: boolean;
  correlativo_pedido: string;
  razon_social: string;
}

// F3 Cargar van (PROMPT_MAESTRO.md §5): contador N/M en 96 px; captura manual del código
// con teclado propio; checklist para bultos sin código; duplicado = banner ámbar.
// «Salir a ruta» exige 100 % o confirmación auditada (única modal permitida) **y** todos
// los DTE asociados (AC-DES-06).
export default function CargarPage() {
  const [rutaId, setRutaId] = useState<string | null>(null);
  const [bultos, setBultos] = useState<Bulto[]>([]);
  const [cargados, setCargados] = useState(0);
  const [codigoTexto, setCodigoTexto] = useState("");
  const [paso, setPaso] = useState<"lista" | "captura">("lista");
  const online = useEnLinea();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ultimoDuplicado, setUltimoDuplicado] = useState<string | null>(null);
  const [mostrarModalSalida, setMostrarModalSalida] = useState(false);
  const [motivoSalida, setMotivoSalida] = useState("");
  const [procesandoSalida, setProcesandoSalida] = useState(false);

  // AC-DES-05: cargar lista de bultos de la ruta del día
  const cargarBultos = useCallback(async () => {
    if (!rutaId) return;
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/bultos?rutaId=${rutaId}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      setBultos(data.bultos ?? []);
      setCargados(data.cargados ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los bultos");
      if (bultos.length === 0) {
        setBultos([]);
        setCargados(0);
      }
    } finally {
      setCargando(false);
    }
  }, [rutaId, bultos.length]);

  // Detectar ruta de la URL (en web será ?rutaId=..., en repartidor viene del estado)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get("rutaId");
    if (rid) {
      setRutaId(rid);
    }
  }, []);

  useEffect(() => {
    if (rutaId) {
      void cargarBultos();
    }
  }, [rutaId, cargarBultos]);

  // AC-DES-05: escanear un código de bulto
  const escanear = useCallback(async (codigo: string) => {
    if (!codigo.trim()) return;
    try {
      const r = await fetch("/api/bultos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigo.trim() }),
      });
      const data = await r.json();

      if (r.status === 409) {
        setUltimoDuplicado(codigo);
        setTimeout(() => setUltimoDuplicado(null), 3000);
        setCodigoTexto("");
        return;
      }

      if (!r.ok) {
        setError(data.error || "Error al escanear");
        return;
      }

      // Actualizar lista local
      setBultos((actual) =>
        actual.map((b) => (b.codigo === codigo ? { ...b, cargado: true } : b))
      );
      setCargados((c) => c + 1);
      setCodigoTexto("");
      setUltimoDuplicado(null);
      // AC-DES-06: un escaneo válido vuelve sola a la lista para ver el contador avanzar;
      // el duplicado (rama 409 arriba) se queda en la captura mostrando el banner ámbar.
      setPaso("lista");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    }
  }, []);

  // AC-DES-04: override auditado para salir con bultos pendientes
  const salirARuta = useCallback(async () => {
    if (cargados === bultos.length) {
      // 100 % cargado — salir sin modal
      setProcesandoSalida(true);
      try {
        const r = await fetch("/api/rutas/salir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rutaId }),
        });
        if (!r.ok) throw new Error(String(r.status));
        // Redirigir a ruta
        window.location.href = "/ruta";
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo salir a ruta");
      } finally {
        setProcesandoSalida(false);
      }
    } else {
      // Menos del 100 % — pedir override
      setMostrarModalSalida(true);
    }
  }, [cargados, bultos.length, rutaId]);

  // Confirmar override
  const confirmarSalida = useCallback(async () => {
    if (!motivoSalida.trim()) {
      setError("Debes indicar el motivo");
      return;
    }
    setProcesandoSalida(true);
    try {
      const r = await fetch("/api/rutas/salir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rutaId, motivo: motivoSalida.trim() }),
      });
      if (!r.ok) throw new Error(String(r.status));
      window.location.href = "/ruta";
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo salir a ruta");
    } finally {
      setProcesandoSalida(false);
    }
  }, [motivoSalida, rutaId]);

  if (!rutaId) {
    return (
      <Pantalla titulo="Cargar van">
        <div style={{ padding: "16px", textAlign: "center", color: superficie.textoDim }}>
          <p>Error: no se encontró la ruta</p>
        </div>
      </Pantalla>
    );
  }

  return (
    <Pantalla
      titulo="Cargar van"
      accesorio={<ChipEstadoConexion pendientes={0} online={online} />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
        {/* Contador N/M 96 px (AC-DES-06) */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              fontVariantNumeric: tabularNums,
              lineHeight: 1,
            }}
          >
            {cargados}/{bultos.length}
          </div>
          <p style={{ margin: "8px 0 0 0", fontSize: 13, color: superficie.textoDim }}>
            bultos cargados
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              backgroundColor: semantico.error + "20",
              borderLeft: `4px solid ${semantico.error}`,
              borderRadius: 8,
              fontSize: 13,
              color: semantico.error,
            }}
          >
            {error}
            <button
              onClick={() => setError(null)}
              style={{
                marginLeft: "8px",
                padding: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
                color: semantico.error,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {ultimoDuplicado && (
          <div
            style={{
              padding: "8px 12px",
              backgroundColor: semantico.alerta + "20",
              borderLeft: `4px solid ${semantico.alerta}`,
              borderRadius: 8,
              fontSize: 13,
              color: semantico.alerta,
            }}
          >
            ⚠ Bulto ya escaneado: {ultimoDuplicado}
          </div>
        )}

        {paso === "lista" ? (
          <>
            {/* Lista de bultos / checklist */}
            <div
              style={{
                flex: 1,
                overflow: "auto",
                border: `1px solid ${superficie.hairline}`,
                borderRadius: 12,
                padding: 8,
              }}
            >
              {bultos.length === 0 && !cargando ? (
                <div style={{ textAlign: "center", padding: "32px 16px", color: superficie.textoDim }}>
                  No hay bultos en esta ruta
                </div>
              ) : cargando ? (
                <div style={{ textAlign: "center", padding: "32px 16px", color: superficie.textoDim }}>
                  Cargando…
                </div>
              ) : (
                bultos.map((bulto) => (
                  <div
                    key={bulto.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: 12,
                      borderBottom: `1px solid ${superficie.hairline}`,
                      gap: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={bulto.cargado}
                      readOnly
                      style={{
                        width: 20,
                        height: 20,
                        cursor: "default",
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 15 }}>{bulto.codigo}</div>
                      <div style={{ fontSize: 13, color: superficie.textoDim }}>
                        {bulto.razon_social}
                      </div>
                    </div>
                    {bulto.cargado ? (
                      <div style={{ color: semantico.ok, fontSize: 18 }}>✓</div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {/* Botón para capturar código */}
            <button
              onClick={() => setPaso("captura")}
              style={{
                padding: "12px 16px",
                backgroundColor: acentos.kilopan,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Escanear código
            </button>

            {/* AC-DES-07: mejora progresiva sobre el botón manual de arriba — reusa el
                mismo `escanear()` (dedup, error, contador) que la captura por teclado. */}
            <EscanerBulto onLeido={(codigo) => void escanear(codigo)} />

            {/* Botón Salir a ruta (AC-DES-04 override) */}
            <BotonPrimario
              onClick={salirARuta}
              disabled={procesandoSalida}
            >
              {cargados === bultos.length
                ? "Salir a ruta (100 %)"
                : `Salir a ruta (${cargados}/${bultos.length})`}
            </BotonPrimario>
          </>
        ) : (
          <>
            {/* Captura manual (AC-DES-06) */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <p style={{ fontSize: 15, marginBottom: 16 }}>Ingresa el código del bulto</p>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 700,
                  fontVariantNumeric: tabularNums,
                  minHeight: 48,
                  marginBottom: 24,
                  textAlign: "center",
                }}
              >
                {codigoTexto ? `P${codigoTexto}` : "—"}
              </div>
            </div>

            {/* AC-DES-06: contrato de captura fijado en la spec (06-ago-2026) — el
                teclado propio es numérico + «−»; el prefijo «P» lo pone la pantalla,
                jamás se teclea. */}
            <TecladoNumerico valor={codigoTexto} onCambiar={setCodigoTexto} permitirGuion />

            <button
              onClick={() => {
                void escanear(`P${codigoTexto}`);
              }}
              style={{
                padding: "12px 16px",
                backgroundColor: codigoTexto ? acentos.kilopan : superficie.textoDim + "40",
                color: codigoTexto ? "#fff" : superficie.textoDim,
                border: "none",
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 500,
                cursor: codigoTexto ? "pointer" : "default",
              }}
              disabled={!codigoTexto}
            >
              Escanear
            </button>

            <button
              onClick={() => {
                setPaso("lista");
                setCodigoTexto("");
                setError(null);
              }}
              style={{
                padding: "12px 16px",
                backgroundColor: "transparent",
                color: acentos.kilopan,
                border: `1px solid ${acentos.kilopan}`,
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Volver
            </button>
          </>
        )}
      </div>

      {/* Modal de override (AC-DES-04) */}
      {mostrarModalSalida && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "flex-end",
            // AC-DES-06: por encima de la BarraPestanas (zIndex 40); si no, la barra de
            // navegación inferior tapa el botón de confirmar del override y la única modal
            // permitida queda intappable — el override auditado no se podría ejecutar.
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: "100%",
              backgroundColor: superficie.tarjeta,
              borderRadius: "16px 16px 0 0",
              padding: "24px 16px",
              maxHeight: "50vh",
              overflow: "auto",
            }}
          >
            <h2 style={{ margin: "0 0 16px 0", fontSize: 22, fontWeight: 600 }}>
              Salir con bultos pendientes
            </h2>
            <p style={{ margin: "0 0 16px 0", fontSize: 15, color: superficie.textoDim }}>
              {cargados} de {bultos.length} bultos cargados. ¿Deseas continuar?
            </p>
            <textarea
              placeholder="Motivo del override (ej: se entregaron en ruta, cliente no estaba, etc.)"
              value={motivoSalida}
              onChange={(e) => setMotivoSalida(e.target.value)}
              style={{
                width: "100%",
                padding: 12,
                marginBottom: 16,
                border: `1px solid ${superficie.hairline}`,
                borderRadius: 8,
                fontSize: 15,
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
              rows={3}
            />
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => {
                  setMostrarModalSalida(false);
                  setMotivoSalida("");
                }}
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: "transparent",
                  color: acentos.kilopan,
                  border: `1px solid ${acentos.kilopan}`,
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => void confirmarSalida()}
                disabled={procesandoSalida || !motivoSalida.trim()}
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: motivoSalida.trim()
                    ? acentos.kilopan
                    : superficie.textoDim + "40",
                  color: motivoSalida.trim() ? "#fff" : superficie.textoDim,
                  border: "none",
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: motivoSalida.trim() ? "pointer" : "default",
                }}
              >
                {procesandoSalida ? "Saliendo…" : "Salir a ruta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Pantalla>
  );
}
