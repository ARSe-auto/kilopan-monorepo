"use client";
import { useEffect, useState } from "react";
import { CifraGrande, TecladoNumerico, BotonPrimario } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { formatearClp, parsearClp } from "@/comun/formato.ts";
import { Pantalla } from "../Pantalla.tsx";
import { SiguientePaso } from "../SiguientePaso.tsx";

// AC-VEN-05: la tabla pan.turnos y el arqueo por turno ya existen
// (0018_turnos_cierre_caja.sql, decisión del dueño 1-ago-2026: "por turno, con
// apertura explícita") — lo que faltaba era esta pantalla, sin la cual el arqueo
// tiene sujeto en la base pero nadie lo declara desde la app
// (docs/PROMPT_CORRECTIVO.md §5, Ola 2). Dos toques: teclear el fondo (uno) y
// confirmar (dos) — nada de pantallas ni modales intermedios.
export default function AperturaTurnoPage() {
  const [fondo, setFondo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [yaAbierto, setYaAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fondoAbierto, setFondoAbierto] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/turnos/actual")
      .then((r) => r.json())
      .then((d) => setYaAbierto(!!d.turno))
      .catch(() => {})
      .finally(() => setCargando(false));
  }, []);

  async function abrir() {
    if (enviando) return; // dos toques, no tres: un segundo tap con las manos ocupadas no debe abrir dos turnos
    setEnviando(true);
    setError(null);
    try {
      const fondoInicialClp = parsearClp(fondo || "0");
      const r = await fetch("/api/turnos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fondoInicialClp }),
      });
      const cuerpo = await r.json();
      if (!r.ok) {
        setError(cuerpo.error ?? "No se pudo abrir el turno");
        return;
      }
      setFondoAbierto(fondoInicialClp);
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Pantalla titulo="Abrir turno" bajada="Anota la plata con la que partes la caja hoy." ancho={420}>
      {cargando ? (
        <p style={{ color: superficie.textoDim, fontSize: 14 }}>Cargando…</p>
      ) : fondoAbierto != null ? (
        <SiguientePaso
          texto={`Turno abierto con ${formatearClp(fondoAbierto)}`}
          detalle="Ya puedes vender."
          acciones={[{ etiqueta: "Vender en el mesón", href: "/vender" }]}
        />
      ) : yaAbierto ? (
        <SiguientePaso
          texto="Ya tienes un turno abierto en este equipo"
          acciones={[{ etiqueta: "Vender en el mesón", href: "/vender" }]}
        />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
            <CifraGrande valor={fondo || "0"} unidad="CLP" />
          </div>
          <TecladoNumerico valor={fondo} onCambiar={setFondo} />
          {error ? (
            <p role="alert" style={{ color: semantico.error, fontSize: 14 }}>
              {error}
            </p>
          ) : null}
          <BotonPrimario onClick={abrir} disabled={enviando}>
            {enviando ? "Abriendo…" : "Abrir turno"}
          </BotonPrimario>
        </>
      )}
    </Pantalla>
  );
}
