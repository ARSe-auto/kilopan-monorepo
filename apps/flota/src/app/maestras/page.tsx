"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, EstadoVacio, EstadoError, EstadoCargando } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";

// Rutas maestras (F1) [AC-FRUT-06] — §3.E1.6, §5.7, §5.1.
//
// ─── ARRASTRAR ES DE ESCRITORIO, Y EL MÓVIL NO SE QUEDA SIN VÍA ──────────────────
//
// El §3.E1.6 pide drag & drop SOLO en escritorio. La razón está en el §5.7 y en el aparato: en
// una pantalla de 375 px, arrastrar una tarjeta compite con el scroll de la página y con el gesto
// de volver atrás del sistema — el resultado es una parada que se suelta en el lugar equivocado y
// un operador que no sabe si guardó.
//
// Pero «sin drag & drop» no puede significar «sin poder reordenar»: eso sería pérdida de datos
// por omisión, que es lo que el AC prohíbe con esas palabras. En móvil, cada parada trae subir y
// bajar — dos objetivos táctiles del tamaño del §0, que se aciertan con el camión andando.
//
// Los DOS gestos escriben por el MISMO endpoint. Si fueran dos, el día que uno cambie el otro
// queda atrás y el operador de teléfono guarda algo distinto de lo que ve el de escritorio.
//
// ─── POR QUÉ EL CORTE SE MIDE Y NO SE ADIVINA ────────────────────────────────────
//
// `matchMedia` sobre el ancho real, evaluado después de montar. Decidirlo por el user agent
// pondría el arrastre en una tablet con teclado y lo sacaría de un notebook con pantalla táctil;
// lo que importa no es qué aparato es, sino cuánto espacio hay para arrastrar.

type Maestra = { id: string; nombre: string | null };
type Parada = { id: string; orden: number; destino: string | null; tipo: string };

/** El corte de escritorio. Es el mismo que el §5.7 usa para el resto de la app. */
const ANCHO_DE_ESCRITORIO = "(min-width: 768px)";

