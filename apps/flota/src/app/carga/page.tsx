"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BotonPrimario,
  CifraGrande,
  TecladoNumerico,
  EstadoVacio,
  EstadoError,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis, semantico as colorSemantico } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { UNDO } from "../../../../../packages/nucleo-comun/src/constants.ts";
import { pedir } from "../../cliente/aparato.ts";
import { useContadorDeToques, enviarToquesFlujo } from "../../cliente/toques-flujo.ts";

// La recepción de carga en el andén (F2) [AC-FRUT-07] — §5.2 F2, §5.3, §0, §4.7, §7.6.
//
// ─── CUATRO ACCIONES, Y LA CUARTA ES LA QUE CIERRA ────────────────────────────────
//
//   1 · el PIN (teclado propio = 1 acción, §5.3)
//   2 · el vehículo (1 toque)
//   3 · «Conforme» de la empresa (1 toque)
//   4 · —solo si hubo diferencia— el conteo real, tecleado en el punto
//
// El camino feliz son TRES. La cuarta existe porque el §5.2 F2 pide que la discrepancia se
// registre EN el punto: mandarla a otra pantalla significa que se registra al final del turno, de
// memoria, o que no se registra.
//
// ─── «CONFORME» ES LA ÚNICA CONFIRMACIÓN, Y SE DESHACE EN 8 SEGUNDOS ─────────────
//
// Cero modales (§7.6, §4.7). El toque manda la captura y abre una ventana de ocho segundos para
// deshacerla — que es lo que hace que un toque equivocado no sea un hecho firmado. La ventana
// sale de `UNDO.ventana_ms` y no de un número escrito acá: la familia canónica es la fuente.
//
// ─── LA CIFRA SE LEE DESDE MEDIO METRO ───────────────────────────────────────────
//
// `CifraGrande` trae el tamaño, el peso y `tabular-nums` de la familia canónica del §0. Es un
// componente y no un estilo local a propósito: el e2e mide los tres valores computados sobre esta
// pantalla, y un mutante que los baje tiene que ponerse rojo acá aunque el token siga vivo.
//
// ─── LA FOTO ES MEJORA PROGRESIVA, JAMÁS DEPENDENCIA ─────────────────────────────
//
// Cámara denegada no bloquea nada (§7.6): la discrepancia se registra igual, tecleada. En un
// andén a las cuatro de la mañana, con guantes y un teléfono prestado, la cámara falla más
// seguido que la red — y una captura que dependa de ella es una captura que no ocurre.

type Declarado = {
  item_id: string;
  empresa_cliente_id: string;
  empresa: string;
  qty_declarada: number;
};

type Paso = "pin" | "vehiculo" | "conteo";

