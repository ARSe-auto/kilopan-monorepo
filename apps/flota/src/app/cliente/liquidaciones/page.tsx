"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { dineroEsCl, fechaEsCl, horaEsCl } from "../../../../../../packages/nucleo-comun/src/fechas.ts";
import { pedir } from "../../../cliente/aparato.ts";
import { useConexion } from "../../../cliente/conexion.ts";
import { TERMINOLOGIA_PORTAL_BASE, resolverTerminologiaPortal, type TerminologiaPortal } from "../../../dominio/portal-terminologia.ts";
import { TEMA_PORTAL_CSS } from "../tema-portal.ts";

// «Liquidación», la cuarta pantalla del portal [AC-FPOR-07, AC-FPOR-10] — spec 07 §2.4.
//
// Sin `?id=`: la lista de cabeceras (abierta→cerrada→pagada) de la empresa de la sesión, igual
// que desde AC-FPOR-07. Con `?id=`: la MISMA pantalla abre la liquidación con sus líneas — mismo
// criterio que `/liquidaciones?id=` del operador (AC-FTAR-07): el id viaja como parámetro de
// CONSULTA, no de ruta, porque esta página no abre ninguna BD de tenant por su cuenta, solo pide
// `pedir()`; el confinamiento por empresa y por tenant vive ENTERO en
// `/cliente/api/liquidaciones/[id]`, que sí es un recurso de ruta con su propio caso de cruce —
// con el drill-down línea→evidencia a 1 clic y la disputa por línea con motivo tipado dentro de
// la ventana de 7 días [AC-FPOR-10, `disputar_linea()` 0066/AC-FTAR-06].

type LiquidacionDelCliente = {
  id: string;
  estado: string;
  periodo_inicio: string;
  periodo_fin: string;
  creado_en: string;
};

type LineaDeLiquidacionCliente = {
  id: string;
  evidencia_tipo: string;
  evidencia_id: string;
  concepto: string;
  cantidad: number;
  monto_clp: string;
  disputa_estado: string | null;
  disputa_motivo_id: string | null;
  disputa_nota: string | null;
  disputa_creado_en: string | null;
  creado_en: string;
};

type LiquidacionConLineas = LiquidacionDelCliente & { lineas: LineaDeLiquidacionCliente[] };

type MotivoDeDisputa = { id: string; codigo: string; etiqueta: string };

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

export default function PortalLiquidaciones() {
  const [id, setId] = useState<string | null | undefined>(undefined);
  const online = useConexion();
  const [terminologia, setTerminologia] = useState<TerminologiaPortal>(TERMINOLOGIA_PORTAL_BASE);
  useEffect(() => {
    const parametros = new URLSearchParams(window.location.search);
    setId(parametros.get("id"));
    setTerminologia(resolverTerminologiaPortal(parametros.get("terminologia") ?? undefined));
  }, []);

  if (id === undefined) return null;
  if (id === null) return <ListaLiquidaciones online={online} terminologia={terminologia} />;
  return <DetalleLiquidacion id={id} online={online} terminologia={terminologia} />;
}

