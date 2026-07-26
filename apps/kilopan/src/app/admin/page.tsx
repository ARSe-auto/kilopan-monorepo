"use client";
import { useEffect, useState } from "react";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";

interface Parametro { clave: string; valor: number; descripcion: string }

// AC-PES-04: el toggle de foto obligatoria en pesaje. Deliberadamente vive acá, en
// una pantalla de admin, y no en la de pesaje: es un control del dueño sobre su
// operación, no algo que quien pesa pueda apagar cuando le incomode.
export default function AdminPage() {
  const [parametros, setParametros] = useState<Parametro[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/parametros").then((r) => r.json()).then((d) => setParametros(d.parametros ?? []));
  }, []);

  async function guardar(clave: string, valor: number) {
    setMensaje(null); setError(null);
    const r = await fetch("/api/parametros", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave, valor }),
    });
    const cuerpo = await r.json();
    if (!r.ok) { setError(cuerpo.error); return; }
    setParametros((ps) => ps.map((p) => (p.clave === clave ? { ...p, valor } : p)));
    setMensaje("Guardado.");
  }

  const foto = parametros.find((p) => p.clave === "pesaje_foto_obligatoria");
  const resto = parametros.filter((p) => p.clave !== "pesaje_foto_obligatoria");

  return (
    <main style={{ maxWidth: 620, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Ajustes</h1>

      {foto ? (
        <section style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>Pedir foto en cada pesaje</p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: superficie.textoDim }}>
                Deja respaldo de cada bandeja pesada. Suma un toque al flujo del maestro,
                así que parte apagado y actívalo solo si lo necesitas.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={foto.valor === 1}
              onClick={() => guardar("pesaje_foto_obligatoria", foto.valor === 1 ? 0 : 1)}
              style={{
                minWidth: 88, minHeight: 44, borderRadius: 100, fontWeight: 700, fontSize: 14,
                border: `1px solid ${superficie.hairline}`,
                background: foto.valor === 1 ? semantico.ok : "#fff",
                color: foto.valor === 1 ? "#fff" : superficie.textoDim,
              }}
            >
              {foto.valor === 1 ? "✓ Activa" : "Apagada"}
            </button>
          </div>
        </section>
      ) : null}

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Antes decía "Costos de reparto", pero acá también viven parámetros que no
            son costos (CO2 evitado por km, umbral de rutas para mostrar "Tu flota"). */}
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Ajustes de reparto y flota</h2>
        {resto.map((p) => (
          <label key={p.clave} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, fontSize: 14, color: superficie.textoDim }}>{p.descripcion}</span>
            <input
              type="number"
              defaultValue={p.valor}
              onBlur={(e) => {
                // Vaciar el campo (Number("") = 0) o escribir un negativo guardaba
                // silenciosamente un costo por km de $0 o negativo, sin que nadie lo
                // pidiera — alimenta el $/km del panel del dueño.
                if (e.target.value.trim() === "") {
                  e.target.value = String(p.valor);
                  return;
                }
                const v = Math.round(Number(e.target.value));
                if (!Number.isInteger(v) || v < 0) {
                  e.target.value = String(p.valor);
                  return;
                }
                if (v !== p.valor) void guardar(p.clave, v);
              }}
              style={{ width: 110, minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 12px", fontSize: 17, fontVariantNumeric: "tabular-nums", textAlign: "right" }}
            />
          </label>
        ))}
      </section>

      {mensaje ? <p style={{ color: semantico.ok, fontSize: 14 }} role="status">{mensaje}</p> : null}
      {error ? <p style={{ color: semantico.error, fontSize: 14 }} role="alert">{error}</p> : null}
    </main>
  );
}
