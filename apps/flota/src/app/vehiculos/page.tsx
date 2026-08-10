"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BotonPrimario, EstadoVacio, EstadoError, EstadoCargando } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, semantico as colorSemantico, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";
import { juzgarPatente, TIPO_LARGO_MAX } from "../../dominio/patentes.ts";

// El alta de vehículo en dos campos [AC-FVEH-01] — §5.4, §3.E1.3, §5.7.
//
// ─── POR QUÉ EL FORMULARIO ESTÁ ABIERTO Y NO DETRÁS DE UN BOTÓN «AGREGAR» ────────────
//
// El §5.4 pide el alta en menos de dos minutos y el §5.3 cuenta acciones. Un botón que abre el
// formulario es una acción entera gastada en revelar dos campos que caben en la misma
// pantalla; la única razón para tenerlo sería no «ensuciar» la lista, y esa razón no le ahorra
// tiempo a nadie que esté dando de alta un camión de pie en un galpón.
//
// ─── LOS CHIPS SALEN DE LOS TIPOS QUE ESTA EMPRESA YA USÓ ───────────────────────────
//
// El maestro dice «tipo (chips)» y NO enumera los chips en ninguna parte: ni el §4.5, ni el
// §5.4, ni `vertical_template`. Inventar acá una lista cerrada —furgón, camión, camioneta—
// sería responder por el dueño una pregunta que no hizo, y una lista mal elegida se convierte
// en el vehículo que no se puede dar de alta. Está preguntado en la spec 02 (pregunta 15).
//
// Mientras tanto los chips existen igual, y salen de donde no hay nada que inventar: los tipos
// que este tenant ya cargó. La primera alta de la vida se escribe; de la segunda en adelante
// es un toque. Cuando el dueño responda, el catálogo reemplaza esta fuente sin tocar el resto.
//
// El campo del tipo NO se esconde cuando hay chips: la flota que incorpora su primer camión
// después de diez furgones no tiene por qué buscar dónde escribirlo.

type Vehiculo = {
  id: string;
  patente: string;
  tipo: string;
  activo: boolean;
  bateria_wh: number | null;
  autonomia_nominal_km: number | null;
};

type Rebote = { error?: string; mensaje?: string };

