// AC-POD-05: catálogo CERRADO de motivos de entrega fallida, compartido entre `/ruta`
// (la pantalla que los ofrece) y `/api/sync` (el servidor que los valida).
//
// Antes este catálogo vivía inline en `ruta/page.tsx` y el servidor solo miraba
// `!!motivoRechazo`: cualquier string pasaba, así que un cliente HTTP directo —o un bug
// de UI— podía dejar CUALQUIER texto inventado como evidencia de una entrega fallida, y
// ese registro alimenta la conciliación del día. Vivir en un módulo único es lo que
// permite que el servidor valide contra el MISMO catálogo que la pantalla muestra, en vez
// de confiar en el cliente. `otro` es la única puerta a texto libre del catálogo, a
// propósito: cubre lo que no cae en los tres motivos fijos sin abrir la validación entera.

export interface MotivoRechazo {
  valor: string;
  etiqueta: string;
}

export const MOTIVOS_RECHAZO = [
  { valor: "cerrado", etiqueta: "Local cerrado" },
  { valor: "direccion", etiqueta: "No se encontró la dirección" },
  // El único motivo que el texto del AC nombra explícitamente.
  { valor: "rechazo", etiqueta: "Cliente rechazó el pedido" },
  { valor: "otro", etiqueta: "Otro" },
] as const satisfies readonly MotivoRechazo[];

export type CodigoMotivo = (typeof MOTIVOS_RECHAZO)[number]["valor"];

/** Devuelve el motivo del catálogo cerrado para un código, o `null` si el código no
 *  pertenece a él. Es la validación de servidor que antes no existía: sin esto cualquier
 *  string colaba como motivo de rechazo. */
export function motivoDeCatalogo(codigo: string | null | undefined): MotivoRechazo | null {
  if (!codigo) return null;
  return MOTIVOS_RECHAZO.find((m) => m.valor === codigo) ?? null;
}
