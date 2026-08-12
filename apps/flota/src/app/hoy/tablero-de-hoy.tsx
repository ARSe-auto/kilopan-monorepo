"use client";

import { useState } from "react";
import { superficie, tipografia, grilla, enfasis, semantico as colores } from "@kilopan/miga/tokens.ts";
import { semantico as layout } from "@kilopan/miga/estructura.ts";
import { CifraGrande } from "@kilopan/miga/componentes/index.tsx";
import type { ColorSemaforo, TarjetaHoy } from "../../dominio/semaforo.ts";
import type { FilaPeek } from "../../dominio/peek-n1.ts";
import { fechaEsCl, horaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";
import { PeekN1 } from "./peek-n1.tsx";

// Nivel 0 del «Hoy» (spec 05, §2.1) [AC-FSEM-01].
//
// Cero toques en el TABLERO (§5.6-N0): las tarjetas no navegan ni abren nada por sí solas. El
// peek de 1 toque (N1, §2.2) SÍ abre un bottom-sheet sobre las tarjetas amarillo/rojo — es
// justo lo que las distingue de verde, que no comunica nada más que el agregado — y por eso
// no cuenta como navegación (la pila del §5.1 no crece): es estado local de este componente,
// no una ruta [AC-FSEM-04].

const ETIQUETA_COLOR: Record<ColorSemaforo, string> = {
  verde: "Verde",
  amarillo: "Amarillo",
  rojo: "Rojo",
};

const FONDO_COLOR: Record<ColorSemaforo, string> = {
  verde: colores.ok,
  amarillo: colores.alerta,
  rojo: colores.error,
};

export function TableroHoy({
  tarjetas,
  peekPorDominio,
  seed,
}: {
  tarjetas: TarjetaHoy[];
  peekPorDominio: Record<string, FilaPeek[]>;
  seed: string;
}) {
  const [abiertoDominio, setAbiertoDominio] = useState<string | null>(null);
  // Overrides LOCALES del demo (§ arriba): `id de fila -> nueva estado tras tocar «Reconocer»`.
  // La transición de verdad vive en el servidor; acá solo refleja el toque en la pantalla.
  const [reconocidasLocal, setReconocidasLocal] = useState<ReadonlySet<string>>(new Set());

  const tarjetaAbierta = tarjetas.find((t) => t.clave === abiertoDominio) ?? null;
  const filasAbiertas = abiertoDominio ? (peekPorDominio[abiertoDominio] ?? []) : [];
  const filasConOverride = filasAbiertas.map((f) => (reconocidasLocal.has(f.id) ? { ...f, estado: "reconocida" as const } : f));

  return (
    <div
      data-testid="tablero-hoy"
      style={{
        display: "grid",
        gap: layout.espacio.entreTarjetas,
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
      }}
    >
      {tarjetas.map((tarjeta) => (
        <TarjetaDelTablero
          key={tarjeta.clave}
          tarjeta={tarjeta}
          onAbrir={tarjeta.color === "verde" ? undefined : () => setAbiertoDominio(tarjeta.clave)}
        />
      ))}
      {tarjetaAbierta ? (
        <PeekN1
          titulo={tarjetaAbierta.titulo}
          filas={filasConOverride}
          seed={seed}
          onCerrar={() => setAbiertoDominio(null)}
          onReconocer={(id) => setReconocidasLocal((previo) => new Set(previo).add(id))}
        />
      ) : null}
    </div>
  );
}

const ESTILO_TARJETA = {
  display: "grid",
  gap: layout.espacio.entreControles,
  padding: `${grilla.base * 2}px`,
  borderRadius: layout.esquina.tarjeta,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
  textAlign: "left",
  font: "inherit",
  width: "100%",
} as const;

function TarjetaDelTablero({ tarjeta, onAbrir }: { tarjeta: TarjetaHoy; onAbrir?: () => void }) {
  const contenido = <ContenidoDeTarjeta tarjeta={tarjeta} />;

  // Verde no abre nada (§5.6-N0: no hay peek de un dominio sin excepciones) — sigue siendo
  // un `<article>` de solo lectura. Amarillo/rojo son el toque de entrada al peek (§2.2) y
  // por eso son un `<button>` real: teclado y lector de pantalla lo anuncian como acción.
  if (!onAbrir) {
    return (
      <article data-testid="tarjeta-hoy" data-dominio={tarjeta.clave} data-color={tarjeta.color} style={ESTILO_TARJETA}>
        {contenido}
      </article>
    );
  }
  return (
    <button
      type="button"
      data-testid="tarjeta-hoy"
      data-dominio={tarjeta.clave}
      data-color={tarjeta.color}
      onClick={onAbrir}
      style={{ ...ESTILO_TARJETA, cursor: "pointer" }}
    >
      {contenido}
    </button>
  );
}

function ContenidoDeTarjeta({ tarjeta }: { tarjeta: TarjetaHoy }) {
  return (
    <>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: grilla.base }}>
        <h2 style={{ margin: 0, fontSize: tipografia.titulo.tamano, fontWeight: tipografia.titulo.peso }}>
          {tarjeta.titulo}
        </h2>
        {/* AA: el color NUNCA es la única señal — la palabra viaja siempre, aunque el punto
            de color se apague con CSS (§5.6, oráculo conductual en AC-FSEM-12). */}
        <span
          data-testid="color-tarjeta"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: grilla.base / 2,
            fontSize: tipografia.pie.tamano,
            fontWeight: enfasis.fuerte,
            color: FONDO_COLOR[tarjeta.color],
          }}
        >
          <span
            aria-hidden
            style={{
              width: grilla.base,
              height: grilla.base,
              borderRadius: "50%",
              background: FONDO_COLOR[tarjeta.color],
            }}
          />
          {ETIQUETA_COLOR[tarjeta.color]}
        </span>
      </header>

      {tarjeta.color === "verde" ? (
        // Verde = SOLO agregado. Ni contador ni excepción: no hay nada que revisar.
        <div data-testid="agregado-verde">
          <CifraGrande valor={tarjeta.agregadoTexto ?? ""} />
        </div>
      ) : (
        <div style={{ display: "grid", gap: layout.espacio.entreControles }}>
          <p style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.fuerte }}>
            <span data-testid="contador-excepciones">{tarjeta.contadorExcepciones}</span>{" "}
            {tarjeta.contadorExcepciones === 1 ? "excepción" : "excepciones"}
          </p>
          {tarjeta.excepcionMasAntigua ? (
            <p data-testid="excepcion-mas-antigua" style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, color: superficie.textoDim }}>
              {tarjeta.excepcionMasAntigua.descripcion}
              {" — desde "}
              {fechaEsCl(tarjeta.excepcionMasAntigua.record_time)} {horaEsCl(tarjeta.excepcionMasAntigua.record_time)}
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
