"use client";

import { useCallback, useEffect, useState } from "react";
import { Termino, EstadoVacio, EstadoError, EstadoCargando } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import type { TerminoResuelto } from "@kilopan/miga/terminologia.ts";
import { pedir } from "../../../cliente/aparato.ts";

// Panel de terminología del tenant [AC-FMIG-04] — §5.1: «el admin ve el término canónico
// entre paréntesis». Solo LECTURA: editar es AC-FMIG-06 (bloqueado por la Pregunta al dueño
// n.º 11 — la restricción de rol de esa pantalla no se cierra ahí, así que tampoco acá). Esta
// pantalla existe para demostrar la cadena de resolución completa contra la BD real y para que
// el e2e de este AC tenga un DOM con `data-testid`/`term_key` estables contra los que correr
// la MISMA suite dos veces (§9.2).
//
// Cada fila la arma `<Termino>` de `packages/miga` — el `data-testid` sale de ahí, nunca de
// este archivo, así que esta pantalla no puede inventar un selector que no respete el contrato.
export default function PanelTerminologia() {
  const [terminos, setTerminos] = useState<Record<string, TerminoResuelto> | null>(null);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    setError(false);
    const respuesta = await pedir("/api/terminologia").catch(() => null);
    if (!respuesta?.ok) return setError(true);
    const { terminos: t } = (await respuesta.json()) as { terminos: Record<string, TerminoResuelto> };
    setTerminos(t);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <main data-testid="panel-terminologia">
      <h1 style={titulo}>Terminología</h1>
      {error && (
        <EstadoError mensaje="No se pudo leer la terminología. Revisá tu conexión." alReintentar={() => void cargar()} />
      )}
      {!error && !terminos && <EstadoCargando />}
      {terminos && Object.keys(terminos).length === 0 && (
        <EstadoVacio mensaje="Este tenant todavía no tiene términos configurados." />
      )}
      {terminos && (
        <ul data-testid="lista-terminos" style={lista}>
          {Object.values(terminos).map((t) => (
            <li key={t.termKey} style={fila}>
              <Termino resuelto={t} admin />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
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
};
