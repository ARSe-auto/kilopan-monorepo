"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, EstadoVacio, EstadoError, EstadoCargando } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";

// Armar rutas (F1, fase 2) [AC-FRUT-05] — §5.2-F1, §5.3, §5.7, §3.E1.5.
//
// ─── EL PRESUPUESTO SON QUINCE CLICS PARA EL DÍA ENTERO ───────────────────────────
//
// Y el §5.2 fija la secuencia completa: bandeja → armar rutas → «Listos para salir» → publicar.
// Esta pantalla es la segunda fase, y el conteo del e2e la mide DENTRO del camino entero: si
// esta pantalla se lleva doce, no quedan tres para el resto.
//
// Por eso la asignación es MÚLTIPLE de verdad —se marcan los encargos y se manda una sola vez—
// y por eso no hay un paso de «crear ruta» separado del de asignarle carga: una ruta vacía no le
// sirve a nadie, así que el botón hace las dos cosas en un clic.
//
// ─── LA AGRUPACIÓN SE VE, NO SE EXPLICA ──────────────────────────────────────────
//
// Cuando dos empresas mandan al mismo destino, la pantalla muestra UNA parada con las dos
// razones sociales adentro. Es la única forma de que el operador confíe en que el camión va a
// parar una vez: si viera dos filas idénticas, agregaría un tercer intento a mano.
//
// ─── EL BOTÓN DE PUBLICAR NO ESTÁ ACÁ, Y ES A PROPÓSITO ──────────────────────────
//
// El §5.2 pone «Listos para salir» entre armar y publicar, como fase OBLIGATORIA. Un botón de
// publicar en esta pantalla dejaría saltársela — y esa fase es la que evita mandar a la calle un
// camión que no llega. Desde acá se pasa al tablero, y el día se publica desde ahí.

type Encargo = { id: string; bultos: number; empresa: string; destino: string };
type Vehiculo = { id: string; patente: string };
type Parada = { id: string; tipo: string; orden: number; destino: string | null; items: Item[] };
type Item = { empresa: string; qty_planificada: number };

