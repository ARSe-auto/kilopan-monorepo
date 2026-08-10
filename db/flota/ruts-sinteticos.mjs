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
};

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
