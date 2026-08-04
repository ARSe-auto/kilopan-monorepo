// AC-VEN-03: cierre de caja — esperado vs declarado con la diferencia visible (§3
// módulo 3). El vendedor cuenta A CIEGAS: no ve lo esperado antes de declarar.
"use client";
import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, TecladoNumerico, CifraGrande } from "@kilopan/miga/componentes/index.tsx";
import { EstadoCargando, EstadoVacio, EstadoError } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { formatearClp, parsearClp } from "@/comun/formato.ts";
import { compartir, sePuedeCompartir } from "@/comun/compartir.ts";
import { Pantalla } from "../Pantalla.tsx";
import { SiguientePaso } from "../SiguientePaso.tsx";
import { useSesion } from "../SesionCliente.tsx";
import { puedeEntrar } from "../navegacion.ts";

// esperado_clp es OPCIONAL a propósito: el servidor NO se lo manda a quien vende
// (conteo a ciegas). Solo el admin lo recibe. Ver api/cierre-caja GET.
interface MedioCaja { medio_pago: string; etiqueta: string; esperado_clp?: string }
interface FilaResultado { medioPago: string; esperado: number; declarado: number; diferencia: number }

// F6 (cierre) + AC-PAG-01 + AC-DASH-04: una fila por medio de pago activo, y el total
// que marcó el facturador tecleado una vez para compararlo (decisión #3, fase 1).
export default function CajaPage() {
  const sesion = useSesion();
  const puedeVerPanel = puedeEntrar(sesion?.rol, "/dashboard");
  const [medios, setMedios] = useState<MedioCaja[]>([]);
  const [declarados, setDeclarados] = useState<Record<string, string>>({});
  const [totalFacturador, setTotalFacturador] = useState("");
  // F23 (docs/PROMPT_CORRECTIVO.md §5): teclado del sistema fuera del arqueo. Con
  // hasta 9 campos de plata en esta pantalla (8 medios + el facturador), un
  // TecladoNumerico POR CAMPO sería una pila de teclados — el patrón correcto es UNO
  // compartido, enrutado al campo que el vendedor tocó. FACTURADOR es un centinela
  // de string, no un medio_pago real: nunca choca porque medio_pago sale de la BD.
  const FACTURADOR = "__facturador__";
  const [campoActivo, setCampoActivo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ filas: FilaResultado[]; difFacturador: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "cargando"/"errorCarga" separados de "medios vacío": sin esto, un fetch que
  // fallaba (sin red, 401, 500) se leía igual que "esta panadería no tiene medios de
  // pago activos" — el vendedor veía la pantalla en blanco sin saber si es un estado
  // real o si la app simplemente no pudo consultar.
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // AC-H0-11: la carga se extrae a una función con nombre para que el botón «Reintentar»
  // del estado de error pueda volver a llamarla. Antes vivía dentro del useEffect y no
  // había forma de reintentar sin recargar la pantalla entera — que es lo que el operador
  // terminaba haciendo, perdiendo lo que ya había tecleado.
  const cargarMedios = useCallback(() => {
    setCargando(true);
    setErrorCarga(false);
    fetch("/api/cierre-caja")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setMedios(d.medios ?? []))
      .catch(() => setErrorCarga(true))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    cargarMedios();
  }, [cargarMedios]);

  function valorDeCampo(campo: string): string {
    return campo === FACTURADOR ? totalFacturador : declarados[campo] ?? "";
  }
  function fijarValorDeCampo(campo: string, nuevo: string) {
    if (campo === FACTURADOR) setTotalFacturador(nuevo);
    else setDeclarados((d) => ({ ...d, [campo]: nuevo }));
  }

  const totalEsperado = medios.reduce((s, m) => s + Number(m.esperado_clp ?? 0), 0);

  async function cerrar() {
    if (enviando) return; // doble toque con las manos ocupadas no debe mandar el cierre dos veces
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/cierre-caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          declarados: medios.map((m) => ({
            medioPago: m.medio_pago,
            declaradoClp: parsearClp(declarados[m.medio_pago] || "0"),
          })),
          totalFacturadorClp: totalFacturador ? parsearClp(totalFacturador) : null,
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) { setError(cuerpo.error); return; }
      setResultado({ filas: cuerpo.resultado, difFacturador: cuerpo.diferenciaFacturador });
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      setEnviando(false);
    }
  }

  async function compartirResumen() {
    if (!resultado) return;
    const lineas = resultado.filas
      .filter((f) => f.esperado > 0 || f.declarado > 0)
      .map((f) => `${f.medioPago}: esperado ${formatearClp(f.esperado)} · contado ${formatearClp(f.declarado)}`);
    await compartir({
      titulo: "Cierre de caja",
      texto: `Cierre de caja de hoy\n${lineas.join("\n")}\nTotal esperado: ${formatearClp(totalEsperado)}`,
    });
  }

  return (
    // Conteo A CIEGAS (hallazgo ALTA del red-team): antes cada fila mostraba "esperado
    // $145.000" ANTES de declarar nada. El vendedor que sacó plata tecleaba justo esa
    // cifra y salía "cuadra"; el honesto pero apurado la copiaba por pereza y nunca
    // contaba de verdad. El cierre —el único control anti-robo por el que paga el
    // dueño— se volvía teatro: todo cuadraba siempre. Ahora lo esperado y la
    // diferencia se revelan RECIÉN al cerrar.
    <Pantalla titulo="Cierre de caja" bajada="Cuenta la plata de cada medio y anótala. Al cerrar te mostramos si cuadra." ancho={520}>
      {/* AC-H0-11: los tres estados desde miga. El de error ahora trae su botón: antes
          decía «inténtalo de nuevo» sin darle al vendedor con qué intentarlo. */}
      {cargando ? (
        <EstadoCargando filas={3} />
      ) : errorCarga ? (
        <EstadoError mensaje="No se pudo consultar lo esperado de hoy. Revisa la conexión." alReintentar={cargarMedios} />
      ) : medios.length === 0 ? (
        <EstadoVacio mensaje="No hay medios de pago activos. Actívalos en Ajustes para poder cerrar la caja." />
      ) : null}

      {medios.map((m) => {
        const activo = campoActivo === m.medio_pago;
        return (
          <div key={m.medio_pago} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{m.etiqueta}</p>
              <p style={{ margin: 0, fontSize: 13, color: superficie.textoFaint, fontVariantNumeric: "tabular-nums" }}>
                {m.esperado_clp != null ? `esperado ${formatearClp(Number(m.esperado_clp))}` : "¿cuánto contaste?"}
              </p>
            </div>
            {/* F23: sin teclado del sistema — este botón abre el teclado propio
                compartido de abajo en vez de un <input> editable directo.
                aria-label con la etiqueta del medio: sin esto, dos medios vacíos
                compiten por el mismo nombre accesible "0" (y con el teclado abierto,
                también con la tecla "0" del propio TecladoNumerico) — ambiguo para
                cualquier lector de pantalla y para un locator de Playwright. */}
            <button
              type="button"
              onClick={() => setCampoActivo(activo ? null : m.medio_pago)}
              aria-pressed={activo}
              aria-label={`${m.etiqueta}: ${declarados[m.medio_pago] ? formatearClp(parsearClp(declarados[m.medio_pago]!)) : "sin contar"}`}
              style={{
                minWidth: 130,
                minHeight: 44,
                borderRadius: 12,
                border: activo ? "2px solid #C2410C" : `1px solid ${superficie.hairline}`,
                padding: "0 12px",
                fontSize: 17,
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
                background: "#fff",
                color: declarados[m.medio_pago] ? "#1B1712" : superficie.textoFaint,
              }}
            >
              {declarados[m.medio_pago] ? formatearClp(parsearClp(declarados[m.medio_pago]!)) : "0"}
            </button>
          </div>
        );
      })}

      <div style={{ borderTop: `1px solid ${superficie.hairline}`, paddingTop: 12 }}>
        <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600, color: superficie.textoDim }}>
          Total que marcó tu facturador (opcional)
        </p>
        <button
          type="button"
          onClick={() => setCampoActivo(campoActivo === FACTURADOR ? null : FACTURADOR)}
          aria-pressed={campoActivo === FACTURADOR}
          style={{
            width: "100%",
            minHeight: 44,
            borderRadius: 12,
            border: campoActivo === FACTURADOR ? "2px solid #C2410C" : `1px solid ${superficie.hairline}`,
            padding: "0 14px",
            fontSize: 17,
            textAlign: "left",
            background: "#fff",
            color: totalFacturador ? "#1B1712" : superficie.textoFaint,
          }}
        >
          {totalFacturador ? formatearClp(parsearClp(totalFacturador)) : "Lo que dice la boleta del día"}
        </button>
      </div>

      {campoActivo ? (
        <div style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <CifraGrande valor={valorDeCampo(campoActivo) || "0"} />
            <button
              type="button"
              onClick={() => setCampoActivo(null)}
              style={{ minHeight: 44, padding: "0 16px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14 }}
            >
              Listo
            </button>
          </div>
          <TecladoNumerico
            valor={valorDeCampo(campoActivo)}
            onCambiar={(nuevo) => fijarValorDeCampo(campoActivo, nuevo)}
          />
        </div>
      ) : null}

      {error ? <p style={{ color: semantico.error, fontSize: 14 }} role="alert">{error}</p> : null}

      {resultado ? (
        <div style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 14, padding: 16 }}>
          {resultado.filas.filter((f) => f.esperado > 0 || f.declarado > 0).map((f) => (
            <div key={f.medioPago} style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "3px 0" }}>
              {/* La clave interna ("mercadopago") no es lo que el vendedor reconoce —
                  arriba en la misma pantalla ya se traduce a la etiqueta. */}
              <span>
                {medios.find((m) => m.medio_pago === f.medioPago)?.etiqueta ?? f.medioPago}
                {/* El desglose se revela RECIEN aca: contaste X, esperado Y. Antes de
                    cerrar, quien vende no vio ninguna de las dos cifras. */}
                <span style={{ display: "block", fontSize: 12, color: superficie.textoFaint, fontVariantNumeric: "tabular-nums" }}>
                  contaste {formatearClp(f.declarado)} · esperado {formatearClp(f.esperado)}
                </span>
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: f.diferencia === 0 ? semantico.ok : semantico.alerta }}>
                {f.diferencia === 0 ? "cuadra" : `${f.diferencia > 0 ? "+" : ""}${formatearClp(f.diferencia)}`}
              </span>
            </div>
          ))}
          {resultado.difFacturador != null ? (
            <p style={{ marginTop: 10, fontSize: 14, color: resultado.difFacturador === 0 ? semantico.ok : semantico.alerta }}>
              {resultado.difFacturador === 0
                ? "Tu facturador marca lo mismo que KiloPan."
                : `Tu facturador marca ${formatearClp(Math.abs(resultado.difFacturador))} ${resultado.difFacturador > 0 ? "más" : "menos"} que KiloPan.`}
            </p>
          ) : null}
          {sePuedeCompartir() ? (
            <button type="button" onClick={compartirResumen} style={{ marginTop: 12, minHeight: 44, padding: "0 16px", borderRadius: 10, border: `1px solid ${superficie.hairline}`, background: "#fff", fontWeight: 700, fontSize: 14 }}>
              Compartir resumen
            </button>
          ) : null}
        </div>
      ) : cargando || errorCarga || medios.length === 0 ? null : (
        <BotonPrimario onClick={cerrar} disabled={enviando}>
          {enviando ? "Cerrando…" : "Cerrar caja"}
        </BotonPrimario>
      )}

      {/* El día cerrado es exactamente el momento en que el panel del dueño tiene algo
          nuevo que mostrar — el salto solo aparece cuando el rol puede verlo. */}
      {resultado && puedeVerPanel ? (
        <SiguientePaso texto="Caja cerrada" acciones={[{ etiqueta: "Ver el panel del día", href: "/dashboard" }]} />
      ) : null}
    </Pantalla>
  );
}
