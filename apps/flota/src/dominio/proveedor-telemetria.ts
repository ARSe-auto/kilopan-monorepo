import { TELEMETRIA } from "../../../../packages/nucleo-comun/src/constants.ts";

// ProveedorTelemetria (§4.9, §11) — el registro por datos de sus implementaciones REALES.
// [AC-FTEL-06]
//
// E1 admitía una sola implementación: `declarada` (el chofer tecleando SOC/odómetro,
// `EV.fuente_por_defecto` en servidor/lecturas.ts). La enmienda §11 (E1.5, 18-ago-2026) suma
// `telefono_gps`: el teléfono del chofer ya trae GPS y no exige hardware, a diferencia de
// OBD/OEM que sigue como punto de extensión (§3-FUERA) hasta que el dueño elija proveedor.
//
// El código válido es la familia canónica de `constants.ts` (`TELEMETRIA.proveedores_del_registro`),
// no un literal repetido acá: es la misma frontera que graba el CHECK de `proveedor_telemetria`
// (migración 0077) y que vigila `db/flota/gate-ganchos-e1.mjs` del lado del código-fuente. Activar
// o desactivar una implementación es un UPDATE de `proveedor_telemetria.activo`: cero cambios de
// código de pantalla (§4.6).

export type CodigoProveedorTelemetria = (typeof TELEMETRIA.proveedores_del_registro)[number];

export type ProveedorTelemetria = {
  codigo: CodigoProveedorTelemetria;
  nombre: string;
};

/** El catálogo de implementaciones REALES del registro (§4.9, §11). Si una está activa o no lo
 *  decide la fila en `proveedor_telemetria`, jamás esta lista — acá solo viven los códigos que
 *  el registro admite. */
export const PROVEEDORES_TELEMETRIA_DEL_REGISTRO: readonly ProveedorTelemetria[] = [
  { codigo: "declarada", nombre: "Declarada por el chofer" },
  { codigo: "telefono_gps", nombre: "GPS del teléfono" },
];

/** ¿Este código pertenece al registro de E1.5? Una fuente de E4 (obd, ocpp, api_fabricante,
 *  sonda_vehiculo) o cualquier otra cosa que alguien tipee devuelve `false`: la frontera es
 *  cerrada, no una lista que se extiende escribiendo un string nuevo. */
export function esCodigoDelRegistro(codigo: string): codigo is CodigoProveedorTelemetria {
  return (TELEMETRIA.proveedores_del_registro as readonly string[]).includes(codigo);
}
