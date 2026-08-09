"use client";

import { useState } from "react";
import { TecladoNumerico, BotonPrimario, EstadoError } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { formatearRut, rutValido, EJEMPLO_RUT } from "../../../../../packages/nucleo-comun/src/rut.ts";
import { PIN } from "../../../../../packages/nucleo-comun/src/constants.ts";
import { normalizarCodigo } from "../../dominio/codigo-corto.ts";
import { parDelAparato, guardarPrivada, huellaDelAparato } from "../../cliente/aparato.ts";

// F-B del §5.4: «Solicitar acceso» [AC-FIDN-17] — §0, §4.2, §4.3, §5.4.
//
// LO QUE ESTE AC PONE ACÁ: el RUT se formatea SOLO mientras se escribe y se valida con módulo
// 11 EN LÍNEA, sin red; mientras sea inválido, el botón no envía. El 422 del servidor sigue
// existiendo y se ejercita por request directo (§4.2: PLANIFICACIÓN valida online y rebota
// tipado) — la validación del cliente no lo reemplaza, lo adelanta. Son dos capas con
// propósitos distintos: la de acá le ahorra el viaje a alguien parado en un galpón; la del
// servidor es la que de verdad protege la base, porque el cliente se puede saltear.
//
// LO QUE NO ESTÁ, Y ES DELIBERADO: no hay campo de correo (§5.4, «CERO emails») y no hay
// checkbox ni texto de consentimiento (§7.8: la base de licitud es la ejecución del contrato
// de trabajo, no el consentimiento del trabajador — pedírselo sería fingir una opción que no
// tiene, y AC-FIDN-20 lo mecaniza).
//
// TECLADO PROPIO Y JAMÁS EL DEL SISTEMA (§5.4). Por eso el RUT y el PIN se muestran en un
// `output` y no en un `<input>`: un input abriría el teclado del sistema al enfocarlo, con
// autocorrector y con sugerencias del navegador sobre un campo que lleva un identificador
// nacional. El nombre SÍ es un input, porque es texto libre y ahí el teclado del sistema es
// el correcto.

type Paso = "codigo" | "rut" | "nombre" | "pin" | "confirmar" | "enviando" | "esperando";

const TEXTO = {
  codigo: "Escribí el código que te pasaron",
  rut: "Tu RUT",
  nombre: "Tu nombre y apellido",
  pin: `Elegí un PIN de ${PIN.digitos} dígitos`,
  confirmar: "Repetí el PIN",
} as const;

