"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BotonPrimario,
  CifraGrande,
  TecladoNumerico,
  EstadoVacio,
  EstadoError,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, semantico as colorSemantico, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";
import { registrarToque, alCambiarTeclado, completarFlujo } from "../../cliente/toques-flujo.ts";
import { fechaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";

// La bandeja de encargos (F1) [AC-FRUT-01] — §3.E1.5, §5.2-F1, §5.3, §5.7.
//
// ─── CUATRO ACCIONES, Y TRES DE ELLAS SON EL DATO ────────────────────────────────
//
//   1 · la empresa (chip)   2 · el destino (chip)   3 · los bultos (teclado propio)   4 · guardar
//
// El §3.E1.5 pide el alta en menos de diez segundos y el §5.3 lo convierte en un presupuesto
// que se cuenta. Nada más es obligatorio: la fecha de servicio es hoy por default, y cada campo
// que alguien agregue como requerido se come esos diez segundos y devuelve al operador a la
// planilla que esta pantalla vino a reemplazar.
//
// ─── LOS REBOTES SE MUESTRAN DISTINTO PORQUE SE ARREGLAN DISTINTO ────────────────
//
// Bultos fuera de rango se arregla cambiando un número; un `attrs` inválido, mirando la
// definición del vertical. Un «datos inválidos» para los dos deja a quien tipea probando a
// ciegas — y esta pantalla la usa alguien con veinte encargos por delante.

type Empresa = { id: string; razon_social: string };
type Destino = { id: string; nombre: string };
type Encargo = { id: string; bultos: number; fecha_servicio: string };

export default function Bandeja() {
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [destinos, setDestinos] = useState<Destino[] | null>(null);
  const [encargos, setEncargos] = useState<Encargo[] | null>(null);
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [destino, setDestino] = useState<string | null>(null);
  const [bultos, setBultos] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rebote, setRebote] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // UN client_uuid por intento de alta [AC-FRUT-25]: antes se generaba de nuevo en CADA llamada
  // a `guardar()`, así que un doble-tap o un reintento tras un corte de red a mitad del submit
  // mandaban un `client_uuid` DISTINTO cada vez y `crearEncargo` (on conflict do nothing) no
  // tenía nada que deduplicar — mismo patrón ya arreglado en `cliente/nuevo/page.tsx`
  // (AC-FPOR-13). Se renueva SOLO tras un alta exitosa, para que el próximo encargo (uno
  // realmente distinto) no colisione con el anterior.
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());

  const cargar = useCallback(async () => {
    const [e, d, n] = await Promise.all([
      pedir("/api/empresas").catch(() => null),
      pedir("/api/destinos").catch(() => null),
      pedir("/api/encargos").catch(() => null),
    ]);
    if (!e?.ok || !d?.ok || !n?.ok) return setError("No se pudo leer la bandeja. Revisá tu conexión.");
    setEmpresas(((await e.json()) as { empresas: Empresa[] }).empresas);
    setDestinos(((await d.json()) as { destinos: Destino[] }).destinos);
    setEncargos(((await n.json()) as { encargos: Encargo[] }).encargos);
    setError(null);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function duplicarAyer() {
    const respuesta = await pedir("/api/encargos/duplicar", { method: "POST", body: "{}" }).catch(
      () => null,
    );
    if (!respuesta?.ok) return setDuplicado("No se pudo repetir el día de ayer. Volvé a intentar.");
    const { creados, repetidos } = (await respuesta.json()) as { creados: number; repetidos: number };
    // Los repetidos se DICEN. Un «listo» a secas después del segundo clic deja a quien mira sin
    // saber si se duplicó el día o si no pasó nada, y la respuesta correcta es distinta.
    setDuplicado(
      creados === 0 && repetidos === 0
        ? "Ayer no había encargos para repetir."
        : `Se agregaron ${creados}. ${repetidos > 0 ? `${repetidos} ya estaban.` : ""}`.trim(),
    );
    await cargar();
    return undefined;
  }

  async function guardar() {
    setRebote(null);
    setEnviando(true);
    const respuesta = await pedir("/api/encargos", {
      method: "POST",
      body: JSON.stringify({
        empresa_cliente_id: empresa,
        destino_id: destino,
        bultos: Number(bultos),
        client_uuid: clientUuid,
      }),
    }).catch(() => null);
    setEnviando(false);
    if (!respuesta) return setRebote("No se pudo guardar. Revisá tu conexión y volvé a intentar.");
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { mensaje?: string };
      // El mensaje del servidor, tal cual: ya viene en es-CL y dice CÓMO se arregla.
      return setRebote(cuerpo.mensaje ?? "No se pudo guardar el encargo.");
    }
    setBultos("");
    setClientUuid(crypto.randomUUID());
    // El flujo COMPLETÓ acá, no en el clic: un rebote de bultos que se corrige le costó al
    // operario los toques de las dos pasadas, y `completarFlujo` los suma todos (§5.3) [AC-FRUT-19].
    void completarFlujo("alta_encargo");
    await cargar();
    return undefined;
  }

  const listo = empresa !== null && destino !== null && bultos !== "" && !enviando;

  return (
    <main data-testid="bandeja">
      <h1 style={titulo}>Encargos de hoy</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}

      <section data-testid="alta-encargo" style={bloque}>
        <h2 style={subtitulo}>¿Para qué empresa?</h2>
        {empresas?.length === 0 && (
          <EstadoVacio mensaje="Todavía no hay empresas contratantes cargadas. Sin una, no hay a quién facturarle el encargo." />
        )}
        <div style={chips}>
          {empresas?.map((e) => (
            <button
              key={e.id}
              type="button"
              data-testid={`empresa-${e.razon_social}`}
              aria-pressed={empresa === e.id}
              onClick={() => {
                registrarToque("alta_encargo");
                setEmpresa(e.id);
              }}
              style={empresa === e.id ? chipMarcado : chip}
            >
              {empresa === e.id ? "✓ " : ""}
              {e.razon_social}
            </button>
          ))}
        </div>

        <h2 style={subtitulo}>¿A dónde va?</h2>
        {destinos?.length === 0 && (
          <EstadoVacio mensaje="No hay destinos cargados todavía. El primero se agrega junto con el primer encargo del cliente." />
        )}
        <div style={chips}>
          {destinos?.map((d) => (
            <button
              key={d.id}
              type="button"
              data-testid={`destino-${d.nombre}`}
              aria-pressed={destino === d.id}
              onClick={() => {
                registrarToque("alta_encargo");
                setDestino(d.id);
              }}
              style={destino === d.id ? chipMarcado : chip}
            >
              {destino === d.id ? "✓ " : ""}
              {d.nombre}
            </button>
          ))}
        </div>

        <h2 style={subtitulo}>¿Cuántos bultos?</h2>
        <CifraGrande valor={bultos === "" ? "—" : bultos} unidad="bultos" />
        <div data-testid="teclado-bultos">
          <TecladoNumerico
            valor={bultos}
            onCambiar={(v) => {
              alCambiarTeclado("alta_encargo", bultos, v);
              setBultos(v);
            }}
          />
        </div>

        {rebote && (
          <p data-testid="rebote-encargo" role="alert" style={textoRebote}>
            {rebote}
          </p>
        )}
        <BotonPrimario
          testid="guardar-encargo"
          disabled={!listo}
          onClick={() => {
            registrarToque("alta_encargo");
            void guardar();
          }}
        >
          {enviando ? "Guardando…" : "Agregar a la bandeja"}
        </BotonPrimario>
      </section>

      <section data-testid="bandeja-del-dia" style={bloque}>
        <h2 style={{ ...cuerpo, margin: 0 }}>
          En la bandeja <span data-testid="conteo-bandeja">{encargos ? encargos.length : "…"}</span>
        </h2>

        {/* «Duplicar encargos de ayer» (§3.E1.5) [AC-FRUT-17]. La panadería que reparte a las
            mismas doce sucursales todos los días no tiene un Excel: tiene el día de ayer.
            Apretarlo dos veces no duplica nada — el identificador de cada copia se deriva del
            encargo original y de la fecha, y ese es el caso real: la pantalla tarda y alguien
            insiste. */}
        <BotonPrimario testid="duplicar-ayer" variante="neutro" onClick={() => void duplicarAyer()}>
          Repetir los encargos de ayer
        </BotonPrimario>
        {duplicado && (
          <p data-testid="resultado-duplicado" style={{ ...pie, color: superficie.textoDim }}>
            {duplicado}
          </p>
        )}
        {encargos?.length === 0 && (
          <EstadoVacio mensaje="La bandeja de hoy está vacía. Agregá el primer encargo acá arriba y después armá las rutas." />
        )}
        {encargos?.map((e) => (
          <article key={e.id} data-testid="encargo" style={tarjeta}>
            <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>{e.bultos} bultos</p>
            <p style={{ ...pie, margin: 0, color: superficie.textoDim }}>
              Para el {fechaEsCl(new Date(`${e.fecha_servicio}T12:00:00`))}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = { fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.medio, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pie = { fontSize: tipografia.pie.tamano };
const bloque = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
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
const chipMarcado = { ...chip, background: superficie.texto, color: superficie.tarjeta };
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
const textoRebote = { ...cuerpo, margin: 0, color: colorSemantico.error, fontWeight: enfasis.medio };
