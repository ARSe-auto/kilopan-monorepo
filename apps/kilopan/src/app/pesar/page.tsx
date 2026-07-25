"use client";
import { useEffect, useState } from "react";
import {
  CifraGrande,
  TecladoNumerico,
  BotonPrimario,
  SelectorUnToque,
  ChipEstadoConexion,
} from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { formatearKg } from "@/comun/formato.ts";
import { enviarOEncolar, iniciarSyncAutomatico } from "@/pod/outbox.ts";

interface Producto {
  id: string;
  nombre: string;
  tipo_venta: string;
}

const DESTINOS = [
  { valor: "mostrador", etiqueta: "Mostrador" },
  { valor: "reparto", etiqueta: "Reparto" },
  { valor: "merma", etiqueta: "Merma" },
] as const;
type Destino = (typeof DESTINOS)[number]["valor"];

const MOTIVOS = [
  { valor: "quemado", etiqueta: "Quemado" },
  { valor: "sobrante_dia", etiqueta: "Sobrante del día" },
  { valor: "devolucion_cliente", etiqueta: "Devolución" },
  { valor: "otro", etiqueta: "Otro" },
] as const;

// Caché del catálogo en localStorage: sobre 5G con mala señal el fetch puede tardar
// segundos o fallar, y una grilla de productos vacía deja al maestro sin poder pesar.
// Es dato público de la panadería (nombres de pan), así que no hay problema de
// privacidad en dejarlo en el equipo.
const CLAVE_CATALOGO = "kp_catalogo";

function leerCatalogoCache(): Producto[] | null {
  if (typeof window === "undefined") return null;
  try {
    const crudo = window.localStorage.getItem(CLAVE_CATALOGO);
    return crudo ? (JSON.parse(crudo) as Producto[]) : null;
  } catch {
    return null;
  }
}

function guardarCatalogoCache(productos: Producto[]) {
  try {
    window.localStorage.setItem(CLAVE_CATALOGO, JSON.stringify(productos));
  } catch {
    // cuota llena o modo privado: seguir sin caché es aceptable
  }
}

