"use client";
import { useEffect, useState } from "react";
import { BotonPrimario } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { formatearClp, parsearClp } from "@/comun/formato.ts";
import { compartir, sePuedeCompartir } from "@/comun/compartir.ts";
import { VolverInicio } from "../VolverInicio.tsx";

interface MedioCaja { medio_pago: string; etiqueta: string; esperado_clp: string }
interface FilaResultado { medioPago: string; esperado: number; declarado: number; diferencia: number }

// F6 (cierre) + AC-PAG-01 + AC-DASH-04: una fila por medio de pago activo, y el total
// que marcó el facturador tecleado una vez para compararlo (decisión #3, fase 1).
export default function CajaPage() {
  const [medios, setMedios] = useState<MedioCaja[]>([]);
  const [declarados, setDeclarados] = useState<Record<string, string>>({});
  const [totalFacturador, setTotalFacturador] = useState("");
  const [resultado, setResultado] = useState<{ filas: FilaResultado[]; difFacturador: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "cargando"/"errorCarga" separados de "medios vacío": sin esto, un fetch que
  // fallaba (sin red, 401, 500) se leía igual que "esta panadería no tiene medios de
  // pago activos" — el vendedor veía la pantalla en blanco sin saber si es un estado
  // real o si la app simplemente no pudo consultar.
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch("/api/cierre-caja")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setMedios(d.medios ?? []))
      .catch(() => setErrorCarga(true))
      .finally(() => setCargando(false));
  }, []);

  const totalEsperado = medios.reduce((s, m) => s + Number(m.esperado_clp), 0);

  async function cerrar() {
    if (enviando) return; // doble toque con las manos ocupadas no debe mandar el cierre dos veces
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/cierre-caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          declarados: medios.map((m) => ({
            medioPago: m.medio_pago,
            declaradoClp: parsearClp(declarados[m.medio_pago] || "0"),
          })),
          totalFacturadorClp: totalFacturador ? parsearClp(totalFacturador) : null,
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setError(cuerpo.error); return; }
      setResultado({ filas: cuerpo.resultado, difFacturador: cuerpo.diferenciaFacturador });
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      setEnviando(false);
    }
  }

  async function compartirResumen() {
    if (!resultado) return;
    const lineas = resultado.filas
      .filter((f) => f.esperado > 0 || f.declarado > 0)
      .map((f) => `${f.medioPago}: esperado ${formatearClp(f.esperado)} · contado ${formatearClp(f.declarado)}`);
    await compartir({
      titulo: "Cierre de caja",
      texto: `Cierre de caja de hoy\n${lineas.join("\n")}\nTotal esperado: ${formatearClp(totalEsperado)}`,
    });
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Cierre de caja</h1>
        <VolverInicio />
      </div>
      <p style={{ margin: 0, fontSize: 14, color: superficie.textoDim }}>
        Cuenta lo que hay en cada medio y anótalo. La app te muestra la diferencia.
      </p>

      {cargando ? (
        <p style={{ color: superficie.textoDim, fontSize: 14 }}>Cargando…</p>
      ) : errorCarga ? (
        <p style={{ color: semantico.error, fontSize: 14 }} role="alert">
          No se pudo consultar lo esperado de hoy. Revisa la conexión e inténtalo de nuevo.
        </p>
      ) : medios.length === 0 ? (
        <p style={{ color: superficie.textoDim, fontSize: 14 }}>No hay medios de pago activos.</p>
      ) : null}

      {medios.map((m) => {
        const esperado = Number(m.esperado_clp);
        return (
          <div key={m.medio_pago} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{m.etiqueta}</p>
              <p style={{ margin: 0, fontSize: 13, color: superficie.textoFaint, fontVariantNumeric: "tabular-nums" }}>
                esperado {formatearClp(esperado)}
              </p>
            </div>
            <input
              value={declarados[m.medio_pago] ?? ""}
              onChange={(e) => setDeclarados({ ...declarados, [m.medio_pago]: e.target.value })}
              placeholder="0"
              inputMode="numeric"
              style={{ width: 130, minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 12px", fontSize: 17, fontVariantNumeric: "tabular-nums", textAlign: "right" }}
            />
          </div>
        );
      })}

      <div style={{ borderTop: `1px solid ${superficie.hairline}`, paddingTop: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim }}>
            Total que marcó tu facturador (opcional)
          </span>
          <input
            value={totalFacturador}
            onChange={(e) => setTotalFacturador(e.target.value)}
            placeholder="Lo que dice la boleta del día"
            inputMode="numeric"
            style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17 }}
          />
        </label>
      </div>

      {error ? <p style={{ color: semantico.error, fontSize: 14 }} role="alert">{error}</p> : null}

      {resultado ? (
        <div style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 14, padding: 16 }}>
          {resultado.filas.filter((f) => f.esperado > 0 || f.declarado > 0).map((f) => (
            <div key={f.medioPago} style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "3px 0" }}>
              {/* La clave interna ("mercadopago") no es lo que el vendedor reconoce —
                  arriba en la misma pantalla ya se traduce a la etiqueta. */}
              <span>{medios.find((m) => m.medio_pago === f.medioPago)?.etiqueta ?? f.medioPago}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: f.diferencia === 0 ? semantico.ok : semantico.alerta }}>
                {f.diferencia === 0 ? "cuadra" : `${f.diferencia > 0 ? "+" : ""}${formatearClp(f.diferencia)}`}
              </span>
            </div>
          ))}
          {resultado.difFacturador != null ? (
            <p style={{ marginTop: 10, fontSize: 14, color: resultado.difFacturador === 0 ? semantico.ok : semantico.alerta }}>
              {resultado.difFacturador === 0
                ? "Tu facturador marca lo mismo que KiloPan."
                : `Tu facturador marca ${formatearClp(Math.abs(resultado.difFacturador))} ${resultado.difFacturador > 0 ? "más" : "menos"} que KiloPan.`}
            </p>
          ) : null}
          {sePuedeCompartir() ? (
            <button type="button" onClick={compartirResumen} style={{ marginTop: 12, minHeight: 44, padding: "0 16px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14 }}>
              Compartir resumen
            </button>
          ) : null}
        </div>
      ) : cargando || errorCarga || medios.length === 0 ? null : (
        <BotonPrimario onClick={cerrar} disabled={enviando}>
          {enviando ? "Cerrando…" : "Cerrar caja"}
        </BotonPrimario>
      )}
    </main>
  );
}
