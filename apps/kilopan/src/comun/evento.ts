// AC-ADM-10: `pan.eventos` obligatoria en toda operación de plata y de configuración.
//
// Por qué un helper y no el insert copiado en cada ruta: la tabla es append-only por
// `revoke update, delete` (0001), así que un evento mal escrito no se corrige después — se
// queda. Y la auditoría sirve solo si TODAS las operaciones usan los mismos nombres: una
// pantalla que busque `venta_registrada` no encuentra nada si una ruta escribió
// `venta_creada`. Los tipos viven acá enumerados, no como strings sueltos por el árbol.
//
// El evento va SIEMPRE dentro de la misma transacción que la operación: si la venta se
// registra y el evento no, la auditoría miente por omisión — y es el caso que más importa,
// porque es justo el que nadie nota hasta que hace falta reconstruir qué pasó.

/** Catálogo cerrado. Agregar una operación de plata obliga a nombrarla acá. */
export type TipoEvento =
  | "venta_registrada"
  | "venta_anulada"
  | "turno_abierto"
  | "turno_cerrado"
  | "cierre_caja_corregido"
  | "precio_cambiado"
  | "pin_reseteado"
  | "equipo_revocado"
  | "merma_registrada"
  | "dte_anulado"
  | "ruta_cerrada"
  | "ruta_salida_con_bultos_pendientes";

/** Lo mínimo que necesita un evento para ser auditable: quién y en qué equipo. */
export interface QuienYDonde {
  usuarioId: string;
  dispositivoId: string;
}

/** Cliente de consulta: sirve tanto el pool como una transacción abierta. */
interface Consultable {
  query(texto: string, valores?: unknown[]): Promise<unknown>;
}

/**
 * Registra un evento de auditoría. Se llama con la MISMA transacción que la operación,
 * nunca con el pool suelto: un evento que se escribe fuera de la transacción sobrevive a
 * un rollback y deja la auditoría afirmando algo que no pasó.
 */
export async function registrarEvento(
  tx: Consultable,
  tipo: TipoEvento,
  entidad: string,
  entidadId: string | null,
  payload: Record<string, unknown>,
  quien: QuienYDonde
): Promise<void> {
  await tx.query(
    `insert into pan.eventos (tipo, entidad, entidad_id, payload, usuario_id, dispositivo_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [tipo, entidad, entidadId, JSON.stringify(payload), quien.usuarioId, quien.dispositivoId]
  );
}