// F1 Pesar (PROMPT_MAESTRO.md §5): grilla de productos -> cifra 96px + teclado propio
// -> destino en un toque -> confirmar. Encadena con el último producto para el
// siguiente pesaje (manos ocupadas, cero volver al inicio entre bandejas).
export default function PesarPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [productoId, setProductoId] = useState<string | null>(null);
  const [gramos, setGramos] = useState("");
  const [destino, setDestino] = useState<Destino>("mostrador");
  const [motivoMerma, setMotivoMerma] = useState<string | null>(null);
  const [estado, setEstado] = useState<"listo" | "enviando" | "confirmar_outlier">("listo");
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    // Catálogo con caché local: sobre datos móviles con mala señal, esperar el fetch
    // deja la pantalla en blanco. Se muestra lo último conocido de inmediato y se
    // refresca por detrás cuando haya red.
    const cacheado = leerCatalogoCache();
    if (cacheado) setProductos(cacheado);
    fetch("/api/productos")
      .then((r) => r.json())
      .then((d) => {
        if (d.productos) {
          setProductos(d.productos);
          guardarCatalogoCache(d.productos);
        }
      })
      .catch(() => undefined); // sin red: se sigue con el caché

    // AC-RED-01: la señal se corta justo a las 5 de la mañana. La cola reintenta sola;
    // el pesaje no se detiene.
    return iniciarSyncAutomatico((n, rechazadas) => {
      setPendientes(n);
      if (rechazadas?.length) {
        setMensaje({
          tipo: "error",
          texto: `${rechazadas.length} pesaje(s) rebotaron al subir: ${rechazadas[0]?.motivo ?? ""}`,
        });
      }
    });
  }, []);

  const producto = productos.find((p) => p.id === productoId) ?? null;
  const gramosNum = Number(gramos || "0");
  const puedeConfirmar =
    !!producto && gramosNum > 0 && estado !== "enviando" && (destino !== "merma" || !!motivoMerma);

  async function confirmar(confirmarOutlier = false) {
    if (!producto) return;
    setEstado("enviando");
    setMensaje(null);

    // Offline-first de verdad: `enviarOEncolar` intenta enviar y, si no hay red,
    // encola en IndexedDB (que sobrevive al cierre del navegador). El maestro nunca
    // ve un error por señal; ve que quedó registrado y que se subirá solo.
    const resultado = await enviarOEncolar("pesaje", "/api/pesajes", {
      clientUuid: crypto.randomUUID(),
      productoId: producto.id,
      gramos: gramosNum,
      destino,
      motivoMerma: destino === "merma" ? motivoMerma : undefined,
      confirmarOutlier,
    });

    if (resultado.estado === "rechazado") {
      // El outlier es el único rechazo que no es un error: es la app pidiendo
      // confirmación de que 25.000 g no fue un dedo de más (test centinela #4).
      if (resultado.error === "outlier") {
        setEstado("confirmar_outlier");
        return;
      }
      setMensaje({ tipo: "error", texto: resultado.error });
      setEstado("listo");
      return;
    }

    setMensaje({
      tipo: "ok",
      texto:
        resultado.estado === "encolado"
          ? `Pesado sin señal: ${formatearKg(gramosNum)} · ${producto.nombre} — se sube solo`
          : `Pesado: ${formatearKg(gramosNum)} · ${producto.nombre}`,
    });
    if (resultado.estado === "encolado") setPendientes((n) => n + 1);
    limpiarParaElSiguiente();
  }

  // Encadena con el mismo producto preseleccionado (spec F1): entre bandeja y bandeja
  // el maestro no vuelve al inicio, solo se limpia el peso.
  function limpiarParaElSiguiente() {
    setGramos("");
    setDestino("mostrador");
    setMotivoMerma(null);
    setEstado("listo");
  }

  if (!producto) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Pesar</h1>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          {productos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProductoId(p.id)}
              style={{
                minHeight: 64,
                borderRadius: 12,
                border: `1px solid ${superficie.hairline}`,
                background: superficie.tarjeta,
                fontSize: 17,
                fontWeight: 700,
                color: superficie.texto,
              }}
            >
              {p.nombre}
            </button>
          ))}
        </div>
        {productos.length === 0 ? <p style={{ color: superficie.textoFaint }}>Cargando catálogo…</p> : null}
      </main>
    );
  }

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minHeight: "100dvh",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{producto.nombre}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {pendientes > 0 ? <ChipEstadoConexion pendientes={pendientes} /> : null}
          <button
            type="button"
            onClick={() => setProductoId(null)}
            style={{ fontSize: 14, fontWeight: 700, color: superficie.textoDim, background: "none", border: "none" }}
          >
            Cambiar
          </button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
        <CifraGrande valor={gramos || "0"} unidad="g" />
      </div>

      <TecladoNumerico valor={gramos} onCambiar={setGramos} />

      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim, margin: "0 0 8px" }}>Destino</p>
        <SelectorUnToque opciones={DESTINOS as unknown as { valor: Destino; etiqueta: string }[]} valor={destino} onCambiar={setDestino} />
      </div>

      {destino === "merma" ? (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim, margin: "0 0 8px" }}>Motivo</p>
          <SelectorUnToque opciones={MOTIVOS as unknown as { valor: string; etiqueta: string }[]} valor={motivoMerma} onCambiar={setMotivoMerma} />
        </div>
      ) : null}

      {destino === "reparto" ? (
        <p style={{ fontSize: 13, color: semantico.alerta }}>
          Reparto se habilita cuando esté armado el módulo de despacho — por ahora usá Mostrador o Merma.
        </p>
      ) : null}

      {estado === "confirmar_outlier" ? (
        <div style={{ padding: 14, borderRadius: 12, background: "#FEF3E2", border: `1px solid ${semantico.alerta}` }}>
          <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600 }}>
            Ese peso es muy distinto a lo habitual para {producto.nombre}. ¿Confirmás {formatearKg(gramosNum)}?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <BotonPrimario variante="neutro" onClick={() => setEstado("listo")}>
              Cancelar
            </BotonPrimario>
            <BotonPrimario onClick={() => confirmar(true)}>Confirmar</BotonPrimario>
          </div>
        </div>
      ) : null}

      {mensaje ? (
        <p role="status" style={{ color: mensaje.tipo === "ok" ? semantico.ok : semantico.error, fontSize: 14 }}>
          {mensaje.texto}
        </p>
      ) : null}

      {estado !== "confirmar_outlier" ? (
        <div style={{ marginTop: "auto" }}>
          <BotonPrimario disabled={!puedeConfirmar || destino === "reparto"} onClick={() => confirmar(false)}>
            {estado === "enviando" ? "Pesando…" : "Confirmar"}
          </BotonPrimario>
        </div>
      ) : null}
    </main>
  );
}
