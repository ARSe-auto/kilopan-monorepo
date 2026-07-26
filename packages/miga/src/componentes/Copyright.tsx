import { superficie, tipografia } from "../tokens.ts";

export function Copyright() {
  return (
    <p
      style={{
        fontSize: tipografia.pie.tamano,
        fontWeight: tipografia.pie.peso,
        color: superficie.textoFaint,
        textAlign: "center",
        margin: 0,
      }}
    >
      © e-auto global 2026
    </p>
  );
}
