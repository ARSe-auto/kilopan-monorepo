"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BotonPrimario,
  CifraGrande,
  TecladoNumerico,
  EstadoVacio,
  EstadoError,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../../cliente/aparato.ts";

// El cierre del turno (F5) [AC-FVEH-21] — §5.2-F5, §5.3, §5.7, §7.6.
//
// ─── ≤6 TOQUES, Y LA NOTA TIENE QUE CABER ADENTRO ─────────────────────────────────
//
//   1 · «Está todo bien» del chequeo post      4 · confirmar los dos
//   2 · el campo del odómetro (teclado propio) 5 · «Sí» o «No» del enchufe, que CIERRA
//   3 · el campo de la carga
//
// Cinco, con uno de margen para la nota opcional. El odómetro y la carga van en la MISMA
// pantalla con un solo «Continuar» a propósito: separarlos costaba un toque más y dejaba la
// nota fuera del presupuesto — y la nota es lo que le llega a la persona que abre mañana.
//
// ─── LA NOTA ES OPCIONAL, SIEMPRE ─────────────────────────────────────────────────
//
// El §7.6 prohíbe el tipeo libre OBLIGATORIO en ruta. Quien tiene algo que decir lo escribe;
// quien no, cierra sin tocarla. Un campo obligatorio acá produciría notas como «ok» y «nada»
// que enseñan a ignorar el recuadro entero.
//
// ─── «¿QUEDÓ ENCHUFADO?» ES EL BOTÓN QUE CIERRA ───────────────────────────────────
//
// No es una pregunta más seguida de un «Confirmar»: la respuesta ES el cierre. Así el §5.2-F5
// queda en cinco toques y la pregunta no se puede saltar — el rojo del Anexo B se apoya en
// poder distinguir «no quedó» de «nadie preguntó».

type TurnoAbierto = { id: string; vehiculo_id: string; patente: string };
type Paso = "chequeo" | "lecturas" | "enchufe";

const ITEMS = ["Luces", "Frenos", "Neumáticos", "Carrocería"];

