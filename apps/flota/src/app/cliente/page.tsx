"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { fechaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";
import { FORMATOS } from "../../../../../packages/nucleo-comun/src/constants.ts";
import { pedir } from "../../cliente/aparato.ts";
import { useConexion } from "../../cliente/conexion.ts";
import { TERMINOLOGIA_PORTAL_BASE, resolverTerminologiaPortal, type TerminologiaPortal } from "../../dominio/portal-terminologia.ts";
import { TEMA_PORTAL_CSS } from "./tema-portal.ts";

// «Hoy», la primera de las cuatro pantallas del portal [AC-FPOR-07] — spec 07 §2.1.
//
// El maestro NOMBRA la pantalla sin cerrar su contenido (Pregunta al dueño 2 de esta spec): lo
// único que este AC garantiza es su existencia, su confinamiento a la empresa de la sesión y
// los estados obligatorios del §5.7. El gate GUI completo (4 estados, AA, tema+dark,
// terminología doble, snapshot 375px) es AC-FPOR-12. Mientras la Pregunta 2 no se cierre, el
// contenido es el resumen más chico que ya es útil y que no adelanta nada de lo que las
// Preguntas dejan abierto: cuántos encargos propios hay hoy, por estado. LEE, no muta — la
// lista completa y el detalle viven en «Encargos» (AC-FPOR-07 también, pantalla separada).
//
// Trae los datos con `pedir()` (`cliente/aparato.ts`): la MISMA credencial de sesión —el
// secreto del aparato— que ya usa el resto de la app «use client» (p. ej. `liquidaciones/page.tsx`
// del operador). El servidor confina por `empresa_cliente_id` en `encargosDelCliente`
// (`servidor/portal-cliente.ts`) — acá NO hay filtro de más que aplicar, solo agregar lo que ya
// llegó confinado.

type EncargoDelCliente = { id: string; estado: string; fecha_servicio: string; bultos: number; creado_en: string };

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
  const online = useConexion();
  // Terminología renombrable del tenant [AC-FPOR-12]: resuelta en el cliente porque esta
  // pantalla entera ya es «use client» (mismo criterio que `?id=` en Encargos/Liquidaciones) —
  // `?terminologia=extremo` es el gancho de e2e mientras AC-FMIG-04 (term_key real) no exista.
  const [terminologia, setTerminologia] = useState<TerminologiaPortal>(TERMINOLOGIA_PORTAL_BASE);
  useEffect(() => {
    setTerminologia(resolverTerminologiaPortal(new URLSearchParams(window.location.search).get("terminologia") ?? undefined));
  }, []);

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
    <main className="portal-superficie" data-testid="portal-hoy" style={pagina}>
      <style>{TEMA_PORTAL_CSS}</style>
      <h1 style={titulo}>Hoy</h1>
      <p style={{ ...pie, margin: 0, color: "var(--portal-texto-dim)" }}>{fechaEsCl(new Date())}</p>

      {!online && (
        <p data-testid="hoy-sin-conexion" role="status" style={{ ...pie, margin: 0, color: "var(--portal-alerta)", fontWeight: enfasis.fuerte }}>
          Sin conexión — este resumen puede estar desactualizado.
        </p>
      )}

      {error && <EstadoError mensaje="No se pudo cargar tu resumen. Revisá tu conexión." alReintentar={() => void cargar()} />}
      {encargos === undefined && !error && <EstadoCargando filas={3} />}
      {encargos !== undefined && !error && deHoy.length === 0 && (
        <EstadoVacio
          mensaje="No tenés encargos programados para hoy."
          accion={
            <Link href="/cliente/nuevo" data-testid="cta-vacio-hoy" style={enlaceAccion}>
              Crear un encargo
            </Link>
          }
        />
      )}

      {deHoy.length > 0 && (
        <ul data-testid="resumen-hoy" style={lista}>
          {Object.entries(porEstado).map(([estado, cantidad]) => (
            <li key={estado} data-testid="resumen-hoy-item" data-estado={estado} style={tarjeta}>
              <span style={cuerpo}>{terminologia.estadoEncargo[estado as "solicitado" | "aceptado"] ?? estado}</span>
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

const pagina = { padding: `${grilla.base * 2}px`, minHeight: "100vh" };
const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: "var(--portal-texto)" };
const pie = { fontSize: tipografia.pie.tamano };
const enlaceAccion = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: semantico.toque.operativo,
  padding: "0 20px",
  borderRadius: grilla.radio,
  border: "1px solid var(--portal-hairline)",
  background: "var(--portal-bg-tarjeta)",
  color: "var(--portal-texto)",
  fontSize: tipografia.cuerpo.tamano,
  fontWeight: enfasis.medio,
  textDecoration: "none",
  alignSelf: "flex-start",
} as const;
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
  background: "var(--portal-bg-tarjeta)",
  border: "1px solid var(--portal-hairline)",
};
