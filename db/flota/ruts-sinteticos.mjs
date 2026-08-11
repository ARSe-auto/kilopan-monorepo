// LISTA CONGELADA de RUTs sintéticos [AC-FIDN-21] — §7.8, §10.
//
// QUÉ MECANIZA. El §7.8 exige «cero datos personales reales en seeds» y el maestro pide RUTs
// «sintácticamente válidos pero irreales». «Irreal» no tiene oráculo: ningún test puede mirar
// un RUT y decidir si le pertenece a alguien. Lo que sí se puede mecanizar es lo de al lado, y
// alcanza: que cada RUT que aparezca en el árbol esté en esta lista, revisada una vez y
// congelada. Un RUT nuevo no se puede sembrar sin agregarlo acá, y agregarlo es un acto
// visible en el diff que alguien mira.
//
// POR QUÉ ESTO Y NO UN VALIDADOR. Un test que solo verificara el módulo 11 diría que un RUT
// real y válido está perfecto — y un RUT real en un seed es exactamente el problema. La lista
// invierte la carga: el default es que un RUT no se puede sembrar.
//
// El módulo 11 NO se implementa acá. Hay UNA implementación y vive en la base
// (`rut_valido()`, AC-FIDN-01); `db/flota/suite-bd/ruts.test.mjs` pasa esta lista por ella,
// así que las dos mitades del AC quedan cubiertas sin un segundo algoritmo que se separe del
// primero.

/**
 * RUTs sintéticos VÁLIDOS. Son los únicos que pueden aparecer como dato sembrado.
 * Cada uno con para qué existe: una lista sin razones se vuelve un cajón donde todo entra.
 */
export const VALIDOS = {
  "11.111.111-1": "la dueña del tenant en los fixtures de enrolamiento; dígitos repetidos, imposible de confundir con uno real",
  "12.345.678-5": "el ejemplo canónico del §0; el que aparece en la documentación y en las pantallas",
  "20.347.878-K": "el caso del dígito verificador K, que el módulo 11 produce y hay que ejercer",
  "5.126.663-3": "cuerpo de siete dígitos, para el caso del primer grupo de una sola cifra",
  "7.654.321-6": "dígitos descendentes; segundo operario donde hace falta más de una persona",
  "9.999.999-3": "el máximo de siete dígitos; comparte dígito verificador con 5.126.663-3, que es lo que prueba la máscara",
  "76.111.111-6": "la EMPRESA contratante de los fixtures del módulo 03 (AC-FRUT-01): rango 76.xxx de persona jurídica, que es el que usan las empresas en Chile y ninguna persona natural",
  "77.222.222-K": "la SEGUNDA empresa contratante (AC-FRUT-04): sin dos, la agrupación multi-empresa no se puede ejercer — el caso entero es que dos contratantes distintos mandan al mismo destino. Lleva K a propósito: el dígito verificador que más se rompe también aparece en una persona jurídica",
  // Los nuevos van AL FINAL, siempre: media docena de suites toma su RUT por índice sobre este
  // objeto (`Object.keys(VALIDOS)[6]`), y meter uno en el medio se los corre a todos en silencio.
  "6.666.666-2": "el chofer del bucle de terreno de F4 (AC-FPOD-01), propio y no prestado: el índice «un dispositivo personal ACTIVO por operario» (§4.3) impide que dos suites que comparten persona tengan cada una su aparato enrolado, y la segunda en correr se pone roja por un choque de fixture que no tiene nada que ver con lo que prueba",
  "8.765.432-K": "el chofer de las variantes cerradas de F4 (AC-FPOD-02), propio y no prestado: mismo motivo que el de arriba — un dispositivo personal por operario — así que esta suite necesita el suyo, no el de AC-FPOD-01",
  "4.444.444-5": "el chofer del POD sin red (AC-FPOD-03), propio y no prestado: tercera suite de F4, tercer operario — la regla de un dispositivo personal por persona no admite compartirlo con las dos de arriba",
  "3.333.333-1": "el chofer de la idempotencia del outbox (AC-FPOD-04), propio y no prestado: cuarta suite de F4, cuarto operario — mismo motivo que los tres de arriba",
  "2.222.222-8": "el chofer de la regla de oro con reloj corrido (AC-FPOD-05), propio y no prestado: quinta suite de F4, quinto operario — mismo motivo que los cuatro de arriba",
  "1.111.112-2": "el chofer del módulo apagado con turno abierto (AC-FPOD-06), propio y no prestado: sexta suite de F4, sexto operario — mismo motivo que las cinco de arriba",
  "9.876.543-3": "el chofer revocado DENTRO de la ventana de 72h (AC-FPOD-07), propio y no prestado: séptima suite de F4, séptimo operario — mismo motivo que las seis de arriba",
  "1.234.567-4": "el chofer revocado FUERA de la ventana de 72h (AC-FPOD-07), propio y no prestado: la misma suite necesita un SEGUNDO operario porque cada caso enrola su propio aparato con su propio `revocado_at`",
  "6.543.210-2": "el chofer A del centinela 9 (AC-FPOD-09), propio y no prestado: octava suite de F4, octavo operario — el que captura 3 entregas sin señal y después ya no vuelve a este teléfono",
  "8.888.888-K": "el chofer B del centinela 9 (AC-FPOD-09): la SEGUNDA identidad que se autentica en el MISMO aparato de A: sin ella no hay quién pise el outbox, que es todo lo que el caso prueba",
  "9.123.456-4": "el chofer de la secuencia monotónica por dispositivo (AC-FPOD-10), propio y no prestado: novena suite de F4, noveno operario — mismo motivo que las ocho de arriba",
  "8.642.097-K": "el segundo operario de AC-FPOD-10, el que ejerce el replay-on-online con Background Sync inexistente: la misma suite necesita su propio aparato aparte del que deja el hueco de secuencia",
  "7.777.777-6": "el chofer de foto y GPS como mejoras progresivas (AC-FPOD-12), propio y no prestado: décima suite de F4, décimo operario — mismo motivo que las nueve de arriba",
};

/**
 * El RUT sintético número `indice`, o un error que dice qué falta.
 *
 * Existe porque `Object.keys(VALIDOS)[n]!` MIENTE: el `!` de TypeScript le promete al compilador
 * que hay algo ahí, y si no lo hay el fixture inserta `undefined` como RUT. Eso no explota donde
 * se escribió — explota mucho más lejos, como una violación de `personas_anonimizacion_completa`
 * (una persona sin RUT parece anonimizada), y el rojo no menciona ni el índice ni esta lista.
 * Pasó de verdad el 11-ago-2026 con AC-FPOD-03, que pidió el índice 11 de una lista de 10.
 */
export function rutDeFixture(indice) {
  const claves = Object.keys(VALIDOS);
  const rut = claves[indice];
  if (rut === undefined) {
    throw new Error(
      `ruts-sinteticos: no existe el índice ${indice}; la lista congelada tiene ${claves.length} ` +
        `(0..${claves.length - 1}). Si esta suite necesita su propia persona, agregá un RUT AL ` +
        `FINAL de VALIDOS con su razón — nunca en el medio, que corre los índices de las demás.`,
    );
  }
  return rut;
}

/**
 * Cadenas con FORMA de RUT que NO pasan el módulo 11, y están a propósito: son los fixtures
 * que prueban que el validador rechaza. Sin declararlas, el gate las marcaría como RUTs
 * sembrados fuera de la lista; con ellas en otra lista, queda escrito que el rojo es su oficio.
 */
export const INVALIDOS_A_PROPOSITO = {
  "12.345.678-9": "el canónico con el dígito verificador cambiado: el caso que prueba que el módulo 11 se corre de verdad",
  "9.999.999-9": "dígito verificador repetido del cuerpo; se ve plausible y el módulo 11 dice 3",
};

/** Normaliza para comparar: el dígito verificador K se escribe en las dos cajas. */
export const normalizar = (rut) => String(rut).toUpperCase();

const DECLARADOS = new Set([...Object.keys(VALIDOS), ...Object.keys(INVALIDOS_A_PROPOSITO)].map(normalizar));

/** ¿Está declarado en la lista congelada, en cualquiera de sus dos mitades? */
export function declarado(rut) {
  return DECLARADOS.has(normalizar(rut));
}
