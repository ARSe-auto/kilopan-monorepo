import type { PoolClient } from "pg";
import { FEATURES, moduloVigenteEncendido } from "./config.ts";

// El manifest de navegación server-side [AC-FMIG-09] — §5.5, §0.
//
// «Módulo apagado NO se renderiza — sin huecos, candados ni parpadeo»: el §5.5 lo cierra sin
// matices. Los locked-states y el upsell son SOLO de la pantalla «Funciones» (AC-FMIG-08); acá,
// del lado de la PWA de terreno, un módulo apagado simplemente no aparece en la lista — nunca un
// ícono deshabilitado ni un mensaje de «esto no lo tenés».
//
// Es «entitlements × rol» de nombre (§5.5), pero hoy el catálogo entero es de acceso general del
// tenant (ningún ítem de este catálogo está reservado a un rol distinto de cualquier sesión
// válida) — la dimensión de rol queda declarada en la firma para el día en que un módulo la
// necesite, y AC-FMIG-21 la ejercita como «estructura de datos testeable» para el chequeo de
// profundidad ≤2.

export type ItemDeManifiesto = {
  lookupKey: string;
  etiqueta: string;
  ruta: string;
};

/** El catálogo completo de módulos que el manifest puede ofrecer, con la feature que los
 *  enciende. Solo entran acá los módulos que de verdad tienen un `lookup_key` en `features`
 *  (control): `modulo_encargos` todavía no lo tiene —lo siembra un hito posterior (§5.5, hito
 *  g)— y agregarlo acá antes de esa siembra sería prometerle a la pantalla un candado que el
 *  servidor no puede mover. */
const CATALOGO: readonly ItemDeManifiesto[] = [
  { lookupKey: FEATURES.modulo_vehiculos, etiqueta: "Vehículos", ruta: "/vehiculos" },
];

/**
 * El manifest para ESTE tenant, ahora: solo los módulos ENCENDIDOS en la config vigente.
 *
 * «App mínima (todo OFF) = abrir turno → paradas → cerrar turno, y sigue siendo producto
 * completo» (§5.5): esa secuencia no depende de ningún ítem de este catálogo, así que un
 * manifest vacío es un resultado válido, no un error — la pantalla de inicio lo pinta como el
 * estado vacío accionable de Miga (AC-FMIG-10), nunca como una falla.
 */
export async function manifiestoDeNavegacion(c: PoolClient, slug: string): Promise<ItemDeManifiesto[]> {
  const items: ItemDeManifiesto[] = [];
  for (const item of CATALOGO) {
    if (await moduloVigenteEncendido(c, slug, item.lookupKey)) items.push(item);
  }
  return items;
}
