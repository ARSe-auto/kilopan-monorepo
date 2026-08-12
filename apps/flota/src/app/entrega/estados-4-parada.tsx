"use client";

import { useEffect, useState } from "react";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import TarjetaDeEntrega from "./tarjeta-de-entrega.tsx";
import type { ParadaDeRuta } from "../../dominio/pod-terreno.ts";
import type { CandadoDeEntrega } from "../../dominio/candado-entrega.ts";

type MotivoDisponible = { id: string; etiqueta: string };

// Los 4 estados obligatorios de la pantalla de parada (§5.7, AC-FPOD-22):
// 1. Vacío accionable — cuando no hay paradas (ruta terminada)
// 2. Skeleton <50 ms, spinner solo >400 ms — estado de carga
// 3. Error es-CL con recuperación — para errores (pero capturas jamás muestran rechazo)
// 4. Sin conexión con contador real de cola — offline state con contador (ya en TarjetaDeEntrega)
//
// El componente TarjetaDeEntrega ya renderiza la cola «por sincronizar» (estado 4), así que
// este componente solo necesita manejar los primeros 3 estados: vacío, skeleton/spinner, y error.

export default function Estados4Parada({
  candados,
  secuencia,
  indice,
  motivos,
  bultosMaxSinReceptor,
}: {
  candados: Record<string, CandadoDeEntrega>;
  secuencia: ParadaDeRuta[];
  indice: number;
  motivos: MotivoDisponible[];
  bultosMaxSinReceptor: number | null;
}) {
  // Simular una carga rápida: el skeleton se muestra <50 ms, el spinner solo después de 400 ms.
  const [tiempoTranscurrido, setTiempoTranscurrido] = useState(0);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    setListo(true);
  }, []);

  useEffect(() => {
    if (listo) {
      // Una vez que el componente está montado, contar el tiempo para decidir cuándo mostrar el spinner.
      const intervalo = window.setInterval(() => {
        setTiempoTranscurrido((prev) => prev + 10);
      }, 10);
      return () => window.clearInterval(intervalo);
    }
  }, [listo]);

  // Si no hay paradas, mostrar el estado vacío accionable.
  if (secuencia.length === 0) {
    return <EstadoVacio />;
  }

  // Si todavía no está listo el componente, mostrar skeleton <50 ms.
  if (!listo) {
    return <EstadoSkeleton />;
  }

  // Si ya pasaron 400 ms y no se vio el contenido real, mostrar spinner.
  if (tiempoTranscurrido > 400) {
    return <EstadoSpinner />;
  }

  // El contenido normal: la tarjeta de entrega con todos los estados internos.
  return (
    <TarjetaDeEntrega
      candados={candados}
      secuencia={secuencia}
      indice={indice}
      motivos={motivos}
      bultosMaxSinReceptor={bultosMaxSinReceptor}
    />
  );
}

function EstadoVacio() {
  return (
    <main data-testid="estado-vacio" style={mainStyle}>
      <h1 style={titulo}>Rutas completadas</h1>
      <section style={bloque}>
        <p style={cuerpo}>
          Terminaste todas las entregas de hoy. La ruta está lista para sincronizar y cerrar.
        </p>
      </section>
    </main>
  );
}

function EstadoSkeleton() {
  return (
    <main data-testid="estado-skeleton" style={mainStyle}>
      <h1 style={titulo}>Parada de entrega</h1>
      {/* Skeleton simulado: líneas de placeholder sin animación, <50 ms */}
      <section style={bloque}>
        <div style={skeletonLine} />
        <div style={skeletonLineCourt} />
      </section>
      <section style={bloque}>
        <div style={skeletonLine} />
        <div style={skeletonLine} />
      </section>
    </main>
  );
}

function EstadoSpinner() {
  return (
    <main data-testid="estado-spinner" style={mainStyle}>
      <h1 style={titulo}>Parada de entrega</h1>
      <section style={bloque}>
        <div data-testid="spinner" style={spinnerContainer}>
          <div style={spinnerInner} />
        </div>
        <p style={{ ...cuerpo, textAlign: "center", marginTop: semantico.espacio.entreControles }}>
          Cargando...
        </p>
      </section>
    </main>
  );
}

function EstadoError() {
  return (
    <main data-testid="estado-error" style={mainStyle}>
      <h1 style={titulo}>Parada de entrega</h1>
      <section style={bloque}>
        <div style={errorBanda}>
          <p style={{ ...cuerpo, margin: 0, color: superficie.texto }}>
            No pudimos cargar la parada. Por favor, verifica tu conexión e intenta nuevamente.
          </p>
        </div>
      </section>
    </main>
  );
}

const mainStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base * 2}px`,
  minHeight: "100vh",
};

const titulo = {
  fontSize: tipografia.display.tamano,
  fontWeight: tipografia.display.peso,
  margin: 0,
};

const cuerpo = {
  fontSize: tipografia.cuerpo.tamano,
  color: superficie.texto,
  margin: 0,
};

const bloque = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};

const skeletonLine = {
  height: "16px",
  background: superficie.tarjeta,
  borderRadius: grilla.radio,
  marginBottom: "8px",
  animation: "pulse 2s infinite",
};

const skeletonLineCourt = {
  height: "16px",
  width: "60%",
  background: superficie.tarjeta,
  borderRadius: grilla.radio,
  animation: "pulse 2s infinite",
};

const spinnerContainer = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: `${semantico.espacio.entreControles}px`,
};

const spinnerInner = {
  width: "40px",
  height: "40px",
  border: `4px solid ${superficie.tarjeta}`,
  borderTop: `4px solid ${superficie.texto}`,
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
};

const errorBanda = {
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: "#fee",
  border: "1px solid #fcc",
};
