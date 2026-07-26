"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TecladoNumerico, CifraGrande, BotonPrimario } from "@kilopan/miga/componentes/index.tsx";
import { guardarDispositivo } from "@/identidad/cliente/dispositivo.ts";

// Enrolar ESTE equipo. Solo hace falta una vez por tablet/teléfono — después queda
// guardado localmente y esta pantalla no vuelve a aparecer (ver / -> redirige a
// /ingresar si el equipo ya está vinculado).
export default function VincularPage() {
  const router = useRouter();
  const [paso, setPaso] = useState<"nombre" | "admin">("nombre");
  const [nombreDispositivo, setNombreDispositivo] = useState("");
  const [rutAdmin, setRutAdmin] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function vincular() {
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/dispositivos/enrolar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreDispositivo, rutAdmin, pinAdmin: pin }),
      });
      const cuerpo = await r.json();
      if (!r.ok) {
        setError(cuerpo.error ?? "No se pudo vincular");
        setEnviando(false);
        return;
      }
      guardarDispositivo({ id: cuerpo.dispositivoId, secreto: cuerpo.secreto, nombre: cuerpo.nombre });
      router.push("/ingresar");
    } catch {
      setError("Sin conexión con el servidor");
      setEnviando(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Vincular este equipo</h1>
        <p style={{ color: "#5B564C", fontSize: 15 }}>
          Se hace una vez por tablet o teléfono. Necesitas el RUT y el PIN de un administrador.
        </p>
      </div>

      {paso === "nombre" ? (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#5B564C" }}>Nombre del equipo</span>
            <input
              value={nombreDispositivo}
              onChange={(e) => setNombreDispositivo(e.target.value)}
              placeholder="Tablet mesón"
              style={{ minHeight: 44, borderRadius: 12, border: "1px solid rgba(27,23,18,.14)", padding: "0 14px", fontSize: 17 }}
            />
          </label>
          <BotonPrimario disabled={!nombreDispositivo.trim()} onClick={() => setPaso("admin")}>
            Continuar
          </BotonPrimario>
        </>
      ) : (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#5B564C" }}>RUT del administrador</span>
            <input
              value={rutAdmin}
              onChange={(e) => setRutAdmin(e.target.value)}
              placeholder="12.345.678-5"
              style={{ minHeight: 44, borderRadius: 12, border: "1px solid rgba(27,23,18,.14)", padding: "0 14px", fontSize: 17 }}
            />
          </label>
          {/* Igual que /ingresar: los dígitos ya tecleados no van en texto plano a
              96 px — se enmascaran con ● (tecleado) / ○ (pendiente). */}
          <CifraGrande valor={"●".repeat(pin.length).padEnd(4, "○")} />
          <TecladoNumerico valor={pin} onCambiar={(v) => setPin(v.slice(0, 4))} permitirCeroInicial />
          {error ? <p style={{ color: "#B91C1C", fontSize: 14 }} role="alert">{error}</p> : null}
          <BotonPrimario disabled={!rutAdmin || pin.length !== 4 || enviando} onClick={vincular}>
            {enviando ? "Vinculando…" : "Vincular equipo"}
          </BotonPrimario>
          {/* Antes no había forma de volver a corregir el nombre del equipo sin
              recargar la página entera y perder lo ya tecleado acá. */}
          <button
            type="button"
            onClick={() => setPaso("nombre")}
            style={{ minHeight: 44, background: "none", border: "none", color: "#5B564C", fontSize: 14, fontWeight: 700 }}
          >
            ← Volver
          </button>
        </>
      )}
    </main>
  );
}
