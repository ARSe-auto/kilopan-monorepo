"use client";
import { useEffect, useState } from "react";
import { BotonPrimario, SelectorUnToque } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";
import { formatearClp, parsearClp } from "@/comun/formato.ts";
import { validaRut } from "@/comun/valida_rut.ts";
import { VolverInicio } from "../VolverInicio.tsx";

interface Parametro { clave: string; valor: number; descripcion: string }
interface Usuario { id: string; nombre: string; rut: string; rol: string; activo: boolean }
interface ProductoAdmin {
  id: string;
  nombre: string;
  tipo_venta: string;
  activo: boolean;
  precio_mostrador_clp: number | null;
  precio_mayorista_clp: number | null;
}
interface MedioPagoAdmin { clave: string; etiqueta: string; activo: boolean }

const ROLES = [
  { valor: "admin", etiqueta: "Admin" },
  { valor: "maestro", etiqueta: "Maestro" },
  { valor: "vendedor", etiqueta: "Vendedor" },
  { valor: "repartidor", etiqueta: "Repartidor" },
] as const;

const PIN_VALIDO = /^\d{4}$/;

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Ajustes</h1>
        <VolverInicio />
      </div>

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

      <SeccionPersonal />
      <SeccionCatalogo />
      <SeccionMediosPago />
    </main>
  );
}

