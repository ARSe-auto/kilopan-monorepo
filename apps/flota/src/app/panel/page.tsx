"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonPrimario, EstadoVacio, EstadoError } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { svgQr } from "../../../../../packages/nucleo-comun/src/qr.ts";
import { pedir } from "../../cliente/aparato.ts";

// El panel del dueño: F-A (emitir) y F-C (aprobar) del §5.4 [AC-FIDN-02].
//
// EL PRESUPUESTO DE ACCIONES DEL §5.3 ES EL CONTRATO, y por eso la pantalla se diseña desde
// ahí y no al revés:
//
//   · EMITIR ≤4 acciones: «Invitar» (1) → el rol, que EMITE en el mismo toque (2) →
//     «Compartir» (3). Un paso de confirmación intermedio sería un cuarto toque para nada: una
//     invitación de más se revoca en 1 toque, así que confirmar protege menos de lo que cuesta.
//   · APROBAR en 1 acción: la tarjeta muestra a quién se aprueba y el botón hace el acto. El
//     rol NO se elige acá —sale de la invitación (AC-FIDN-04)— porque elegirlo convertiría un
//     toque en una decisión de permisos tomada sin mirar.
//
// LOS TRES ENVOLTORIOS DE LA INVITACIÓN SON UNA SOLA CREDENCIAL (AC-FIDN-03): el código corto
// ES la credencial, el link lo lleva como parámetro y el QR codifica el link. Uno solo que
// revocar, uno solo que expirar.
//
// El share-sheet es el del propio teléfono, sin pasarela de SMS ni de WhatsApp (respuesta del
// dueño a la pregunta 5): cero integraciones y sin meter en el camino crítico el modo de falla
// de un proveedor de mensajería — el mensaje que no llegó.

type Solicitud = { id: string; rut_propuesto: string; nombre_propuesto: string; rol: string | null };
type Emitida = { id: string; codigo: string; rol: string };

const ROLES_INVITABLES = [
  { rol: "operador", etiqueta: "Operador" },
  { rol: "chofer", etiqueta: "Chofer" },
  { rol: "responsable_carga", etiqueta: "Responsable de carga" },
  { rol: "responsable_tecnico", etiqueta: "Responsable técnico" },
] as const;

export default function Panel() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[] | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [eligiendoRol, setEligiendoRol] = useState(false);
  const [emitida, setEmitida] = useState<Emitida | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const respuesta = await pedir("/api/gobierno/solicitudes").catch(() => null);
    if (!respuesta) return setError("No se pudo leer el panel. Revisá tu conexión.");
    if (respuesta.status === 403) return setSinPermiso(true);
    if (!respuesta.ok) return setError("Este panel es del dueño de la cuenta.");
    const { pendientes } = (await respuesta.json()) as { pendientes: Solicitud[] };
    setSolicitudes(pendientes);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function emitir(rol: string) {
    setError(null);
    const respuesta = await pedir("/api/gobierno/invitaciones", {
      method: "POST",
      body: JSON.stringify({ rol }),
    }).catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo emitir la invitación.");
    setEmitida((await respuesta.json()) as Emitida);
    setEligiendoRol(false);
    return undefined;
  }

  async function aprobar(id: string) {
    setError(null);
    const respuesta = await pedir(`/api/gobierno/solicitudes/${id}`, {
      method: "POST",
      body: JSON.stringify({ accion: "aprobar" }),
    }).catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo aprobar. Volvé a intentar.");
    await cargar();
    return undefined;
  }

  if (sinPermiso) {
    return (
      <main data-testid="panel-sin-permiso">
        <h1 style={titulo}>Enrolamiento</h1>
        <EstadoVacio mensaje="Esta pantalla es del dueño de la cuenta. Pedile a quien administra que la abra." />
      </main>
    );
  }

  // Al volver de compartir se RECARGA: entre que el dueño compartió el link y vuelve a mirar
  // pasa justo el rato en que la persona completa sus datos, y una lista que no se refresca
  // deja el panel diciendo «no hay nadie esperando» con alguien esperando.
  if (emitida) {
    return (
      <Invitacion
        emitida={emitida}
        alVolver={() => {
          setEmitida(null);
          void cargar();
        }}
      />
    );
  }

  return (
    <main data-testid="panel">
      <h1 style={titulo}>Enrolamiento</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}

      <section data-testid="pendientes" style={bloque}>
        {/* El BADGE del §5.4 vive acá y en ningún otro lado (respuesta a la pregunta 6): el
            semáforo «Hoy» es de la operación y meterle enrolamiento le saca el lugar a algo
            que sí detiene un camión. */}
        <h2 style={{ ...cuerpo, margin: 0 }}>
          Esperando tu aprobación{" "}
          <span data-testid="badge-pendientes">{solicitudes ? solicitudes.length : "…"}</span>
        </h2>
        {solicitudes?.length === 0 && (
          <EstadoVacio mensaje="No hay nadie esperando. Cuando invites a alguien y complete sus datos, aparece acá." />
        )}
        {solicitudes?.map((s) => (
          <article key={s.id} data-testid="solicitud" style={tarjeta}>
            {/* El RUT sale ENTERO: quien mira esta pantalla está decidiendo si esa persona
                entra a su empresa, y decidir con el RUT enmascarado no es decidir. */}
            <p style={{ ...cuerpo, margin: 0, fontWeight: 600 }}>{s.nombre_propuesto}</p>
            <p style={{ ...pie, margin: 0, color: superficie.textoDim }}>
              {s.rut_propuesto} · {s.rol ?? "cambio de equipo"}
            </p>
            <BotonPrimario testid="aprobar-solicitud" onClick={() => void aprobar(s.id)}>Aprobar</BotonPrimario>
          </article>
        ))}
      </section>

      <section data-testid="emitir" style={bloque}>
        {!eligiendoRol ? (
          <BotonPrimario testid="invitar" onClick={() => setEligiendoRol(true)}>Invitar</BotonPrimario>
        ) : (
          <>
            <h2 style={{ ...cuerpo, margin: 0 }}>¿Para qué va a entrar?</h2>
            {/* Elegir el rol EMITE: el toque de confirmación no protege de nada que no se
                arregle revocando en 1 toque, y sí cuesta una acción del presupuesto. */}
            {ROLES_INVITABLES.map((r) => (
              <BotonPrimario key={r.rol} testid={`rol-${r.rol}`} variante="neutro" onClick={() => void emitir(r.rol)}>
                {r.etiqueta}
              </BotonPrimario>
            ))}
          </>
        )}
      </section>
    </main>
  );
}

