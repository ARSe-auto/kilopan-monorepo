import { superficie, tipografia, grilla, enfasis } from "../tokens.ts";
import { componente } from "../estructura.ts";

// La cifra más grande de toda la app (PROMPT_MAESTRO.md §5) — el componente de CIFRA
// OPERATIVA del §5.1 de FLOTA: la que se lee desde medio metro con las manos ocupadas.
// Tamaño y peso salen de `componente.cifraOperativa`, que los toma de la familia canónica
// del §0: acá no se escribe ninguno de los dos a mano [AC-FMIG-01].
//
// SIEMPRE tabular-nums: es la razón de ser de este componente, no una opción. La cadena
// queda escrita en el CSS de este archivo a propósito —AC-H0-03 exige la propiedad EN CADA
// componente que muestra una cifra, y un mutante que la borre tiene que poner el test en
// rojo aunque siga viva en otro archivo—; que ese literal coincida con el token canónico
// lo verifica `estructura.test.ts`.
export function CifraGrande({ valor, unidad }: { valor: string; unidad?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: grilla.base }}>
      <span
        style={{
          fontSize: componente.cifraOperativa.tamanoPx,
          fontWeight: componente.cifraOperativa.peso,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {valor}
      </span>
      {unidad ? (
        <span style={{ fontSize: tipografia.titulo.tamano, fontWeight: enfasis.medio, color: superficie.textoFaint }}>
          {unidad}
        </span>
      ) : null}
    </div>
  );
}
