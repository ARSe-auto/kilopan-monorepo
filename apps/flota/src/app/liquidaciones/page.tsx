"use client";

import { useCallback, useEffect, useState } from "react";
import { EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { dineroEsCl, fechaEsCl, horaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";
import { formatearRut } from "../../../../../packages/nucleo-comun/src/rut.ts";
import { pedir } from "../../cliente/aparato.ts";

// La liquidación del operador/admin, con su drill-down línea→evidencia en 1 clic [AC-FTAR-07]
// — spec 06 §9, §3.E1.9.
//
// EL `id` VIAJA COMO PARÁMETRO DE CONSULTA (`?id=`), no de ruta — mismo criterio que
// `/hoy/excepciones` (AC-FSEM-05): la página no abre la BD del tenant por su cuenta, solo pide
// `pedir()` (que ya lleva la sesión del aparato), así que el confinamiento por tenant y por rol
// vive ENTERO en `/api/liquidaciones/[id]`, que sí es un recurso de ruta con su caso de cruce.
//
// UNA INTERACCIÓN: el mismo toque que abre la ficha de una línea dispara la carga de su
// evidencia — no hay un «ver más» de por medio. Bottom-sheet inline, sin navegar (mismo patrón
// que el peek N1 del semáforo, `hoy/peek-n1.tsx`): la evidencia es estado local de esta misma
// pantalla, jamás una ruta nueva.
//
// SOLO LO QUE LA BASE TIENE: no hay foto para mostrar porque ningún AC anterior persiste el
// binario en un storage servible (AC-FPOD-19 solo guarda el sha256); la ficha lista lo que
// `evidence` sí trae — tipo de captura y cuándo — sin inventar una imagen.

type LineaDeLiquidacion = {
  id: string;
  concepto: string;
  cantidad: number;
  monto_clp: string;
  evidencia_tipo: string;
  evidencia_id: string;
  bloqueada: boolean;
  disputa_estado: string | null;
  creado_en: string;
};

type LiquidacionConLineas = {
  id: string;
  estado: string;
  periodo_inicio: string;
  periodo_fin: string;
  empresa_razon_social: string;
  empresa_rut: string;
  lineas: LineaDeLiquidacion[];
};

type EvidenciaDePod = {
  tipo: "entrega_pod";
  resultado: string;
  metodo_entrega: string | null;
  motivo_etiqueta: string | null;
  event_time: string;
  capturas: { tipo: string; capturada_en: string }[];
};

type EvidenciaDeLinea = {
  linea_id: string;
  evidencia_tipo: string;
  evidencia_id: string;
  detalle: EvidenciaDePod | null;
};

const ETIQUETA_CONCEPTO: Record<string, string> = {
  por_entrega: "Entrega",
  por_bulto: "Por bulto",
  por_bloque_horas: "Bloque de horas",
  por_devolucion: "Devolución",
  por_intento_fallido: "Intento fallido",
};

const ETIQUETA_ESTADO: Record<string, string> = {
  abierta: "Abierta",
  cerrada: "Cerrada",
  pagada: "Pagada",
};

const ETIQUETA_RESULTADO: Record<string, string> = {
  exito: "Entregado",
  parcial: "Entrega parcial",
  fallo: "No entregado",
};

const ETIQUETA_EVIDENCIA: Record<string, string> = {
  firma: "Firma",
  foto: "Foto",
  lectura: "Lectura",
  indicador_visual: "Indicador visual",
  archivo_logger: "Registro adjunto",
  documento: "Documento",
  pin_destinatario: "PIN del destinatario",
  escaneo_codigo: "Código escaneado",
};

export default function Liquidaciones() {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  const [liquidacion, setLiquidacion] = useState<LiquidacionConLineas | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [sinAcceso, setSinAcceso] = useState(false);

  const cargar = useCallback(async (idLiquidacion: string) => {
    setError(false);
    const respuesta = await pedir(`/api/liquidaciones/${idLiquidacion}`).catch(() => null);
    if (!respuesta) return setError(true);
    if (respuesta.status === 403) return setSinAcceso(true);
    if (!respuesta.ok) return setLiquidacion(null);
    const { liquidacion: l } = (await respuesta.json()) as { liquidacion: LiquidacionConLineas };
    setLiquidacion(l);
    return undefined;
  }, []);

  useEffect(() => {
    if (id) void cargar(id);
  }, [id, cargar]);

  const [abierta, setAbierta] = useState<string | null>(null);
  const [evidencias, setEvidencias] = useState<Record<string, EvidenciaDeLinea | "cargando" | "error">>({});

  async function abrirEvidencia(lineaId: string) {
    // El toque abre Y cierra (toggle): reabrir una ficha ya vista no debería costar una
    // segunda interacción para volver a mirarla.
    setAbierta((actual) => (actual === lineaId ? null : lineaId));
    if (evidencias[lineaId] !== undefined) return;
    setEvidencias((prev) => ({ ...prev, [lineaId]: "cargando" }));
    const respuesta = await pedir(`/api/liquidacion-lineas/${lineaId}/evidencia`).catch(() => null);
    if (!respuesta?.ok) {
      setEvidencias((prev) => ({ ...prev, [lineaId]: "error" }));
      return;
    }
    const { evidencia } = (await respuesta.json()) as { evidencia: EvidenciaDeLinea };
    setEvidencias((prev) => ({ ...prev, [lineaId]: evidencia }));
  }

  if (sinAcceso) {
    return (
      <main data-testid="liquidacion-sin-acceso">
        <h1 style={titulo}>Liquidación</h1>
        <EstadoVacio mensaje="Este panel es de operación o administración." />
      </main>
    );
  }

  if (id === undefined) return null;

  if (id === null) {
    return (
      <main data-testid="liquidacion-sin-id">
        <h1 style={titulo}>Liquidación</h1>
        <EstadoVacio mensaje="Elegí una liquidación para verla." />
      </main>
    );
  }

  return (
    <main data-testid="liquidacion">
      <h1 style={titulo}>Liquidación</h1>

      {error && (
        <EstadoError
          mensaje="No se pudo cargar la liquidación. Revisá tu conexión."
          alReintentar={() => void cargar(id)}
        />
      )}
      {liquidacion === undefined && !error && <EstadoCargando filas={4} />}
      {liquidacion === null && !error && <EstadoVacio mensaje="Esta liquidación no existe." />}

      {liquidacion && (
        <>
          <section data-testid="cabecera-liquidacion" style={bloque}>
            <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.fuerte }}>{liquidacion.empresa_razon_social}</p>
            <p data-testid="empresa-rut" style={{ ...pie, margin: 0, color: superficie.textoDim }}>
              RUT {formatearRut(liquidacion.empresa_rut)}
            </p>
            <p style={{ ...pie, margin: 0, color: superficie.textoDim }}>
              {fechaEsCl(new Date(liquidacion.periodo_inicio))} a {fechaEsCl(new Date(liquidacion.periodo_fin))}
            </p>
            <p data-testid="estado-liquidacion" style={{ ...pie, margin: 0, fontWeight: enfasis.medio }}>
              {ETIQUETA_ESTADO[liquidacion.estado] ?? liquidacion.estado}
            </p>
          </section>

          {liquidacion.lineas.length === 0 ? (
            <EstadoVacio mensaje="Esta liquidación todavía no tiene líneas. El devengo las agrega solo, desde la evidencia de entrega." />
          ) : (
            <ul
              data-testid="lineas-liquidacion"
              style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas }}
            >
              {liquidacion.lineas.map((linea) => (
                <li key={linea.id} data-testid="linea-liquidacion" style={tarjeta}>
                  <button
                    type="button"
                    data-testid={`abrir-evidencia-${linea.id}`}
                    onClick={() => void abrirEvidencia(linea.id)}
                    style={filaBoton}
                  >
                    <span style={{ ...cuerpo, fontWeight: enfasis.medio }}>
                      {ETIQUETA_CONCEPTO[linea.concepto] ?? linea.concepto}
                    </span>
                    <span data-testid="monto-linea" style={{ ...cuerpo, fontVariantNumeric: "tabular-nums" }}>
                      {dineroEsCl(Number(linea.monto_clp))}
                    </span>
                  </button>
                  <p style={{ ...pie, margin: 0, color: superficie.textoDim }}>
                    {linea.cantidad} · {fechaEsCl(new Date(linea.creado_en))}
                    {linea.disputa_estado && <span data-testid="linea-disputada"> · Disputada</span>}
                    {linea.bloqueada && <span data-testid="linea-bloqueada"> · Bloqueada</span>}
                  </p>

                  {abierta === linea.id && (
                    <div data-testid={`evidencia-linea-${linea.id}`} style={fichaEvidencia}>
                      <FichaDeEvidencia estado={evidencias[linea.id]} onReintentar={() => void abrirEvidencia(linea.id)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function FichaDeEvidencia({
  estado,
  onReintentar,
}: {
  estado: EvidenciaDeLinea | "cargando" | "error" | undefined;
  onReintentar: () => void;
}) {
  if (estado === undefined || estado === "cargando") return <EstadoCargando filas={2} />;
  if (estado === "error") {
    return <EstadoError mensaje="No se pudo abrir la evidencia." alReintentar={onReintentar} />;
  }
  if (!estado.detalle) {
    return <EstadoVacio mensaje="Esta línea no tiene evidencia con detalle para mostrar acá." />;
  }
  const d = estado.detalle;
  return (
    <div data-testid="evidencia-pod" style={{ display: "grid", gap: semantico.espacio.entreControles }}>
      <p data-testid="evidencia-resultado" style={{ ...cuerpo, margin: 0 }}>
        {ETIQUETA_RESULTADO[d.resultado] ?? d.resultado}
        {d.metodo_entrega === "dejado_en_punto" && " — dejado en punto"}
      </p>
      {d.motivo_etiqueta && (
        <p data-testid="evidencia-motivo" style={{ ...pie, margin: 0, color: superficie.textoDim }}>
          Motivo: {d.motivo_etiqueta}
        </p>
      )}
      <p style={{ ...pie, margin: 0, color: superficie.textoDim }}>
        {fechaEsCl(new Date(d.event_time))} {horaEsCl(new Date(d.event_time))}
      </p>
      {d.capturas.length === 0 ? (
        <p style={{ ...pie, margin: 0, color: superficie.textoDim }}>Sin foto ni firma capturada.</p>
      ) : (
        <ul
          data-testid="evidencia-capturas"
          style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}
        >
          {d.capturas.map((captura, i) => (
            <li key={i} data-testid="evidencia-captura" style={{ ...pie, color: superficie.texto }}>
              {ETIQUETA_EVIDENCIA[captura.tipo] ?? captura.tipo} — {fechaEsCl(new Date(captura.capturada_en))}{" "}
              {horaEsCl(new Date(captura.capturada_en))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pie = { fontSize: tipografia.pie.tamano };
const bloque = { display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas };
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
const filaBoton = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: grilla.base,
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "pointer",
  textAlign: "left" as const,
  width: "100%",
};
const fichaEvidencia = {
  marginTop: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.fondo,
  border: `1px solid ${superficie.hairline}`,
};
