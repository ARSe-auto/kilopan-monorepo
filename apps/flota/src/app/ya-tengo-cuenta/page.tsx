"use client";

import { useState } from "react";
import { TecladoNumerico, BotonPrimario, EstadoError } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { formatearRut, rutValido, EJEMPLO_RUT } from "../../../../../packages/nucleo-comun/src/rut.ts";
import { PIN } from "../../../../../packages/nucleo-comun/src/constants.ts";
import { parDelAparato, guardarPrivada, huellaDelAparato } from "../../cliente/aparato.ts";

// F-E del §5.4: «Ya tengo cuenta», el teléfono nuevo [AC-FIDN-20] — §4.3, §5.4, §7.8.
//
// FLUJO DE PRIMERA CLASE Y NO UNA EXCEPCIÓN (§5.4). Cambiar de teléfono pasa seguido, y
// obligar a pasar de nuevo por una invitación del dueño convierte un trámite de noventa
// segundos en una llamada telefónica a las cinco de la mañana. Por eso tiene pantalla propia
// y no está escondida detrás de un enlace en letra chica.
//
// SE ENTRA CON LO QUE LA PERSONA YA SABE: su RUT y su PIN. No abre sesión —crea una solicitud
// `pendiente` (AC-FIDN-08)— y el aparato anterior se revoca recién cuando el dueño aprueba, en
// el mismo acto. El PIN pasa por `verificarPin` del servidor, con su lockout: esta puerta no
// es un probador de PINs.
//
// CERO CONSENTIMIENTO, igual que en F-B y por la misma razón [AC-FIDN-20]: la base de licitud
// del tratamiento es la EJECUCIÓN DEL CONTRATO de trabajo (§7.8), no el consentimiento del
// trabajador. Ponerle un checkbox a alguien que necesita el teléfono para trabajar sería
// fingir una opción que no tiene — y bajo la Ley 21.719 un consentimiento que no se puede
// negar sin costo no es consentimiento. El gate `db/flota/gate-consentimiento.mjs` lo
// mecaniza sobre esta pantalla y sobre la de solicitar.

type Paso = "rut" | "pin" | "enviando" | "esperando";

export default function YaTengoCuenta() {
  const [paso, setPaso] = useState<Paso>("rut");
  const [rutCrudo, setRutCrudo] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rut = formatearRut(rutCrudo);
  const rutEsValido = rutValido(rut);
  const pinEsValido = new RegExp(`^\\d{${PIN.digitos}}$`).test(pin);

  async function enviar() {
    setPaso("enviando");
    setError(null);
    try {
      const aparato = await parDelAparato();
      await guardarPrivada(aparato.privada);
      const respuesta = await fetch("/api/reenrolamiento", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rut,
          pin,
          clave_publica: aparato.publica,
          huella_dispositivo: huellaDelAparato(),
        }),
      });
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { mensaje?: string };
        setError(cuerpo.mensaje ?? "No se pudo pedir el cambio de equipo. Intentá de nuevo.");
        setPaso("pin");
        return;
      }
      setPaso("esperando");
    } catch {
      setError("No se pudo pedir el cambio de equipo. Revisá tu conexión e intentá de nuevo.");
      setPaso("pin");
    }
  }

  if (paso === "esperando") {
    return (
      <main data-testid="esperando-aprobacion">
        <h1 style={titulo}>Esperando aprobación</h1>
        <p style={cuerpo}>
          Le avisamos a quien administra la cuenta. Cuando te apruebe, este teléfono queda activo
          y el anterior deja de funcionar.
        </p>
      </main>
    );
  }

  return (
    <main data-testid="ya-tengo-cuenta">
      <h1 style={titulo}>Ya tengo cuenta</h1>
      <p style={{ ...cuerpo, color: superficie.textoDim }}>
        Cambiaste de teléfono. Entrá con tu RUT y tu PIN de siempre.
      </p>

      {paso === "rut" && (
        <section
          data-testid="campo-rut"
          style={{ display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas }}
        >
          <h2 style={{ ...cuerpo, margin: 0 }}>Tu RUT</h2>
          <output data-testid="rut" style={valorGrande} aria-label="Tu RUT">
            {rut || EJEMPLO_RUT}
          </output>
          <TecladoNumerico valor={rutCrudo} onCambiar={setRutCrudo} permitirK permitirCeroInicial />
          <BotonPrimario disabled={!rutEsValido} onClick={() => setPaso("pin")}>
            Continuar
          </BotonPrimario>
        </section>
      )}

      {(paso === "pin" || paso === "enviando") && (
        <section
          data-testid="campo-pin"
          style={{ display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas }}
        >
          <h2 style={{ ...cuerpo, margin: 0 }}>Tu PIN</h2>
          <output data-testid="pin" style={valorGrande} aria-label="Tu PIN">
            {"•".repeat(pin.length)}
          </output>
          {error && <EstadoError mensaje={error} alReintentar={() => setError(null)} />}
          <TecladoNumerico valor={pin} onCambiar={setPin} permitirCeroInicial />
          <BotonPrimario disabled={paso === "enviando" || !pinEsValido} onClick={enviar}>
            {paso === "enviando" ? "Enviando…" : "Pedir este equipo"}
          </BotonPrimario>
        </section>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const valorGrande = {
  fontSize: tipografia.titulo.tamano,
  fontWeight: tipografia.titulo.peso,
  fontVariantNumeric: "tabular-nums" as const,
  display: "block",
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
  color: superficie.texto,
};
