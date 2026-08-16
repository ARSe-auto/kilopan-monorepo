"use client";

import { useCallback, useEffect, useState } from "react";
import { EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { fechaEsCl } from "../../../../../../packages/nucleo-comun/src/fechas.ts";
import { pedir } from "../../../cliente/aparato.ts";

// «Liquidación», la cuarta pantalla del portal [AC-FPOR-07] — spec 07 §2.4.
//
// LO QUE ESTA LISTA ES: las cabeceras (abierta→cerrada→pagada) de la empresa de la sesión, vía
// `liquidacionesDelCliente` (`servidor/portal-cliente.ts`, sobre `liquidacion_cliente` —la vista
// sancionada del §4.3, 0067). LO QUE NO ES TODAVÍA: línea por línea con su drill-down a evidencia
// y la disputa con motivo tipado dentro de la ventana de 7 días son AC-FPOR-10, abierto — esa
// mecánica cuelga de `/cliente/api/liquidaciones/[id]` (con líneas) y `/cliente/api/evidencias/[id]`,
// ambas ya reales desde AC-FPOR-06; esta pantalla lista las cabeceras, no abre ninguna.
type LiquidacionDelCliente = { id: string; estado: string; periodo_inicio: string; periodo_fin: string; creado_en: string };

const ETIQUETA_ESTADO: Record<string, string> = { abierta: "Abierta", cerrada: "Cerrada", pagada: "Pagada" };

export default function PortalLiquidaciones() {
  const [liquidaciones, setLiquidaciones] = useState<LiquidacionDelCliente[] | undefined>(undefined);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    setError(false);
    const respuesta = await pedir("/cliente/api/liquidaciones").catch(() => null);
    if (!respuesta?.ok) return setError(true);
    const { liquidaciones: lista } = (await respuesta.json()) as { liquidaciones: LiquidacionDelCliente[] };
    setLiquidaciones(lista);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <main data-testid="portal-liquidaciones">
      <h1 style={titulo}>Liquidación</h1>

      {error && (
        <EstadoError mensaje="No se pudieron cargar tus liquidaciones. Revisá tu conexión." alReintentar={() => void cargar()} />
      )}
      {liquidaciones === undefined && !error && <EstadoCargando filas={3} />}
      {liquidaciones !== undefined && !error && liquidaciones.length === 0 && (
        <EstadoVacio mensaje="Todavía no tenés liquidaciones." />
      )}

      {liquidaciones && liquidaciones.length > 0 && (
        <ul data-testid="lista-liquidaciones" style={lista}>
          {liquidaciones.map((l) => (
            <li key={l.id} data-testid="liquidacion-item" data-estado={l.estado} style={tarjeta}>
              <span style={cuerpo}>{ETIQUETA_ESTADO[l.estado] ?? l.estado}</span>
              <span style={{ ...pie, color: superficie.textoDim }}>
                {fechaEsCl(new Date(`${l.periodo_inicio}T12:00:00`))} a{" "}
                {fechaEsCl(new Date(`${l.periodo_fin}T12:00:00`))}
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
