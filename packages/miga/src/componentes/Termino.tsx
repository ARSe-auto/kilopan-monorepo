import type { TerminoResuelto } from "../terminologia.ts";

/**
 * El único punto de la pantalla donde un `term_key` se convierte en texto visible [AC-FMIG-04]
 * — §5.1. El `data-testid` y el `data-term-key` NUNCA dependen del texto resuelto: son la
 * ancla estable que el e2e usa para correr la MISMA suite contra terminología base y extrema
 * sin cambiar un selector (§9.2) — el mismo contrato que ya usa `BotonPrimario` con `testid`.
 *
 * `admin`: «el admin ve el término canónico entre paréntesis» (§5.1) — SIEMPRE que `admin` es
 * verdadero, sin condicionarlo a si el tenant renombró o no: el paréntesis es la referencia de
 * fábrica que el panel de edición (AC-FMIG-06) va a necesitar mostrar en todo momento, y
 * condicionarlo a «solo si difiere» convertiría el DOM en algo que cambia de forma según el
 * dato — justo lo que este AC prohíbe de los selectores de e2e.
 */
export function Termino({
  resuelto,
  variante = "singular",
  admin = false,
}: {
  resuelto: TerminoResuelto;
  variante?: "singular" | "plural";
  admin?: boolean;
}) {
  const texto = variante === "plural" ? resuelto.plural : resuelto.singular;
  return (
    <span data-testid={`termino-${resuelto.termKey}`} data-term-key={resuelto.termKey}>
      {texto}
      {admin && (
        <span data-testid={`termino-canonico-${resuelto.termKey}`} data-term-key={resuelto.termKey}>
          {" "}
          ({resuelto.canonico})
        </span>
      )}
    </span>
  );
}
