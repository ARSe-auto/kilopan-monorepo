"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BotonPrimario,
  CifraGrande,
  EstadoVacio,
  EstadoError,
  SelectorUnToque,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../../cliente/aparato.ts";
import {
  diferenciaDe,
  puedeCerrar,
  clasificar,
  DESTINOS_DEL_DESCUADRE,
  type TerminosDeEmpresa,
} from "../../../dominio/cierre.ts";

// El motivo de la devolución, del catálogo del tenant [AC-FRUT-21] — §4.5, §5.2 F5.
//
// Un tercer toque, y no un campo de texto: el §7.6 no quiere tipeo libre obligatorio en terreno,
// y `motivos` YA es la lista que el catálogo del tenant ofrece para explicar un hecho (AC-FRUT-13).
// Se exige acá, en el CLIENTE contra el snapshot (§4.2), porque «Cerrar la ruta» es la última
// oportunidad de preguntarlo con el camión detenido y la persona ahí — después, la captura ya no
// rebota y la fila de `devoluciones` que no llegó con motivo simplemente no se materializa.
type Motivo = { id: string; etiqueta: string };

// El cierre de la ruta con su ecuación de custodia por empresa (F5) [AC-FRUT-11]
// — §3.E1.6, §4.5, §5.2 F5, §4.2, §4.8, §5.7.
//
// ─── PANTALLA PROPIA, Y NO UN PASO DENTRO DEL CIERRE DE TURNO ─────────────────────
//
// El §5.2 F5 cierra el TURNO en ≤6 toques (chequeo post, odómetro/SOC, enchufe) y ese contrato
// ya está medido por AC-FVEH-21. La ecuación es de la RUTA —una empresa, sus bultos, dónde
// quedaron— y meterla dentro de aquel flujo le sumaría toques a un presupuesto que el §5.3
// declara contrato. Van separadas: la ruta se reconcilia al volver, el turno se cierra al bajar.
//
// ─── LA RUTA NO CIERRA DESCUADRADA, Y EL BLOQUEO ES ACÁ ───────────────────────────
//
// El §4.2 lo dice: la validación bloqueante corre en el CLIENTE contra el snapshot. Por eso
// «Cerrar la ruta» no existe mientras alguna empresa no cuadre, y la pantalla DICE cuánto falta
// y cuáles son las dos salidas — jamás un botón gris sin explicación, jamás solo color (§5.7).
//
// ─── LA CLASIFICACIÓN ES TÁCTIL: DOS BOTONES, CERO TECLADO ───────────────────────
//
// «Volvieron al depósito» o «Faltaron». Son los términos de la propia ecuación (§5.2 F5) y no
// hay un tercero: existiendo un «sin explicar», todo descuadre terminaría ahí y la
// reconciliación diaria del §6 dejaría de reconciliar nada.
//
// ─── NI UN CLP ───────────────────────────────────────────────────────────────────
//
// Todo lo que se muestra son bultos (§4.8, §5.2 F5). No hay un solo número de dinero en esta
// pantalla, y la tabla que hay detrás tampoco tiene dónde guardarlo.
//
// Quién decide que esta ruta EXISTE para este tenant es la envoltura de servidor (`page.tsx`),
// no esta pantalla: un identificador ajeno tiene que morir en 404 antes de que se pinte un
// título (centinela 2). Acá abajo la ruta ya es de la casa.

type Renglon = TerminosDeEmpresa & { diferencia: number };