export default function ArmarRutas() {
  const [encargos, setEncargos] = useState<Encargo[] | null>(null);
  const [vehiculos, setVehiculos] = useState<Vehiculo[] | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [vehiculo, setVehiculo] = useState<string | null>(null);
  const [paradas, setParadas] = useState<Parada[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebote, setRebote] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [e, v] = await Promise.all([
      pedir("/api/encargos").catch(() => null),
      // `operativo=1`: asignar un vehículo a una ruta es lo que el §5.4 le deja leer al
      // operador [AC-FMIG-09] — no gestión del catálogo, no pasa por el candado de Vehículos.
      pedir("/api/vehiculos?operativo=1").catch(() => null),
    ]);
    if (!e?.ok || !v?.ok) return setError("No se pudo leer la bandeja. Revisá tu conexión.");
    setEncargos(((await e.json()) as { encargos: Encargo[] }).encargos);
    setVehiculos(((await v.json()) as { vehiculos: Vehiculo[] }).vehiculos);
    setError(null);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function armar() {
    setRebote(null);
    const creada = await pedir("/api/rutas", {
      method: "POST",
      body: JSON.stringify({
        nombre: "Ruta del día",
        vehiculo_id: vehiculo,
        client_uuid: crypto.randomUUID(),
      }),
    }).catch(() => null);
    if (!creada?.ok) return setRebote("No se pudo crear la ruta. Volvé a intentar.");

    const { ruta } = (await creada.json()) as { ruta: { id: string } };
    const asignada = await pedir(`/api/rutas/${ruta.id}/asignar`, {
      method: "POST",
      body: JSON.stringify({ encargos: elegidos }),
    }).catch(() => null);
    if (!asignada?.ok) {
      const cuerpo = (await asignada?.json().catch(() => ({}))) as { mensaje?: string };
      return setRebote(cuerpo.mensaje ?? "No se pudieron asignar los encargos.");
    }

    const armada = await pedir(`/api/rutas/${ruta.id}`).catch(() => null);
    if (armada?.ok) setParadas(((await armada.json()) as { paradas: Parada[] }).paradas);
    setElegidos([]);
    return undefined;
  }

  return (
    <main data-testid="armar-rutas">
      <h1 style={titulo}>Armar rutas</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}
      {!error && encargos === null && <EstadoCargando filas={3} />}
      {!error && encargos?.length === 0 && (
        <EstadoVacio mensaje="No hay encargos para hoy. Cargalos en la bandeja y volvé acá a armar el día." />
      )}

      {encargos && encargos.length > 0 && (
        <>
          <h2 style={subtitulo}>¿Qué encargos van juntos?</h2>
          <div style={lista}>
            {encargos.map((e) => {
              const marcado = elegidos.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  data-testid={`encargo-${e.id}`}
                  aria-pressed={marcado}
                  onClick={() =>
                    setElegidos((previos) =>
                      marcado ? previos.filter((i) => i !== e.id) : [...previos, e.id],
                    )
                  }
                  style={marcado ? filaMarcada : fila}
                >
                  {/* Jamás solo color (§5.7): el ✓ dice lo mismo que el fondo. */}
                  {marcado ? "✓ " : ""}
                  {e.empresa} → {e.destino} · {e.bultos} bultos
                </button>
              );
            })}
          </div>

          <h2 style={subtitulo}>¿Qué camión la hace?</h2>
          <div style={chips}>
            {vehiculos?.map((v) => (
              <button
                key={v.id}
                type="button"
                data-testid={`vehiculo-${v.patente}`}
                aria-pressed={vehiculo === v.id}
                onClick={() => setVehiculo(v.id)}
                style={vehiculo === v.id ? chipMarcado : chip}
              >
                {vehiculo === v.id ? "✓ " : ""}
                {v.patente}
              </button>
            ))}
          </div>

          <BotonPrimario
            testid="armar-ruta"
            disabled={elegidos.length === 0 || vehiculo === null}
            onClick={() => void armar()}
          >
            Armar la ruta
          </BotonPrimario>
          {rebote && <p data-testid="rebote-armado" style={textoDeRebote}>{rebote}</p>}
        </>
      )}

      {paradas && (
        <section data-testid="ruta-armada" style={bloque}>
          <h2 style={subtitulo}>La ruta quedó así</h2>
          {paradas.map((p) => (
            <article key={p.id} data-testid="fila-parada" style={tarjeta}>
              <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>
                {p.orden}. {p.destino}
              </p>
              {/* La agrupación se VE: una parada con las dos empresas adentro. Si el operador
                  viera dos filas iguales, agregaría un tercer intento a mano. */}
              {p.items.map((i, n) => (
                <p key={n} style={pieDim}>
                  {i.empresa} · {i.qty_planificada} bultos
                </p>
              ))}
            </article>
          ))}
          <a data-testid="ir-a-listos" href="/listos" style={enlace}>
            Ver si están listos para salir
          </a>
        </section>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = {
  fontSize: tipografia.cuerpo.tamano,
  fontWeight: enfasis.medio,
  marginTop: semantico.espacio.entreTarjetas,
  marginBottom: 0,
};
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pieDim = { fontSize: tipografia.pie.tamano, color: superficie.textoDim, margin: 0 };
const bloque = { display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas };
const lista = { display: "grid", gap: grilla.base, marginTop: semantico.espacio.entreControles };
const chips = { display: "flex", gap: grilla.base, flexWrap: "wrap" as const, marginTop: semantico.espacio.entreControles };
const fila = {
  minHeight: componente.objetivoTactil.altoMinPx,
  padding: `${grilla.base}px ${grilla.base * 2}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.cuerpo.tamano,
  textAlign: "left" as const,
};
const filaMarcada = { ...fila, background: superficie.texto, color: superficie.tarjeta };
const chip = { ...fila, fontWeight: enfasis.medio };
const chipMarcado = { ...chip, background: superficie.texto, color: superficie.tarjeta };
const tarjeta = {
  display: "grid",
  gap: grilla.base,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
const textoDeRebote = { ...cuerpo, marginTop: semantico.espacio.entreControles };
const enlace = {
  ...cuerpo,
  minHeight: componente.objetivoTactil.altoMinPx,
  display: "flex",
  alignItems: "center",
  fontWeight: enfasis.medio,
};
