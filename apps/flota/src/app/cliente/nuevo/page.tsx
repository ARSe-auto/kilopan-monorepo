"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, EstadoError } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../../cliente/aparato.ts";

// «Nuevo / Importar CSV», la tercera pantalla del portal [AC-FPOR-07, AC-FPOR-08] — spec 07
// §2.3.
//
// El §3.E1.10 trata esto como UNA sola pantalla con dos vías de alta, no dos pantallas. Acá va
// la primera —el encargo individual, que nace `solicitado` (§4.5) y es editable SOLO hasta que
// el operador lo acepte (§3.E1.10)—; la de importar CSV es AC-FPOR-09, todavía abierto y
// PROVISIONAL a la Pregunta al dueño 4.
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
  const puedeEnviar = destinoId !== "" && bultosEsValido && !enviando;

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
    <main data-testid="portal-nuevo">
      <h1 style={titulo}>Nuevo / Importar CSV</h1>

      <section data-testid="nuevo-encargo" style={tarjeta}>
        <h2 style={subtitulo}>Encargo nuevo</h2>
        <p style={cuerpo}>Cargá un encargo indicando destino y bultos. Nace en estado «Solicitado».</p>

        <label style={etiqueta} htmlFor="nuevo-destino">Destino</label>
        <select
          id="nuevo-destino"
          data-testid="nuevo-destino"
          value={destinoId}
          onChange={(e) => setDestinoId(e.target.value)}
          disabled={destinos === undefined}
          style={campo}
        >
          <option value="">{destinos === undefined ? "Cargando…" : "Elegí un destino"}</option>
          {destinos?.map((d) => (
            <option key={d.id} value={d.id}>{d.nombre}</option>
          ))}
        </select>

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
          <p data-testid="nuevo-bultos-invalido" style={{ ...pie, color: "#B91C1C" }}>
            Los bultos van de 1 a 500.
          </p>
        )}

        {error && <EstadoError mensaje={error} alReintentar={() => setError(null)} />}
        {creado && (
          <p data-testid="nuevo-encargo-creado" role="status" style={{ ...pie, color: superficie.texto }}>
            Encargo creado. Lo vas a ver en «Encargos» como «Solicitado».
          </p>
        )}

        <BotonPrimario testid="crear-encargo" disabled={!puedeEnviar} onClick={() => void crear()}>
          {enviando ? "Creando…" : "Crear encargo"}
        </BotonPrimario>
      </section>

      <section data-testid="importar-csv" style={tarjeta}>
        <h2 style={subtitulo}>Importar CSV</h2>
        <p style={cuerpo}>Subí un archivo con varios encargos a la vez. Cada fila nace en estado «Solicitado».</p>
      </section>
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = { fontSize: tipografia.titulo.tamano, fontWeight: tipografia.titulo.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto, margin: 0 };
const pie = { fontSize: tipografia.pie.tamano, margin: 0 };
const etiqueta = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto, fontWeight: 600 };
const campo = {
  fontSize: tipografia.cuerpo.tamano,
  minHeight: semantico.toque.operativo,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
};
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
  marginTop: semantico.espacio.entreTarjetas,
};
