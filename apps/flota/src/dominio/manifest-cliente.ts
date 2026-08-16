// El manifest del portal del contratante [AC-FPOR-07] — spec 07 §2.
//
// A DIFERENCIA de `manifest.ts` (el del operador, AC-FPOR-03), este manifest NO se recorta por
// entitlement: una vez que el candado de módulo deja pasar el namespace `/cliente/*` (AC-FPOR-04,
// `servidor/portal.ts`), el §3.E1.10 cierra la lista en EXACTAMENTE cuatro pantallas — «lista
// cerrada», sin matices ni un quinto módulo que un tenant pueda contratar aparte. Por eso es una
// constante y no una función de un mapa de entitlements: no hay nada que apagar acá adentro, todo
// lo que se apaga (el portal ENTERO) ya se decidió antes de que Next reciba el request.

export type ClaveModuloCliente = "hoy" | "encargos" | "nuevo" | "liquidacion";

export type ModuloPortalCliente = { clave: ClaveModuloCliente; titulo: string; ruta: string };

/** Las cuatro pantallas del §3.E1.10, en el orden en que el maestro las nombra. */
export const MODULOS_PORTAL_CLIENTE: ModuloPortalCliente[] = [
  { clave: "hoy", titulo: "Hoy", ruta: "/cliente" },
  { clave: "encargos", titulo: "Encargos", ruta: "/cliente/encargos" },
  { clave: "nuevo", titulo: "Nuevo / Importar CSV", ruta: "/cliente/nuevo" },
  { clave: "liquidacion", titulo: "Liquidación", ruta: "/cliente/liquidaciones" },
];