function ListaLiquidaciones({ online, terminologia }: { online: boolean; terminologia: TerminologiaPortal }) {
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
    <main className="portal-superficie" data-testid="portal-liquidaciones" style={pagina}>
      <style>{TEMA_PORTAL_CSS}</style>
      <h1 style={titulo}>Liquidación</h1>

      {!online && (
        <p data-testid="liquidaciones-sin-conexion" role="status" style={{ ...pie, margin: 0, color: "var(--portal-alerta)", fontWeight: enfasis.fuerte }}>
          Sin conexión — esta lista puede estar desactualizada.
        </p>
      )}

      {error && (
        <EstadoError mensaje="No se pudieron cargar tus liquidaciones. Revisá tu conexión." alReintentar={() => void cargar()} />
      )}
      {liquidaciones === undefined && !error && <EstadoCargando filas={3} />}
      {liquidaciones !== undefined && !error && liquidaciones.length === 0 && (
        <EstadoVacio mensaje="Todavía no tenés liquidaciones. Se generan automáticamente cuando el operador cierra un período con tus entregas." />
      )}

      {liquidaciones && liquidaciones.length > 0 && (
        <ul data-testid="lista-liquidaciones" style={lista}>
          {liquidaciones.map((l) => (
            <li key={l.id} style={{ margin: 0, padding: 0 }}>
              <a
                data-testid="liquidacion-item"
                data-estado={l.estado}
                data-id={l.id}
                href={`/cliente/liquidaciones?id=${l.id}`}
                style={{ ...tarjeta, ...filaBoton, textDecoration: "none" }}
              >
                <span style={cuerpo}>{terminologia.estadoLiquidacion[l.estado as "abierta" | "cerrada" | "pagada"] ?? l.estado}</span>
                <span style={{ ...pie, color: "var(--portal-texto-dim)" }}>
                  {fechaEsCl(new Date(`${l.periodo_inicio}T12:00:00`))} a{" "}
                  {fechaEsCl(new Date(`${l.periodo_fin}T12:00:00`))}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function DetalleLiquidacion({ id, online, terminologia }: { id: string; online: boolean; terminologia: TerminologiaPortal }) {
  const [liquidacion, setLiquidacion] = useState<LiquidacionConLineas | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [motivos, setMotivos] = useState<MotivoDeDisputa[] | undefined>(undefined);

  const cargar = useCallback(async () => {
    setError(false);
    const respuesta = await pedir(`/cliente/api/liquidaciones/${id}`).catch(() => null);
    if (!respuesta) return setError(true);
    if (!respuesta.ok) return setLiquidacion(null);
    const { liquidacion: l } = (await respuesta.json()) as { liquidacion: LiquidacionConLineas };
    setLiquidacion(l);
    return undefined;
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void (async () => {
      const respuesta = await pedir("/cliente/api/motivos-disputa").catch(() => null);
      if (!respuesta?.ok) return;
      const { motivos: catalogo } = (await respuesta.json()) as { motivos: MotivoDeDisputa[] };
      setMotivos(catalogo);
    })();
  }, []);

  const [abierta, setAbierta] = useState<string | null>(null);
  const [evidencias, setEvidencias] = useState<Record<string, EvidenciaDeLinea | "cargando" | "error">>({});

  async function abrirEvidencia(lineaId: string) {
    // El toque abre Y cierra (toggle): mismo criterio que el drill-down del operador
    // (AC-FTAR-07) — reabrir una ficha ya vista no debería costar una segunda interacción.
    setAbierta((actual) => (actual === lineaId ? null : lineaId));
    if (evidencias[lineaId] !== undefined) return;
    setEvidencias((prev) => ({ ...prev, [lineaId]: "cargando" }));
    const respuesta = await pedir(`/cliente/api/liquidacion-lineas/${lineaId}/evidencia`).catch(() => null);
    if (!respuesta?.ok) {
      setEvidencias((prev) => ({ ...prev, [lineaId]: "error" }));
      return;
    }
    const { evidencia } = (await respuesta.json()) as { evidencia: EvidenciaDeLinea };
    setEvidencias((prev) => ({ ...prev, [lineaId]: evidencia }));
  }

  const banner = !online && (
    <p data-testid="liquidaciones-sin-conexion" role="status" style={{ ...pie, margin: 0, color: "var(--portal-alerta)", fontWeight: enfasis.fuerte }}>
      Sin conexión — este detalle puede estar desactualizado.
    </p>
  );

  if (error) {
    return (
      <main className="portal-superficie" data-testid="portal-liquidacion-detalle" style={pagina}>
        <style>{TEMA_PORTAL_CSS}</style>
        <h1 style={titulo}>Liquidación</h1>
        {banner}
        <EstadoError mensaje="No se pudo cargar la liquidación. Revisá tu conexión." alReintentar={() => void cargar()} />
      </main>
    );
  }
  if (liquidacion === undefined) {
    return (
      <main className="portal-superficie" data-testid="portal-liquidacion-detalle" style={pagina}>
        <style>{TEMA_PORTAL_CSS}</style>
        <h1 style={titulo}>Liquidación</h1>
        {banner}
        <EstadoCargando filas={4} />
      </main>
    );
  }
  if (liquidacion === null) {
    return (
      <main className="portal-superficie" data-testid="portal-liquidacion-detalle" style={pagina}>
        <style>{TEMA_PORTAL_CSS}</style>
        <h1 style={titulo}>Liquidación</h1>
        {banner}
        <EstadoVacio mensaje="Esta liquidación no existe." />
      </main>
    );
  }

  return (
    <main className="portal-superficie" data-testid="portal-liquidacion-detalle" style={pagina}>
      <style>{TEMA_PORTAL_CSS}</style>
      <a data-testid="volver-liquidaciones" href="/cliente/liquidaciones" style={{ ...pie, color: "var(--portal-texto-dim)" }}>
        ← Todas tus liquidaciones
      </a>
      <h1 style={titulo}>Liquidación</h1>
      {banner}

      <section data-testid="cabecera-liquidacion-cliente" style={bloque}>
        <p data-testid="estado-liquidacion-cliente" style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>
          {terminologia.estadoLiquidacion[liquidacion.estado as "abierta" | "cerrada" | "pagada"] ?? liquidacion.estado}
        </p>
        <p style={{ ...pie, margin: 0, color: "var(--portal-texto-dim)" }}>
          {fechaEsCl(new Date(`${liquidacion.periodo_inicio}T12:00:00`))} a{" "}
          {fechaEsCl(new Date(`${liquidacion.periodo_fin}T12:00:00`))}
        </p>
      </section>

      {liquidacion.lineas.length === 0 ? (
        <EstadoVacio mensaje="Esta liquidación todavía no tiene líneas. El devengo las agrega solo, desde la evidencia de entrega." />
      ) : (
        <ul data-testid="lineas-liquidacion-cliente" style={lista}>
          {liquidacion.lineas.map((linea) => (
            <li key={linea.id} data-testid="linea-liquidacion-cliente" data-id={linea.id} style={tarjeta}>
              <button
                type="button"
                data-testid={`abrir-evidencia-${linea.id}`}
                onClick={() => void abrirEvidencia(linea.id)}
                style={filaBoton}
              >
                <span style={{ ...cuerpo, fontWeight: enfasis.medio }}>
                  {ETIQUETA_CONCEPTO[linea.concepto] ?? linea.concepto}
                </span>
                <span data-testid="monto-linea-cliente" style={{ ...cuerpo, fontVariantNumeric: "tabular-nums" }}>
                  {dineroEsCl(Number(linea.monto_clp))}
                </span>
              </button>
              <p style={{ ...pie, margin: 0, color: "var(--portal-texto-dim)" }}>
                {linea.cantidad} · {fechaEsCl(new Date(linea.creado_en))}
              </p>

              {abierta === linea.id && (
                <div data-testid={`evidencia-linea-${linea.id}`} style={fichaEvidencia}>
                  <FichaDeEvidencia estado={evidencias[linea.id]} terminologia={terminologia} onReintentar={() => void abrirEvidencia(linea.id)} />
                </div>
              )}

              {linea.disputa_estado ? (
                <p data-testid="linea-disputada-cliente" style={{ ...pie, margin: 0, color: "var(--portal-alerta)" }}>
                  Disputada{linea.disputa_nota ? `: ${linea.disputa_nota}` : ""}
                </p>
              ) : liquidacion.estado === "cerrada" ? (
                <FormularioDeDisputa lineaId={linea.id} motivos={motivos} online={online} alDisputar={() => void cargar()} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function FichaDeEvidencia({
  estado,
  terminologia,
  onReintentar,
}: {
  estado: EvidenciaDeLinea | "cargando" | "error" | undefined;
  terminologia: TerminologiaPortal;
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
    <div data-testid="evidencia-pod-cliente" style={{ display: "grid", gap: semantico.espacio.entreControles }}>
      <p data-testid="evidencia-resultado-cliente" style={{ ...cuerpo, margin: 0 }}>
        {terminologia.resultadoEntrega[d.resultado as "exito" | "parcial" | "fallo"] ?? d.resultado}
        {d.metodo_entrega === "dejado_en_punto" && " — dejado en punto"}
      </p>
      {d.motivo_etiqueta && (
        <p data-testid="evidencia-motivo-cliente" style={{ ...pie, margin: 0, color: "var(--portal-texto-dim)" }}>
          Motivo: {d.motivo_etiqueta}
        </p>
      )}
      <p style={{ ...pie, margin: 0, color: "var(--portal-texto-dim)" }}>
        {fechaEsCl(new Date(d.event_time))} {horaEsCl(new Date(d.event_time))}
      </p>
      {d.capturas.length === 0 ? (
        <p style={{ ...pie, margin: 0, color: "var(--portal-texto-dim)" }}>Sin foto ni firma capturada.</p>
      ) : (
        <ul
          data-testid="evidencia-capturas-cliente"
          style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}
        >
          {d.capturas.map((captura, i) => (
            <li key={i} data-testid="evidencia-captura-cliente" style={{ ...pie, color: "var(--portal-texto)" }}>
              {ETIQUETA_EVIDENCIA[captura.tipo] ?? captura.tipo} — {fechaEsCl(new Date(captura.capturada_en))}{" "}
              {horaEsCl(new Date(captura.capturada_en))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormularioDeDisputa({
  lineaId,
  motivos,
  online,
  alDisputar,
}: {
  lineaId: string;
  motivos: MotivoDeDisputa[] | undefined;
  online: boolean;
  alDisputar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivoId, setMotivoId] = useState("");
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // UN client_uuid por apertura del formulario: es la llave de idempotencia del §9.3.1 — si el
  // doble-tap reintenta con el MISMO valor, `disputar_linea()` (0066) devuelve la disputa ya
  // registrada en vez de rebotar «ya tiene una disputa».
  const [clientUuid] = useState(() => crypto.randomUUID());

  if (!abierto) {
    return (
      <button
        type="button"
        data-testid={`disputar-linea-${lineaId}`}
        onClick={() => setAbierto(true)}
        style={botonSecundario}
      >
        Disputar esta línea
      </button>
    );
  }

  async function enviar() {
    setEnviando(true);
    setError(null);
    const respuesta = await pedir(`/cliente/api/liquidacion-lineas/${lineaId}/disputa`, {
      method: "POST",
      body: JSON.stringify({ motivo_id: motivoId, nota: nota || undefined, client_uuid: clientUuid }),
    }).catch(() => null);
    setEnviando(false);
    if (!respuesta?.ok) {
      const cuerpo = (await respuesta?.json().catch(() => ({}))) as { mensaje?: string } | undefined;
      setError(cuerpo?.mensaje ?? "No se pudo registrar la disputa. Revisá tu conexión e intentá de nuevo.");
      return;
    }
    setAbierto(false);
    alDisputar();
  }

  return (
    <div data-testid={`formulario-disputa-${lineaId}`} style={{ display: "grid", gap: semantico.espacio.entreControles }}>
      <label style={etiqueta} htmlFor={`motivo-disputa-${lineaId}`}>
        Motivo
      </label>
      <select
        id={`motivo-disputa-${lineaId}`}
        data-testid="motivo-disputa"
        value={motivoId}
        onChange={(e) => setMotivoId(e.target.value)}
        disabled={motivos === undefined}
        style={campo}
      >
        <option value="">{motivos === undefined ? "Cargando…" : "Elegí un motivo"}</option>
        {motivos?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.etiqueta}
          </option>
        ))}
      </select>

      <label style={etiqueta} htmlFor={`nota-disputa-${lineaId}`}>
        Nota (opcional)
      </label>
      <input
        id={`nota-disputa-${lineaId}`}
        data-testid="nota-disputa"
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        style={campo}
      />

      {!online && (
        <p data-testid="disputa-sin-conexion" role="status" style={{ ...pie, margin: 0, color: "var(--portal-alerta)" }}>
          Sin conexión — registrar la disputa necesita red.
        </p>
      )}

      {error && (
        <p role="alert" style={{ ...pie, margin: 0, color: "var(--portal-error)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: semantico.espacio.entreControles }}>
        <BotonPrimario testid="enviar-disputa" disabled={!online || motivoId === "" || enviando} onClick={() => void enviar()}>
          {enviando ? "Enviando…" : "Enviar disputa"}
        </BotonPrimario>
        <button type="button" data-testid="cancelar-disputa" onClick={() => setAbierto(false)} style={botonSecundario}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

const pagina = { padding: `${grilla.base * 2}px`, minHeight: "100vh" };
const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: "var(--portal-texto)" };
const pie = { fontSize: tipografia.pie.tamano };
const etiqueta = { fontSize: tipografia.cuerpo.tamano, color: "var(--portal-texto)", fontWeight: 600 };
const bloque = { display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas };
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
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: "var(--portal-bg-tarjeta)",
  border: "1px solid var(--portal-hairline)",
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
  background: "var(--portal-bg-pagina)",
  border: "1px solid var(--portal-hairline)",
};
const botonSecundario = {
  minHeight: semantico.toque.operativo,
  padding: "0 16px",
  borderRadius: grilla.radio,
  border: "1px solid var(--portal-hairline)",
  background: "var(--portal-bg-tarjeta)",
  color: "var(--portal-texto)",
  fontSize: tipografia.pie.tamano,
  alignSelf: "start" as const,
};
const campo = {
  fontSize: tipografia.cuerpo.tamano,
  minHeight: semantico.toque.operativo,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  border: "1px solid var(--portal-hairline)",
  background: "var(--portal-bg-pagina)",
  color: "var(--portal-texto)",
};
