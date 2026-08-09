import { tipografia, grilla } from "../tokens.ts";
import { componente } from "../estructura.ts";

// Teclado numérico PROPIO — jamás el teclado del sistema (PROMPT_MAESTRO.md §5).
// El tamaño de tecla sale de `componente.tecla`, que lo toma de la familia canónica del
// §0 (manos con harina/guantes) [AC-FMIG-01]. Coma es-CL como separador decimal.
const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"] as const;

export function TecladoNumerico({
  valor,
  onCambiar,
  permitirDecimal = false,
  permitirCeroInicial = false,
  permitirGuion = false,
}: {
  valor: string;
  onCambiar: (nuevoValor: string) => void;
  permitirDecimal?: boolean;
  /** Para PIN y otros códigos, donde "0512" NO es lo mismo que "512". Sin esto, el
   *  colapso del cero inicial —correcto para un monto: "0" + "5" es 5, no 05— hacía
   *  literalmente IMPOSIBLE teclear un PIN que empieza con cero: el operador tocaba
   *  0, después 5, y el 0 se reemplazaba por el 5. La bolita no avanzaba, parecía
   *  colgado, y a los pocos intentos quedaba bloqueado 15 minutos por AC-SEC-01 con
   *  un error que lo culpaba a él. Lo encontró la auditoría de experiencia; nunca se
   *  vio porque los usuarios sembrados usan PIN "1234". */
  permitirCeroInicial?: boolean;
  /** AC-DES-06: captura manual del código de bulto P<correlativo>-<n> — sustituye la
   *  coma decimal por «−» en la misma celda (un código no tiene decimales, nunca
   *  coexisten). El prefijo «P» lo agrega la pantalla, no este teclado. */
  permitirGuion?: boolean;
}) {
  function tocar(tecla: string) {
    if (tecla === "⌫") {
      onCambiar(valor.slice(0, -1));
      return;
    }
    // El botón muestra «−» (guión tipográfico) pero el valor lleva el guión ASCII "-"
    // que espera la BD en el código P<correlativo>-<n> — dos glifos, un solo carácter real.
    if (permitirGuion && tecla === "−") {
      onCambiar(valor + "-");
      return;
    }
    if (tecla === ",") {
      if (!permitirDecimal || valor.includes(",")) return;
      onCambiar(valor.length === 0 ? "0," : valor + ",");
      return;
    }
    onCambiar(!permitirCeroInicial && valor === "0" ? tecla : valor + tecla);
  }

  return (
    <div
      role="group"
      aria-label="Teclado numérico"
      style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: componente.tecla.separacionPx }}
    >
      {TECLAS.map((tecla) => {
        // Hallazgo menor de la auditoría: en /ingresar y /vincular (PIN, sin decimales)
        // esta tecla se mostraba apagada y sin poder tocarse — un botón
        // muerto ocupando espacio, con contraste bajo el mínimo. Si no aplica, no se
        // pinta: se deja el hueco vacío para no correr "0" y "⌫" de lugar.
        if (tecla === "," && !permitirDecimal && !permitirGuion) {
          return (
            <div
              key={tecla}
              aria-hidden="true"
              style={{ minHeight: componente.tecla.altoMinPx, minWidth: componente.tecla.anchoMinPx }}
            />
          );
        }
        const etiqueta = tecla === "," && permitirGuion ? "−" : tecla;
        return (
          <button
            key={tecla}
            type="button"
            onClick={() => tocar(etiqueta)}
            aria-label={etiqueta === "⌫" ? "Borrar" : etiqueta}
            style={{
              minHeight: componente.tecla.altoMinPx,
              minWidth: componente.tecla.anchoMinPx,
              // AC-H0-08: el tamaño que había acá no pertenecía a la escala tipográfica
              // de Miga — "titulo" (22/600) es el peldaño correcto, y el peso ya coincidía
              // con el token.
              fontSize: tipografia.titulo.tamano,
              fontWeight: tipografia.titulo.peso,
              fontVariantNumeric: "tabular-nums",
              borderRadius: grilla.radio,
              border: "1px solid rgba(27,23,18,.14)",
              background: "#FFFFFF",
              color: "#1B1712",
            }}
          >
            {etiqueta}
          </button>
        );
      })}
    </div>
  );
}
