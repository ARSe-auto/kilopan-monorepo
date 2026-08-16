"use client";

import { useCallback, useEffect, useState } from "react";
import { EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
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
type EncargoDelCliente = { id: string; estado: string; fecha_servicio: string; bultos: number; creado_en: string };

const ETIQUETA_ESTADO: Record<string, string> = { solicitado: "Solicitado", aceptado: "Aceptado" };

export default function PortalEncargos() {
  const [encargos, setEncargos] = useState<EncargoDelCliente[] | undefined>(undefined);
  const [error, setError] = useState(false);

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
            <li key={e.id} data-testid="encargo-item" data-estado={e.estado} style={tarjeta}>
              <span style={cuerpo}>{ETIQUETA_ESTADO[e.estado] ?? e.estado}</span>
              <span style={{ ...pie, color: superficie.textoDim }}>
                {e.bultos} bultos · {fechaEsCl(new Date(`${e.fecha_servicio}T12:00:00`))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
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
