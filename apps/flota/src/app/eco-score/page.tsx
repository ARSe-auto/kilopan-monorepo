"use client";

import { useCallback, useEffect, useState } from "react";
import { EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";

// Eco-score v1 sin hardware [AC-FTEL-08] — §11 punto 6: consumo declarado (kilometraje) contra
// el presupuesto de energía de las rutas, por chofer y por semana. Mismo criterio de pantalla
// que `torre-de-control/page.tsx` (AC-FTEL-04): cliente puro que solo pide `pedir()`, el
// confinamiento por tenant y por rol vive ENTERO en `/api/eco-score`.
//
// EL AVISO NO ES DECORATIVO: es la mitad del AC. La pantalla dice qué mide (eficiencia
// energética DECLARADA) y qué NO (no es medición de manejo en tiempo real, no hay sensor a
// bordo) — texto fijo servido por el propio endpoint (`AVISO_ECO_SCORE`), para que la pantalla
// y el dominio nunca puedan decir cosas distintas.

type FilaEcoScore =
  | { tipo: "vacio"; choferId: string; choferNombre: string; semana: string }
  | {
      tipo: "ok";
      choferId: string;
      choferNombre: string;
      semana: string;
      kmRecorridos: number;
      kmPresupuestoEnergia: number;
      consumoPct: number;
      rutasConsideradas: number;
    };

function semanaLegible(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}-${mes}-${anio}`;
}

export default function EcoScore() {
  const [semanas, setSemanas] = useState<FilaEcoScore[] | undefined>(undefined);
  const [aviso, setAviso] = useState<string>("");
  const [error, setError] = useState(false);
  const [sinAcceso, setSinAcceso] = useState(false);

  const cargar = useCallback(async () => {
    setError(false);
    const respuesta = await pedir("/api/eco-score").catch(() => null);
    if (!respuesta) return setError(true);
    if (respuesta.status === 403) return setSinAcceso(true);
    if (!respuesta.ok) return setError(true);
    const datos = (await respuesta.json()) as { semanas: FilaEcoScore[]; aviso: string };
    setSemanas(datos.semanas);
    setAviso(datos.aviso);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (sinAcceso) {
    return (
      <main data-testid="eco-score-sin-acceso">
        <h1 style={titulo}>Eco-score</h1>
        <EstadoVacio mensaje="Este panel es de operación o administración." />
      </main>
    );
  }

  return (
    <main data-testid="eco-score">
      <h1 style={titulo}>Eco-score</h1>
      <p data-testid="eco-score-aviso" style={avisoEstilo}>
        {aviso || "Eficiencia energética DECLARADA, no medición de manejo en tiempo real."}
      </p>

      {error && (
        <EstadoError
          mensaje="No se pudo cargar el eco-score. Revisá tu conexión."
          alReintentar={() => void cargar()}
        />
      )}
      {semanas === undefined && !error && <EstadoCargando filas={4} />}

      {semanas && semanas.length === 0 && !error && (
        <EstadoVacio mensaje="Todavía no hay rutas con presupuesto de energía cargado. En cuanto una ruta lo tenga, el eco-score de su chofer aparece acá." />
      )}

      {semanas && semanas.length > 0 && (
        <ul
          data-testid="eco-score-lista"
          style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas }}
        >
          {semanas.map((s) => (
            <li key={`${s.choferId}-${s.semana}`} data-testid={`eco-score-fila-${s.choferId}-${s.semana}`} style={tarjeta}>
              <div>
                <span style={{ ...cuerpo, fontWeight: enfasis.medio }}>{s.choferNombre}</span>
                <span style={pie}> · semana del {semanaLegible(s.semana)}</span>
              </div>
              {s.tipo === "ok" ? (
                <span data-testid={`eco-score-pct-${s.choferId}-${s.semana}`} style={{ ...cuerpo, fontVariantNumeric: "tabular-nums" }}>
                  {s.consumoPct}% del presupuesto · {s.kmRecorridos} km de {s.kmPresupuestoEnergia} km
                </span>
              ) : (
                <span data-testid={`eco-score-vacio-${s.choferId}-${s.semana}`} style={{ ...pie, color: superficie.textoFaint }}>
                  Sin presupuesto de energía cargado esa semana
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pie = { fontSize: tipografia.pie.tamano, margin: 0, color: superficie.textoDim };
const avisoEstilo = { ...pie, marginTop: grilla.base / 2, maxWidth: 560 };
const tarjeta = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: grilla.base,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