export default function Maestras() {
  const [maestras, setMaestras] = useState<Maestra[] | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [paradas, setParadas] = useState<Parada[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enEscritorio, setEnEscritorio] = useState(false);
  const [arrastrada, setArrastrada] = useState<string | null>(null);

  useEffect(() => {
    // Después de montar: en el servidor no hay ancho, y adivinarlo produce un primer render con
    // el gesto equivocado que el usuario alcanza a tocar.
    const media = window.matchMedia(ANCHO_DE_ESCRITORIO);
    const mirar = () => setEnEscritorio(media.matches);
    mirar();
    media.addEventListener("change", mirar);
    return () => media.removeEventListener("change", mirar);
  }, []);

  const cargar = useCallback(async () => {
    const respuesta = await pedir("/api/maestras").catch(() => null);
    if (!respuesta?.ok) return setError("No se pudieron leer las rutas maestras.");
    setMaestras(((await respuesta.json()) as { maestras: Maestra[] }).maestras);
    setError(null);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function abrir(id: string) {
    setElegida(id);
    const respuesta = await pedir(`/api/rutas/${id}`).catch(() => null);
    if (respuesta?.ok) setParadas(((await respuesta.json()) as { paradas: Parada[] }).paradas);
  }

  /** Guarda el orden que se ve. Único camino: los dos gestos terminan acá. */
  async function guardar(enOrden: Parada[]) {
    setParadas(enOrden);
    const respuesta = await pedir(`/api/rutas/${elegida}/paradas`, {
      method: "PATCH",
      body: JSON.stringify({ paradas: enOrden.map((p) => p.id) }),
    }).catch(() => null);
    setAviso(respuesta?.ok ? "Orden guardado." : "No se pudo guardar el orden. Volvé a intentar.");
  }

  function mover(desde: number, hasta: number) {
    if (hasta < 0 || hasta >= paradas.length) return;
    const copia = [...paradas];
    const [sacada] = copia.splice(desde, 1);
    copia.splice(hasta, 0, sacada!);
    void guardar(copia);
  }

  return (
    <main data-testid="maestras">
      <h1 style={titulo}>Rutas maestras</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}
      {!error && maestras === null && <EstadoCargando filas={2} />}
      {!error && maestras?.length === 0 && (
        <EstadoVacio mensaje="No hay rutas maestras todavía. Cuando armes un recorrido que se repite, guardalo como maestra y el día sale de acá en un clic." />
      )}

      <div style={chips}>
        {maestras?.map((m) => (
          <button
            key={m.id}
            type="button"
            data-testid={`maestra-${m.id}`}
            aria-pressed={elegida === m.id}
            onClick={() => void abrir(m.id)}
            style={elegida === m.id ? chipMarcado : chip}
          >
            {elegida === m.id ? "✓ " : ""}
            {m.nombre ?? "Sin nombre"}
          </button>
        ))}
      </div>

      {elegida && (
        <section data-testid="recorrido" style={bloque}>
          <h2 style={subtitulo}>El recorrido</h2>
          {/* El texto dice cuál es el gesto disponible. Sin él, quien está en el teléfono busca
              el arrastre que leyó en el manual y concluye que la app está rota (§5.7). */}
          <p data-testid="como-se-ordena" style={pieDim}>
            {enEscritorio
              ? "Arrastrá las paradas para cambiarles el orden."
              : "Usá las flechas para cambiar el orden. Arrastrar es solo en pantalla grande."}
          </p>

          {paradas.map((p, i) => (
            <article
              key={p.id}
              data-testid={`parada-${p.id}`}
              // Arrastrable SOLO en escritorio: en 375 px el arrastre compite con el scroll y
              // con el gesto de volver atrás del sistema.
              draggable={enEscritorio}
              onDragStart={enEscritorio ? () => setArrastrada(p.id) : undefined}
              onDragOver={enEscritorio ? (e) => e.preventDefault() : undefined}
              onDrop={
                enEscritorio
                  ? () => {
                      const desde = paradas.findIndex((q) => q.id === arrastrada);
                      if (desde >= 0 && desde !== i) mover(desde, i);
                      setArrastrada(null);
                    }
                  : undefined
              }
              style={tarjeta}
            >
              <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>
                {i + 1}. {p.destino ?? "Recarga"}
              </p>
              {!enEscritorio && (
                <div style={flechas}>
                  <button
                    type="button"
                    data-testid={`subir-${p.id}`}
                    disabled={i === 0}
                    onClick={() => mover(i, i - 1)}
                    aria-label={`Subir ${p.destino ?? "la parada"}`}
                    style={flecha}
                  >
                    ↑ Subir
                  </button>
                  <button
                    type="button"
                    data-testid={`bajar-${p.id}`}
                    disabled={i === paradas.length - 1}
                    onClick={() => mover(i, i + 1)}
                    aria-label={`Bajar ${p.destino ?? "la parada"}`}
                    style={flecha}
                  >
                    ↓ Bajar
                  </button>
                </div>
              )}
            </article>
          ))}

          {aviso && (
            <p data-testid="aviso-orden" style={pieDim}>
              {aviso}
            </p>
          )}

          <BotonPrimario
            testid="usar-de-plantilla"
            onClick={() =>
              void pedir("/api/maestras", {
                method: "POST",
                body: JSON.stringify({ maestra_id: elegida }),
              })
                .then(() => setAviso("El día se armó desde esta maestra."))
                .catch(() => setAviso("No se pudo armar el día."))
            }
          >
            Armar el día con esta ruta
          </BotonPrimario>
        </section>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = { fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.medio, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pieDim = { fontSize: tipografia.pie.tamano, color: superficie.textoDim, margin: 0 };
const bloque = { display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas };
const chips = { display: "flex", gap: grilla.base, flexWrap: "wrap" as const, marginTop: semantico.espacio.entreControles };
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
const tarjeta = {
  display: "grid",
  gap: grilla.base,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
const flechas = { display: "flex", gap: grilla.base };
const flecha = {
  minHeight: componente.objetivoTactil.altoMinPx,
  minWidth: componente.objetivoTactil.altoMinPx,
  padding: `0 ${grilla.base * 2}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.cuerpo.tamano,
};
