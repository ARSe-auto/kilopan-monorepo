"use client";
import { useEffect, useRef, useState } from "react";
import {
  CifraGrande,
  TecladoNumerico,
  BotonPrimario,
  SelectorUnToque,
  ChipEstadoConexion,
} from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";
import { formatearKg } from "@/comun/formato.ts";
import { kgTextoAGramos, pesoValido } from "@/comun/peso.ts";
import { useEnLinea } from "@/comun/useEnLinea.ts";
import { VolverInicio } from "../VolverInicio.tsx";
import { enviarOEncolar, encolarFoto, iniciarSyncAutomatico } from "@/pod/outbox.ts";
import { abrirCamara, capturar, cerrarCamara, subirFoto } from "@/comun/camara.ts";

interface Producto {
  id: string;
  nombre: string;
  tipo_venta: string;
}

interface LineaPedido {
  linea_id: string;
  pedido_id: string;
  correlativo_pedido: number | null;
  razon_social: string;
  gramos_pedidos: string;
  gramos_pesados: string;
  gramos_faltantes: string;
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
  const [errorCatalogo, setErrorCatalogo] = useState(false);
  const [productoId, setProductoId] = useState<string | null>(null);
  // El maestro teclea KILOS ("1,5"); a la BD viajan gramos enteros. La conversión vive
  // en comun/peso.ts y es por texto, nunca `Number(kilos)*1000`.
  const [kilos, setKilos] = useState("");
  const [destino, setDestino] = useState<Destino>("mostrador");
  const [motivoMerma, setMotivoMerma] = useState<string | null>(null);
  // Destino reparto: a qué línea de pedido se imputa este pesaje. La BD lo exige
  // (constraint pesajes_reparto_requiere_pedido) — un kilo despachado sin decir a qué
  // pedido va no se puede conciliar contra nada.
  const [lineasPedido, setLineasPedido] = useState<LineaPedido[]>([]);
  const [pedidoLineaId, setPedidoLineaId] = useState<string | null>(null);
  const [cargandoLineas, setCargandoLineas] = useState(false);
  // Se incrementa tras cada pesaje de reparto para releer cuánto falta: si el maestro
  // no ve bajar el faltante, no tiene cómo saber cuándo parar de cargar bandejas.
  const [refrescoLineas, setRefrescoLineas] = useState(0);
  const [estado, setEstado] = useState<"listo" | "foto" | "enviando" | "confirmar_outlier">("listo");
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const [pendientes, setPendientes] = useState(0);
  const enLinea = useEnLinea();

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

