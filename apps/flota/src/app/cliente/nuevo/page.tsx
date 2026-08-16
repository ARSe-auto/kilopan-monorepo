"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../../cliente/aparato.ts";
import { useConexion } from "../../../cliente/conexion.ts";
import { TERMINOLOGIA_PORTAL_BASE, resolverTerminologiaPortal, type TerminologiaPortal } from "../../../dominio/portal-terminologia.ts";
import { TEMA_PORTAL_CSS } from "../tema-portal.ts";

// «Nuevo / Importar CSV», la tercera pantalla del portal [AC-FPOR-07, AC-FPOR-08, AC-FPOR-09] —
// spec 07 §2.3.
//
// El §3.E1.10 trata esto como UNA sola pantalla con dos vías de alta, no dos pantallas. La
// primera es el encargo individual, que nace `solicitado` (§4.5) y es editable SOLO hasta que
// el operador lo acepte (§3.E1.10). La segunda es el import CSV [AC-FPOR-09]: todo-o-nada
// PROVISIONAL a la Pregunta al dueño 4 (un lote mixto rebota entero mientras no se responda) y
// deshabilitado sin conexión mostrando el estado obligatorio del §5.7 — es PLANIFICACIÓN
// (§4.2), así que la acción se apaga en vez de encolarse: no hay nada que sincronizar después,
// solo un archivo que se puede volver a subir cuando vuelva la red.
//
// Es PLANIFICACIÓN (§4.2): el 422 tipado del servidor es la guardia real y ESTE formulario no
// la reemplaza, solo evita el viaje redondo cuando ya se sabe la respuesta (mismo patrón que
// `/solicitar`, AC-FIDN-17).
export default function PortalNuevo() {
  const [destinos, setDestinos] = useState<{ id: string; nombre: string }[] | undefined>(undefined);
  const [destinoId, setDestinoId] = useState("");
  const [bultos, setBultos] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState(false);
  // «Sin conexión se deshabilita mostrando el estado obligatorio de §5.7» [AC-FPOR-09,
  // AC-FPOR-12]: extraído a `useConexion()` (`cliente/conexion.ts`) para que las otras 3
  // pantallas del portal no repitan este mismo `useEffect`.
  const online = useConexion();
  const [terminologia, setTerminologia] = useState<TerminologiaPortal>(TERMINOLOGIA_PORTAL_BASE);
  useEffect(() => {
    setTerminologia(resolverTerminologiaPortal(new URLSearchParams(window.location.search).get("terminologia") ?? undefined));
  }, []);

  const [archivoCsv, setArchivoCsv] = useState<File | null>(null);
  const [importandoCsv, setImportandoCsv] = useState(false);
  const [errorCsv, setErrorCsv] = useState<string | null>(null);
  const [filasInvalidas, setFilasInvalidas] = useState<{ linea: number; error: string; detalle: string }[]>([]);
  const [resultadoCsv, setResultadoCsv] = useState<{ creados: number; repetidos: number } | null>(null);

  async function importarCsv() {
    if (!archivoCsv) return;
    setImportandoCsv(true);
    setErrorCsv(null);
    setFilasInvalidas([]);
    setResultadoCsv(null);
    const texto = await archivoCsv.text();
    const respuesta = await pedir("/cliente/api/encargos/importar", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: texto,
    }).catch(() => null);
    setImportandoCsv(false);
    if (!respuesta?.ok) {
      const cuerpo = (await respuesta?.json().catch(() => ({}))) as
        | { mensaje?: string; filas?: { linea: number; error: string; detalle: string }[] }
        | undefined;
      setError(null);
      setErrorCsv(cuerpo?.mensaje ?? "No se pudo importar el archivo. Revisá tu conexión e intentá de nuevo.");
      setFilasInvalidas(cuerpo?.filas ?? []);
      return;
    }
    const cuerpo = (await respuesta.json()) as { creados: number; repetidos: number };
    setArchivoCsv(null);
    setResultadoCsv(cuerpo);
  }

  const cargarDestinos = useCallback(async () => {
    const respuesta = await pedir("/api/destinos").catch(() => null);
    if (!respuesta?.ok) return;
    const { destinos: lista } = (await respuesta.json()) as { destinos: { id: string; nombre: string }[] };
    setDestinos(lista);
  }, []);

  useEffect(() => {
    void cargarDestinos();
  }, [cargarDestinos]);

  const bultosNumero = Number(bultos);
  const bultosEsValido = Number.isInteger(bultosNumero) && bultosNumero >= 1 && bultosNumero <= 500;
  const puedeEnviar = online && destinoId !== "" && bultosEsValido && !enviando;

  async function crear() {
    setEnviando(true);
    setError(null);
    setCreado(false);
    const respuesta = await pedir("/cliente/api/encargos", {
      method: "POST",
      body: JSON.stringify({ destino_id: destinoId, bultos: bultosNumero }),
    }).catch(() => null);
    setEnviando(false);
    if (!respuesta?.ok) {
      const cuerpo = (await respuesta?.json().catch(() => ({}))) as { mensaje?: string } | undefined;
      setError(cuerpo?.mensaje ?? "No se pudo crear el encargo. Revisá tu conexión e intentá de nuevo.");
      return;
    }
    setDestinoId("");
    setBultos("");
    setCreado(true);
  }

  return (
    <main className="portal-superficie" data-testid="portal-nuevo" style={pagina}>
      <style>{TEMA_PORTAL_CSS}</style>
      <h1 style={titulo}>Nuevo / Importar CSV</h1>

      <section data-testid="nuevo-encargo" style={tarjeta}>
        <h2 style={subtitulo}>Encargo nuevo</h2>
        <p style={cuerpo}>
          Cargá un encargo indicando destino y bultos. Nace en estado «{terminologia.estadoEncargo.solicitado}».
        </p>

        {!online && (
          <p data-testid="nuevo-encargo-sin-conexion" role="status" style={{ ...pie, color: "var(--portal-alerta)", fontWeight: enfasis.fuerte }}>
            Sin conexión — crear un encargo necesita red. Volvé a intentarlo cuando se recupere.
          </p>
        )}

        {destinos !== undefined && destinos.length === 0 ? (
          <EstadoVacio mensaje="No hay destinos configurados todavía. Contactá a tu operador para que agregue uno." />
        ) : (
          <>
            <label style={etiqueta} htmlFor="nuevo-destino">Destino</label>
            {destinos === undefined ? (
              <EstadoCargando filas={1} />
            ) : (
              <select
                id="nuevo-destino"
                data-testid="nuevo-destino"
                value={destinoId}
                onChange={(e) => setDestinoId(e.target.value)}
                style={campo}
              >
                <option value="">Elegí un destino</option>
                {destinos.map((d) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </select>
            )}

            <label style={etiqueta} htmlFor="nuevo-bultos">Bultos</label>
            <input
              id="nuevo-bultos"
              data-testid="nuevo-bultos"
              type="number"
              inputMode="numeric"
              min={1}
              max={500}
              value={bultos}
              onChange={(e) => setBultos(e.target.value)}
              style={campo}
            />
            {bultos !== "" && !bultosEsValido && (
              <p data-testid="nuevo-bultos-invalido" style={{ ...pie, color: "var(--portal-error)" }}>
                Los bultos van de 1 a 500.
              </p>
            )}

            {error && <EstadoError mensaje={error} alReintentar={() => setError(null)} />}
            {creado && (
              <p data-testid="nuevo-encargo-creado" role="status" style={{ ...pie, color: "var(--portal-texto)" }}>
                Encargo creado. Lo vas a ver en «Encargos» como «{terminologia.estadoEncargo.solicitado}».
              </p>
            )}

            <BotonPrimario testid="crear-encargo" disabled={!puedeEnviar} onClick={() => void crear()}>
              {enviando ? "Creando…" : "Crear encargo"}
            </BotonPrimario>
          </>
        )}
      </section>

      <section data-testid="importar-csv" style={tarjeta}>
        <h2 style={subtitulo}>Importar CSV</h2>
        <p style={cuerpo}>
          Subí un archivo con varios encargos a la vez. Cada fila nace en estado «{terminologia.estadoEncargo.solicitado}».
        </p>

        {!online && (
          <p data-testid="csv-sin-conexion" role="status" style={{ ...pie, color: "var(--portal-alerta)" }}>
            Sin conexión — la importación necesita red. Volvé a intentarlo cuando se recupere.
          </p>
        )}

        <label style={etiqueta} htmlFor="csv-archivo">Archivo CSV (columnas: destino, bultos)</label>
        <input
          id="csv-archivo"
          data-testid="csv-archivo"
          type="file"
          accept=".csv,text/csv"
          disabled={!online || importandoCsv}
          onChange={(e) => {
            setArchivoCsv(e.target.files?.[0] ?? null);
            setErrorCsv(null);
            setFilasInvalidas([]);
            setResultadoCsv(null);
          }}
          style={campo}
        />

        {errorCsv && (
          <div data-testid="csv-error">
            <EstadoError mensaje={errorCsv} alReintentar={() => setErrorCsv(null)} />
            {filasInvalidas.length > 0 && (
              <ul data-testid="csv-filas-invalidas" style={{ margin: 0, paddingLeft: grilla.base }}>
                {filasInvalidas.map((f) => (
                  <li key={f.linea} style={pie}>
                    Línea {f.linea}: {f.error} ({f.detalle})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {resultadoCsv && (
          <p data-testid="csv-importado" role="status" style={{ ...pie, color: "var(--portal-texto)" }}>
            Se importaron {resultadoCsv.creados} encargo(s). Los vas a ver en «Encargos» como «{terminologia.estadoEncargo.solicitado}».
          </p>
        )}

        <BotonPrimario
          testid="importar-csv-boton"
          disabled={!online || !archivoCsv || importandoCsv}
          onClick={() => void importarCsv()}
        >
          {importandoCsv ? "Importando…" : "Importar"}
        </BotonPrimario>
      </section>
    </main>
  );
}

const pagina = { padding: `${grilla.base * 2}px`, minHeight: "100vh" };
const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = { fontSize: tipografia.titulo.tamano, fontWeight: tipografia.titulo.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: "var(--portal-texto)", margin: 0 };
const pie = { fontSize: tipografia.pie.tamano, margin: 0 };
const etiqueta = { fontSize: tipografia.cuerpo.tamano, color: "var(--portal-texto)", fontWeight: 600 };
const campo = {
  fontSize: tipografia.cuerpo.tamano,
  minHeight: semantico.toque.operativo,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  border: "1px solid var(--portal-hairline)",
  background: "var(--portal-bg-tarjeta)",
  color: "var(--portal-texto)",
};
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: "var(--portal-bg-tarjeta)",
  border: "1px solid var(--portal-hairline)",
  marginTop: semantico.espacio.entreTarjetas,
};
