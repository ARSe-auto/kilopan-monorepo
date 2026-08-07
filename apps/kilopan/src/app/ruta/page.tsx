"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BotonPrimario,
  ChipEstadoConexion,
  CifraGrande,
  TecladoNumerico,
  SelectorUnToque,
} from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";
import { formatearKg } from "@/comun/formato.ts";
import { kgTextoAGramos, pesoValido, gramosAKgTexto } from "@/comun/peso.ts";
import { encolar, encolarFoto, iniciarSyncAutomatico, contarPendientes } from "@/pod/outbox.ts";
import { MOTIVOS_RECHAZO } from "@/pod/motivosRechazo.ts";
import { useEnLinea } from "@/comun/useEnLinea.ts";
import { abrirCamara, capturar, cerrarCamara, subirFoto } from "@/comun/camara.ts";
import { Pantalla } from "../Pantalla.tsx";

// AC-POD-05: catálogo CERRADO de motivos, compartido con `/api/sync` (`pod/motivosRechazo.ts`)
// para que el servidor valide el MISMO catálogo por código, no un texto libre. Rechazo
// total acá; el parcial sale de gramos_entregados < gramos_pedidos y se muestra como
// «Entregada parcial — X de Y».
const MOTIVOS_FALLA = MOTIVOS_RECHAZO;

interface Parada {
  parada_id: string;
  pedido_id: string;
  orden: number;
  estado: string;
  razon_social: string;
  direccion: string | null;
  contacto_nombre: string | null;
  gramos_pedidos: string;
}