export default function CierreDeRuta({ rutaId }: { rutaId: string }) {
  const [renglones, setRenglones] = useState<Renglon[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cerrada, setCerrada] = useState(false);
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  // Empresa → motivo elegido, SOLO para las que se clasificaron «devuelto» [AC-FRUT-21]. No
  // vive en `renglones` porque el motivo no es un término de la ecuación (§5.2 F5) — es el
  // detalle que la fila de `devoluciones` necesita, y la ecuación cuadra sin mirarlo.
  const [motivoElegido, setMotivoElegido] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    setError(null);
    const [respuesta, deMotivos] = await Promise.all([
      pedir(`/api/rutas/${rutaId}/cierre`).catch(() => null),
      pedir(`/api/motivos`).catch(() => null),
    ]);
    setCargando(false);
    if (!respuesta?.ok) return setError("No se pudo leer el cierre de la ruta. Revisá tu conexión.");
    const datos = (await respuesta.json()) as { renglones: Renglon[]; cerrada: boolean };
    setRenglones(datos.renglones);
    setCerrada(datos.cerrada);
    if (deMotivos?.ok) {
      const catalogo = (await deMotivos.json()) as { motivos: Motivo[] };
      setMotivos(catalogo.motivos);
    }
    return undefined;
  }, [rutaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** La clasificación táctil, en el cliente: se ve al instante y todavía no viajó nada. */
  function asignar(empresaId: string, destino: (typeof DESTINOS_DEL_DESCUADRE)[number]) {
    setRenglones((previos) =>
      (previos ?? []).map((r) =>
        r.empresa_cliente_id === empresaId ? { ...clasificar(r, destino), diferencia: 0 } : r,
      ),
    );
  }

  async function cerrar() {
    setError(null);
    const respuesta = await pedir(`/api/rutas/${rutaId}/cierre`, {
      method: "POST",
      body: JSON.stringify({
        empresas: (renglones ?? []).map((r) => ({
          empresa_cliente_id: r.empresa_cliente_id,
          devuelto: r.devuelto,
          faltante: r.faltante,
          motivo_id: r.devuelto > 0 ? (motivoElegido[r.empresa_cliente_id] ?? null) : null,
        })),
        client_uuid: crypto.randomUUID(),
        ts_dispositivo: new Date().toISOString(),
        tz_offset_min: -new Date().getTimezoneOffset(),
      }),
    }).catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo cerrar la ruta. Volvé a intentar.");
    setCerrada(true);
    return undefined;
  }

  if (cerrada) {
    return (
      <main data-testid="ruta-cerrada">
        <h1 style={titulo}>Ruta cerrada</h1>
        <p style={cuerpo}>Todo lo que subió quedó contado.</p>
      </main>
    );
  }

  if (cargando) {
    return (
      <main data-testid="pantalla-cierre-ruta">
        <h1 style={titulo}>Cerrar la ruta</h1>
        <p style={cuerpo}>Cargando…</p>
      </main>
    );
  }

  const lista = renglones ?? [];
  const cuadrada = puedeCerrar(lista);

  return (
    <main data-testid="pantalla-cierre-ruta">
      <h1 style={titulo}>Cerrar la ruta</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}

      {lista.length === 0 ? (
        <EstadoVacio mensaje="Esta ruta no lleva carga de ninguna empresa. No hay nada que reconciliar." />
      ) : (
        lista.map((r) => {
          const diferencia = diferenciaDe(r);
          return (
            <section
              key={r.empresa_cliente_id}
              data-testid={`empresa-${r.empresa_cliente_id}`}
              style={tarjeta}
            >
              <h2 style={subtitulo}>{r.empresa}</h2>
              <CifraGrande valor={String(r.cargado)} unidad="bultos cargados" />
              <p style={cuerpo} data-testid="terminos">
                Entregados {r.entregado} · Devueltos {r.devuelto} · Faltantes {r.faltante}
              </p>

              {diferencia !== 0 && (
                <div data-testid="descuadre" style={bloque}>
                  {/* El texto DICE qué falta y cuáles son las dos salidas: un botón gris sin
                      explicación deja al chofer sin saber qué hacer a las nueve de la noche. */}
                  <p style={aviso}>
                    {diferencia > 0
                      ? `Faltan ${diferencia} bulto(s) por explicar. Decí dónde quedaron para poder cerrar.`
                      : `Hay ${-diferencia} bulto(s) de más: se contó menos de lo que salió. Corregí el conteo en el andén.`}
                  </p>
                  {diferencia > 0 && (
                    <>
                      <BotonPrimario
                        testid={`devuelto-${r.empresa_cliente_id}`}
                        onClick={() => asignar(r.empresa_cliente_id, "devuelto")}
                      >
                        Volvieron al depósito
                      </BotonPrimario>
                      <BotonPrimario
                        testid={`faltante-${r.empresa_cliente_id}`}
                        variante="neutro"
                        onClick={() => asignar(r.empresa_cliente_id, "faltante")}
                      >
                        Faltaron
                      </BotonPrimario>
                    </>
                  )}
                </div>
              )}

              {/* Cuadró como «devuelto»: falta el motivo antes de poder cerrar [AC-FRUT-21].
                  Un tercer toque, del mismo catálogo que ya usa la no-entrega — jamás un campo
                  de texto (§7.6). */}
              {diferencia === 0 && r.devuelto > 0 && (
                <div data-testid={`motivo-${r.empresa_cliente_id}`} style={bloque}>
                  <p style={aviso}>¿Por qué volvieron los {r.devuelto} bulto(s)?</p>
                  <SelectorUnToque
                    opciones={motivos.map((m) => ({ valor: m.id, etiqueta: m.etiqueta }))}
                    valor={motivoElegido[r.empresa_cliente_id] ?? null}
                    onCambiar={(motivoId) =>
                      setMotivoElegido((previos) => ({ ...previos, [r.empresa_cliente_id]: motivoId }))
                    }
                  />
                </div>
              )}
            </section>
          );
        })
      )}

      {/* El botón NO EXISTE mientras no cuadre NI mientras falte un motivo de devolución.
          Deshabilitado sería la misma prohibición dicha peor: se ve, se toca, y no pasa nada. */}
      {cuadrada && lista.every((r) => r.devuelto === 0 || motivoElegido[r.empresa_cliente_id]) && (
        <BotonPrimario testid="cerrar-ruta" onClick={() => void cerrar()}>
          Cerrar la ruta
        </BotonPrimario>
      )}
    </main>
  );
}

const titulo = {
  fontSize: tipografia.display.tamano,
  fontWeight: tipografia.display.peso,
  margin: 0,
};
const subtitulo = { fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.medio, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const aviso = { ...cuerpo, fontWeight: enfasis.medio };
const bloque = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreControles,
};
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
  padding: `${grilla.base * 2}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
};
