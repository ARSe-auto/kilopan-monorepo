import type { PoolClient } from "pg";
import { FEATURES, moduloVigenteEncendido } from "./config.ts";
import type { Rol } from "../../../../packages/nucleo-comun/src/constants.ts";
// `ItemDeManifiesto.subitems` abajo es estructuralmente un `NodoDeNavegacion`
// (`dominio/manifiesto-profundidad.ts`) sin necesidad de extenderlo a mano: cualquier
// `ItemDeManifiesto[]` ya sirve como argumento de `profundidadDeManifiesto`.

// El manifest de navegación server-side [AC-FMIG-09] — §5.5, §0.
//
// «Módulo apagado NO se renderiza — sin huecos, candados ni parpadeo»: el §5.5 lo cierra sin
// matices. Los locked-states y el upsell son SOLO de la pantalla «Funciones» (AC-FMIG-08); acá,
// del lado de la PWA de terreno, un módulo apagado simplemente no aparece en la lista — nunca un
// ícono deshabilitado ni un mensaje de «esto no lo tenés».
//
// Es «entitlements × rol» de nombre (§5.5): el catálogo de HOY sigue siendo de acceso general
// del tenant (ningún ítem reserva un rol distinto de cualquier sesión válida), pero la firma YA
// recibe el `rol` y lo aplica —`roles` opcional en `ItemDeManifiesto`, sin restricción si no se
// declara— [AC-FMIG-21]: el día en que un módulo necesite un ítem reservado a un rol, la puerta
// ya existe y ya la ejercita el covering array de `e2e/profundidad-manifiesto.spec.ts`.
//
// `subitems` (opcional, sin uso hoy: el catálogo es plano) es la misma extensión, para el
// chequeo de profundidad ≤2 [AC-FMIG-21] — ver `dominio/manifiesto-profundidad.ts`.

export type ItemDeManifiesto = {
  lookupKey: string;
  etiqueta: string;
  ruta: string;
  /** Sin declarar = accesible a cualquier rol de sesión válida (el criterio de hoy). */
  roles?: readonly Rol[];
  subitems?: readonly ItemDeManifiesto[];
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
 * El manifest para ESTE tenant y ESTE rol, ahora: solo los módulos ENCENDIDOS en la config
 * vigente y accesibles al rol de la sesión (§5.5, AC-FMIG-21).
 *
 * «App mínima (todo OFF) = abrir turno → paradas → cerrar turno, y sigue siendo producto
 * completo» (§5.5): esa secuencia no depende de ningún ítem de este catálogo, así que un
 * manifest vacío es un resultado válido, no un error — la pantalla de inicio lo pinta como el
 * estado vacío accionable de Miga (AC-FMIG-10), nunca como una falla.
 */
export async function manifiestoDeNavegacion(
  c: PoolClient,
  slug: string,
  rol: string,
): Promise<ItemDeManifiesto[]> {
  const items: ItemDeManifiesto[] = [];
  for (const item of CATALOGO) {
    if (item.roles && !item.roles.includes(rol as Rol)) continue;
    if (await moduloVigenteEncendido(c, slug, item.lookupKey)) items.push(item);
  }
  return items;
}
