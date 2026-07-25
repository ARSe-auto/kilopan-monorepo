"use client";
import { useEffect, useState } from "react";
import { CifraGrande, TecladoNumerico, BotonPrimario, SelectorUnToque } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { formatearClp, formatearKg } from "@/comun/formato.ts";

interface Producto {
  id: string;
  nombre: string;
  tipo_venta: string;
  precio_mostrador_clp: number | null;
  stock_disponible_g: number;
}
interface MedioPago {
  clave: string;
  etiqueta: string;
}
interface ClienteFiado {
  id: string;
  razon_social: string;
  saldo_pendiente_clp: number | null;
}
interface LineaCarrito {
  productoId: string;
  nombre: string;
  gramos: number;
  precioClp: number;
}

// F6 Venta mostrador — contra el stock ya pesado (PROMPT_MAESTRO.md §5).
export default function VenderPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [mediosPago, setMediosPago] = useState<MedioPago[]>([]);
  const [productoId, setProductoId] = useState<string | null>(null);
  const [gramos, setGramos] = useState("");
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [medioPago, setMedioPago] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [clientes, setClientes] = useState<ClienteFiado[]>([]);
  const [clienteFiado, setClienteFiado] = useState("");

  useEffect(() => {
    fetch("/api/productos")
      .then((r) => r.json())
      .then((d) => setProductos(d.productos ?? []));
    fetch("/api/medios-pago")
      .then((r) => r.json())
      .then((d) => setMediosPago(d.mediosPago ?? []));
    fetch("/api/clientes")
      .then((r) => r.json())
      .then((d) => setClientes(d.clientes ?? []));
  }, []);

  const producto = productos.find((p) => p.id === productoId) ?? null;
  const gramosNum = Number(gramos || "0");
  const precioLinea =
    producto?.precio_mostrador_clp != null ? Math.round((producto.precio_mostrador_clp * gramosNum) / 1000) : 0;
  const totalCarrito = carrito.reduce((s, l) => s + l.precioClp, 0);

  function agregarAlCarrito() {
    if (!producto || gramosNum < 1) return;
    setCarrito((c) => [
      ...c,
      { productoId: producto.id, nombre: producto.nombre, gramos: gramosNum, precioClp: precioLinea },
    ]);
    setProductoId(null);
    setGramos("");
  }

  async function cobrar() {
    if (!medioPago || carrito.length === 0) return;
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          medioPago,
          clienteId: medioPago === "fiado" ? clienteFiado : undefined,
          lineas: carrito.map((l) => ({ productoId: l.productoId, gramos: l.gramos, precioClp: l.precioClp })),
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) {
        setMensaje({ tipo: "error", texto: cuerpo.error ?? "No se pudo cobrar" });
        setEnviando(false);
        return;
      }
      setMensaje({ tipo: "ok", texto: `Venta cobrada: ${formatearClp(cuerpo.totalClp)}` });
      setCarrito([]);
      setMedioPago(null);
      setClienteFiado("");
      fetch("/api/productos")
        .then((r) => r.json())
        .then((d) => setProductos(d.productos ?? []));
    } catch {
      setMensaje({ tipo: "error", texto: "Sin conexión con el servidor" });
    } finally {
      setEnviando(false);
    }
  }

  if (producto) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{producto.nombre}</h1>
          <button type="button" onClick={() => setProductoId(null)} style={{ fontSize: 14, fontWeight: 700, color: superficie.textoDim, background: "none", border: "none" }}>
            Cambiar
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: superficie.textoFaint }}>
          Disponible: {formatearKg(producto.stock_disponible_g)}
        </p>
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
          <CifraGrande valor={gramos || "0"} unidad="g" />
        </div>
        <p style={{ textAlign: "center", margin: 0, fontSize: 17, fontWeight: 700 }}>{formatearClp(precioLinea)}</p>
        <TecladoNumerico valor={gramos} onCambiar={setGramos} />
        <BotonPrimario disabled={gramosNum < 1 || gramosNum > producto.stock_disponible_g} onClick={agregarAlCarrito}>
          Agregar
        </BotonPrimario>
        {gramosNum > producto.stock_disponible_g ? (
          <p style={{ color: semantico.error, fontSize: 13 }}>No hay ese stock disponible.</p>
        ) : null}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Vender</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {productos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setProductoId(p.id)}
            disabled={p.stock_disponible_g <= 0}
            style={{
              minHeight: 72,
              borderRadius: 12,
              border: `1px solid ${superficie.hairline}`,
              background: superficie.tarjeta,
              opacity: p.stock_disponible_g <= 0 ? 0.4 : 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 700, color: superficie.texto }}>{p.nombre}</span>
            <span style={{ fontSize: 12, color: superficie.textoFaint }}>{formatearKg(p.stock_disponible_g)}</span>
          </button>
        ))}
      </div>

      {carrito.length > 0 ? (
        <div style={{ borderTop: `1px solid ${superficie.hairline}`, paddingTop: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: superficie.textoDim, margin: "0 0 8px" }}>Carrito</p>
          {carrito.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "4px 0" }}>
              <span>
                {l.nombre} · {formatearKg(l.gramos)}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatearClp(l.precioClp)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, fontWeight: 700, paddingTop: 8 }}>
            <span>Total</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatearClp(totalCarrito)}</span>
          </div>

          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim, margin: "0 0 8px" }}>Medio de pago</p>
            <SelectorUnToque
              opciones={mediosPago.map((m) => ({ valor: m.clave, etiqueta: m.etiqueta }))}
              valor={medioPago}
              onCambiar={setMedioPago}
            />
          </div>

          {/* AC-PAG-02: fiar en el mesón usa el MISMO cliente y el mismo saldo que el
              fiado del reparto — no hay un segundo sistema de crédito. */}
          {medioPago === "fiado" ? (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim, margin: "0 0 8px" }}>
                ¿A quién se le anota?
              </p>
              <select
                value={clienteFiado}
                onChange={(e) => setClienteFiado(e.target.value)}
                style={{ width: "100%", minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17, background: "#fff" }}
              >
                <option value="">Elegí un cliente registrado…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razon_social}
                    {c.saldo_pendiente_clp ? ` — debe ${formatearClp(Number(c.saldo_pendiente_clp))}` : ""}
                  </option>
                ))}
              </select>
              {clientes.length === 0 ? (
                <p style={{ fontSize: 13, color: semantico.alerta, marginTop: 6 }}>
                  No hay clientes registrados todavía. Dalos de alta en Despacho.
                </p>
              ) : null}
            </div>
          ) : null}

          {mensaje ? (
            <p role="status" style={{ color: mensaje.tipo === "ok" ? semantico.ok : semantico.error, fontSize: 14 }}>
              {mensaje.texto}
            </p>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <BotonPrimario
              disabled={!medioPago || enviando || (medioPago === "fiado" && !clienteFiado)}
              onClick={cobrar}
            >
              {enviando ? "Cobrando…" : medioPago === "fiado" ? "Anotar en la cuenta" : `Cobrar ${formatearClp(totalCarrito)}`}
            </BotonPrimario>
          </div>
        </div>
      ) : mensaje ? (
        <p role="status" style={{ color: mensaje.tipo === "ok" ? semantico.ok : semantico.error, fontSize: 14 }}>
          {mensaje.texto}
        </p>
      ) : null}
    </main>
  );
}
