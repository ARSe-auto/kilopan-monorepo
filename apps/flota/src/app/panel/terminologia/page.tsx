"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Termino,
  EstadoVacio,
  EstadoError,
  EstadoCargando,
  BotonPrimario,
  useEscaladaDeCarga,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, semantico as colorSemantico, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { TERMINOLOGIA_BASE_ES_CL, type TerminoResuelto } from "@kilopan/miga/terminologia.ts";
import { pedir } from "../../../cliente/aparato.ts";

// Panel de terminología del tenant [AC-FMIG-04, AC-FMIG-06] — §5.1: «el admin ve el término
// canónico entre paréntesis» y puede renombrar singular/plural de cada término.
//
// LA LISTA EDITABLE ES `TERMINOLOGIA_BASE_ES_CL` Y NADA MÁS: los términos de sistema/auditoría
// nunca entraron a ese catálogo (packages/miga/src/terminologia.ts), así que esta pantalla no
// tiene nada que excluir a mano — «no aparecen como editables» sale de iterar la fuente
// correcta, no de un chequeo que se pueda olvidar.
//
// EL REBOTE ES SIEMPRE 422 TIPADO ES-CL (`PUT /api/terminologia`, AC-FMIG-06: largo por tipo,
// caracteres prohibidos, singular/plural vacíos) — se muestra bajo la fila que falló, sin
// perder lo que la persona ya tecleó en los otros campos ni en ese mismo, para que pueda
// corregir sin escribir todo de nuevo.
//
// LA CADA FILA la arma `<Termino>` de `packages/miga` — el `data-testid` del texto resuelto
// sale de ahí; los `data-testid` de los campos de edición son de esta pantalla, porque son
// SUYOS: no hay término renombrable involucrado en anclar un `<input>`.
export default function PanelTerminologia() {
  const [terminos, setTerminos] = useState<Record<string, TerminoResuelto> | null>(null);
  const [error, setError] = useState(false);
  const [borrador, setBorrador] = useState<Record<string, { singular: string; plural: string }>>({});
  const [errorPorTermino, setErrorPorTermino] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  // AC-FMIG-10 (§5.7): misma escalada de EstadoListado.tsx — skeleton instantáneo, aviso
  // solo pasados 400 ms sin respuesta.
  const demorado = useEscaladaDeCarga(!error && !terminos);

  const cargar = useCallback(async () => {
    setError(false);
    const respuesta = await pedir("/api/terminologia").catch(() => null);
    if (!respuesta?.ok) return setError(true);
    const { terminos: t } = (await respuesta.json()) as { terminos: Record<string, TerminoResuelto> };
    setTerminos(t);
    setBorrador(
      Object.fromEntries(Object.values(t).map((r) => [r.termKey, { singular: r.singular, plural: r.plural }])),
    );
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function editar(termKey: string, campo: "singular" | "plural", valor: string) {
    setGuardado(null);
    setBorrador((previo) => ({
      ...previo,
      [termKey]: { ...(previo[termKey] ?? { singular: "", plural: "" }), [campo]: valor },
    }));
  }

  async function guardar(termKey: string) {
    setGuardando(termKey);
    setGuardado(null);
    setErrorPorTermino((previo) => ({ ...previo, [termKey]: "" }));
    const valor = borrador[termKey] ?? { singular: "", plural: "" };
    const respuesta = await pedir("/api/terminologia", {
      method: "PUT",
      body: JSON.stringify({ term_key: termKey, singular: valor.singular, plural: valor.plural }),
    }).catch(() => null);
    setGuardando(null);
    if (!respuesta) {
      setErrorPorTermino((previo) => ({ ...previo, [termKey]: "No se pudo guardar. Revisá tu conexión." }));
      return;
    }
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { mensaje?: string };
      setErrorPorTermino((previo) => ({
        ...previo,
        [termKey]: cuerpo.mensaje ?? "No se pudo guardar ese término.",
      }));
      return;
    }
    setGuardado(termKey);
    await cargar();
  }

  return (
    <main data-testid="panel-terminologia">
      <h1 style={titulo}>Terminología</h1>
      {error && (
        <EstadoError mensaje="No se pudo leer la terminología. Revisá tu conexión." alReintentar={() => void cargar()} />
      )}
      {!error && !terminos && <EstadoCargando avisoDemora={demorado ? "Sigue cargando…" : undefined} />}
      {terminos && Object.keys(terminos).length === 0 && (
        <EstadoVacio mensaje="Este tenant todavía no tiene términos configurados." />
      )}
      {terminos && (
        <ul data-testid="lista-terminos" style={lista}>
          {Object.keys(TERMINOLOGIA_BASE_ES_CL).map((termKey) => {
            const resuelto = terminos[termKey];
            if (!resuelto) return null;
            const valor = borrador[termKey] ?? { singular: resuelto.singular, plural: resuelto.plural };
            return (
              <li key={termKey} data-testid={`fila-editar-${termKey}`} style={fila}>
                <Termino resuelto={resuelto} admin />
                <div style={campos}>
                  <label style={etiqueta} htmlFor={`singular-${termKey}`}>
                    Singular
                  </label>
                  <input
                    id={`singular-${termKey}`}
                    data-testid={`input-singular-${termKey}`}
                    value={valor.singular}
                    onChange={(e) => editar(termKey, "singular", e.target.value)}
                    style={campo}
                  />
                  <label style={etiqueta} htmlFor={`plural-${termKey}`}>
                    Plural
                  </label>
                  <input
                    id={`plural-${termKey}`}
                    data-testid={`input-plural-${termKey}`}
                    value={valor.plural}
                    onChange={(e) => editar(termKey, "plural", e.target.value)}
                    style={campo}
                  />
                  <BotonPrimario
                    testid={`guardar-${termKey}`}
                    variante="neutro"
                    disabled={guardando === termKey}
                    onClick={() => void guardar(termKey)}
                  >
                    {guardando === termKey ? "Guardando…" : "Guardar"}
                  </BotonPrimario>
                </div>
                {errorPorTermino[termKey] && (
                  <p data-testid={`rebote-${termKey}`} role="alert" style={textoRebote}>
                    {errorPorTermino[termKey]}
                  </p>
                )}
                {guardado === termKey && !errorPorTermino[termKey] && (
                  <p data-testid={`guardado-${termKey}`} style={textoGuardado}>
                    Guardado.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const etiqueta = { ...cuerpo, fontWeight: enfasis.medio, marginBottom: 0 };
const lista = {
  listStyle: "none",
  padding: 0,
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const fila = {
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
  fontSize: tipografia.cuerpo.tamano,
  color: superficie.texto,
  display: "grid",
  gap: semantico.espacio.entreControles,
};
const campos = { display: "grid", gap: semantico.espacio.entreControles };
const campo = {
  minHeight: componente.objetivoTactil.altoMinPx,
  padding: `0 ${grilla.base}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.cuerpo.tamano,
};
const textoRebote = { ...cuerpo, margin: 0, color: colorSemantico.error, fontWeight: enfasis.medio };
const textoGuardado = { ...cuerpo, margin: 0, color: colorSemantico.ok, fontWeight: enfasis.medio };
