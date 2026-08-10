"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, EstadoVacio, EstadoError, EstadoCargando } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, semantico as colorSemantico, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";
import { fechaEsCl, horaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";

// El tablero «Listos para salir» (F1) [AC-FVEH-12] — §5.2-F1, §3.E1.12, §5.7, §5.1.
//
// ─── LO QUE ESTA PANTALLA PUEDE AFIRMAR HOY, Y LO QUE NO ──────────────────────────
//
// El «necesario» —cuántos km pide el plan del día— lo suministra el hito (d) con
// `rutas.km_presupuesto_energia`. Hasta entonces no hay contra qué comparar, así que el
// semáforo no dice «alcanza» ni «no alcanza»: dice qué falta. Afirmar que un camión llega sin
// saber a dónde va es exactamente el cálculo con folleto que el Anexo A prohíbe — 305 km de
// catálogo contra 185–245 reales.
//
// ─── EL VACÍO ES ACCIONABLE, NO UN GUION ─────────────────────────────────────────
//
// Cuando falta un dato EV, la fila NOMBRA cuál (§5.7). Un «—» le dice a quien mira que no hay
// número; decirle «falta la autonomía» le dice qué cargar y dónde.
//
// ─── LA SUGERENCIA SUGIERE ───────────────────────────────────────────────────────
//
// Un clic devuelve la ventana concreta que la agenda del vehículo deja libre esta noche. Que
// ese clic CREE el bloque o pida confirmación antes es la pregunta 14 de la spec 02: la
// pantalla muestra la propuesta y lo dice con todas las letras en vez de decidirlo sola.

type Fila = {
  vehiculo_id: string;
  patente: string;
  soc: number | null;
  rango_efectivo_km: number | null;
  max_distance_km: number | null;
  semaforo: "alcanza" | "no_alcanza" | "sin_datos";
  falta: string[];
};

type Sugerencia = { empieza_en: string; termina_en: string };

const TEXTO_DEL_SEMAFORO: Record<Fila["semaforo"], string> = {
  alcanza: "Alcanza",
  no_alcanza: "No alcanza — recargá antes de salir",
  sin_datos: "Sin plan del día todavía",
};

const redondo = (n: number | null) => (n === null ? null : Math.round(n));

export default function ListosParaSalir() {
  const [flota, setFlota] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sugerencias, setSugerencias] = useState<Record<string, Sugerencia | string>>({});

  const cargar = useCallback(async () => {
    const respuesta = await pedir("/api/tablero").catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo leer el tablero. Revisá tu conexión.");
    setFlota(((await respuesta.json()) as { flota: Fila[] }).flota);
    setError(null);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function sugerir(vehiculoId: string) {
    const respuesta = await pedir("/api/tablero/sugerir-recarga", {
      method: "POST",
      body: JSON.stringify({ vehiculo_id: vehiculoId, desde: new Date().toISOString() }),
    }).catch(() => null);
    const cuerpo = (await respuesta?.json().catch(() => ({}))) as {
      sugerencia?: Sugerencia;
      mensaje?: string;
    };
    setSugerencias((previas) => ({
      ...previas,
      [vehiculoId]: cuerpo.sugerencia ?? cuerpo.mensaje ?? "No se pudo calcular la sugerencia.",
    }));
  }

  return (
    <main data-testid="listos-para-salir">
      <h1 style={titulo}>Listos para salir</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}
      {!error && flota === null && <EstadoCargando filas={3} />}
      {!error && flota?.length === 0 && (
        <EstadoVacio mensaje="No hay vehículos activos. Cuando des de alta uno, aparece acá con su estado de carga." />
      )}

      {flota?.map((v) => {
        const sugerencia = sugerencias[v.vehiculo_id];
        return (
          <article key={v.vehiculo_id} data-testid="fila-tablero" style={tarjeta}>
            <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>{v.patente}</p>

            {/* SIEMPRE con texto, jamás solo color (§5.1). */}
            <p data-testid={`semaforo-${v.patente}`} style={textoDelSemaforo(v.semaforo)}>
              {TEXTO_DEL_SEMAFORO[v.semaforo]}
            </p>

            {v.falta.length > 0 ? (
              // Vacío ACCIONABLE: nombra QUÉ falta, no un guion (§5.7).
              <p data-testid={`falta-${v.patente}`} style={pieDim}>
                Para saber si alcanza falta cargar: {v.falta.join(", ")}.
              </p>
            ) : (
              <p data-testid={`alcance-${v.patente}`} style={pieDim}>
                Carga {v.soc}% · alcanza unos {redondo(v.max_distance_km)} km con la reserva ya
                descontada (rango efectivo {redondo(v.rango_efectivo_km)} km).
              </p>
            )}

            <BotonPrimario
              testid={`sugerir-${v.patente}`}
              variante="neutro"
              onClick={() => void sugerir(v.vehiculo_id)}
            >
              Sugerir recarga nocturna
            </BotonPrimario>

            {sugerencia && (
              <p data-testid={`sugerencia-${v.patente}`} style={pieDim}>
                {typeof sugerencia === "string"
                  ? sugerencia
                  : `Hueco libre: ${fechaEsCl(new Date(sugerencia.empieza_en))} de ${horaEsCl(
                      new Date(sugerencia.empieza_en),
                    )} a ${horaEsCl(new Date(sugerencia.termina_en))}.`}
              </p>
            )}
          </article>
        );
      })}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pieDim = { fontSize: tipografia.pie.tamano, color: superficie.textoDim, margin: 0 };
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  marginTop: semantico.espacio.entreTarjetas,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
const textoDelSemaforo = (estado: Fila["semaforo"]) => ({
  ...cuerpo,
  margin: 0,
  fontWeight: enfasis.fuerte,
  color:
    estado === "alcanza"
      ? colorSemantico.ok
      : estado === "no_alcanza"
        ? colorSemantico.error
        : superficie.textoDim,
});