export default function CerrarTurno() {
  const [turno, setTurno] = useState<TurnoAbierto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [paso, setPaso] = useState<Paso>("chequeo");
  const [fallados, setFallados] = useState<string[]>([]);
  const [nota, setNota] = useState("");
  const [escribiendoNota, setEscribiendoNota] = useState(false);
  const [odometro, setOdometro] = useState("");
  const [carga, setCarga] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cerrado, setCerrado] = useState(false);

  const cargar = useCallback(async () => {
    const respuesta = await pedir("/api/turnos/abierto").catch(() => null);
    setCargando(false);
    if (!respuesta?.ok) return setError("No se pudo leer tu turno. Revisá tu conexión.");
    const { turno: abierto } = (await respuesta.json()) as { turno: TurnoAbierto | null };
    setTurno(abierto);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cerrar(enchufado: boolean) {
    setError(null);
    if (!turno) return;

    // Las capturas van PRIMERO y por sus propias puertas: si alguna fallara, el cierre igual
    // ocurre después y el chofer no se queda con el turno abierto (§4.2).
    await pedir("/api/chequeos", {
      method: "POST",
      body: JSON.stringify({
        inspectable_tipo: "vehiculos",
        inspectable_id: turno.vehiculo_id,
        momento: "post",
        turno_id: turno.id,
        fallados,
        nota: nota.trim() === "" ? null : nota.trim(),
        client_uuid: crypto.randomUUID(),
        ts_dispositivo: new Date().toISOString(),
      }),
    }).catch(() => null);

    for (const [magnitud, valor] of [
      ["odometro", odometro],
      ["soc", carga],
    ] as const) {
      if (valor === "") continue;
      await pedir("/api/lecturas", {
        method: "POST",
        body: JSON.stringify({
          magnitud,
          valor: Number(valor),
          turno_id: turno.id,
          client_uuid: crypto.randomUUID(),
          ts_dispositivo: new Date().toISOString(),
        }),
      }).catch(() => null);
    }

    const respuesta = await pedir(`/api/turnos/${turno.id}/cierre`, {
      method: "POST",
      body: JSON.stringify({ enchufado }),
    }).catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo cerrar el turno. Volvé a intentar.");
    setCerrado(true);
    return undefined;
  }

  if (cerrado) {
    return (
      <main data-testid="turno-cerrado">
        <h1 style={titulo}>Turno cerrado</h1>
        <p style={cuerpo}>Listo por hoy. Gracias.</p>
      </main>
    );
  }

  if (!cargando && !turno) {
    return (
      <main data-testid="pantalla-cierre">
        <h1 style={titulo}>Cerrar turno</h1>
        <EstadoVacio mensaje="No tenés ningún turno abierto. Cuando abras uno, vas a poder cerrarlo desde acá." />
      </main>
    );
  }

  return (
    <main data-testid="pantalla-cierre">
      <h1 style={titulo}>Cerrar turno</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}

      {paso === "chequeo" && (
        <section data-testid="paso-chequeo-post" style={bloque}>
          <h2 style={subtitulo}>¿Cómo dejás el vehículo?</h2>
          <BotonPrimario testid="todo-bien-post" onClick={() => setPaso("lecturas")}>
            Está todo bien
          </BotonPrimario>
          <div style={chips}>
            {ITEMS.map((item) => (
              <button
                key={item}
                type="button"
                data-testid={`falla-post-${item}`}
                aria-pressed={fallados.includes(item)}
                onClick={() =>
                  setFallados((previos) =>
                    previos.includes(item) ? previos.filter((f) => f !== item) : [...previos, item],
                  )
                }
                style={fallados.includes(item) ? chipMarcado : chip}
              >
                {fallados.includes(item) ? "✓ " : ""}
                {item}
              </button>
            ))}
          </div>

          {/* La nota es OPCIONAL (§7.6): quien tiene algo que decir la abre, quien no, sigue.
              Un campo obligatorio acá produciría notas como «ok» y «nada», y el recuadro
              entero se volvería invisible para quien abre mañana. */}
          {!escribiendoNota ? (
            <BotonPrimario testid="dejar-nota" variante="neutro" onClick={() => setEscribiendoNota(true)}>
              Dejar una nota al del turno siguiente
            </BotonPrimario>
          ) : (
            <textarea
              data-testid="nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
              aria-label="Nota para quien maneje mañana"
              style={campoDeNota}
            />
          )}

          {(fallados.length > 0 || escribiendoNota) && (
            <BotonPrimario testid="continuar-chequeo-post" onClick={() => setPaso("lecturas")}>
              Continuar
            </BotonPrimario>
          )}
        </section>
      )}

      {paso === "lecturas" && (
        <section data-testid="paso-lecturas" style={bloque}>
          {/* Los dos en la MISMA pantalla: separarlos costaba un toque más y dejaba la nota
              fuera del presupuesto del §5.3. */}
          <h2 style={subtitulo}>Kilómetros del tablero</h2>
          <CifraGrande valor={odometro === "" ? "—" : odometro} unidad="km" />
          <div data-testid="teclado-odometro-post">
            <TecladoNumerico valor={odometro} onCambiar={setOdometro} />
          </div>
          <h2 style={subtitulo}>Carga de la batería</h2>
          <CifraGrande valor={carga === "" ? "—" : carga} unidad="%" />
          <div data-testid="teclado-carga-post">
            <TecladoNumerico valor={carga} onCambiar={setCarga} />
          </div>
          <BotonPrimario
            testid="continuar-lecturas"
            disabled={odometro === "" || carga === ""}
            onClick={() => setPaso("enchufe")}
          >
            Continuar
          </BotonPrimario>
        </section>
      )}

      {paso === "enchufe" && (
        <section data-testid="paso-enchufe" style={bloque}>
          {/* La respuesta ES el cierre: sin un «Confirmar» detrás, la pregunta no se puede
              saltar y el §5.2-F5 queda en cinco toques. */}
          <h2 style={subtitulo}>¿Quedó enchufado?</h2>
          <BotonPrimario testid="enchufado-si" onClick={() => void cerrar(true)}>
            Sí, quedó enchufado
          </BotonPrimario>
          <BotonPrimario testid="enchufado-no" variante="neutro" onClick={() => void cerrar(false)}>
            No quedó enchufado
          </BotonPrimario>
        </section>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = { fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.medio, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const bloque = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const chips = { display: "flex", gap: grilla.base, flexWrap: "wrap" as const };
const chip = {
  minHeight: componente.objetivoTactil.altoMinPx,
  padding: `0 ${grilla.base * 2}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.cuerpo.tamano,
  fontWeight: enfasis.medio,
};
const chipMarcado = { ...chip, background: superficie.texto, color: superficie.tarjeta };
const campoDeNota = {
  minHeight: componente.objetivoTactil.altoMinPx * 2,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.cuerpo.tamano,
  fontFamily: "inherit",
};
