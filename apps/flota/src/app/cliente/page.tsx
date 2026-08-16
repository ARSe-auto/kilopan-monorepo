"use client";

import { useCallback, useEffect, useState } from "react";
import { EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { fechaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";
import { FORMATOS } from "../../../../../packages/nucleo-comun/src/constants.ts";
import { pedir } from "../../cliente/aparato.ts";

// «Hoy», la primera de las cuatro pantallas del portal [AC-FPOR-07] — spec 07 §2.1.
//
// El maestro NOMBRA la pantalla sin cerrar su contenido (Pregunta al dueño 2 de esta spec): lo
// único que este AC garantiza es su existencia, su confinamiento a la empresa de la sesión y
// los estados obligatorios del §5.7 (cargando/error/vacío — el conjunto completo con AA es
// AC-FPOR-12, todavía abierto). Mientras esa pregunta no se cierre, el contenido es el resumen
// más chico que ya es útil y que no adelanta nada de lo que las Preguntas dejan abierto: cuántos
// encargos propios hay hoy, por estado. LEE, no muta — la lista completa y el detalle viven en
// «Encargos» (AC-FPOR-07 también, pantalla separada).
//
// Trae los datos con `pedir()` (`cliente/aparato.ts`): la MISMA credencial de sesión —el
// secreto del aparato— que ya usa el resto de la app «use client» (p. ej. `liquidaciones/page.tsx`
// del operador). El servidor confina por `empresa_cliente_id` en `encargosDelCliente`
// (`servidor/portal-cliente.ts`) — acá NO hay filtro de más que aplicar, solo agregar lo que ya
// llegó confinado.

type EncargoDelCliente = { id: string; estado: string; fecha_servicio: string; bultos: number; creado_en: string };

const ETIQUETA_ESTADO: Record<string, string> = { solicitado: "Solicitado", aceptado: "Aceptado" };

/** «Hoy» es el día en CHILE, no el del huso del navegador (§0: la app está cableada a Chile,
 *  mismo criterio que `offsetChileMin` del servidor) — `fecha_servicio` que la BD asigna con
 *  `(now() at time zone 'America/Santiago')::date` puede caer un día distinto del UTC del
 *  navegador cerca de la medianoche. `en-CA` es el truco estándar para que `Intl` devuelva
 *  YYYY-MM-DD directo, sin armar el string a mano. */
function hoyIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FORMATOS.zona_horaria }).format(new Date());
}

export default function PortalHoy() {
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

  const deHoy = encargos?.filter((e) => e.fecha_servicio === hoyIso()) ?? [];
  const porEstado = deHoy.reduce<Record<string, number>>((acc, e) => {
    acc[e.estado] = (acc[e.estado] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main data-testid="portal-hoy">
      <h1 style={titulo}>Hoy</h1>
      <p style={{ ...pie, margin: 0, color: superficie.textoDim }}>{fechaEsCl(new Date())}</p>

      {error && <EstadoError mensaje="No se pudo cargar tu resumen. Revisá tu conexión." alReintentar={() => void cargar()} />}
      {encargos === undefined && !error && <EstadoCargando filas={3} />}
      {encargos !== undefined && !error && deHoy.length === 0 && (
        <EstadoVacio mensaje="No tenés encargos programados para hoy." />
      )}

      {deHoy.length > 0 && (
        <ul data-testid="resumen-hoy" style={lista}>
          {Object.entries(porEstado).map(([estado, cantidad]) => (
            <li key={estado} data-testid="resumen-hoy-item" data-estado={estado} style={tarjeta}>
              <span style={cuerpo}>{ETIQUETA_ESTADO[estado] ?? estado}</span>
              <span data-testid="resumen-hoy-cantidad" style={{ ...cuerpo, fontVariantNumeric: "tabular-nums" }}>
                {cantidad}
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
  display: "flex",
  justifyContent: "space-between",
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