export default function Vehiculos() {
  const [vehiculos, setVehiculos] = useState<Vehiculo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebote, setRebote] = useState<string | null>(null);
  const [patente, setPatente] = useState("");
  const [tipo, setTipo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const respuesta = await pedir("/api/vehiculos").catch(() => null);
    if (!respuesta) return setError("No se pudo leer la flota. Revisá tu conexión.");
    if (!respuesta.ok) return setError("No se pudo leer la flota.");
    const { vehiculos: lista } = (await respuesta.json()) as { vehiculos: Vehiculo[] };
    setVehiculos(lista);
    setError(null);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Los tipos ya usados, de más usado a menos. Es el catálogo que la empresa se fue armando. */
  const tiposConocidos = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const v of vehiculos ?? []) cuenta.set(v.tipo, (cuenta.get(v.tipo) ?? 0) + 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es-CL")).map(([t]) => t);
  }, [vehiculos]);

  async function agregar() {
    setRebote(null);
    setGuardando(true);
    const respuesta = await pedir("/api/gobierno/vehiculos", {
      method: "POST",
      body: JSON.stringify({ patente, tipo }),
    }).catch(() => null);
    setGuardando(false);

    if (!respuesta) return setRebote("No se pudo guardar. Revisá tu conexión y volvé a intentar.");
    if (respuesta.status === 403) return setRebote("El alta de vehículos es del dueño de la cuenta.");
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as Rebote;
      // El mensaje del servidor, tal cual: ya viene en es-CL y nombra la patente repetida.
      return setRebote(cuerpo.mensaje ?? "No se pudo guardar el vehículo.");
    }
    setPatente("");
    setTipo("");
    await cargar();
    return undefined;
  }

  const patenteSana = juzgarPatente(patente).tipo === "ok";
  const listo = patenteSana && tipo.trim().length > 0 && !guardando;

  return (
    <main data-testid="vehiculos">
      <h1 style={titulo}>Vehículos</h1>

      <section data-testid="alta-vehiculo" style={bloque}>
        <label style={etiqueta} htmlFor="patente">
          Patente
        </label>
        <input
          id="patente"
          data-testid="patente"
          value={patente}
          onChange={(e) => setPatente(e.target.value)}
          // `characters` y no `words`: el autocorrector del teléfono convierte una patente en
          // una palabra parecida, y esa corrección se descubre meses después, cuando el
          // odómetro del camión equivocado no cuadra.
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          style={campo}
        />

        <label style={etiqueta} htmlFor="tipo">
          Tipo
        </label>
        {tiposConocidos.length > 0 && (
          <div data-testid="tipos-conocidos" role="group" aria-label="Tipos ya usados" style={chips}>
            {tiposConocidos.map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`tipo-${t}`}
                aria-pressed={tipo === t}
                onClick={() => setTipo(t)}
                style={chip(tipo === t)}
              >
                {tipo === t ? "✓ " : ""}
                {t}
              </button>
            ))}
          </div>
        )}
        <input
          id="tipo"
          data-testid="tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          maxLength={TIPO_LARGO_MAX}
          style={campo}
        />

        {rebote && <p data-testid="rebote-alta" role="alert" style={textoRebote}>{rebote}</p>}

        <BotonPrimario testid="guardar-vehiculo" disabled={!listo} onClick={() => void agregar()}>
          {guardando ? "Guardando…" : "Agregar vehículo"}
        </BotonPrimario>
        {/* El resto es progresivo (§5.4): se dice, para que nadie crea que la ficha quedó a
            medias por error. Un vehículo con dos campos ya sirve. */}
        <p style={pie}>
          Con la patente y el tipo ya podés usarlo. Capacidades, documentos y datos de la
          batería se completan cuando los tengas.
        </p>
      </section>

      <section data-testid="flota" style={bloque}>
        <h2 style={{ ...cuerpo, margin: 0 }}>
          En tu flota <span data-testid="conteo-flota">{vehiculos ? vehiculos.length : "…"}</span>
        </h2>
        {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}
        {!error && vehiculos === null && <EstadoCargando filas={2} />}
        {!error && vehiculos?.length === 0 && (
          <EstadoVacio mensaje="Todavía no cargaste ningún vehículo. Escribí la patente y el tipo acá arriba y ya queda operativo." />
        )}
        {vehiculos?.map((v) => (
          <article key={v.id} data-testid="vehiculo" style={tarjeta}>
            <p data-testid="vehiculo-patente" style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>
              {v.patente}
            </p>
            <p style={{ ...pie, margin: 0, color: superficie.textoDim }}>
              {v.tipo}
              {/* Estado con TEXTO y jamás solo con color (§5.1). Y los datos EV que faltan se
                  nombran: es lo que convierte «ficha incompleta» en algo que se puede hacer. */}
              {v.activo ? "" : " · desactivado"}
              {v.bateria_wh === null && v.autonomia_nominal_km === null ? " · sin datos de batería" : ""}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pie = { fontSize: tipografia.pie.tamano, color: superficie.textoDim };
const etiqueta = { ...cuerpo, fontWeight: enfasis.medio, marginBottom: 0 };
const bloque = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const campo = {
  minHeight: componente.objetivoTactil.altoMinPx,
  padding: `0 ${grilla.base}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.cuerpo.tamano,
};
const chips = { display: "flex", gap: grilla.base, flexWrap: "wrap" as const };
const chip = (activo: boolean) => ({
  minHeight: componente.objetivoTactil.altoMinPx,
  padding: `0 ${grilla.base * 2}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: activo ? superficie.texto : superficie.tarjeta,
  color: activo ? superficie.tarjeta : superficie.texto,
  fontSize: tipografia.pie.tamano,
  fontWeight: enfasis.medio,
});
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
const textoRebote = { ...cuerpo, margin: 0, color: colorSemantico.error, fontWeight: enfasis.medio };
