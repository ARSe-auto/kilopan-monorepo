"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, EstadoVacio, EstadoError, EstadoCargando } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, semantico as colorSemantico, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";
import { fechaEsCl, horaEsCl, diaDeSemanaEsCl, lunesDeLaSemana } from "../../../../../packages/nucleo-comun/src/fechas.ts";

// La agenda semanal por vehículo [AC-FVEH-07] — §3.E1.4, §5.2-F1, §0 (Formatos).
//
// FECHAS EN es-CL Y CERO STRINGS EN INGLÉS. No se formatea acá: todo pasa por
// `packages/nucleo-comun/src/fechas.ts`, que es el único lugar donde vive `dd-mm-aaaa`. Un
// formateo a mano en cada pantalla es un `mm-dd-aaaa` colado en la que alguien copió de un
// ejemplo de internet, y en un país que escribe el día primero eso no lo nota nadie hasta que
// un camión sale un mes tarde.
//
// LA SEMANA EMPIEZA EL LUNES, la misma que cuenta `eevd_semanal`. Si acá empezara el domingo,
// la agenda y la métrica norte hablarían de semanas distintas con el mismo nombre.
//
// «DUPLICAR SEMANA» clona los bloques REALES de siete días atrás, no una plantilla (§3.E1.4).
// Cuando la semana destino ya tiene bloques que chocan, el servidor NO decide: la pregunta 12
// está abierta y la pantalla muestra lo que contestó, con todas las letras.

type Bloque = {
  id: string;
  tipo: string;
  empieza_en: string;
  termina_en: string;
  nota: string | null;
};

type Vehiculo = { id: string; patente: string; activo: boolean };

const ETIQUETA_DE_TIPO: Record<string, string> = {
  ruta: "Ruta",
  recarga: "Recarga",
  mantencion: "Mantención",
  descanso: "Descanso",
};

const UNA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

export default function Agenda() {
  const [vehiculos, setVehiculos] = useState<Vehiculo[] | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [lunes, setLunes] = useState(() => lunesDeLaSemana(new Date()));
  const [bloques, setBloques] = useState<Bloque[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      // `operativo=1`: la agenda elige un vehículo ya existente [AC-FMIG-09] — §5.5, no
      // gestiona el catálogo, así que no pasa por el candado de la Vehículos apagada.
      const respuesta = await pedir("/api/vehiculos?operativo=1").catch(() => null);
      if (!respuesta?.ok) return setError("No se pudo leer la flota.");
      const { vehiculos: lista } = (await respuesta.json()) as { vehiculos: Vehiculo[] };
      setVehiculos(lista);
      setElegido((previo) => previo ?? lista.find((v) => v.activo)?.id ?? null);
      return undefined;
    })();
  }, []);

  const cargar = useCallback(async () => {
    if (!elegido) return;
    const hasta = new Date(lunes.getTime() + UNA_SEMANA_MS);
    const respuesta = await pedir(
      `/api/agenda?vehiculo_id=${elegido}&desde=${lunes.toISOString()}&hasta=${hasta.toISOString()}`,
    ).catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo leer la agenda.");
    const { bloques: lista } = (await respuesta.json()) as { bloques: Bloque[] };
    setBloques(lista);
    setError(null);
    return undefined;
  }, [elegido, lunes]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function duplicar() {
    setAviso(null);
    const respuesta = await pedir("/api/agenda/duplicar-semana", {
      method: "POST",
      body: JSON.stringify({ vehiculo_id: elegido, desde: lunes.toISOString() }),
    }).catch(() => null);
    if (!respuesta) return setAviso("No se pudo copiar la semana. Revisá tu conexión.");
    const cuerpo = (await respuesta.json().catch(() => ({}))) as { mensaje?: string; clonados?: number };
    if (!respuesta.ok) return setAviso(cuerpo.mensaje ?? "No se pudo copiar la semana.");
    setAviso(`Se copiaron ${cuerpo.clonados} bloques de la semana anterior.`);
    await cargar();
    return undefined;
  }

  const hasta = new Date(lunes.getTime() + UNA_SEMANA_MS - 1);

  return (
    <main data-testid="agenda">
      <h1 style={titulo}>Agenda</h1>

      <section data-testid="semana" style={bloque}>
        {/* La semana, con fechas en es-CL y el día de la semana escrito: se lee de un vistazo
            sin traducir un número de mes. */}
        <p data-testid="rango-semana" style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>
          Semana del {fechaEsCl(lunes)} al {fechaEsCl(hasta)}
        </p>
        <div style={fila}>
          <BotonPrimario
            testid="semana-anterior"
            variante="neutro"
            onClick={() => setLunes(new Date(lunes.getTime() - UNA_SEMANA_MS))}
          >
            Semana anterior
          </BotonPrimario>
          <BotonPrimario
            testid="semana-siguiente"
            variante="neutro"
            onClick={() => setLunes(new Date(lunes.getTime() + UNA_SEMANA_MS))}
          >
            Semana siguiente
          </BotonPrimario>
        </div>

        {vehiculos && vehiculos.length > 0 && (
          <div data-testid="vehiculos" role="group" aria-label="Vehículos" style={chips}>
            {vehiculos.map((v) => (
              <button
                key={v.id}
                type="button"
                data-testid={`vehiculo-${v.patente}`}
                aria-pressed={elegido === v.id}
                onClick={() => setElegido(v.id)}
                style={chip(elegido === v.id)}
              >
                {elegido === v.id ? "✓ " : ""}
                {v.patente}
              </button>
            ))}
          </div>
        )}
      </section>

      <section data-testid="bloques" style={bloque}>
        {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}
        {!error && bloques === null && <EstadoCargando filas={3} />}
        {!error && bloques?.length === 0 && (
          <EstadoVacio mensaje="Esta semana no tiene nada agendado. Podés copiar la semana anterior con el botón de abajo." />
        )}
        {bloques?.map((b) => (
          <article key={b.id} data-testid="bloque" style={tarjeta}>
            <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>
              {ETIQUETA_DE_TIPO[b.tipo] ?? b.tipo}
            </p>
            <p data-testid="bloque-cuando" style={{ ...pie, margin: 0, color: superficie.textoDim }}>
              {diaDeSemanaEsCl(new Date(b.empieza_en))} {fechaEsCl(new Date(b.empieza_en))} ·{" "}
              {horaEsCl(new Date(b.empieza_en))} a {horaEsCl(new Date(b.termina_en))}
            </p>
            {b.nota && <p style={{ ...pie, margin: 0, color: superficie.textoDim }}>{b.nota}</p>}
          </article>
        ))}
      </section>

      <section style={bloque}>
        {aviso && (
          <p data-testid="aviso-duplicar" role="status" style={textoAviso}>
            {aviso}
          </p>
        )}
        <BotonPrimario testid="duplicar-semana" disabled={!elegido} onClick={() => void duplicar()}>
          Copiar la semana anterior
        </BotonPrimario>
      </section>
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pie = { fontSize: tipografia.pie.tamano };
const bloque = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const fila = { display: "flex", gap: grilla.base };
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
const textoAviso = { ...cuerpo, margin: 0, color: colorSemantico.alerta, fontWeight: enfasis.medio };
