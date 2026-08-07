// AC-DTE-03. El TED (Timbre Electrónico de Documentos) es el XML que viaja dentro del
// código PDF417 impreso en toda factura/guía/boleta electrónica chilena. Escanearlo es
// una MEJORA PROGRESIVA sobre la captura manual (§3, §7: el manual es el camino primario
// en iOS): rellena tipo+folio+RUT+monto de un solo tiro, sin teclear. La app JAMÁS emite
// ni genera este timbre — solo LEE uno que el SII ya autorizó (art. 97 N°4 CT).
//
// El TED no trae neto ni IVA (nota de implementación de la spec 06): solo el total (MNT).
// Se guarda el XML crudo (`ted_xml`) para poder re-verificarlo contra el CAF más adelante.

export interface TedLeido {
  tipoDte: number;
  folioSii: number;
  rutEmisor: string;
  rutReceptor: string | null;
  montoTotal: number;
  /** XML crudo del timbre, tal cual venía en el PDF417, para re-verificación futura. */
  tedXml: string;
}

const TIPOS_VALIDOS = new Set([33, 39, 52, 61]);

// El SII define el TED con estos campos dentro de <DD> (datos del documento):
// RE = RUT emisor, TD = tipo de DTE, F = folio, RR = RUT receptor, MNT = monto total.
// Se extraen por etiqueta y no con DOMParser para que la misma función corra igual en el
// navegador y bajo `node --test` (sin jsdom).
function valorEtiqueta(xml: string, etiqueta: string): string | null {
  const m = new RegExp(`<${etiqueta}>\\s*([^<]*?)\\s*</${etiqueta}>`).exec(xml);
  return m?.[1] ?? null;
}

/**
 * Parsea el XML de un TED escaneado desde el PDF417. Devuelve los campos que rellenan el
 * panel «Registrar documento del SII». Lanza un Error con mensaje en español si el texto
 * escaneado no es un TED reconocible o le falta un dato obligatorio — el llamador cae de
 * vuelta a la captura manual, que siempre está disponible.
 */
export function parsearTed(texto: string): TedLeido {
  const xml = texto.trim();
  if (!/<TED\b/.test(xml) || !/<DD>/.test(xml)) {
    throw new Error("El código escaneado no es un timbre del SII (TED)");
  }

  const tdCrudo = valorEtiqueta(xml, "TD");
  const fCrudo = valorEtiqueta(xml, "F");
  const reCrudo = valorEtiqueta(xml, "RE");
  const mntCrudo = valorEtiqueta(xml, "MNT");
  const rrCrudo = valorEtiqueta(xml, "RR");

  if (!tdCrudo || !fCrudo || !reCrudo || !mntCrudo) {
    throw new Error("El timbre no trae tipo, folio, RUT o monto completos");
  }

  const tipoDte = Number(tdCrudo);
  if (!Number.isInteger(tipoDte) || !TIPOS_VALIDOS.has(tipoDte)) {
    throw new Error("Tipo de documento del timbre no soportado (33, 39, 52 o 61)");
  }

  const folioSii = Number(fCrudo);
  if (!Number.isInteger(folioSii) || folioSii < 1) {
    throw new Error("Folio del timbre inválido");
  }

  const montoTotal = Number(mntCrudo);
  if (!Number.isInteger(montoTotal) || montoTotal < 1) {
    throw new Error("Monto del timbre inválido");
  }

  return {
    tipoDte,
    folioSii,
    rutEmisor: reCrudo,
    rutReceptor: rrCrudo || null,
    montoTotal,
    tedXml: xml,
  };
}
