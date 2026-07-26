"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BotonPrimario } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";
import { formatearClp, parsearClp } from "@/comun/formato.ts";
import { kgTextoAGramos, pesoValido } from "@/comun/peso.ts";
import { validaRut } from "@/comun/valida_rut.ts";
import { VolverInicio } from "../VolverInicio.tsx";

interface Pedido {
  id: string;
  correlativo_pedido: string | null;
  estado: string;
  fecha_entrega: string;
  total_clp: number;
  razon_social: string;
  direccion: string | null;
  dte_count: number;
}
interface Cliente { id: string; razon_social: string; canal: string }
interface Producto { id: string; nombre: string }
interface Repartidor { id: string; nombre: string }

// F2 Armar pedido + armar ruta + registrar DTE (PROMPT_MAESTRO.md §5). El bloqueo del
// art. 55 DL 825 se ve acá en pantalla: los pedidos sin DTE salen en rojo y «Salir a
// ruta» rebota mientras quede uno.
export default function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const [clienteId, setClienteId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [kilos, setKilos] = useState("");

  // Hallazgo menor de la auditoría: "Armar ruta y salir" tomaba SIEMPRE repartidores[0]
  // y una patente inventada ("ABCD-12") — un residuo de desarrollo que llegó a
  // producción. Con dos o más repartidores dados de alta, toda ruta quedaba atribuida
  // al primero de la lista sin que nadie lo eligiera.
  const [repartidorId, setRepartidorId] = useState("");
  const [vehiculo, setVehiculo] = useState("");

  // AC-DES (Tanda 5 de la auditoría): bloqueador raíz. No existía NINGUNA pantalla que
  // llamara a POST /api/clientes — sin clientes no hay pedidos, ni reparto, ni fiado,
  // ni facturación.
  const [nuevoClienteAbierto, setNuevoClienteAbierto] = useState(false);
  const [nuevoRut, setNuevoRut] = useState("");
  const [nuevoRazonSocial, setNuevoRazonSocial] = useState("");
  const [nuevoCanal, setNuevoCanal] = useState<"reparto" | "mostrador">("reparto");
  const [nuevoDireccion, setNuevoDireccion] = useState("");
  const [nuevoContactoNombre, setNuevoContactoNombre] = useState("");
  const [nuevoContactoFono, setNuevoContactoFono] = useState("");
  const [creandoCliente, setCreandoCliente] = useState(false);

  const [dtePedidoId, setDtePedidoId] = useState<string | null>(null);
  // Hallazgo menor de la auditoría: el panel "Registrar documento" aparece DESPUÉS de
  // la lista de pedidos — con la lista larga, tocar "Asociar guía o factura" en un
  // pedido de más abajo abría el panel fuera de la vista, sin ninguna señal de que
  // pasó algo.
  const panelDteRef = useRef<HTMLElement | null>(null);
  const [dteTipo, setDteTipo] = useState("52");
  const [dteFolio, setDteFolio] = useState("");
  const [dteRut, setDteRut] = useState("76.192.083-9");
  const [dteMonto, setDteMonto] = useState("");

  // Doble toque con las manos ocupadas: ninguno de los tres botones de abajo se
  // deshabilitaba mientras su petición estaba en vuelo. Para "Armar ruta y salir" es
  // el más caro de los tres —son dos POST/PATCH seguidos— así que además el servidor
  // (api/rutas) ahora es idempotente por su cuenta; esto es la primera línea de
  // defensa, no la única.
  const [creandoPedido, setCreandoPedido] = useState(false);
  const [registrandoDte, setRegistrandoDte] = useState(false);
  const [armandoRuta, setArmandoRuta] = useState(false);

  const cargar = useCallback(async () => {
    const [p, c, pr, u] = await Promise.all([
      fetch("/api/pedidos").then((r) => r.json()),
      fetch("/api/clientes").then((r) => r.json()),
      fetch("/api/productos").then((r) => r.json()),
      fetch("/api/usuarios?rol=repartidor").then((r) => r.json()),
    ]);
    setPedidos(p.pedidos ?? []);
    setClientes((c.clientes ?? []).filter((x: Cliente) => x.canal === "reparto"));
    setProductos(pr.productos ?? []);
    setRepartidores(u.usuarios ?? []);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function crearPedido() {
    if (creandoPedido) return;
    // Antes acá vivía `Math.round(Number(kilos)*1000)`, una segunda conversión de
    // kilos a gramos distinta de la del pesaje. Math.round tapaba el error del
    // flotante por casualidad, pero dos implementaciones de la misma regla terminan
    // divergiendo. Ahora las dos pantallas usan comun/peso.ts, que está probado.
    let gramos = 0;
    try {
      gramos = kgTextoAGramos(kilos);
    } catch {
      setMensaje({ tipo: "error", texto: "Ese peso no es válido" });
      return;
    }
    if (!clienteId || !productoId || !pesoValido(gramos)) {
      setMensaje({ tipo: "error", texto: "Elige cliente, producto y kilos" });
      return;
    }
    setCreandoPedido(true);
    try {
      const r = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId,
          fechaEntrega: new Date().toISOString().slice(0, 10),
          lineas: [{ productoId, gramosPedidos: gramos }],
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setMensaje({ tipo: "error", texto: cuerpo.error }); return; }
      setMensaje({ tipo: "ok", texto: `Pedido N° ${cuerpo.correlativo} · ${formatearClp(cuerpo.totalClp)}` });
      setKilos("");
      await cargar();
    } catch {
      setMensaje({ tipo: "error", texto: "Sin conexión con el servidor" });
    } finally {
      setCreandoPedido(false);
    }
  }

  async function crearCliente() {
    if (!nuevoRazonSocial.trim()) {
      setMensaje({ tipo: "error", texto: "Falta la razón social del cliente" });
      return;
    }
    if (!validaRut(nuevoRut)) {
      setMensaje({ tipo: "error", texto: "RUT inválido" });
      return;
    }
    setCreandoCliente(true);
    try {
      const r = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rut: nuevoRut,
          razonSocial: nuevoRazonSocial,
          canal: nuevoCanal,
          direccion: nuevoDireccion || undefined,
          contactoNombre: nuevoContactoNombre || undefined,
          contactoFono: nuevoContactoFono || undefined,
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) {
        setMensaje({ tipo: "error", texto: cuerpo.error });
        return;
      }
      setMensaje({ tipo: "ok", texto: `Cliente «${nuevoRazonSocial}» dado de alta` });
      setNuevoRut("");
      setNuevoRazonSocial("");
      setNuevoDireccion("");
      setNuevoContactoNombre("");
      setNuevoContactoFono("");
      setNuevoClienteAbierto(false);
      await cargar();
      if (nuevoCanal === "reparto") setClienteId(cuerpo.id);
    } catch {
      setMensaje({ tipo: "error", texto: "Sin conexión con el servidor" });
    } finally {
      setCreandoCliente(false);
    }
  }

  async function registrarDte() {
    if (!dtePedidoId || registrandoDte) return;
    setRegistrandoDte(true);
    try {
      const r = await fetch("/api/dte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoDte: Number(dteTipo),
          // parsearClp() y no Number(): mismo bug que ya se corrigió en facturar/page.tsx
          // y en el monto de más abajo — un folio SII tecleado con el punto de miles
          // chileno ("1.234.567") daba Number.isInteger(1.234567) = false en el
          // servidor, y el panadero veía "folio inválido" por un folio que escribió bien.
          folioSii: parsearClp(dteFolio),
          rutEmisor: dteRut,
          montoTotal: parsearClp(dteMonto || "0"),
          pedidoId: dtePedidoId,
          origenCaptura: "manual",
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setMensaje({ tipo: "error", texto: cuerpo.error }); return; }
      setMensaje({ tipo: "ok", texto: `Documento ${dteTipo} folio ${dteFolio} registrado` });
      setDtePedidoId(null);
      setDteFolio("");
      setDteMonto("");
      await cargar();
    } catch {
      setMensaje({ tipo: "error", texto: "Sin conexión con el servidor" });
    } finally {
      setRegistrandoDte(false);
    }
  }

  async function armarYSalir() {
    if (armandoRuta) return;
    if (!repartidorId) { setMensaje({ tipo: "error", texto: "Elige quién sale a repartir" }); return; }
    if (!vehiculo.trim()) { setMensaje({ tipo: "error", texto: "Escribe la patente del vehículo" }); return; }
    const paraRuta = pedidos.filter((p) => p.estado === "confirmado");
    if (paraRuta.length === 0) { setMensaje({ tipo: "error", texto: "No hay pedidos confirmados" }); return; }

    setArmandoRuta(true);
    try {
      const ruta = await fetch("/api/rutas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repartidorId, vehiculo: vehiculo.trim(), pedidoIds: paraRuta.map((p) => p.id) }),
      });
      const rutaCuerpo = await ruta.json();
      if (!ruta.ok) { setMensaje({ tipo: "error", texto: rutaCuerpo.error }); return; }

      const salir = await fetch("/api/rutas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rutaId: rutaCuerpo.id, estado: "en_curso", kmInicio: 0 }),
      });
      const salirCuerpo = await salir.json();
      if (!salir.ok) {
        setMensaje({ tipo: "error", texto: salirCuerpo.error });
        return;
      }
      setMensaje({ tipo: "ok", texto: `Ruta en curso con ${rutaCuerpo.paradas} parada(s)` });
      await cargar();
    } catch {
      setMensaje({ tipo: "error", texto: "Sin conexión con el servidor" });
    } finally {
      setArmandoRuta(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Despacho</h1>
        <VolverInicio />
      </div>

      {mensaje ? (
        <p role="status" style={{ color: mensaje.tipo === "ok" ? semantico.ok : semantico.error, fontSize: 14, margin: 0 }}>
          {mensaje.texto}
        </p>
      ) : null}

      <section style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Nuevo pedido</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ ...campo, flex: 1 }}>
            <option value="">Cliente…</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setNuevoClienteAbierto((v) => !v)}
            style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}
          >
            + Nuevo cliente
          </button>
        </div>
        {clientes.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: semantico.alerta }}>
            No hay clientes de reparto todavía — dar de alta uno es el primer paso.
          </p>
        ) : null}

        {nuevoClienteAbierto ? (
          <div style={{ border: `2px solid ${acentos.kilopan}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Nuevo cliente</p>
            <input value={nuevoRazonSocial} onChange={(e) => setNuevoRazonSocial(e.target.value)} placeholder="Razón social" style={campo} />
            <input value={nuevoRut} onChange={(e) => setNuevoRut(e.target.value)} placeholder="RUT (ej: 12.345.678-5)" style={campo} />
            <div style={{ display: "flex", gap: 8 }}>
              {(["reparto", "mostrador"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNuevoCanal(c)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 10,
                    border: nuevoCanal === c ? `2px solid ${acentos.kilopan}` : `1px solid ${superficie.hairline}`,
                    background: nuevoCanal === c ? "#FEF3E2" : "#fff",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {c === "reparto" ? "Reparto" : "Mostrador"}
                </button>
              ))}
            </div>
            {nuevoCanal === "reparto" ? (
              <input value={nuevoDireccion} onChange={(e) => setNuevoDireccion(e.target.value)} placeholder="Dirección de entrega" style={campo} />
            ) : null}
            <input value={nuevoContactoNombre} onChange={(e) => setNuevoContactoNombre(e.target.value)} placeholder="Contacto (opcional)" style={campo} />
            <input value={nuevoContactoFono} onChange={(e) => setNuevoContactoFono(e.target.value)} placeholder="Teléfono (opcional)" style={campo} inputMode="tel" />
            <BotonPrimario disabled={creandoCliente} onClick={crearCliente}>
              {creandoCliente ? "Guardando…" : "Guardar cliente"}
            </BotonPrimario>
          </div>
        ) : null}

        <select value={productoId} onChange={(e) => setProductoId(e.target.value)} style={campo}>
          <option value="">Producto…</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <input value={kilos} onChange={(e) => setKilos(e.target.value)} placeholder="Kilos (ej: 12)" style={campo} inputMode="decimal" />
        <BotonPrimario onClick={crearPedido} disabled={creandoPedido}>
          {creandoPedido ? "Confirmando…" : "Confirmar pedido"}
        </BotonPrimario>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Pedidos de hoy</h2>
        {pedidos.length === 0 ? <p style={{ color: superficie.textoFaint, fontSize: 14 }}>Sin pedidos todavía.</p> : null}
        {pedidos.map((p) => (
          <div key={p.id} style={{ background: superficie.tarjeta, border: `1px solid ${p.dte_count === 0 ? semantico.error : superficie.hairline}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontWeight: 700 }}>
                N° {p.correlativo_pedido ?? "—"} · {p.razon_social}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatearClp(p.total_clp)}</span>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: p.dte_count === 0 ? semantico.error : semantico.ok }}>
              {p.dte_count === 0
                ? "⚠ Sin documento asociado — este pedido bloquea la salida a ruta (art. 55 DL 825)"
                : `✓ ${p.dte_count} documento(s) registrado(s)`}
            </p>
            {p.dte_count === 0 ? (
              <button
                type="button"
                onClick={() => {
                  setDtePedidoId(p.id);
                  requestAnimationFrame(() => panelDteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
                }}
                style={{ marginTop: 8, minHeight: 44, padding: "0 14px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14 }}
              >
                Asociar guía o factura
              </button>
            ) : null}
          </div>
        ))}
      </section>

      {dtePedidoId ? (
        <section ref={panelDteRef} style={{ background: superficie.tarjeta, border: `2px solid ${acentos.kilopan}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Registrar documento del SII</h2>
          <p style={{ margin: 0, fontSize: 13, color: superficie.textoDim }}>
            KiloPan no emite documentos: registra el folio de uno que el SII ya emitió.
          </p>
          <select value={dteTipo} onChange={(e) => setDteTipo(e.target.value)} style={campo}>
            <option value="52">Guía de despacho (52)</option>
            <option value="33">Factura electrónica (33)</option>
            <option value="39">Boleta electrónica (39)</option>
            <option value="61">Nota de crédito (61)</option>
          </select>
          <input value={dteFolio} onChange={(e) => setDteFolio(e.target.value)} placeholder="Folio" style={campo} inputMode="numeric" />
          <input value={dteRut} onChange={(e) => setDteRut(e.target.value)} placeholder="RUT emisor" style={campo} />
          <input value={dteMonto} onChange={(e) => setDteMonto(e.target.value)} placeholder="Monto total" style={campo} inputMode="numeric" />
          <BotonPrimario onClick={registrarDte} disabled={registrandoDte}>
            {registrandoDte ? "Registrando…" : "Registrar documento"}
          </BotonPrimario>
        </section>
      ) : null}

      <section style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Armar ruta y salir</h2>
        <select value={repartidorId} onChange={(e) => setRepartidorId(e.target.value)} style={campo}>
          <option value="">¿Quién reparte?</option>
          {repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        <input value={vehiculo} onChange={(e) => setVehiculo(e.target.value)} placeholder="Patente (ej: ABCD-12)" style={campo} />
        <BotonPrimario onClick={armarYSalir} disabled={armandoRuta}>
          {armandoRuta ? "Armando ruta…" : "Armar ruta y salir"}
        </BotonPrimario>
      </section>
    </main>
  );
}

const campo: React.CSSProperties = {
  minHeight: 44,
  borderRadius: 12,
  border: `1px solid ${superficie.hairline}`,
  padding: "0 14px",
  fontSize: 17,
  background: "#fff",
};