function Invitacion({ emitida, alVolver }: { emitida: Emitida; alVolver: () => void }) {
  const link = `${location.origin}/solicitar?codigo=${emitida.codigo}`;
  const [compartido, setCompartido] = useState(false);

  async function compartir() {
    const navegador = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (navegador.share) {
      // El share-sheet del propio teléfono. Sin pasarela de SMS ni de WhatsApp.
      await navegador.share({ title: "Invitación a FLOTA", text: `Tu código: ${emitida.codigo}`, url: link }).catch(() => undefined);
    } else {
      // Donde no hay share-sheet, copiar. Nunca dejar a la persona sin salida.
      await navigator.clipboard?.writeText(link).catch(() => undefined);
    }
    setCompartido(true);
  }

  return (
    <main data-testid="invitacion-emitida">
      <h1 style={titulo}>Invitación lista</h1>
      {/* El QR va como SVG en el DOM: sin petición extra, nítido a cualquier tamaño, y se ve
          en un galpón sin señal. El codificador es propio (packages/nucleo-comun/src/qr.ts). */}
      <div
        data-testid="qr"
        style={{ marginTop: semantico.espacio.entreControles }}
        dangerouslySetInnerHTML={{ __html: svgQr(link, { escala: 6 }) }}
      />
      <p style={{ ...cuerpo, marginBottom: 0 }}>O dictale este código:</p>
      {/* Tabular y grande: se dicta en voz alta en un galpón ruidoso. */}
      <output data-testid="codigo-corto" style={codigoGrande} aria-label="Código de la invitación">
        {emitida.codigo}
      </output>
      <p data-testid="link" style={{ ...pie, color: superficie.textoDim, wordBreak: "break-all" }}>
        {link}
      </p>
      <BotonPrimario testid="compartir-invitacion" onClick={() => void compartir()}>
        {compartido ? "Compartido" : "Compartir"}
      </BotonPrimario>
      <BotonPrimario testid="volver-invitacion" variante="neutro" onClick={alVolver}>
        Volver
      </BotonPrimario>
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pie = { fontSize: tipografia.pie.tamano };
const bloque = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
const codigoGrande = {
  display: "block",
  fontSize: tipografia.display.tamano,
  fontWeight: tipografia.display.peso,
  fontVariantNumeric: "tabular-nums" as const,
  letterSpacing: "0.12em",
  color: superficie.texto,
};
