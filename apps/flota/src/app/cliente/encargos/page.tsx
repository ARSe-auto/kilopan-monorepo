"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { fechaEsCl } from "../../../../../../packages/nucleo-comun/src/fechas.ts";
import { pedir } from "../../../cliente/aparato.ts";

// «Encargos», la segunda pantalla del portal [AC-FPOR-07] — spec 07 §2.2.
//
// LO QUE ESTA LISTA ES: estado/resultado de los encargos propios, confinados por
// `empresa_cliente_id` en `encargosDelCliente` (`servidor/portal-cliente.ts`) — jamás el orden
// global de la ruta ni paradas de terceros, que el §3.E1.10 prohíbe con esas palabras. LO QUE NO
// ES TODAVÍA: el drill-down a la evidencia de cada entrega (foto/firma/GPS) es AC-FPOR-11,
// abierto — esta pantalla lista, no abre ficha.
//
// LA CORRECCIÓN [AC-FPOR-08] vive acá y no en una pantalla propia: el §3.E1.10 dice «editable
// SOLO hasta la aceptación», y la forma de que la UI «ya no ofrece edición» tras la aceptación
// es que el botón de corregir exista únicamente en la fila cuyo `estado === "solicitado"` — no
// un `disabled` que igual se ve, sino la ausencia del control. El servidor (`PATCH
// /cliente/api/encargos/[id]`, `editarEncargo`) es la guardia real; esto es la conveniencia.
type EncargoDelCliente = { id: string; estado: string; fecha_servicio: string; bultos: number; creado_en: string };

const ETIQUETA_ESTADO: Record<string, string> = { solicitado: "Solicitado", aceptado: "Aceptado" };

export default function PortalEncargos() {
  const [encargos, setEncargos] = useState<EncargoDelCliente[] | undefined>(undefined);
  const [error, setError] = useState(false);
  const [enEdicion, setEnEdicion] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(false);
    const respuesta = await pedir("/cliente/api/encargos").catch(() => null);
    if (!respuesta?.ok) return setError(true);
    const { encargos: lista } = (await respuesta.json()) as { encargos: EncargoDelCliente[] };
    setEncargos(lista);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <main data-testid="portal-encargos">
      <h1 style={titulo}>Encargos</h1>

      {error && <EstadoError mensaje="No se pudieron cargar tus encargos. Revisá tu conexión." alReintentar={() => void cargar()} />}
      {encargos === undefined && !error && <EstadoCargando filas={4} />}
      {encargos !== undefined && !error && encargos.length === 0 && (
        <EstadoVacio mensaje="Todavía no tenés encargos. Se crean desde «Nuevo / Importar CSV»." />
      )}

      {encargos && encargos.length > 0 && (
        <ul data-testid="lista-encargos" style={lista}>
          {encargos.map((e) => (
            <li key={e.id} data-testid="encargo-item" data-estado={e.estado} data-id={e.id} style={tarjeta}>
              <span style={cuerpo}>{ETIQUETA_ESTADO[e.estado] ?? e.estado}</span>
              <span style={{ ...pie, color: superficie.textoDim }}>
                {e.bultos} bultos · {fechaEsCl(new Date(`${e.fecha_servicio}T12:00:00`))}
              </span>
              {e.estado === "solicitado" && (
                enEdicion === e.id ? (
                  <EdicionDeEncargo
                    encargo={e}
                    alCancelar={() => setEnEdicion(null)}
                    alGuardar={() => {
                      setEnEdicion(null);
                      void cargar();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    data-testid="corregir-encargo"
                    onClick={() => setEnEdicion(e.id)}
                    style={botonCorregir}
                  >
                    Corregir
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EdicionDeEncargo({
  encargo,
  alCancelar,
  alGuardar,
}: {
  encargo: EncargoDelCliente;
  alCancelar: () => void;
  alGuardar: () => void;
}) {
  const [bultos, setBultos] = useState(String(encargo.bultos));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bultosNumero = Number(bultos);
  const bultosEsValido = Number.isInteger(bultosNumero) && bultosNumero >= 1 && bultosNumero <= 500;

  async function guardar() {
    setEnviando(true);
    setError(null);
    const respuesta = await pedir(`/cliente/api/encargos/${encargo.id}`, {
      method: "PATCH",
      body: JSON.stringify({ bultos: bultosNumero }),
    }).catch(() => null);
    setEnviando(false);
    if (!respuesta?.ok) {
      const cuerpo = (await respuesta?.json().catch(() => ({}))) as { mensaje?: string } | undefined;
      setError(
        cuerpo?.mensaje ??
          "No se pudo corregir el encargo. Revisá tu conexión e intentá de nuevo.",
      );
      // El operador aceptó justo mientras se editaba: `alGuardar` recarga la lista y el
      // botón «Corregir» desaparece solo, porque el `estado` que vuelve ya no es `solicitado`.
      if (cuerpo?.mensaje) alGuardar();
      return;
    }
    alGuardar();
  }

  return (
    <div data-testid="editar-encargo" style={{ display: "grid", gap: semantico.espacio.entreControles }}>
      <input
        data-testid="editar-bultos"
        type="number"
        inputMode="numeric"
        min={1}
        max={500}
        value={bultos}
        onChange={(ev) => setBultos(ev.target.value)}
        style={campoEdicion}
      />
      {error && <p role="alert" style={{ ...pie, margin: 0, color: "#B91C1C" }}>{error}</p>}
      <div style={{ display: "flex", gap: semantico.espacio.entreControles }}>
        <BotonPrimario testid="guardar-encargo" disabled={!bultosEsValido || enviando} onClick={() => void guardar()}>
          {enviando ? "Guardando…" : "Guardar"}
        </BotonPrimario>
        <button type="button" data-testid="cancelar-edicion" onClick={alCancelar} style={botonCorregir}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pie = { fontSize: tipografia.pie.tamano };
const lista = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const tarjeta = {
  display: "grid",
  gap: 4,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
const botonCorregir = {
  minHeight: semantico.toque.operativo,
  padding: "0 16px",
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.pie.tamano,
  alignSelf: "start" as const,
};
const campoEdicion = {
  fontSize: tipografia.cuerpo.tamano,
  minHeight: semantico.toque.operativo,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.fondo,
  color: superficie.texto,
};