// F4 Entregar (PROMPT_MAESTRO.md §5): ≤4 toques — «Entregar» → obturador → receptor
// precargado → «Confirmar». Todo funciona sin señal: la entrega se encola y sincroniza
// sola. El repartidor ve SOLO km y kg, jamás CLP (regla de rol).
export default function RutaPage() {
  const [paradas, setParadas] = useState<Parada[]>([]);
  const [activa, setActiva] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  // AC-POD-07. Sin esto, `ChipEstadoConexion` caía en su default `online = true` y, con la
  // cola vacía, /ruta mostraba «Sincronizado» en verde SIEMPRE — con señal y sin señal.
  // Justo en la única pantalla que se usa lejos del local: el repartidor sin cobertura no
  // tenía ninguna forma de distinguir un POD que subió de uno que quedó en la cola.
  const enLinea = useEnLinea();
  const [paso, setPaso] = useState<"lista" | "foto" | "receptor">("lista");
  const [receptor, setReceptor] = useState("");
  // Precargados con el total del pedido (camino rápido, cero toques extra); editables
  // para la entrega parcial — nunca se manda `gramos_pedidos` a ciegas (ALTA #10).
  const [gramosTexto, setGramosTexto] = useState("");
  const [editandoGramos, setEditandoGramos] = useState(false);
  // "No se pudo entregar" (ALTA #18): mismo paso "receptor", mismo GPS/foto ya
  // capturados — solo cambia qué se le pide al repartidor y qué payload se manda.
  const [modoFallida, setModoFallida] = useState(false);
  const [motivoFallida, setMotivoFallida] = useState<string | null>(null);
  const [motivoOtroTexto, setMotivoOtroTexto] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number; precision: number } | null>(null);
  const [errorGps, setErrorGps] = useState<string | null>(null);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [cargandoRuta, setCargandoRuta] = useState(true);
  const [errorRuta, setErrorRuta] = useState(false);
  const [fotoSha, setFotoSha] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [entregadasLocal, setEntregadasLocal] = useState<Set<string>>(new Set());
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);
  const [capturando, setCapturando] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // El outbox reporta rechazos por `clientUuid`, pero la lista de paradas vive por
  // `parada_id` — este mapa es lo que permite, al llegar un rechazo, volver a mostrar
  // LA PARADA correcta como pendiente en vez de dejarla desaparecida.
  const clientUuidAParada = useRef<Map<string, string>>(new Map());

  // `errorRuta` separa "no hay reparto hoy" de "no pude consultar". Sin eso, una
  // sesión vencida o el server caído dejaban `paradas` vacío y la pantalla decía
  // "No tienes paradas hoy": el repartidor se iba a la casa con el furgón cargado
  // (auditoría de experiencia, ALTA). Solo se marca error si NO hay nada en pantalla:
  // con un snapshot ya cargado, seguir mostrándolo es lo correcto sin señal.
  const cargarRuta = useCallback(async () => {
    try {
      const r = await fetch("/api/rutas/mi-ruta");
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setParadas(d.paradas ?? []);
      setErrorRuta(false);
    } catch {
      setParadas((actuales) => {
        setErrorRuta(actuales.length === 0);
        return actuales; // sin señal: se sigue con el snapshot del día
      });
    } finally {
      setCargandoRuta(false);
    }
  }, []);

  // Si el repartidor sale de la pantalla con la cámara abierta (back del navegador, se
  // bloquea el teléfono a medio POD), apagar el stream igual — dejarlo prendido gasta
  // batería y es la luz roja de la cámara encendida sin razón.
  useEffect(() => {
    return () => cerrarCamara(stream);
  }, [stream]);

  useEffect(() => {
    void cargarRuta();
    // Antes esto era `iniciarSyncAutomatico(setPendientes)`: pasaba el setter de React
    // directo como callback, así que el segundo argumento (`rechazadas`) se ignoraba
    // por completo. El outbox ya había borrado el ítem rebotado y `confirmar()` ya
    // había marcado la parada como entregada en el estado local — la entrega
    // desaparecía en silencio y la parada se contaba como hecha sin estarlo.
    const detener = iniciarSyncAutomatico((n, rechazadas) => {
      setPendientes(n);
      if (rechazadas?.length) {
        setEntregadasLocal((actual) => {
          const copia = new Set(actual);
          for (const rz of rechazadas) {
            const paradaId = clientUuidAParada.current.get(rz.clientUuid);
            if (paradaId) copia.delete(paradaId);
          }
          return copia;
        });
        setMensaje(
          `${rechazadas.length} entrega(s) rebotaron y siguen pendientes: ${rechazadas[0]?.motivo ?? ""}`
        );
        void cargarRuta(); // el estado real de las paradas lo tiene el servidor
      }
    });
    void contarPendientes().then(setPendientes);
    return detener;
  }, [cargarRuta]);

  const parada = paradas.find((p) => p.parada_id === activa) ?? null;

  // Extraída de iniciarEntrega para poder REINTENTARLA: dentro de un galpón o con la
  // ubicación recién activada, el primer fix falla y antes no había forma de volver a
  // pedirlo — el repartidor quedaba en un callejón sin salida (auditoría de
  // experiencia, ALTA). `buscandoGps` distingue "todavía buscando" de "no se pudo".
  function pedirUbicacion() {
    if (!navigator.geolocation) {
      setErrorGps("Este equipo no tiene GPS.");
      return;
    }
    setBuscandoGps(true);
    setErrorGps(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: Math.round(pos.coords.accuracy) });
        setErrorGps(null);
        setBuscandoGps(false);
      },
      () => {
        setErrorGps("No se pudo tomar la ubicación. Revisa el permiso o inténtalo de nuevo.");
        setBuscandoGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // «Entregar»: pide GPS y abre la cámara del equipo (getUserMedia in-app — nunca un
  // <input type=file>, porque eso dejaría adjuntar una foto vieja como si fuera de
  // ahora). El obturador de verdad va en el paso "foto".
  function iniciarEntrega(paradaId: string) {
    setMensaje(null);
    setErrorCamara(null);
    setActiva(paradaId);
    setPaso("foto");

    pedirUbicacion();

    abrirCamara()
      .then(setStream)
      .catch(() => setErrorCamara("Sin acceso a la cámara. Actívala para poder confirmar la entrega."));
  }

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  function cancelarEntrega() {
    cerrarCamara(stream);
    setStream(null);
    setPaso("lista");
    setActiva(null);
    setErrorCamara(null);
  }

  // Limpia todo lo que junta el flujo de UNA parada, tanto tras confirmar como al
  // cancelar desde el paso "receptor" — así el próximo "Entregar" no arrastra el
  // motivo, el peso editado o el modo fallida de la parada anterior.
  function volverALista() {
    setPaso("lista");
    setActiva(null);
    setFotoSha(null);
    setGps(null);
    setErrorGps(null);
    setReceptor("");
    setGramosTexto("");
    setEditandoGramos(false);
    setModoFallida(false);
    setMotivoFallida(null);
    setMotivoOtroTexto("");
  }

  // El obturador real: toma el cuadro actual, lo comprime a JPEG (~400 KB) y calcula
  // el sha256 sobre el blob ya comprimido — es el mismo que el servidor recalcula al
  // recibir la imagen. Se intenta subir al tiro; si falla (sin señal / 5xx) la foto NO
  // se pierde: queda en la cola de fotos del outbox y se reintenta sola.
  async function tomarFoto() {
    if (!videoRef.current || !stream) return;
    setCapturando(true);
    try {
      const captura = await capturar(videoRef.current);
      cerrarCamara(stream);
      setStream(null);
      const subida = await subirFoto(captura);
      if (!subida) await encolarFoto(captura.sha256, captura.blob);
      setFotoSha(captura.sha256);
      setReceptor(parada?.contacto_nombre ?? "");
      // Precarga con el total del pedido: la entrega completa (el caso corriente)
      // sigue sin pedir un toque de más. Editar es la excepción, no la regla.
      setGramosTexto(gramosAKgTexto(Number(parada?.gramos_pedidos ?? 0)));
      setPaso("receptor");
    } catch {
      setErrorCamara("No se pudo tomar la foto. Intenta de nuevo.");
    } finally {
      setCapturando(false);
    }
  }

  let gramosEntregadosNum = 0;
  try {
    gramosEntregadosNum = kgTextoAGramos(gramosTexto);
  } catch {
    gramosEntregadosNum = 0; // el teclado propio no puede producirlo, pero no revienta la pantalla
  }
  const gramosPedidosNum = parada ? Number(parada.gramos_pedidos) : 0;
  const gramosValidos = pesoValido(gramosEntregadosNum) && gramosEntregadosNum <= gramosPedidosNum;

  async function confirmar() {
    if (!parada || !fotoSha) return;
    if (!gps) {
      setErrorGps("Esperando la ubicación… si no aparece, revisa el permiso de GPS.");
      return;
    }
    if (!gramosValidos) return;
    // UN SOLO client_uuid para la clave del outbox y para el payload. Antes se
    // generaban dos por separado: el servidor aceptaba la entrega y devolvía el uuid
    // del payload, la cola intentaba borrar por ESE uuid, no encontraba el ítem
    // (guardado bajo el otro) y lo reenviaba para siempre. Con datos móviles eso es
    // una cola que nunca se vacía y consume datos sin parar.
    const clientUuid = crypto.randomUUID();
    clientUuidAParada.current.set(clientUuid, parada.parada_id);
    await encolar({
      clientUuid,
      tipo: "entrega",
      ruta: "/api/sync",
      payload: {
        clientUuid,
        pedidoId: parada.pedido_id,
        receptorNombre: receptor || "No identificado",
        fotoSha256: fotoSha,
        lat: gps.lat,
        lng: gps.lng,
        precisionM: gps.precision,
        gramosEntregados: gramosEntregadosNum,
        capturadoAt: new Date().toISOString(),
      },
    });
    setEntregadasLocal((s) => new Set(s).add(parada.parada_id));
    setPendientes(await contarPendientes());
    setMensaje(
      gramosEntregadosNum < gramosPedidosNum
        ? `Entregada parcial — ${parada.razon_social}: ${formatearKg(gramosEntregadosNum)} de ${formatearKg(gramosPedidosNum)}`
        : `Entregada — ${parada.razon_social}`
    );
    volverALista();
  }

  // "No se pudo entregar": mismo GPS y foto ya capturados en el paso "foto" (misma
  // exigencia de evidencia que una entrega exitosa — el POD es evidencia en los dos
  // casos), pero 0 g entregados y un motivo en vez de receptor/cantidad.
  async function confirmarFallida() {
    if (!parada || !fotoSha) return;
    // A diferencia de la entrega exitosa, la FALLIDA no exige GPS: no se está
    // afirmando haber dejado el pan en ningún punto, y exigirlo dejaba al repartidor
    // sin poder registrar ni el intento dentro de un galpón (migración 0015).
    const motivo =
      motivoFallida === "otro"
        ? motivoOtroTexto.trim()
        : (MOTIVOS_FALLA.find((m) => m.valor === motivoFallida)?.etiqueta ?? "");
    if (!motivo) return;

    const clientUuid = crypto.randomUUID();
    clientUuidAParada.current.set(clientUuid, parada.parada_id);
    await encolar({
      clientUuid,
      tipo: "entrega",
      ruta: "/api/sync",
      payload: {
        clientUuid,
        pedidoId: parada.pedido_id,
        receptorNombre: "No aplica — entrega no realizada",
        fotoSha256: fotoSha,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
        precisionM: gps?.precision ?? null,
        gramosEntregados: 0,
        // `motivoCodigo` es lo que valida el servidor contra el catálogo cerrado
        // (`pod/motivosRechazo.ts`); `motivoRechazo` es el texto legible —igual a la
        // etiqueta salvo en "otro", donde es libre— que el servidor solo usa para "otro".
        motivoCodigo: motivoFallida,
        motivoRechazo: motivo,
        capturadoAt: new Date().toISOString(),
      },
    });
    setEntregadasLocal((s) => new Set(s).add(parada.parada_id));
    setPendientes(await contarPendientes());
    setMensaje(`No se pudo entregar — ${parada.razon_social}: ${motivo}`);
    volverALista();
  }

  if (paso === "foto" && parada) {
    return (
      <Pantalla titulo={parada.razon_social} bajada="Foto de la entrega como comprobante">
        <div
          style={{
            position: "relative",
            aspectRatio: "3 / 4",
            borderRadius: 14,
            overflow: "hidden",
            background: "#000",
            border: `1px solid ${superficie.hairline}`,
          }}
        >
          {stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#fff", fontSize: 14, padding: 16, textAlign: "center" }}>
              {errorCamara ?? "Abriendo la cámara…"}
            </div>
          )}
        </div>

        {errorGps ? <p style={{ color: semantico.error, fontSize: 14, margin: 0 }} role="alert">{errorGps}</p> : null}
        {errorCamara ? <p style={{ color: semantico.error, fontSize: 14, margin: 0 }} role="alert">{errorCamara}</p> : null}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          <BotonPrimario disabled={!stream || capturando} onClick={tomarFoto}>
            {capturando ? "Procesando…" : "Tomar foto"}
          </BotonPrimario>
          <BotonPrimario variante="neutro" onClick={cancelarEntrega}>Cancelar</BotonPrimario>
        </div>
      </Pantalla>
    );
  }

  if (paso === "receptor" && parada) {
    const gpsBox = (
      <div style={{ padding: 14, borderRadius: 12, background: superficie.tarjeta, border: `1px solid ${superficie.hairline}` }}>
        <p style={{ margin: 0, fontSize: 13, color: superficie.textoFaint }}>Foto tomada · GPS</p>
        <p style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 600 }}>
          {gps
            ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} · ±${gps.precision} m${gps.precision > 100 ? " (impreciso, igual sirve)" : ""}`
            : buscandoGps
              ? "Buscando ubicación…"
              : "Sin ubicación todavía"}
        </p>
        {/* Sin este reintento, un GPS que no fija al primer intento dejaba al
            repartidor encerrado: no podía confirmar ni cancelar hacia algo útil. */}
        {!gps && !buscandoGps ? (
          <button
            type="button"
            onClick={pedirUbicacion}
            style={{ marginTop: 8, minHeight: 44, padding: "0 14px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14 }}
          >
            Reintentar ubicación
          </button>
        ) : null}
      </div>
    );

    // "No se pudo entregar": la foto y el GPS ya se tomaron en el paso anterior — se
    // reutilizan tal cual, solo cambia qué se pide después de eso (motivo, no receptor).
    if (modoFallida) {
      const motivoListo =
        motivoFallida === "otro" ? motivoOtroTexto.trim().length > 0 : motivoFallida !== null;
      return (
        <Pantalla titulo={parada.razon_social} bajada={parada.direccion ?? undefined}>
          {gpsBox}

          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim, margin: "0 0 8px" }}>
              ¿Por qué no se pudo entregar?
            </p>
            <SelectorUnToque
              opciones={MOTIVOS_FALLA as unknown as { valor: string; etiqueta: string }[]}
              valor={motivoFallida}
              onCambiar={setMotivoFallida}
            />
          </div>

          {motivoFallida === "otro" ? (
            <input
              value={motivoOtroTexto}
              onChange={(e) => setMotivoOtroTexto(e.target.value)}
              placeholder="Describe brevemente"
              style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17 }}
            />
          ) : null}

          {errorGps ? <p style={{ color: semantico.error, fontSize: 14 }} role="alert">{errorGps}</p> : null}

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <BotonPrimario disabled={!motivoListo} onClick={confirmarFallida}>
              Confirmar: no se pudo entregar
            </BotonPrimario>
            <BotonPrimario variante="neutro" onClick={() => setModoFallida(false)}>Volver</BotonPrimario>
          </div>
        </Pantalla>
      );
    }

    return (
      <Pantalla titulo={parada.razon_social} bajada={parada.direccion ?? undefined}>
        {gpsBox}

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim }}>Quién recibe</span>
          <input
            value={receptor}
            onChange={(e) => setReceptor(e.target.value)}
            style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17 }}
          />
        </label>

        {editandoGramos ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
              <CifraGrande valor={gramosTexto || "0"} unidad="kg" />
            </div>
            <TecladoNumerico valor={gramosTexto} onCambiar={setGramosTexto} permitirDecimal />
            {gramosTexto && !gramosValidos ? (
              <p style={{ color: semantico.error, fontSize: 13, margin: 0 }} role="alert">
                Máximo {formatearKg(gramosPedidosNum)} (lo pedido) — no se puede entregar más de eso
              </p>
            ) : null}
            <BotonPrimario variante="neutro" onClick={() => setEditandoGramos(false)}>Listo</BotonPrimario>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 15, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span>
              Entrega: <strong>{formatearKg(gramosEntregadosNum)}</strong>
              {gramosEntregadosNum < gramosPedidosNum ? ` de ${formatearKg(gramosPedidosNum)} pedidos (parcial)` : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                // Se limpia el campo al entrar a editar: el teclado APENDA, así que
                // sobre el total precargado ("10") tocar 5 daba "105" en vez de 5.
                setGramosTexto("");
                setEditandoGramos(true);
              }}
              style={{ fontSize: 14, fontWeight: 700, color: superficie.textoDim, background: "none", border: "none" }}
            >
              Editar
            </button>
          </p>
        )}

        {errorGps ? <p style={{ color: semantico.error, fontSize: 14 }} role="alert">{errorGps}</p> : null}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          <BotonPrimario disabled={!gps || !gramosValidos} onClick={confirmar}>Confirmar entrega</BotonPrimario>
          <BotonPrimario variante="neutro" onClick={volverALista}>Cancelar</BotonPrimario>
          <button
            type="button"
            onClick={() => setModoFallida(true)}
            style={{ fontSize: 14, fontWeight: 700, color: semantico.error, background: "none", border: "none", padding: "8px 0" }}
          >
            No se pudo entregar
          </button>
        </div>
      </Pantalla>
    );
  }

  const pendientesDeRuta = paradas.filter((p) => !entregadasLocal.has(p.parada_id) && p.estado === "pendiente");

  // A diferencia de /pesar y /vender, que montan el chip solo si hay algo que decir
  // (`pendientes > 0 || !enLinea`), acá va SIEMPRE y es a propósito: /ruta es el módulo
  // offline del maestro («offline es SOLO el módulo de reparto»), se usa en la calle, y el
  // estado de la conexión es información permanente para el repartidor, no una alarma
  // ocasional. Ahora que `online` va cableado, el verde «Sincronizado» dice la verdad.
  return (
    <Pantalla titulo="Mi ruta" accesorio={<ChipEstadoConexion pendientes={pendientes} online={enLinea} />}>
      {mensaje ? (
        <p role="status" style={{ color: semantico.ok, fontSize: 14, margin: 0 }}>{mensaje}</p>
      ) : null}

      {/* Tres estados distintos, nunca uno solo: buscando / no se pudo / de verdad
          no hay. Antes los tres se veían iguales y el repartidor no tenía cómo
          distinguir "hoy no hay reparto" de "la app no pudo preguntar". */}
      {pendientesDeRuta.length === 0 && cargandoRuta ? (
        <div style={{ padding: 24, textAlign: "center", color: superficie.textoDim }}>
          <p style={{ fontSize: 15 }}>Buscando tu ruta…</p>
        </div>
      ) : pendientesDeRuta.length === 0 && errorRuta ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 15, color: semantico.error }} role="alert">
            No se pudo cargar tu ruta. NO quiere decir que no tengas reparto hoy —
            revisa la señal y reintenta antes de volver.
          </p>
          <button
            type="button"
            onClick={() => { setCargandoRuta(true); void cargarRuta(); }}
            style={{ marginTop: 12, minHeight: 44, padding: "0 16px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14 }}
          >
            Reintentar
          </button>
        </div>
      ) : pendientesDeRuta.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: superficie.textoDim }}>
          <CifraGrande valor={String(paradas.length - pendientesDeRuta.length)} />
          <p style={{ fontSize: 15 }}>
            {paradas.length === 0 ? "No tienes paradas hoy." : "Todas las paradas entregadas."}
          </p>
        </div>
      ) : null}

      {pendientesDeRuta.map((p, i) => {
        const esActiva = i === 0;
        return (
          <div
            key={p.parada_id}
            style={{
              background: superficie.tarjeta,
              border: esActiva ? `2px solid ${acentos.kilopan}` : `1px solid ${superficie.hairline}`,
              borderRadius: 14,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>
                {p.orden}. {p.razon_social}
              </span>
              <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: superficie.textoDim }}>
                {formatearKg(Number(p.gramos_pedidos))}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: superficie.textoDim }}>{p.direccion}</p>
            {esActiva ? (
              <BotonPrimario onClick={() => iniciarEntrega(p.parada_id)}>Entregar</BotonPrimario>
            ) : null}
          </div>
        );
      })}
    </Pantalla>
  );
}
