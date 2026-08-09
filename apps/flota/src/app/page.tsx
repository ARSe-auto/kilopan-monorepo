import { EstadoVacio } from "@kilopan/miga/componentes/index.tsx";

// Esqueleto del hito 0 (§9.1). Esta pantalla NO es un cartel de bienvenida ni una cáscara:
// es el estado que la regla de contracción del §5.5 manda renderizar cuando el manifest de
// navegación llega sin módulos. Hoy llega vacío porque los módulos nacen en los hitos (a)
// a (g); el día que el bootstrap devuelva un manifest de verdad, esta misma pantalla
// mostrará lo que traiga, sin huecos ni candados.
//
// Vacío ACCIONABLE, uno de los cuatro estados obligatorios de Miga: dice qué pasa y qué
// hacer. Un «no hay datos» a secas deja al operador sin salida.
export default function Inicio() {
  return (
    <main>
      <h1 style={{ margin: 0 }}>FLOTA</h1>
      <EstadoVacio mensaje="Todavía no hay módulos habilitados para esta cuenta. El administrador los activa desde el panel." />
    </main>
  );
}
