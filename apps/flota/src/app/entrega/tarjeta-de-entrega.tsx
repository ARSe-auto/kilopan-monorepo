"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BotonPrimario,
  EstadoCargando,
  EstadoError,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";
import { textoDelCandado, type EmpresaDeLaEntrega } from "../../dominio/candado-entrega.ts";

// La tarjeta de la parada de entrega (F4) [AC-FRUT-22] — KR-29, §4.2, §5.2 F4, §7.6.
//
// ─── EL CANDADO ES EN EL CLIENTE, CONTRA EL SNAPSHOT ──────────────────────────────
//
// El §4.2 lo fija así: la validación bloqueante corre acá, no en el servidor (que jamás
// rechaza una captura — §4.6, §9.3.4). Mientras el sub-manifiesto por empresa de la parada de
// carga que abastece esta entrega no esté confirmado, «Llegué» sencillamente NO se ofrece: no
// hay botón gris, no hay candado mudo, no hay modal (§7.6) — hay texto que dice qué falta y
// cuál es la vía, las dos que existen: confirmar en el andén, o bajar el ítem del manifiesto
// (AC-FRUT-08).
//
// ─── EL TEXTO SALE DE LA MISMA FUENTE QUE EL SERVIDOR ─────────────────────────────
//
// `textoDelCandado` es la función pura de `dominio/candado-entrega.ts`: el servidor la usa (vía
// `candadoDeLaEntrega`) para decidir QUÉ manda, y este componente la usa para decidir QUÉ dice.
// Escribir la frase acá, aparte, sería una segunda copia que se desalinea el día que alguien
// ajuste una — el mismo motivo por el que `dominio/custodia.ts` es una función y no un texto
// repetido en cada pantalla.
export type RespuestaCandado = { abierta: boolean; empresas_faltantes: EmpresaDeLaEntrega[] };

export default function TarjetaDeEntrega({ paradaId }: { paradaId: string }) {
  const [datos, setDatos] = useState<RespuestaCandado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [llegue, setLlegue] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    const respuesta = await pedir(`/api/paradas/${paradaId}/entrega`).catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo leer el candado de esta parada. Revisá tu conexión.");
    setDatos((await respuesta.json()) as RespuestaCandado);
    return undefined;
  }, [paradaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <EstadoError mensaje={error} alReintentar={() => void cargar()} />;
  if (!datos) return <EstadoCargando filas={2} />;

  const resultado = datos.abierta
    ? ({ abierta: true } as const)
    : ({
        abierta: false,
        empresasFaltantes: datos.empresas_faltantes.map((e) => ({ id: e.id, razonSocial: e.razon_social })),
      } as const);

  return (
    <main data-testid="tarjeta-de-entrega">
      <h1 style={titulo}>Parada de entrega</h1>

      {!resultado.abierta && (
        <section data-testid="candado-cerrado" style={bloque}>
          {/* Texto, jamás modal (§7.6): dice qué falta y cuál es la vía. */}
          <p style={cuerpo}>{textoDelCandado(resultado)}</p>
        </section>
      )}

      {resultado.abierta && !llegue && (
        <section data-testid="candado-abierto" style={bloque}>
          <p style={cuerpo}>El manifiesto de la carga está confirmado. Podés empezar la entrega.</p>
          <BotonPrimario testid="llegue" onClick={() => setLlegue(true)}>
            Llegué
          </BotonPrimario>
        </section>
      )}

      {resultado.abierta && llegue && (
        <section data-testid="entrega-en-curso" style={bloque}>
          <p style={cuerpo}>Entrega abierta.</p>
        </section>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const bloque = { display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas };
