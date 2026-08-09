// Tokens ESTRUCTURALES de Miga generalizado — arquitectura de 3 capas [AC-FMIG-01].
//
// «Tokens ESTRUCTURALES = constantes de plataforma NO configurables» (§5.1). El tenant
// personaliza EXACTAMENTE tres cosas —logo, UN acento y el diccionario de terminología—
// y ninguna de las tres vive acá: lo de este archivo es igual para todos los tenants,
// para siempre, y por eso son constantes y no filas.
//
// Las tres capas del §5.1 (primitivo → semántico → componente) existen para que una
// pantalla NUNCA toque un número: pide `componente.botonPrimario.altoMinPx` y no sabe
// —ni le importa— que abajo son 56. Cambiar el 56 es cambiar UNA línea de la familia
// canónica; hoy, cambiarlo significaría perseguirlo por el árbol.
//
//   1. PRIMITIVO — el valor crudo, importado de la familia canónica del §0. Cero
//      literales propios: cada número de esta capa es una re-exportación con nombre.
//   2. SEMÁNTICO — qué SIGNIFICA ese valor en el sistema (el texto de un cuerpo, la
//      separación entre tarjetas, el mínimo de contraste de una cifra bajo el sol).
//   3. COMPONENTE — la receta cerrada de un control concreto, lista para renderizar.
//
// La regla que le da filo, y el caso de rebote del AC: un número mágico de la familia
// §0 escrito a mano en `packages/miga` pone el gate en rojo (`db/flota/gate-constantes.mjs`,
// que desde este AC incluye este paquete en su alcance). Por eso este archivo IMPORTA
// todo y no declara ni un dígito de la familia.
//
// Lo que este archivo NO hace, y hay que decirlo porque publicar constantes no puede
// fallar (§5, encabezado): las reglas CONDUCTUALES del §5.1 —«una acción primaria por
// pantalla» y «máx 2 niveles de profundidad»— NO quedan cumplidas por estar escritas
// acá. Su oráculo es AC-FMIG-21, sobre e2e y sobre el manifest de navegación.
import {
  TIPOGRAFIA,
  GRILLA,
  TACTIL,
  CIFRA_OPERATIVA,
  CONTRASTE,
} from "../../nucleo-comun/src/constants.ts";

// Ruta relativa y no `@kilopan/nucleo-comun`: `packages/miga` lo consumen DOS árboles con
// tsconfig distintos (apps/kilopan hoy, apps/flota cuando exista) y un alias obliga a que
// cada uno lo declare. Una ruta relativa resuelve igual en tsc, en Node y en el bundler,
// sin que un consumidor nuevo tenga que enterarse de nada.

// ─── Capa 1: PRIMITIVO ────────────────────────────────────────────────────────────────
// Valores crudos con nombre. Ni un literal: todo viene de la familia canónica.
export const primitivo = Object.freeze({
  fuente: TIPOGRAFIA.familia,
  escalaPt: TIPOGRAFIA.escala_pt,
  espacioBasePx: GRILLA.base_px,
  radioTarjetaPx: GRILLA.radio_tarjeta_px,
  radioControl: GRILLA.radio_control,
  objetivoOperativoPx: TACTIL.operativo_min,
  teclaPx: TACTIL.tecla_min,
  botonPrimarioPx: TACTIL.boton_primario,
  pisoWcagPx: TACTIL.piso_wcag,
  cifraPx: CIFRA_OPERATIVA.tamano_px,
  cifraPeso: CIFRA_OPERATIVA.peso,
  cifraVarianteNumerica: CIFRA_OPERATIVA.variante_numerica,
  contrasteTexto: CONTRASTE.texto,
  contrasteUi: CONTRASTE.ui,
  contrasteCifra: CONTRASTE.cifra_operativa_y_semaforos,
});

