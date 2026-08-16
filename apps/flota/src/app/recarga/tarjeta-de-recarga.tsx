"use client";

import { useEffect, useRef, useState } from "react";
import { BotonPrimario, TecladoNumerico } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";
import { replayarRecargas } from "../../cliente/outbox.ts";
import { guardarOutboxRecarga, leerOutboxRecarga, type Identidad } from "../../cliente/outbox-local.ts";
import { identidadDelAparato } from "../../cliente/identidad.ts";
import {
  iniciarCarga,
  cerrarCarga,
  type CapturaDeRecarga,
  type SesionDeCarga,
} from "../../dominio/recarga-terreno.ts";

// La tarjeta de la parada de recarga (F4) [AC-FPOD-13] — §5.2 F4: «Bloque de recarga = una
// parada más («Iniciar carga» 1 toque; al terminar SOC fin + confirmar)».
//
// Mismo mecanismo de outbox que `entrega/tarjeta-de-entrega.tsx` —partición por (tenant,
// usuario), escritura INMEDIATA al cerrar, replay-on-startup y replay-on-online contra el MISMO
// `/api/sync/capturas`— con su propia cola (`outbox-local.ts::*OutboxRecarga`, `outbox.ts::
// replayarRecargas`) para que una captura de recarga jamás se lea como si fuera una de POD.
//
// Sin undo de 8 s: el §5.2 F4 no lo pide para esta parada —a diferencia de la entrega, acá no
// hay «avance automático» que deshacer— y agregarlo sería inventar un contrato que el maestro
// no fija.
export default function TarjetaDeRecarga({
  vehiculoId,
  turnoId,
}: {
  vehiculoId: string;
  turnoId: string | null;
}) {
  const [sesion, setSesion] = useState<SesionDeCarga | null>(null);
  const [kwh, setKwh] = useState("");
  const [socFinal, setSocFinal] = useState("");
  const [cola, setCola] = useState<CapturaDeRecarga[]>([]);
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
  const [outboxCargado, setOutboxCargado] = useState(false);
  useEffect(() => {
    if (identidad === null) return;
    setCola(leerOutboxRecarga(window.localStorage, identidad));
    setOutboxCargado(true);
  }, [identidad]);

  // Se escribe INMEDIATAMENTE al cerrar (§4.7), no al vencer ningún plazo.
  useEffect(() => {
    if (!outboxCargado || identidad === null) return;
    guardarOutboxRecarga(window.localStorage, identidad, cola);
  }, [outboxCargado, identidad, cola]);

  // El replay, sin que el chofer toque nada: al montar y al volver la señal (§4.7).
  const replayando = useRef(false);
  useEffect(() => {
    let vivo = true;
    async function vaciar() {
      if (replayando.current || cola.length === 0) return;
      replayando.current = true;
      try {
        const confirmadas = await replayarRecargas(cola, (cuerpo) =>
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

  function tocarIniciar() {
    setSesion(iniciarCarga(vehiculoId, turnoId));
  }

  function confirmar() {
    if (sesion === null) return;
    const captura = cerrarCarga(
      sesion,
      {
        kwh: Number(kwh.replace(",", ".")),
        socFinal: socFinal === "" ? null : Number(socFinal),
      },
      {
        clientUuid: crypto.randomUUID(),
        tsDispositivo: new Date().toISOString(),
        tzOffsetMin: -new Date().getTimezoneOffset(),
      },
    );
    if (captura === null) return;
    setCola((c) => [...c, captura]);
    setSesion(null);
    setKwh("");
    setSocFinal("");
  }

  return (
    <main data-testid="tarjeta-de-recarga">
      <h1 style={titulo}>Parada de recarga</h1>

      {sesion === null && (
        <section data-testid="carga-sin-iniciar" style={bloque}>
          <p style={cuerpo}>Enchufá el vehículo y tocá para empezar.</p>
          <BotonPrimario testid="iniciar-carga" onClick={tocarIniciar}>
            Iniciar carga
          </BotonPrimario>
        </section>
      )}

      {sesion !== null && (
        <section data-testid="carga-en-curso" style={bloque}>
          <p style={{ ...cuerpo, margin: 0, fontWeight: enfasis.medio }}>
            Cargando. Al terminar, anotá cuánto entró y el SOC final.
          </p>
          <p style={pieDim}>kWh cargados</p>
          <div data-testid="kwh-cargados">
            <TecladoNumerico valor={kwh} onCambiar={setKwh} permitirDecimal />
          </div>
          <p style={pieDim}>SOC final</p>
          <div data-testid="soc-fin">
            <TecladoNumerico valor={socFinal} onCambiar={setSocFinal} />
          </div>
          {kwh !== "" && (
            <BotonPrimario testid="confirmar-recarga" onClick={confirmar}>
              Confirmar
            </BotonPrimario>
          )}
        </section>
      )}

      {cola.length > 0 && (
        <section data-testid="recarga-por-sincronizar" style={banda}>
          <p style={{ ...cuerpo, margin: 0 }}>Recarga registrada — por sincronizar</p>
          <p style={{ ...pieDim, margin: 0 }}>
            <span data-testid="contador-cola-recarga" style={{ fontVariantNumeric: "tabular-nums" }}>
              {cola.length}
            </span>{" "}
            {cola.length === 1 ? "sesión esperando señal" : "sesiones esperando señal"}
          </p>
        </section>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pieDim = { fontSize: tipografia.pie.tamano, color: superficie.textoDim, margin: 0 };
const bloque = { display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas };
const banda = {
  ...bloque,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
