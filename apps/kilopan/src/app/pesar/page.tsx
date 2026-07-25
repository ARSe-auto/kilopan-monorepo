"use client";
import { useEffect, useRef, useState } from "react";
import {
  CifraGrande,
  TecladoNumerico,
  BotonPrimario,
  SelectorUnToque,
  ChipEstadoConexion,
} from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { formatearKg } from "@/comun/formato.ts";
import { enviarOEncolar, encolarFoto, iniciarSyncAutomatico } from "@/pod/outbox.ts";
import { abrirCamara, capturar, cerrarCamara, subirFoto } from "@/comun/camara.ts";

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
  const [estado, setEstado] = useState<"listo" | "foto" | "enviando" | "confirmar_outlier">("listo");
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const [pendientes, setPendientes] = useState(0);

  // AC-PES-04: lo prende el admin en /admin y no se puede apagar desde acá — ese es
  // el punto de la decisión #1. Se cachea junto al catálogo porque sin señal la
  // pantalla igual tiene que saber si esta panadería exige foto.
  const [exigeFoto, setExigeFoto] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("kp_exige_foto") === "1"
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);
  const [capturando, setCapturando] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    fetch("/api/parametros")
      .then((r) => r.json())
      .then((d) => {
        const p = (d.parametros ?? []).find(
          (x: { clave: string }) => x.clave === "pesaje_foto_obligatoria"
        );
        if (p) {
          const activo = p.valor === 1;
          setExigeFoto(activo);
          window.localStorage.setItem("kp_exige_foto", activo ? "1" : "0");
        }
      })
      .catch(() => undefined); // sin red: vale lo último conocido
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // Apagar la cámara si el maestro sale de la pantalla con el obturador abierto.
  useEffect(() => () => cerrarCamara(stream), [stream]);

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

  // El sha256 de la foto de ESTE pesaje. Se guarda aparte del estado de render porque
  // el camino del outlier vuelve a llamar a `enviar()` y la foto ya tomada tiene que
  // sobrevivir a esa segunda vuelta — sacarla de nuevo sería pedirle al maestro que
  // fotografíe dos veces la misma bandeja.
  const fotoShaRef = useRef<string | null>(null);

  // «Confirmar» con foto obligatoria abre el obturador en vez de enviar: es UN toque
  // más, no una pantalla más.
  function alConfirmar() {
    if (!producto) return;
    if (exigeFoto && !fotoShaRef.current) {
      setMensaje(null);
      setErrorCamara(null);
      setEstado("foto");
      abrirCamara()
        .then(setStream)
        .catch(() =>
          setErrorCamara("Sin acceso a la cámara. Actívala: esta panadería exige foto por pesaje.")
        );
      return;
    }
    void enviar(false);
  }

  async function tomarFoto() {
    if (!videoRef.current || !stream) return;
    setCapturando(true);
    try {
      const captura = await capturar(videoRef.current);
      cerrarCamara(stream);
      setStream(null);
      // Se intenta subir al tiro; si no hay señal el JPEG queda en la cola de fotos y
      // se reintenta solo. El pesaje NO se frena por eso: el hash ya viaja con él.
      const subida = await subirFoto(captura);
      if (!subida) await encolarFoto(captura.sha256, captura.blob);
      fotoShaRef.current = captura.sha256;
      await enviar(false);
    } catch {
      setErrorCamara("No se pudo tomar la foto. Intenta de nuevo.");
      setCapturando(false);
    }
  }

  async function enviar(confirmarOutlier = false) {
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
      fotoSha256: fotoShaRef.current ?? undefined,
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
    // La foto es de LA bandeja que se acaba de pesar: la siguiente exige la suya.
    fotoShaRef.current = null;
    setCapturando(false);
    setErrorCamara(null);
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

  // Obturador: mismo contrato que el POD — la cámara se abre in-app por getUserMedia,
  // nunca un <input type=file>, porque eso dejaría adjuntar una foto vieja de la
  // galería como si fuera de esta bandeja (PROMPT_MAESTRO.md §7).
  if (estado === "foto") {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16, minHeight: "100dvh" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{producto.nombre}</h1>
        <p style={{ margin: 0, color: superficie.textoDim, fontSize: 15 }}>
          Foto de respaldo · {formatearKg(gramosNum)}
        </p>

        <div style={{ position: "relative", aspectRatio: "3 / 4", borderRadius: 14, overflow: "hidden", background: "#000", border: `1px solid ${superficie.hairline}` }}>
          {stream ? (
            <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#fff", fontSize: 14, padding: 16, textAlign: "center" }}>
              {errorCamara ?? "Abriendo la cámara…"}
            </div>
          )}
        </div>

        {errorCamara ? <p style={{ color: semantico.error, fontSize: 14, margin: 0 }} role="alert">{errorCamara}</p> : null}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          <BotonPrimario disabled={!stream || capturando} onClick={tomarFoto}>
            {capturando ? "Procesando…" : "Tomar foto y pesar"}
          </BotonPrimario>
          <BotonPrimario
            variante="neutro"
            onClick={() => {
              cerrarCamara(stream);
              setStream(null);
              setEstado("listo");
            }}
          >
            Cancelar
          </BotonPrimario>
        </div>
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
            <BotonPrimario onClick={() => void enviar(true)}>Confirmar</BotonPrimario>
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
          <BotonPrimario disabled={!puedeConfirmar || destino === "reparto"} onClick={alConfirmar}>
            {estado === "enviando" ? "Pesando…" : exigeFoto ? "Confirmar con foto" : "Confirmar"}
          </BotonPrimario>
        </div>
      ) : null}
    </main>
  );
}