// ─── Capa 2: SEMÁNTICO ────────────────────────────────────────────────────────────────
// Qué significa cada primitivo. Una pantalla que necesita «el texto de un pie de tarjeta»
// pide `texto.pie`, no «13».
export const semantico = Object.freeze({
  texto: Object.freeze({
    tituloGrande: primitivo.escalaPt.titulo_grande,
    cuerpo: primitivo.escalaPt.cuerpo,
    subtitulo: primitivo.escalaPt.subtitulo,
    pie: primitivo.escalaPt.pie,
    minimo: primitivo.escalaPt.minimo,
    familia: primitivo.fuente,
  }),
  // Todo espacio es múltiplo de la base. Un `12` suelto entre dos tarjetas es cómo se
  // desalinea una grilla sin que nadie lo note hasta la captura de pantalla.
  espacio: Object.freeze({
    unidad: primitivo.espacioBasePx,
    entreControles: primitivo.espacioBasePx,
    entreTarjetas: primitivo.espacioBasePx * 2,
    margenPantalla: primitivo.espacioBasePx * 2,
  }),
  esquina: Object.freeze({
    tarjeta: primitivo.radioTarjetaPx,
    control: primitivo.radioControl,
  }),
  // El de la cifra no es un lujo: es leerla al sol directo, de pie, con el teléfono en
  // una mano. Los otros dos son los mínimos AA de texto y de UI.
  contrasteMinimo: Object.freeze({
    texto: primitivo.contrasteTexto,
    ui: primitivo.contrasteUi,
    cifraOperativaYSemaforos: primitivo.contrasteCifra,
  }),
  // Ningún elemento tocable baja del piso WCAG, ni siquiera uno decorativo.
  toque: Object.freeze({
    piso: primitivo.pisoWcagPx,
    operativo: primitivo.objetivoOperativoPx,
    tecla: primitivo.teclaPx,
  }),
});

// ─── Capa 3: COMPONENTE ───────────────────────────────────────────────────────────────
// La receta cerrada de cada control estructural. Es lo único que una pantalla consume.
export const componente = Object.freeze({
  /**
   * La cifra que se lee desde medio metro con las manos ocupadas. `tabular-nums` no es
   * una opción de estilo: sin ella los dígitos cambian de ancho al actualizarse y el
   * número «baila» — ilegible justo cuando más se lo mira.
   */
  cifraOperativa: Object.freeze({
    tamanoPx: primitivo.cifraPx,
    peso: primitivo.cifraPeso,
    varianteNumerica: primitivo.cifraVarianteNumerica,
    contrasteMinimo: semantico.contrasteMinimo.cifraOperativaYSemaforos,
  }),
  /** §5.1: full-width, anclado abajo, respetando la safe-area del iPhone. */
  botonPrimario: Object.freeze({
    altoMinPx: primitivo.botonPrimarioPx,
    ancho: "100%",
    anclado: "abajo",
    respetaSafeArea: true,
    tamanoTextoPt: semantico.texto.cuerpo,
    esquina: semantico.esquina.control,
  }),
  /** Teclado PROPIO: en terreno el del sistema jamás aparece (§5.7, conducta en AC-FMIG-03). */
  tecla: Object.freeze({
    altoMinPx: semantico.toque.tecla,
    anchoMinPx: semantico.toque.tecla,
    separacionPx: semantico.espacio.entreControles,
    esquina: semantico.esquina.tarjeta,
  }),
  /** Cualquier otro control tocable de terreno. */
  objetivoTactil: Object.freeze({
    altoMinPx: semantico.toque.operativo,
    anchoMinPx: semantico.toque.operativo,
    pisoAbsolutoPx: semantico.toque.piso,
  }),
  tarjeta: Object.freeze({
    esquinaPx: semantico.esquina.tarjeta,
    separacionPx: semantico.espacio.entreTarjetas,
    margenPantallaPx: semantico.espacio.margenPantalla,
  }),
});

/** Las 3 capas del §5.1, en orden, para que un test pueda recorrerlas sin adivinarlas. */
export const CAPAS = ["primitivo", "semantico", "componente"] as const;