export default function Solicitar() {
  const [paso, setPaso] = useState<Paso>("codigo");
  const [codigo, setCodigo] = useState("");
  const [rutCrudo, setRutCrudo] = useState("");
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirmado, setPinConfirmado] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rut = formatearRut(rutCrudo);
  const rutEsValido = rutValido(rut);
  const codigoEsValido = normalizarCodigo(codigo) !== null;
  const pinEsValido = new RegExp(`^\\d{${PIN.digitos}}$`).test(pin);

  async function enviar() {
    setPaso("enviando");
    setError(null);
    try {
      const aparato = await parDelAparato();
      // La privada se guarda ANTES de enviar: si el request sale y el guardado falla, el
      // aparato queda con una solicitud viva que nunca va a poder abrir su sobre.
      await guardarPrivada(aparato.privada);
      const respuesta = await fetch("/api/solicitudes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          codigo,
          rut,
          nombre: nombre.trim(),
          pin,
          clave_publica: aparato.publica,
          huella_dispositivo: huellaDelAparato(),
        }),
      });
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { mensaje?: string };
        setError(cuerpo.mensaje ?? "No se pudo enviar la solicitud. Intentá de nuevo.");
        setPaso("confirmar");
        return;
      }
      setPaso("esperando");
    } catch {
      setError("No se pudo enviar la solicitud. Revisá tu conexión e intentá de nuevo.");
      setPaso("confirmar");
    }
  }

  if (paso === "esperando") {
    return (
      <main data-testid="esperando-aprobacion">
        <h1 style={titulo}>Esperando aprobación</h1>
        <p style={cuerpo}>
          Le avisamos a quien administra la cuenta. En cuanto te apruebe, esta pantalla se abre sola.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1 style={titulo}>Solicitar acceso</h1>

      {paso === "codigo" && (
        <Campo etiqueta={TEXTO.codigo} testid="campo-codigo">
          <input
            data-testid="codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            aria-label={TEXTO.codigo}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            style={campoTexto}
          />
          <BotonPrimario disabled={!codigoEsValido} onClick={() => setPaso("rut")}>
            Continuar
          </BotonPrimario>
        </Campo>
      )}

      {paso === "rut" && (
        <Campo etiqueta={TEXTO.rut} testid="campo-rut">
          {/* `output` y no `input`: el §5.4 exige teclado PROPIO, y un input abriría el del
              sistema —con autocorrector y sugerencias— sobre un identificador nacional. */}
          <output data-testid="rut" style={valorGrande} aria-label={TEXTO.rut}>
            {rut || EJEMPLO_RUT}
          </output>
          {/* El estado se dice con TEXTO y no solo con color (§5.7): un semáforo mudo no
              sirve a quien no distingue rojo de verde ni a quien mira con sol de frente. */}
          <p
            data-testid="rut-estado"
            style={{ ...pie, color: rut && !rutEsValido ? "#B91C1C" : superficie.textoDim }}
          >
            {rut === ""
              ? `Así se ve: ${EJEMPLO_RUT}`
              : rutEsValido
                ? "RUT válido"
                : "Todavía no es un RUT válido. Revisá el número y el dígito verificador."}
          </p>
          <TecladoNumerico valor={rutCrudo} onCambiar={setRutCrudo} permitirK permitirCeroInicial />
          <BotonPrimario disabled={!rutEsValido} onClick={() => setPaso("nombre")}>
            Continuar
          </BotonPrimario>
        </Campo>
      )}

      {paso === "nombre" && (
        <Campo etiqueta={TEXTO.nombre} testid="campo-nombre">
          <input
            data-testid="nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            aria-label={TEXTO.nombre}
            autoComplete="name"
            style={campoTexto}
          />
          <BotonPrimario disabled={nombre.trim().length < 3} onClick={() => setPaso("pin")}>
            Continuar
          </BotonPrimario>
        </Campo>
      )}

      {paso === "pin" && (
        <Campo etiqueta={TEXTO.pin} testid="campo-pin">
          <output data-testid="pin" style={valorGrande} aria-label={TEXTO.pin}>
            {"•".repeat(pin.length)}
          </output>
          <TecladoNumerico valor={pin} onCambiar={setPin} permitirCeroInicial />
          <BotonPrimario disabled={!pinEsValido} onClick={() => setPaso("confirmar")}>
            Continuar
          </BotonPrimario>
        </Campo>
      )}

      {(paso === "confirmar" || paso === "enviando") && (
        <Campo etiqueta={TEXTO.confirmar} testid="campo-confirmar">
          <output data-testid="pin-confirmado" style={valorGrande} aria-label={TEXTO.confirmar}>
            {"•".repeat(pinConfirmado.length)}
          </output>
          {pinConfirmado.length === PIN.digitos && pinConfirmado !== pin && (
            <p data-testid="pin-no-coincide" style={{ ...pie, color: "#B91C1C" }}>
              Los dos PIN no son iguales. Borrá y escribilo de nuevo.
            </p>
          )}
          {error && (
            // El error trae SIEMPRE su salida: reintentar es volver a tocar el botón, y el
            // estado de error de Miga exige la acción justamente para que no exista la
            // pantalla que dice «algo salió mal» y deja a la persona sin qué hacer.
            <EstadoError mensaje={error} alReintentar={() => setError(null)} />
          )}
          <TecladoNumerico valor={pinConfirmado} onCambiar={setPinConfirmado} permitirCeroInicial />
          <BotonPrimario
            disabled={paso === "enviando" || pinConfirmado !== pin || !pinEsValido}
            onClick={enviar}
          >
            {paso === "enviando" ? "Enviando…" : "Solicitar acceso"}
          </BotonPrimario>
        </Campo>
      )}
    </main>
  );
}

function Campo({
  etiqueta,
  testid,
  children,
}: {
  etiqueta: string;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testid}
      style={{ display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas }}
    >
      <h2 style={{ ...cuerpo, margin: 0 }}>{etiqueta}</h2>
      {children}
    </section>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pie = { fontSize: tipografia.pie.tamano, margin: 0 };
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
const campoTexto = {
  // ≥16 px: por debajo de eso Safari hace zoom al enfocar y el formulario salta de lugar
  // con la persona a mitad de escribir (§5.7, PWA iOS).
  fontSize: tipografia.cuerpo.tamano,
  minHeight: semantico.toque.operativo,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
};