// AC-ADM-01: dar de alta, desactivar, cambiar de rol o resetear el PIN de una
// persona. Nunca se borra a nadie — pesajes/ventas/entregas ya pasadas referencian
// usuario_id por FK; "desactivar" es lo único reversible y correcto acá.
function SeccionPersonal() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [rut, setRut] = useState("");
  const [rol, setRol] = useState<(typeof ROLES)[number]["valor"]>("vendedor");
  const [pin, setPin] = useState("");
  const [creando, setCreando] = useState(false);

  const [reseteandoId, setReseteandoId] = useState<string | null>(null);
  const [pinReset, setPinReset] = useState("");
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    setErrorCarga(false);
    try {
      const r = await fetch("/api/usuarios?detalle=1");
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setUsuarios(d.usuarios ?? []);
    } catch {
      setErrorCarga(true);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { void cargar(); }, []);

  async function crear() {
    if (creando) return;
    setMensaje(null); setError(null);
    if (!nombre.trim()) { setError("Falta el nombre"); return; }
    if (!validaRut(rut)) { setError("RUT inválido"); return; }
    if (!PIN_VALIDO.test(pin)) { setError("El PIN debe ser de 4 dígitos"); return; }
    setCreando(true);
    try {
      const r = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, rut, rol, pin }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setError(cuerpo.error); return; }
      setMensaje(`«${nombre}» dado de alta`);
      setNombre(""); setRut(""); setPin(""); setRol("vendedor"); setAbierto(false);
      await cargar();
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      setCreando(false);
    }
  }

  async function patch(id: string, cuerpo: Record<string, unknown>) {
    setGuardandoId(id);
    setMensaje(null); setError(null);
    try {
      const r = await fetch("/api/usuarios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...cuerpo }),
      });
      const cuerpoResp = await r.json();
      if (!r.ok) { setError(cuerpoResp.error); return; }
      setUsuarios((us) => us.map((u) => (u.id === id ? { ...u, ...cuerpoResp } : u)));
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      setGuardandoId(null);
    }
  }

  async function confirmarReset(id: string) {
    if (!PIN_VALIDO.test(pinReset)) { setError("El PIN debe ser de 4 dígitos"); return; }
    await patch(id, { pin: pinReset });
    setMensaje("PIN reseteado");
    setReseteandoId(null);
    setPinReset("");
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: `1px solid ${superficie.hairline}`, paddingTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Personal</h2>
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14 }}
        >
          {abierto ? "Cancelar" : "+ Nueva persona"}
        </button>
      </div>

      {abierto ? (
        <div style={{ border: `2px solid ${acentos.kilopan}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" style={campo} />
          <input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="RUT (ej: 12.345.678-5)" style={campo} />
          <SelectorUnToque opciones={ROLES as unknown as { valor: string; etiqueta: string }[]} valor={rol} onCambiar={(v) => setRol(v as typeof rol)} />
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="PIN inicial (4 dígitos)" style={campo} inputMode="numeric" />
          <BotonPrimario onClick={crear} disabled={creando}>{creando ? "Guardando…" : "Dar de alta"}</BotonPrimario>
        </div>
      ) : null}

      {cargando ? (
        <p style={{ color: superficie.textoDim, fontSize: 14 }}>Cargando…</p>
      ) : errorCarga ? (
        <p style={{ color: semantico.error, fontSize: 14 }} role="alert">No se pudo cargar el personal.</p>
      ) : (
        usuarios.map((u) => (
          <div key={u.id} style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 12, padding: 14, opacity: u.activo ? 1 : 0.55 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700 }}>{u.nombre}{u.activo ? "" : " (inactiva)"}</p>
                <p style={{ margin: 0, fontSize: 13, color: superficie.textoFaint }}>{u.rut}</p>
              </div>
              <button
                type="button"
                disabled={guardandoId === u.id}
                onClick={() => patch(u.id, { activo: !u.activo })}
                style={{ minHeight: 44, padding: "0 12px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 13 }}
              >
                {u.activo ? "Desactivar" : "Reactivar"}
              </button>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <select
                value={u.rol}
                disabled={guardandoId === u.id}
                onChange={(e) => patch(u.id, { rol: e.target.value })}
                style={{ minHeight: 44, borderRadius: 10, border: `1px solid ${superficie.hairline}`, padding: "0 10px", fontSize: 14 }}
              >
                {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
              </select>
              {reseteandoId === u.id ? (
                <>
                  <input
                    value={pinReset}
                    onChange={(e) => setPinReset(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="Nuevo PIN"
                    inputMode="numeric"
                    style={{ width: 100, minHeight: 44, borderRadius: 10, border: `1px solid ${superficie.hairline}`, padding: "0 10px", fontSize: 14 }}
                  />
                  <button type="button" onClick={() => confirmarReset(u.id)} style={{ minHeight: 44, padding: "0 12px", borderRadius: 10, border: "none", background: acentos.kilopan, color: "#fff", fontWeight: 700, fontSize: 13 }}>
                    Confirmar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => { setReseteandoId(u.id); setPinReset(""); }}
                  style={{ minHeight: 44, padding: "0 12px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 13 }}
                >
                  Resetear PIN
                </button>
              )}
            </div>
          </div>
        ))
      )}

      {mensaje ? <p style={{ color: semantico.ok, fontSize: 14 }} role="status">{mensaje}</p> : null}
      {error ? <p style={{ color: semantico.error, fontSize: 14 }} role="alert">{error}</p> : null}
    </section>
  );
}

// AC-ADM-02: dar de alta pan nuevo y editar precios — sin esto un producto nuevo (o
// una lista de precios que cambia) exigía SQL directo, un bloqueador real de producto.
function SeccionCatalogo() {
  const [productos, setProductos] = useState<ProductoAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [tipoVenta, setTipoVenta] = useState<"kilo" | "unidad">("kilo");
  const [precioMostrador, setPrecioMostrador] = useState("");
  const [precioMayorista, setPrecioMayorista] = useState("");
  const [creando, setCreando] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editMostrador, setEditMostrador] = useState("");
  const [editMayorista, setEditMayorista] = useState("");
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    setErrorCarga(false);
    try {
      const r = await fetch("/api/productos?detalle=1");
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setProductos(d.productos ?? []);
    } catch {
      setErrorCarga(true);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { void cargar(); }, []);

  async function crear() {
    if (creando) return;
    setMensaje(null); setError(null);
    if (!nombre.trim()) { setError("Falta el nombre del producto"); return; }
    const mostradorClp = parsearClp(precioMostrador || "0");
    if (!Number.isInteger(mostradorClp) || mostradorClp <= 0) { setError("Precio de mostrador inválido"); return; }
    const mayoristaClp = precioMayorista.trim() ? parsearClp(precioMayorista) : null;
    setCreando(true);
    try {
      const r = await fetch("/api/productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          tipoVenta,
          precioMostradorClp: mostradorClp,
          precioMayoristaClp: mayoristaClp,
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setError(cuerpo.error); return; }
      setMensaje(`«${nombre}» agregado al catálogo`);
      setNombre(""); setPrecioMostrador(""); setPrecioMayorista(""); setTipoVenta("kilo"); setAbierto(false);
      await cargar();
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      setCreando(false);
    }
  }

  async function toggleActivo(p: ProductoAdmin) {
    setGuardandoId(p.id);
    setMensaje(null); setError(null);
    try {
      const r = await fetch("/api/productos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, activo: !p.activo }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setError(cuerpo.error); return; }
      setProductos((ps) => ps.map((x) => (x.id === p.id ? { ...x, activo: cuerpo.activo } : x)));
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      setGuardandoId(null);
    }
  }

  async function guardarPrecio(id: string) {
    const mostradorClp = editMostrador.trim() ? parsearClp(editMostrador) : undefined;
    const mayoristaClp = editMayorista.trim() ? parsearClp(editMayorista) : undefined;
    if (mostradorClp !== undefined && (!Number.isInteger(mostradorClp) || mostradorClp <= 0)) {
      setError("Precio de mostrador inválido");
      return;
    }
    if (mayoristaClp !== undefined && (!Number.isInteger(mayoristaClp) || mayoristaClp <= 0)) {
      setError("Precio mayorista inválido");
      return;
    }
    setGuardandoId(id);
    setMensaje(null); setError(null);
    try {
      const r = await fetch("/api/productos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, precioMostradorClp: mostradorClp, precioMayoristaClp: mayoristaClp }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setError(cuerpo.error); return; }
      setMensaje("Precio actualizado");
      setEditandoId(null);
      await cargar();
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      setGuardandoId(null);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: `1px solid ${superficie.hairline}`, paddingTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Catálogo</h2>
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14 }}
        >
          {abierto ? "Cancelar" : "+ Nuevo producto"}
        </button>
      </div>

      {abierto ? (
        <div style={{ border: `2px solid ${acentos.kilopan}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej: Marraqueta)" style={campo} />
          <div style={{ display: "flex", gap: 8 }}>
            {(["kilo", "unidad"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipoVenta(t)}
                style={{
                  flex: 1, minHeight: 44, borderRadius: 10,
                  border: tipoVenta === t ? `2px solid ${acentos.kilopan}` : `1px solid ${superficie.hairline}`,
                  background: tipoVenta === t ? "#FEF3E2" : "#fff", fontWeight: 700, fontSize: 14,
                }}
              >
                {t === "kilo" ? "Por kilo" : "Por unidad"}
              </button>
            ))}
          </div>
          <input value={precioMostrador} onChange={(e) => setPrecioMostrador(e.target.value)} placeholder="Precio mostrador (CLP)" style={campo} inputMode="numeric" />
          <input value={precioMayorista} onChange={(e) => setPrecioMayorista(e.target.value)} placeholder="Precio mayorista (opcional, para reparto)" style={campo} inputMode="numeric" />
          <BotonPrimario onClick={crear} disabled={creando}>{creando ? "Guardando…" : "Agregar producto"}</BotonPrimario>
        </div>
      ) : null}

      {cargando ? (
        <p style={{ color: superficie.textoDim, fontSize: 14 }}>Cargando…</p>
      ) : errorCarga ? (
        <p style={{ color: semantico.error, fontSize: 14 }} role="alert">No se pudo cargar el catálogo.</p>
      ) : (
        productos.map((p) => (
          <div key={p.id} style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 12, padding: 14, opacity: p.activo ? 1 : 0.55 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700 }}>{p.nombre}{p.activo ? "" : " (inactivo)"}</p>
                <p style={{ margin: 0, fontSize: 13, color: superficie.textoFaint }}>
                  {p.tipo_venta === "kilo" ? "Por kilo" : "Por unidad"} · mostrador{" "}
                  {p.precio_mostrador_clp != null ? formatearClp(p.precio_mostrador_clp) : "—"}
                  {p.precio_mayorista_clp != null ? ` · mayorista ${formatearClp(p.precio_mayorista_clp)}` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={guardandoId === p.id}
                onClick={() => toggleActivo(p)}
                style={{ minHeight: 44, padding: "0 12px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 13 }}
              >
                {p.activo ? "Desactivar" : "Reactivar"}
              </button>
            </div>
            {editandoId === p.id ? (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <input
                  value={editMostrador}
                  onChange={(e) => setEditMostrador(e.target.value)}
                  placeholder="Nuevo precio mostrador"
                  inputMode="numeric"
                  style={{ width: 160, minHeight: 44, borderRadius: 10, border: `1px solid ${superficie.hairline}`, padding: "0 10px", fontSize: 14 }}
                />
                <input
                  value={editMayorista}
                  onChange={(e) => setEditMayorista(e.target.value)}
                  placeholder="Nuevo precio mayorista"
                  inputMode="numeric"
                  style={{ width: 160, minHeight: 44, borderRadius: 10, border: `1px solid ${superficie.hairline}`, padding: "0 10px", fontSize: 14 }}
                />
                <button type="button" onClick={() => guardarPrecio(p.id)} style={{ minHeight: 44, padding: "0 12px", borderRadius: 10, border: "none", background: acentos.kilopan, color: "#fff", fontWeight: 700, fontSize: 13 }}>
                  Guardar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setEditandoId(p.id); setEditMostrador(""); setEditMayorista(""); }}
                style={{ marginTop: 10, minHeight: 44, padding: "0 12px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 13 }}
              >
                Cambiar precio
              </button>
            )}
          </div>
        ))
      )}

      {mensaje ? <p style={{ color: semantico.ok, fontSize: 14 }} role="status">{mensaje}</p> : null}
      {error ? <p style={{ color: semantico.error, fontSize: 14 }} role="alert">{error}</p> : null}
    </section>
  );
}

