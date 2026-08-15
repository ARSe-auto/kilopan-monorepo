import type { Pool } from "pg";
import { entitlementVigente, FEATURES } from "./config.ts";

// El gate HTTP del portal del contratante [AC-FPOR-04] — spec 07 §1, §0 (HTTP.modulo_apagado).
//
// Vive separado de `config.ts` porque quien lo llama es `servidor.mjs`, ANTES de que exista
// sesión o rol: es el mismo momento en que se decide 404/503 por subdominio (AC-FTEN-05), y
// por la MISMA razón — un Server Component no puede fijar el status, así que el candado no
// puede vivir en un layout de `src/app/cliente/**` (ver el comentario de cabecera de
// `servidor.mjs`). Una conexión suelta y no una transacción con `enLectura`: no hay `Sesion`
// que declarar todavía y `config_version` no lleva política de fila.
export async function portalClienteEncendido(pool: Pool, slug: string): Promise<boolean> {
  const cliente = await pool.connect();
  try {
    return await entitlementVigente(cliente, slug, FEATURES.portal_contratante);
  } finally {
    cliente.release();
  }
}
