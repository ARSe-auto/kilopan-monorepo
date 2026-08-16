import { tipografia, superficie } from "@kilopan/miga/tokens.ts";

// El 404 de las PANTALLAS, en es-CL [AC-FRUT-11] — §0 (contrato HTTP y cero inglés), §9.3.2.
//
// Hasta ahora ninguna pantalla del producto recibía un identificador por URL, así que el único
// 404 que existía era el pelado de la API. El cierre de ruta lo cambia: pedir la ruta de otro
// tenant tiene que morir en 404 (centinela 2), y sin este archivo ese 404 lo pinta Next con su
// página en inglés — «This page could not be found» —, que es la primera pantalla del sistema
// que hablaría otro idioma (§0: cero strings visibles en inglés).
//
// Lo que NO dice es la mitad del punto: ni qué se pidió, ni de quién sería, ni si existe en otra
// parte. Un 404 que explica es un 404 que responde la pregunta que el que enumera vino a hacer.
export default function NoSeEncontro() {
  return (
    <main>
      <h1 style={titulo}>Acá no hay nada</h1>
      <p style={cuerpo}>
        La dirección no corresponde a ninguna pantalla de esta cuenta. Revisá el enlace o volvé al
        inicio.
      </p>
    </main>
  );
}

const titulo = {
  fontSize: tipografia.display.tamano,
  fontWeight: tipografia.display.peso,
  margin: 0,
};
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