// AC-PAG-01: catálogo de 8 medios de pago fijo — "prender/apagar lo que de verdad
// usa" (0003), no inventar claves nuevas. Coherente con el grant de la BD
// (`update (activo)` solamente, nunca insert).
function SeccionMediosPago() {
  const [medios, setMedios] = useState<MedioPagoAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardandoClave, setGuardandoClave] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/medios-pago?detalle=1")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setMedios(d.mediosPago ?? []))
      .catch(() => setErrorCarga(true))
      .finally(() => setCargando(false));
  }, []);

  async function toggle(m: MedioPagoAdmin) {
    setGuardandoClave(m.clave);
    setError(null);
    try {
      const r = await fetch("/api/medios-pago", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave: m.clave, activo: !m.activo }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setError(cuerpo.error); return; }
      setMedios((ms) => ms.map((x) => (x.clave === m.clave ? { ...x, activo: cuerpo.activo } : x)));
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      setGuardandoClave(null);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${superficie.hairline}`, paddingTop: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Medios de pago</h2>
      {cargando ? (
        <p style={{ color: superficie.textoDim, fontSize: 14 }}>Cargando…</p>
      ) : errorCarga ? (
        <p style={{ color: semantico.error, fontSize: 14 }} role="alert">No se pudieron cargar los medios de pago.</p>
      ) : (
        medios.map((m) => (
          <div key={m.clave} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 44 }}>
            <span style={{ fontSize: 15, opacity: m.activo ? 1 : 0.55 }}>{m.etiqueta}</span>
            <button
              type="button"
              role="switch"
              aria-checked={m.activo}
              disabled={guardandoClave === m.clave}
              onClick={() => toggle(m)}
              style={{
                minWidth: 88, minHeight: 44, borderRadius: 100, fontWeight: 700, fontSize: 13,
                border: `1px solid ${superficie.hairline}`,
                background: m.activo ? semantico.ok : "#fff",
                color: m.activo ? "#fff" : superficie.textoDim,
              }}
            >
              {m.activo ? "✓ Activo" : "Apagado"}
            </button>
          </div>
        ))
      )}
      {error ? <p style={{ color: semantico.error, fontSize: 14 }} role="alert">{error}</p> : null}
    </section>
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
