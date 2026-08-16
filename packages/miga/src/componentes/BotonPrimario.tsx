import { tipografia, grilla, enfasis } from "../tokens.ts";
import { componente } from "../estructura.ts";
import { BotonTactil } from "./BotonTactil.tsx";

// Botón primario full-width, anclado abajo en safe-area (PROMPT_MAESTRO.md §5). El alto
// mínimo sale de `componente.botonPrimario`, que lo toma de la familia canónica del §0:
// escribirlo a mano acá pondría el grep-gate en rojo [AC-FMIG-01].
export function BotonPrimario({
  children,
  onClick,
  disabled,
  variante = "acento",
  testid,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variante?: "acento" | "neutro";
  /** Ancla ESTABLE para los tests que cuentan acciones [AC-FIDN-02]. Un selector por texto se
   *  rompe cuando alguien mejora una etiqueta, y ese día el presupuesto de toques del §5.3
   *  deja de medirse por una razón que no tiene nada que ver con los toques. */
  testid?: string;
}) {
  return (
    <BotonTactil
      type="button"
      data-testid={testid}
      data-variante={variante}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: componente.botonPrimario.ancho,
        minHeight: componente.botonPrimario.altoMinPx,
        borderRadius: grilla.radio,
        border: "none",
        fontSize: tipografia.cuerpo.tamano,
        fontWeight: enfasis.fuerte,
        color: variante === "acento" ? "#FFFFFF" : "#1B1712",
        background: disabled ? "#B8AFA2" : variante === "acento" ? "#C2410C" : "#E3E1DA",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {children}
    </BotonTactil>
  );
}
