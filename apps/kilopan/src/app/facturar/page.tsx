"use client";
import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, CifraGrande } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { formatearClp, formatearFecha, parsearClp } from "@/comun/formato.ts";
import { VolverInicio } from "../VolverInicio.tsx";

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
  const [consolidando, setConsolidando] = useState(false);
  const [cargandoGuias, setCargandoGuias] = useState(false);
  const [errorGuias, setErrorGuias] = useState(false);

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then((d) => setClientes(d.clientes ?? []));
  }, []);

  // Sin distinguir error de vacío, un fetch caído (sin red, sesión vencida) pintaba
  // "Este cliente no tiene guías pendientes de facturar" — el dueño concluía que no
  // había fiado mayorista que cobrar y dejaba la plata sin facturar (auditoría de
  // experiencia, ALTA).
  const cargarGuias = useCallback(async (id: string) => {
    if (!id) { setGuias([]); setErrorGuias(false); return; }
    setCargandoGuias(true);
    setErrorGuias(false);
    try {
      const r = await fetch(`/api/facturar?clienteId=${id}`);
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setGuias(d.guias ?? []);
      setElegidas(new Set((d.guias ?? []).map((g: Guia) => g.id)));
    } catch {
      setGuias([]);
      setErrorGuias(true);
    } finally {
      setCargandoGuias(false);
    }
  }, []);

  useEffect(() => { void cargarGuias(clienteId); }, [clienteId, cargarGuias]);

  const total = guias.filter((g) => elegidas.has(g.id)).reduce((s, g) => s + Number(g.monto_total), 0);

  function alternar(id: string) {
    const nuevo = new Set(elegidas);
    if (nuevo.has(id)) nuevo.delete(id); else nuevo.add(id);
    setElegidas(nuevo);
  }

  async function consolidar() {
    if (consolidando) return; // doble toque no debe consolidar la misma guía dos veces
    setMensaje(null);
    setConsolidando(true);
    try {
      const r = await fetch("/api/facturar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // parsearClp() y no Number(): un folio grande tecleado con el punto de miles
        // chileno ("123.456") daba Number.isInteger(123.456) = false y el servidor
        // respondía "Faltan campos" como si el folio nunca hubiera llegado.
        body: JSON.stringify({ guiaIds: [...elegidas], folioSii: parsearClp(folio), rutEmisor }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setMensaje({ tipo: "error", texto: cuerpo.error }); return; }
      setMensaje({
        tipo: "ok",
        texto: `Factura ${folio} registrada: ${cuerpo.guiasConsolidadas} guía(s) por ${formatearClp(cuerpo.montoTotal)}`,
      });
      setFolio("");
      await cargarGuias(clienteId);
      await fetch("/api/clientes").then((r) => r.json()).then((d) => setClientes(d.clientes ?? []));
    } catch {
      setMensaje({ tipo: "error", texto: "Sin conexión con el servidor" });
    } finally {
      setConsolidando(false);
    }
  }

  const cliente = clientes.find((c) => c.id === clienteId);

  return (
    <main style={{ maxWidth: 620, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Consolidar y facturar</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: superficie.textoDim }}>
            Cada despacho ya salió con su guía. Aquí las agrupas en una factura para cobrar.
          </p>
        </div>
        <VolverInicio />
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

      {clienteId && cargandoGuias ? (
        <p style={{ color: superficie.textoDim, fontSize: 14 }}>Buscando guías…</p>
      ) : null}
      {clienteId && errorGuias ? (
        <p style={{ color: semantico.error, fontSize: 14 }} role="alert">
          No se pudieron consultar las guías de este cliente. Revisa la conexión e
          inténtalo de nuevo — puede haber fiado sin cobrar.
        </p>
      ) : null}

      {guias.length > 0 ? (
        <>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: superficie.textoDim }}>
            Guías entregadas sin facturar
          </p>
          {guias.map((g) => (
            <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 12, padding: "8px 14px" }}>
              {/* El input en sí mide 22×22 — bajo el mínimo táctil de 44×44 — pero el
                  <label> completo (arriba) ya cubre toda la fila con minHeight: 44 y
                  la alterna al tocar cualquier parte, así que el blanco real ya es
                  correcto; esto solo agranda el glifo visible para no obligar a
                  apuntar con precisión con las manos enharinadas. */}
              <input
                type="checkbox"
                checked={elegidas.has(g.id)}
                onChange={() => alternar(g.id)}
                style={{ width: 26, height: 26, flexShrink: 0 }}
              />
              <span style={{ flex: 1, fontSize: 15 }}>
                Guía {g.folio_sii} · pedido N° {g.correlativo_pedido ?? "—"} · {formatearFecha(new Date(g.fecha_emision))}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{formatearClp(Number(g.monto_total))}</span>
            </label>
          ))}

          {/* Antes esto usaba total.toLocaleString("es-CL") + unidad="CLP" — un formato
              CLP distinto al de formatearClp() de acá abajo, en la misma pantalla.
              Con varias guías seleccionadas el total (96 px, CifraGrande) se salía del
              viewport sin que hubiera scroll para alcanzarlo — overflow-x lo deja
              alcanzable en vez de cortado. */}
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0", maxWidth: "100%", overflowX: "auto" }}>
            <CifraGrande valor={formatearClp(total)} />
          </div>

          <input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Folio de la factura que emitiste" inputMode="numeric"
            style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17 }} />
          <input value={rutEmisor} onChange={(e) => setRutEmisor(e.target.value)} placeholder="RUT emisor"
            style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17 }} />

          <BotonPrimario disabled={elegidas.size === 0 || !folio || consolidando} onClick={consolidar}>
            {consolidando ? "Registrando…" : `Registrar factura por ${formatearClp(total)}`}
          </BotonPrimario>
        </>
      ) : clienteId && !cargandoGuias && !errorGuias ? (
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
