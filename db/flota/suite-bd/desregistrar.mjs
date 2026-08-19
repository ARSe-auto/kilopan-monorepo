// Baja COMPLETA del registro de un tenant de prueba en `control`.
//
// Desde que `provisionar()` da de alta en `control.tenants` [AC-FPOR-01], dropear la base ya
// no basta: la fila queda, el job exportador la nombra como rezago (AC-FTEN-20) y sus
// agregados bloquean por FK cualquier limpieza posterior (AC-FTEN-04). Una suite que borre un
// tenant de prueba tiene que dar de baja el registro ENTERO —las tablas hijas primero, la
// fila después— o el gate se envenena a sí mismo para la corrida siguiente: verde sobre
// cluster limpio, rojo en la que viene. Así quedó aparcado el motor 3 el 15-ago.
import { con, BD_CONTROL } from "../conectar.mjs";

/** Toda tabla de `control` que referencia `tenants(id)`: el orden del delete no es opcional. */
export const HIJAS_DE_TENANTS = [
  "agregados_tecnicos",
  "tenant_feature_overrides",
  "invitaciones_tenant",
  "grants_soporte",
];

/** Borra del registro todo tenant cuyo slug matchee el patrón LIKE (`\` escapa `_`/`%`). */
export async function desregistrarComo(patron) {
  try {
    await con(BD_CONTROL, async ({ sql }) => {
      for (const hija of HIJAS_DE_TENANTS) {
        await sql(
          `delete from ${hija} where tenant_id in (select id from tenants where slug like $1)`,
          [patron],
        );
      }
      await sql("delete from tenants where slug like $1", [patron]);
    });
  } catch (e) {
    // Sin base `control` o sin tabla `tenants` no hay registro del que dar de baja: es el
    // cluster virgen de antes del primer `migrar.mjs aplicar`, no un error.
    if (e.code === "3D000" || e.code === "42P01") return;
    throw e;
  }
}

/** La baja de UN slug exacto (escapa `_`, que en LIKE es comodín de un carácter). */
export async function desregistrar(slug) {
  await desregistrarComo(slug.replace(/[\\%_]/g, (m) => `\\${m}`));
}