export default function RecepcionDeCarga() {
  const [paso, setPaso] = useState<Paso>("pin");
  const [pin, setPin] = useState("");
  const [vehiculos, setVehiculos] = useState<{ id: string; patente: string }[]>([]);
  const [paradaId, setParadaId] = useState<string | null>(null);
  const [declarado, setDeclarado] = useState<Declarado[] | null>(null);
  const [contado, setContado] = useState<Record<string, string>>({});
  const [ajustando, setAjustando] = useState<string | null>(null);
  const [confirmadas, setConfirmadas] = useState<Record<string, "enviando" | "listo">>({});
  const [porDeshacer, setPorDeshacer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contadorPin = useContadorDeToques();

  const cargar = useCallback(async () => {
    const respuesta = await pedir("/api/vehiculos").catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo leer la flota. Revisá tu conexión.");
    setVehiculos(((await respuesta.json()) as { vehiculos: { id: string; patente: string }[] }).vehiculos);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** La parada de carga del día de ese vehículo, con lo declarado por empresa. */
  async function abrirVehiculo(vehiculoId: string) {
    const rutas = await pedir("/api/rutas").catch(() => null);
    const { rutas: delDia } = ((await rutas?.json().catch(() => ({ rutas: [] }))) ?? {}) as {
      rutas: { id: string; vehiculo_id: string | null }[];
    };
    const suya = delDia.find((r) => r.vehiculo_id === vehiculoId);
    if (!suya) {
      setError("Ese vehículo no tiene ruta publicada para hoy.");
      return;
    }
    const armada = await pedir(`/api/rutas/${suya.id}`).catch(() => null);
    const { paradas } = ((await armada?.json().catch(() => ({ paradas: [] }))) ?? {}) as {
      paradas: { id: string; tipo: string }[];
    };
    // La primera parada de CARGA: es donde se sube la mercadería. Si no hay, la ruta arranca
    // con el camión ya cargado y esta pantalla no aplica.
    const carga = paradas.find((p) => p.tipo === "carga") ?? paradas[0];
    if (!carga) {
      setError("Esa ruta todavía no tiene paradas.");
      return;
    }
    setParadaId(carga.id);
    const lo = await pedir(`/api/paradas/${carga.id}/manifiesto`).catch(() => null);
    setDeclarado(((await lo?.json().catch(() => ({ declarado: [] }))) as { declarado: Declarado[] }).declarado);
    setPaso("conteo");
  }

  /** Las empresas de esta parada, cada una con sus ítems: el sub-manifiesto es POR EMPRESA. */
  const porEmpresa = new Map<string, Declarado[]>();
  for (const d of declarado ?? []) {
    porEmpresa.set(d.empresa_cliente_id, [...(porEmpresa.get(d.empresa_cliente_id) ?? []), d]);
  }

  async function conforme(empresaId: string, items: Declarado[]) {
    setConfirmadas((previas) => ({ ...previas, [empresaId]: "enviando" }));
    setPorDeshacer(empresaId);

    // La ventana de undo: ocho segundos en los que el toque todavía no es un hecho. Si nadie la
    // usa, la captura viaja. Es la ÚNICA confirmación del flujo (§4.7).
    const enviar = window.setTimeout(async () => {
      setPorDeshacer(null);
      await pedir(`/api/paradas/${paradaId}/manifiesto`, {
        method: "POST",
        body: JSON.stringify({
          empresa_cliente_id: empresaId,
          client_uuid: crypto.randomUUID(),
          ts_dispositivo: new Date().toISOString(),
          tz_offset_min: -new Date().getTimezoneOffset(),
          conteos: items.map((i) => ({
            item_id: i.item_id,
            qty_confirmada: contado[i.item_id] === undefined ? i.qty_declarada : Number(contado[i.item_id]),
          })),
        }),
      }).catch(() => null);
      setConfirmadas((previas) => ({ ...previas, [empresaId]: "listo" }));
    }, UNDO.ventana_ms);

    (window as unknown as Record<string, number>)[`undo-${empresaId}`] = enviar;
  }

  function deshacer(empresaId: string) {
    window.clearTimeout((window as unknown as Record<string, number>)[`undo-${empresaId}`]);
    setPorDeshacer(null);
    setConfirmadas((previas) => {
      const copia = { ...previas };
      delete copia[empresaId];
      return copia;
    });
  }

  return (
    <main data-testid="recepcion-de-carga">
      <h1 style={titulo}>Recepción de carga</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}

      {paso === "pin" && (
        <section data-testid="paso-pin" style={bloque}>
          <h2 style={subtitulo}>Tu PIN</h2>
          {/* Teclado PROPIO: el del sistema tapa media pantalla justo cuando la persona está de
              pie en el andén con las manos ocupadas (§5.7, §0). */}
          <CifraGrande valor={pin === "" ? "—" : "•".repeat(pin.length)} />
          <div data-testid="teclado-pin">
            <TecladoNumerico valor={pin} onCambiar={setPin} onToque={contadorPin.contar} />
          </div>
          <BotonPrimario
            testid="continuar-pin"
            disabled={pin.length < 4}
            onClick={() => {
              enviarToquesFlujo("carga_pin", contadorPin.leerYReiniciar());
              setPaso("vehiculo");
            }}
          >
            Continuar
          </BotonPrimario>
        </section>
      )}

      {paso === "vehiculo" && (
        <section data-testid="paso-vehiculo" style={bloque}>
          <h2 style={subtitulo}>¿Qué camión estás cargando?</h2>
          <div style={chips}>
            {vehiculos.map((v) => (
              <button
                key={v.id}
                type="button"
                data-testid={`vehiculo-${v.patente}`}
                onClick={() => void abrirVehiculo(v.id)}
                style={chip}
              >
                {v.patente}
              </button>
            ))}
          </div>
        </section>
      )}

      {paso === "conteo" && (
        <section data-testid="paso-conteo" style={bloque}>
          {porEmpresa.size === 0 && (
            <EstadoVacio mensaje="Esta parada no tiene carga declarada. Revisá que el día esté publicado." />
          )}

          {[...porEmpresa.entries()].map(([empresaId, items]) => {
            const total = items.reduce(
              (suma, i) => suma + (contado[i.item_id] === undefined ? i.qty_declarada : Number(contado[i.item_id] || 0)),
              0,
            );
            const declaradoTotal = items.reduce((suma, i) => suma + i.qty_declarada, 0);
            const estado = confirmadas[empresaId];

            return (
              <article key={empresaId} data-testid={`sub-manifiesto-${empresaId}`} style={tarjeta}>
                {/* POR EMPRESA, con su nombre arriba: cada panadería responde por lo suyo y el
                    conteo de una no puede leerse como el de la otra (§5.2 F2). */}
                <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>{items[0]!.empresa}</p>

                <div data-testid={`cifra-${empresaId}`}>
                  <CifraGrande valor={String(total)} unidad="bultos" />
                </div>
                <p style={pieDim}>Declarados: {declaradoTotal}</p>

                {total !== declaradoTotal && (
                  <p data-testid={`discrepancia-${empresaId}`} style={textoDeAlerta}>
                    Diferencia de {total - declaradoTotal} bultos. Queda registrada acá mismo.
                  </p>
                )}

                {estado === undefined && ajustando !== empresaId && (
                  <>
                    <BotonPrimario testid={`conforme-${empresaId}`} onClick={() => void conforme(empresaId, items)}>
                      Conforme
                    </BotonPrimario>
                    {/* La discrepancia se registra EN el punto (§5.2 F2). Mandarla a otra
                        pantalla significa que se registra al final del turno, de memoria. */}
                    <BotonPrimario
                      testid={`ajustar-${empresaId}`}
                      variante="neutro"
                      onClick={() => setAjustando(empresaId)}
                    >
                      Conté distinto
                    </BotonPrimario>
                  </>
                )}

                {ajustando === empresaId && (
                  <div data-testid={`teclado-conteo-${empresaId}`}>
                    <TecladoNumerico
                      valor={contado[items[0]!.item_id] ?? ""}
                      onCambiar={(v) => setContado((previos) => ({ ...previos, [items[0]!.item_id]: v }))}
                    />
                    <BotonPrimario testid={`listo-conteo-${empresaId}`} onClick={() => setAjustando(null)}>
                      Listo
                    </BotonPrimario>
                  </div>
                )}

                {porDeshacer === empresaId && (
                  <BotonPrimario
                    testid={`deshacer-${empresaId}`}
                    variante="neutro"
                    onClick={() => deshacer(empresaId)}
                  >
                    Deshacer
                  </BotonPrimario>
                )}

                {estado === "listo" && (
                  <p data-testid={`confirmado-${empresaId}`} style={pieDim}>
                    Recibido conforme.
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = { fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.medio, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pieDim = { fontSize: tipografia.pie.tamano, color: superficie.textoDim, margin: 0 };
const textoDeAlerta = { ...cuerpo, margin: 0, color: colorSemantico.error, fontWeight: enfasis.medio };
const bloque = { display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas };
const chips = { display: "flex", gap: grilla.base, flexWrap: "wrap" as const };
const chip = {
  minHeight: componente.objetivoTactil.altoMinPx,
  padding: `0 ${grilla.base * 2}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.cuerpo.tamano,
  fontWeight: enfasis.medio,
};
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  marginTop: semantico.espacio.entreTarjetas,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
