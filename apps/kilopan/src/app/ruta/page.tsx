"use client";
import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, ChipEstadoConexion, CifraGrande } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";
import { formatearKg } from "@/comun/formato.ts";
import { encolar, iniciarSyncAutomatico, contarPendientes } from "@/pod/outbox.ts";

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
  const [paso, setPaso] = useState<"lista" | "foto" | "receptor">("lista");
  const [receptor, setReceptor] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number; precision: number } | null>(null);
  const [errorGps, setErrorGps] = useState<string | null>(null);
  const [fotoSha, setFotoSha] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [entregadasLocal, setEntregadasLocal] = useState<Set<string>>(new Set());

  const cargarRuta = useCallback(async () => {
    try {
      const r = await fetch("/api/rutas/mi-ruta");
      if (!r.ok) return;
      const d = await r.json();
      setParadas(d.paradas ?? []);
    } catch {
      // sin señal: se sigue con lo que ya está en pantalla (snapshot del día)
    }
  }, []);

  useEffect(() => {
    void cargarRuta();
    const detener = iniciarSyncAutomatico(setPendientes);
    void contarPendientes().then(setPendientes);
    return detener;
  }, [cargarRuta]);

  const parada = paradas.find((p) => p.parada_id === activa) ?? null;

  // El obturador: en la app real es getUserMedia. Acá se captura el hash de la imagen,
  // que es lo que viaja en la cola — la foto se sube aparte (multipart) y el servidor
  // marca 'subida' al verificar el sha256.
  async function capturarFoto() {
    setMensaje(null);
    // GPS: permiso DENEGADO bloquea y lo dice; precisión mala JAMÁS bloquea.
    if (!navigator.geolocation) {
      setErrorGps("Este equipo no tiene GPS. No se puede confirmar la entrega.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: Math.round(pos.coords.accuracy) });
        setErrorGps(null);
      },
      () => {
        setErrorGps("Sin permiso de ubicación. Actívalo para poder confirmar la entrega.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
    // sha256 de un buffer que en producción es el JPEG del obturador
    const semilla = new TextEncoder().encode(`${activa}-${Date.now()}`);
    const hash = await crypto.subtle.digest("SHA-256", semilla);
    setFotoSha([...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join(""));
    setReceptor(parada?.contacto_nombre ?? "");
    setPaso("receptor");
  }

  async function confirmar() {
    if (!parada || !fotoSha) return;
    if (!gps) {
      setErrorGps("Esperando la ubicación… si no aparece, revisa el permiso de GPS.");
      return;
    }
    // UN SOLO client_uuid para la clave del outbox y para el payload. Antes se
    // generaban dos por separado: el servidor aceptaba la entrega y devolvía el uuid
    // del payload, la cola intentaba borrar por ESE uuid, no encontraba el ítem
    // (guardado bajo el otro) y lo reenviaba para siempre. Con datos móviles eso es
    // una cola que nunca se vacía y consume datos sin parar.
    const clientUuid = crypto.randomUUID();
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
        gramosEntregados: Number(parada.gramos_pedidos),
        capturadoAt: new Date().toISOString(),
      },
    });
    setEntregadasLocal((s) => new Set(s).add(parada.parada_id));
    setPendientes(await contarPendientes());
    setMensaje(`Entregada — ${parada.razon_social}`);
    setPaso("lista");
    setActiva(null);
    setFotoSha(null);
    setGps(null);
  }

  if (paso === "receptor" && parada) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16, minHeight: "100dvh" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{parada.razon_social}</h1>
        <p style={{ margin: 0, color: superficie.textoDim, fontSize: 15 }}>{parada.direccion}</p>

        <div style={{ padding: 14, borderRadius: 12, background: superficie.tarjeta, border: `1px solid ${superficie.hairline}` }}>
          <p style={{ margin: 0, fontSize: 13, color: superficie.textoFaint }}>Foto tomada · GPS</p>
          <p style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 600 }}>
            {gps
              ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} · ±${gps.precision} m${gps.precision > 100 ? " (impreciso, igual sirve)" : ""}`
              : "Buscando ubicación…"}
          </p>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: superficie.textoDim }}>Quién recibe</span>
          <input
            value={receptor}
            onChange={(e) => setReceptor(e.target.value)}
            style={{ minHeight: 44, borderRadius: 12, border: `1px solid ${superficie.hairline}`, padding: "0 14px", fontSize: 17 }}
          />
        </label>

        <p style={{ margin: 0, fontSize: 15 }}>
          Entrega: <strong>{formatearKg(Number(parada.gramos_pedidos))}</strong>
        </p>

        {errorGps ? <p style={{ color: semantico.error, fontSize: 14 }} role="alert">{errorGps}</p> : null}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          <BotonPrimario disabled={!gps} onClick={confirmar}>Confirmar entrega</BotonPrimario>
          <BotonPrimario variante="neutro" onClick={() => { setPaso("lista"); setActiva(null); }}>Cancelar</BotonPrimario>
        </div>
      </main>
    );
  }

  const pendientesDeRuta = paradas.filter((p) => !entregadasLocal.has(p.parada_id) && p.estado === "pendiente");

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Mi ruta</h1>
        <ChipEstadoConexion pendientes={pendientes} />
      </div>

      {mensaje ? (
        <p role="status" style={{ color: semantico.ok, fontSize: 14, margin: 0 }}>{mensaje}</p>
      ) : null}

      {pendientesDeRuta.length === 0 ? (
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
              <BotonPrimario
                onClick={() => {
                  setActiva(p.parada_id);
                  void capturarFoto();
                }}
              >
                Entregar
              </BotonPrimario>
            ) : null}
          </div>
        );
      })}
    </main>
  );
}