  // Los pedidos que esperan ESTE producto. Se piden solo al elegir «Reparto»: en el
  // 90% de los pesajes el destino es mostrador y no hay por qué gastar datos móviles
  // trayendo despachos que nadie va a mirar.
  useEffect(() => {
    if (destino !== "reparto" || !productoId) {
      setLineasPedido([]);
      setPedidoLineaId(null);
      return;
    }
    let vigente = true;
    setCargandoLineas(true);
    fetch(`/api/pedidos/pendientes?productoId=${encodeURIComponent(productoId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!vigente) return;
        const lineas: LineaPedido[] = d.lineas ?? [];
        setLineasPedido(lineas);
        setPedidoLineaId((actual) => {
          // Si el pedido elegido sigue en la lista, se conserva: este efecto también
          // corre al refrescar el faltante tras cada bandeja, y deseleccionar ahí
          // obligaría a reelegir el mismo pedido en cada vuelta.
          if (actual && lineas.some((l) => l.linea_id === actual)) return actual;
          // Un solo pedido esperando: se elige solo. Es el caso corriente en una
          // panadería chica y ahorra un toque con las manos ocupadas.
          return lineas.length === 1 ? (lineas[0] as LineaPedido).linea_id : null;
        });
      })
      .catch(() => {
        if (vigente) setLineasPedido([]);
      })
      .finally(() => {
        if (vigente) setCargandoLineas(false);
      });
    return () => {
      vigente = false; // cambiar de producto rápido no debe pisar el resultado nuevo con el viejo
    };
  }, [destino, productoId, refrescoLineas]);

  // Apagar la cámara si el maestro sale de la pantalla con el obturador abierto.
  useEffect(() => () => cerrarCamara(stream), [stream]);

  useEffect(() => {
    // Catálogo con caché local: sobre datos móviles con mala señal, esperar el fetch
    // deja la pantalla en blanco. Se muestra lo último conocido de inmediato y se
    // refresca por detrás cuando haya red.
    const cacheado = leerCatalogoCache();
    if (cacheado) setProductos(cacheado);
    fetch("/api/productos")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        if (d.productos) {
          setProductos(d.productos);
          guardarCatalogoCache(d.productos);
        }
      })
      // Con caché, seguir con lo último conocido es lo correcto y no hace falta avisar.
      // Sin caché (equipo recién vinculado, primera vez sin señal), la grilla se queda
      // vacía para siempre y "Cargando catálogo…" mentía — nunca terminaba de cargar.
      .catch(() => { if (!cacheado) setErrorCatalogo(true); });

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
  let gramosNum = 0;
  try {
    gramosNum = kgTextoAGramos(kilos);
  } catch {
    gramosNum = 0; // el teclado propio no puede producirlo, pero no revienta la pantalla
  }
  const puedeConfirmar =
    !!producto &&
    pesoValido(gramosNum) &&
    estado !== "enviando" &&
    (destino !== "merma" || !!motivoMerma) &&
    (destino !== "reparto" || !!pedidoLineaId);

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
      pedidoLineaId: destino === "reparto" ? pedidoLineaId : undefined,
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

    setMensaje(
      resultado.estado === "encolado" && resultado.motivo === "error_servidor"
        ? {
            // Antes esto se anunciaba igual que "sin señal", con el mismo verde de
            // éxito — un 500 con buena señal es un problema real, no falta de cobertura.
            tipo: "error",
            texto: `Pesado: ${formatearKg(gramosNum)} · ${producto.nombre} — hubo un problema al guardarlo, se reintenta solo`,
          }
        : {
            tipo: "ok",
            texto:
              resultado.estado === "encolado"
                ? `Pesado sin señal: ${formatearKg(gramosNum)} · ${producto.nombre} — se sube solo`
                : `Pesado: ${formatearKg(gramosNum)} · ${producto.nombre}`,
          }
    );
    if (resultado.estado === "encolado") setPendientes((n) => n + 1);
    // Releer cuánto le falta al pedido. Solo si de verdad llegó al servidor: si quedó
    // encolado, el trigger que suma gramos_pesados todavía no corrió y refrescar
    // mostraría el mismo faltante de antes, como si la bandeja no contara.
    if (destino === "reparto" && resultado.estado === "enviado") {
      setRefrescoLineas((n) => n + 1);
    }
    limpiarParaElSiguiente();
  }

  // Encadena con el mismo producto preseleccionado (spec F1): entre bandeja y bandeja
  // el maestro no vuelve al inicio, solo se limpia el peso.
  function limpiarParaElSiguiente() {
    setKilos("");
    setMotivoMerma(null);
    setEstado("listo");
    // Armar un despacho son varias bandejas seguidas al MISMO pedido, así que el
    // destino y el pedido se mantienen. Merma es lo contrario —una excepción, no una
    // tanda— y volver solo a mostrador evita que la siguiente bandeja buena se anote
    // como pérdida por inercia.
    if (destino === "merma") setDestino("mostrador");
    // La foto es de LA bandeja que se acaba de pesar: la siguiente exige la suya.
    fotoShaRef.current = null;
    setCapturando(false);
    setErrorCamara(null);
  }

  if (!producto) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Pesar</h1>
          <VolverInicio />
        </div>
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
        {productos.length === 0 ? (
          <p style={{ color: errorCatalogo ? semantico.error : superficie.textoFaint }} role={errorCatalogo ? "alert" : undefined}>
            {errorCatalogo ? "No se pudo cargar el catálogo. Revisa la conexión e inténtalo de nuevo." : "Cargando catálogo…"}
          </p>
        ) : null}
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
          {pendientes > 0 || !enLinea ? <ChipEstadoConexion pendientes={pendientes} online={enLinea} /> : null}
          <button
            type="button"
            onClick={() => setProductoId(null)}
            style={{ minHeight: 44, minWidth: 44, padding: "0 12px", fontSize: 14, fontWeight: 700, color: superficie.textoDim, background: "none", border: "none" }}
          >
            Cambiar
          </button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
        <CifraGrande valor={kilos || "0"} unidad="kg" />
      </div>

      <TecladoNumerico
        valor={kilos}
        onCambiar={(v) => {
          // El mensaje de éxito del pesaje anterior se quedaba en pantalla mientras
          // se tecleaba el peso de la SIGUIENTE bandeja — se podía confundir con la
          // confirmación de la que está en curso, todavía sin enviar.
          if (mensaje) setMensaje(null);
          setKilos(v);
        }}
        permitirDecimal
      />
      {/* Antes el botón Confirmar solo quedaba deshabilitado sin decir por qué —
          quien pesa no tenía forma de saber si el peso estaba fuera de rango o si
          faltaba otra cosa (destino, foto, línea de pedido). */}
      {kilos && !pesoValido(gramosNum) ? (
        <p style={{ fontSize: 13, color: semantico.alerta, margin: 0 }}>
          El peso tiene que ser mayor a 0 y hasta 100 kg.
        </p>
      ) : null}

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
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim, margin: "0 0 8px" }}>
            ¿A qué pedido va?
          </p>
          {cargandoLineas ? (
            <p style={{ fontSize: 14, color: superficie.textoFaint, margin: 0 }}>Buscando pedidos…</p>
          ) : lineasPedido.length === 0 ? (
            <p style={{ fontSize: 14, color: semantico.alerta, margin: 0 }}>
              Ningún pedido de hoy está esperando {producto.nombre}. Ármalo primero en Despacho.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lineasPedido.map((l) => {
                const elegida = l.linea_id === pedidoLineaId;
                const faltante = Number(l.gramos_faltantes);
                return (
                  <button
                    key={l.linea_id}
                    type="button"
                    onClick={() => setPedidoLineaId(l.linea_id)}
                    style={{
                      minHeight: 56,
                      textAlign: "left",
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: elegida
                        ? `2px solid ${acentos.kilopan}`
                        : `1px solid ${superficie.hairline}`,
                      background: elegida ? "#FEF3E2" : superficie.tarjeta,
                      color: superficie.texto,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700 }}>
                      {l.correlativo_pedido ? `N° ${l.correlativo_pedido} · ` : ""}
                      {l.razon_social}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontVariantNumeric: "tabular-nums",
                        color: faltante > 0 ? superficie.textoDim : semantico.ok,
                        textAlign: "right",
                      }}
                    >
                      {faltante > 0 ? `faltan ${formatearKg(faltante)}` : "completo"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {estado === "confirmar_outlier" ? (
        <div style={{ padding: 14, borderRadius: 12, background: "#FEF3E2", border: `1px solid ${semantico.alerta}` }}>
          <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600 }}>
            Ese peso es muy distinto a lo habitual para {producto.nombre}. ¿Confirmas {formatearKg(gramosNum)}?
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
          <BotonPrimario disabled={!puedeConfirmar} onClick={alConfirmar}>
            {estado === "enviando" ? "Pesando…" : exigeFoto ? "Confirmar con foto" : "Confirmar"}
          </BotonPrimario>
        </div>
      ) : null}
    </main>
  );
}
