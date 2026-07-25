"use client";
import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, CifraGrande } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { formatearClp, formatearFecha } from "@/comun/formato.ts";

interface Cliente { id: string; razon_social: string; saldo_pendiente_clp: number | null }
interface Guia {
  id: string;
  folio_sii: string;
  fecha_emision: string;
  monto_total: number;
  correlativo_pedido: string | null;
}

// AC-FIA-02 (decisión #2): consolidar las guías entregadas de un cliente en UNA
// factura. El borde legal no se toca: cada despacho salió con su propia guía; esto
// solo agrupa después para cobrar, que es como opera el fiado del canal mayorista.
export default function FacturarPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [guias, setGuias] = useState<Guia[]>([]);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [folio, setFolio] = useState("");
  const [rutEmisor, setRutEmisor] = useState("76.192.083-9");
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then((d) => setClientes(d.clientes ?? []));
  }, []);

  const cargarGuias = useCallback(async (id: string) => {
    if (!id) { setGuias([]); return; }
    const d = await (await fetch(`/api/facturar?clienteId=${id}`)).json();
    setGuias(d.guias ?? []);
    setElegidas(new Set((d.guias ?? []).map((g: Guia) => g.id)));
  }, []);

  useEffect(() => { void cargarGuias(clienteId); }, [clienteId, cargarGuias]);

  const total = guias.filter((g) => elegidas.has(g.id)).reduce((s, g) => s + Number(g.monto_total), 0);

  function alternar(id: string) {
    const nuevo = new Set(elegidas);
    if (nuevo.has(id)) nuevo.delete(id); else nuevo.add(id);
    setElegidas(nuevo);
  }

  async function consolidar() {
    setMensaje(null);
    const r = await fetch("/api/facturar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guiaIds: [...elegidas], folioSii: Number(folio), rutEmisor }),
    });
    const cuerpo = await r.json();
    if (!r.ok) { setMensaje({ tipo: "error", texto: cuerpo.error }); return; }
    setMensaje({
      tipo: "ok",
      texto: `Factura ${folio} registrada: ${cuerpo.guiasConsolidadas} guía(s) por ${formatearClp(cuerpo.montoTotal)}`,
    });
    setFolio("");
    void cargarGuias(clienteId);
    fetch("/api/clientes").then((r) => r.json()).then((d) => setClientes(d.clientes ?? []));
  }

  const cliente = clientes.find((c) => c.id === clienteId);

  return (
    <main style={{ maxWidth: 620, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Consolidar y facturar</h1>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: superficie.textoDim }}>
          Cada despacho ya salió con su guía. Aquí las agrupas en una factura para cobrar.
        </p>
      </div>

      <select
        value={clienteId}
        onChange={(e) => setClienteId(e.target.value)}
        style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17, background: "#fff" }}
      >
        <option value="">Elige un cliente…</option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.razon_social}
            {c.saldo_pendiente_clp ? ` — debe ${formatearClp(Number(c.saldo_pendiente_clp))}` : ""}
          </option>
        ))}
      </select>

      {cliente ? (
        <div style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 14, padding: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: superficie.textoFaint }}>Saldo pendiente de {cliente.razon_social}</p>
          <p style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {formatearClp(Number(cliente.saldo_pendiente_clp ?? 0))}
          </p>
        </div>
      ) : null}

      {guias.length > 0 ? (
        <>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: superficie.textoDim }}>
            Guías entregadas sin facturar
          </p>
          {guias.map((g) => (
            <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 12, padding: "8px 14px" }}>
              <input type="checkbox" checked={elegidas.has(g.id)} onChange={() => alternar(g.id)} style={{ width: 22, height: 22 }} />
              <span style={{ flex: 1, fontSize: 15 }}>
                Guía {g.folio_sii} · pedido N° {g.correlativo_pedido ?? "—"} · {formatearFecha(new Date(g.fecha_emision))}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{formatearClp(Number(g.monto_total))}</span>
            </label>
          ))}

          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
            <CifraGrande valor={total.toLocaleString("es-CL")} unidad="CLP" />
          </div>

          <input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Folio de la factura que emitiste" inputMode="numeric"
            style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17 }} />
          <input value={rutEmisor} onChange={(e) => setRutEmisor(e.target.value)} placeholder="RUT emisor"
            style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17 }} />

          <BotonPrimario disabled={elegidas.size === 0 || !folio} onClick={consolidar}>
            Registrar factura por {formatearClp(total)}
          </BotonPrimario>
        </>
      ) : clienteId ? (
        <p style={{ color: superficie.textoFaint, fontSize: 14 }}>Este cliente no tiene guías pendientes de facturar.</p>
      ) : null}

      {mensaje ? (
        <p role="status" style={{ color: mensaje.tipo === "ok" ? semantico.ok : semantico.error, fontSize: 14 }}>
          {mensaje.texto}
        </p>
      ) : null}
    </main>
  );
}
