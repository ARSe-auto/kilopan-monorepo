"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { tipografia, superficie, grilla, semantico as colorSemantico } from "@kilopan/miga/tokens.ts";
import { semantico as espacio } from "@kilopan/miga/estructura.ts";
import { estadoDeRastreo } from "../../dominio/rastreo.ts";
import { iniciarRastreo, type PosicionCruda } from "../../cliente/rastreo.ts";
import { pedir } from "../../cliente/aparato.ts";
import { replayarPosiciones } from "../../cliente/outbox.ts";
import { guardarOutboxPosicion, leerOutboxPosicion, type Identidad } from "../../cliente/outbox-local.ts";
import { identidadDelAparato } from "../../cliente/identidad.ts";
import type { CapturaDePosicion } from "../../dominio/rastreo-terreno.ts";

// El aviso de rastreo, SIEMPRE visible mientras el turno está abierto [AC-FTEL-01] — §7.8, §11.
//
// NO ES CONFIGURABLE NI REMOVIBLE: no hay botón para cerrarlo, ni ajuste de tenant que lo
// apague. Deja de decir «en ruta» ÚNICAMENTE cuando el turno cierra — el efecto que arranca la
// captura se limpia con el desmontaje o con el cambio de turno, que es exactamente cuándo el
// §7.8 dice que la autorización de rastrear termina.
//
// EL TRANSPORTE ES EL MISMO OUTBOX QUE EL POD Y LA RECARGA [AC-FTEL-03] — §4.6, §4.7: mismo
// mecanismo que `app/recarga/tarjeta-de-recarga.tsx` — partición por (tenant, usuario), escritura
// INMEDIATA al capturar cada fix, replay-on-startup y replay-on-online contra el MISMO
// `/api/sync/capturas` —, con su propia cola (`outbox-local.ts::*OutboxPosicion`,
// `outbox.ts::replayarPosiciones`) para que un punto de rastreo jamás se lea como si fuera una
// captura de otra clase.
export function EstadoDeRastreo({ turno }: { turno: { id: string; abiertoEn: string } | null }) {
  const estado = useMemo(() => estadoDeRastreo(turno?.abiertoEn ?? null), [turno?.abiertoEn]);

  const [identidad, setIdentidad] = useState<Identidad | null>(null);
  useEffect(() => {
    let vivo = true;
    void identidadDelAparato().then((resuelta) => {
      if (vivo) setIdentidad(resuelta);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // El outbox durable: lo que la sesión anterior dejó sin replicar vuelve al montar.
  const [cola, setCola] = useState<CapturaDePosicion[]>([]);
  const [outboxCargado, setOutboxCargado] = useState(false);
  useEffect(() => {
    if (identidad === null) return;
    setCola(leerOutboxPosicion(window.localStorage, identidad));
    setOutboxCargado(true);
  }, [identidad]);

  // Se escribe INMEDIATAMENTE al capturar cada fix (§4.7), no al vencer ningún plazo.
  useEffect(() => {
    if (!outboxCargado || identidad === null) return;
    guardarOutboxPosicion(window.localStorage, identidad, cola);
  }, [outboxCargado, identidad, cola]);

  // El replay, sin que el chofer toque nada: al montar y al volver la señal (§4.7).
  const replayando = useRef(false);
  useEffect(() => {
    let vivo = true;
    async function vaciar() {
      if (replayando.current || cola.length === 0) return;
      replayando.current = true;
      try {
        const confirmadas = await replayarPosiciones(cola, (cuerpo) =>
          pedir("/api/sync/capturas", { method: "POST", body: cuerpo }),
        );
        if (vivo && confirmadas.length > 0) {
          const acusadas = new Set(confirmadas);
          setCola((c) => c.filter((cap) => !acusadas.has(cap.clientUuid)));
        }
      } finally {
        replayando.current = false;
      }
    }
    void vaciar();
    window.addEventListener("online", vaciar);
    return () => {
      vivo = false;
      window.removeEventListener("online", vaciar);
    };
  }, [cola]);

  useEffect(() => {
    if (!turno) return undefined;
    const turnoId = turno.id;
    return iniciarRastreo((p: PosicionCruda) => {
      setCola((c) => [
        ...c,
        {
          clientUuid: crypto.randomUUID(),
          turnoId,
          lat: p.lat,
          lng: p.lng,
          precisionM: p.precisionM,
          tsDispositivo: new Date().toISOString(),
          tzOffsetMin: -new Date().getTimezoneOffset(),
        },
      ]);
    });
  }, [turno?.id]);

  return (
    <>
      <p data-testid="rastreo-estado" role="status" style={estilo(estado.rastreando)}>
        {estado.texto}
      </p>
      {/* El §5.7 no pide silencio ante una posición sin confirmar: pide el contador REAL de la
          cola, igual que `recarga/tarjeta-de-recarga.tsx` y `entrega/tarjeta-de-entrega.tsx`
          [AC-FTEL-03] — gate-capturas-sin-rechazo.mjs. */}
      {cola.length > 0 && (
        <section data-testid="rastreo-por-sincronizar" style={banda}>
          <p style={{ ...cuerpo, margin: 0 }}>Posición — por sincronizar</p>
          <p style={{ ...pieDim, margin: 0 }}>
            <span data-testid="contador-cola-rastreo" style={{ fontVariantNumeric: "tabular-nums" }}>
              {cola.length}
            </span>{" "}
            {cola.length === 1 ? "punto esperando señal" : "puntos esperando señal"}
          </p>
        </section>
      )}
    </>
  );
}

const estilo = (rastreando: boolean) => ({
  margin: 0,
  fontSize: tipografia.cuerpo.tamano,
  fontWeight: 600,
  color: rastreando ? colorSemantico.ok : superficie.textoDim,
});

const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pieDim = { fontSize: tipografia.pie.tamano, color: superficie.textoDim, margin: 0 };
const banda = {
  display: "grid",
  gap: espacio.espacio.entreControles,
  marginTop: espacio.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
