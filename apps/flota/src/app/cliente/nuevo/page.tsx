import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";

// «Nuevo / Importar CSV», la tercera pantalla del portal [AC-FPOR-07] — spec 07 §2.3.
//
// El namespace y la pantalla EXISTEN acá; el §3.E1.10 la trata como UNA sola pantalla con dos
// vías de alta, no dos pantallas. Lo que esta pantalla NO hace todavía —crear el encargo que
// nace `solicitado`, con el rebote 422 tipado de bultos/destino inválidos, y editar mientras siga
// `solicitado`— es AC-FPOR-08 («ciclo del encargo solicitado»), abierto: ese AC es dueño de la
// mutación de servidor (`POST /cliente/api/encargos`, todavía inexistente) y del rebote §4.2. La
// vía de importar CSV, con su semántica de lote, es AC-FPOR-09, abierto y además PROVISIONAL a la
// Pregunta al dueño 4 de esta spec. Cablear un formulario que llame a un endpoint que no existe
// sería peor que no tenerlo: parecería funcionar y no haría nada.
export default function PortalNuevo() {
  return (
    <main data-testid="portal-nuevo">
      <h1 style={titulo}>Nuevo / Importar CSV</h1>

      <section data-testid="nuevo-encargo" style={tarjeta}>
        <h2 style={subtitulo}>Encargo nuevo</h2>
        <p style={cuerpo}>Cargá un encargo indicando destino y bultos. Nace en estado «Solicitado».</p>
      </section>

      <section data-testid="importar-csv" style={tarjeta}>
        <h2 style={subtitulo}>Importar CSV</h2>
        <p style={cuerpo}>Subí un archivo con varios encargos a la vez. Cada fila nace en estado «Solicitado».</p>
      </section>
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = { fontSize: tipografia.titulo.tamano, fontWeight: tipografia.titulo.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto, margin: 0 };
const tarjeta = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
  marginTop: semantico.espacio.entreTarjetas,
};
