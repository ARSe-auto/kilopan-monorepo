// Manifest de módulos navegables, contraído por modo del tenant [AC-FPOR-03] — spec 07 §1, §2.

// El §3 cierra el mapeo como filas y no como un `if`: `mi_flota` deja lo operativo puro y
// apaga EXACTAMENTE cuatro cosas del contratante — «quedan OFF y ocultos», sin matices. Este
// archivo espeja 1:1 `modo_recorte` (db/migraciones-flota/control/0003_modo_como_preset.sql,
// AC-FTEN-22): la MISMA lista de `feature_lookup_key`, para que agregar una fila al recorte en
// la BD sin agregarla acá se note por divergencia, no por un contratante viendo un enlace que
// ya no debería estar.
//
// La resolución real (`entitlement_efectivo`, override ?? plan, recortado por modo) es de la
// BD y del módulo 00 (manifest de navegación server-side, hito a — aún no construido: layout.tsx
// sigue siendo el esqueleto del hito 0). Mientras esa tubería no exista, este manifest recibe
// el mapa de entitlements YA RESUELTO —tal como lo entregaría el snapshot congelado de
// `servidor/config.ts`— y decide sobre eso, mismo patrón que `dominioSemaforoActivo`
// (`dominio/semaforo.ts`, AC-FSEM-13): puro, sin abrir una conexión por su cuenta.

export type ClaveModulo =
  | "hoy"
  | "turno"
  | "rutas"
  | "tarifas"
  | "liquidacion_por_cliente"
  | "portal_contratante"
  | "facturacion";

export type ModuloManifest = { clave: ClaveModulo; titulo: string; ruta: string };

/** Lo operativo puro: nunca se contrae por modo (§3 «queda lo operativo puro»). */
export const MODULOS_SIEMPRE: ModuloManifest[] = [
  { clave: "hoy", titulo: "Hoy", ruta: "/hoy" },
  { clave: "turno", titulo: "Turno", ruta: "/turno" },
  { clave: "rutas", titulo: "Rutas", ruta: "/rutas" },
];

/** El grupo DaaS del §3 — las cuatro filas EXACTAS de `modo_recorte` para `mi_flota`. Cada
 *  clave es su propio `feature_lookup_key`: la BD las apaga una por una, no como bloque, así
 *  que este manifest también las evalúa una por una — un módulo nuevo que el hito f/g/08
 *  agregue al recorte sin sumarlo acá queda huérfano en vez de heredar la contracción sola. */
export const MODULOS_GRUPO_DAAS: ModuloManifest[] = [
  { clave: "tarifas", titulo: "Tarifas", ruta: "/tarifas" },
  { clave: "liquidacion_por_cliente", titulo: "Liquidación", ruta: "/liquidaciones" },
  { clave: "portal_contratante", titulo: "Portal del contratante", ruta: "/cliente" },
  { clave: "facturacion", titulo: "Facturación", ruta: "/facturacion" },
];

/**
 * Los módulos que el manifest ofrece, dado el mapa de entitlements YA RESUELTO.
 *
 * Un módulo del grupo DaaS sin entrada en `entitlements` (o con `false`) NO se agrega al
 * arreglo — no se agrega deshabilitado, no se agrega con un candado: el hueco donde iría el
 * enlace no existe (§3 «sin huecos ni candados»; el candado SÍ aparece, pero solo en el panel
 * admin del hito g, que este manifest no es). Mismo criterio de «sin entrada = apagada» que
 * `entitlementVigente`/`dominioSemaforoActivo`: encender por defecto algo que nadie decidió
 * dejaría el portal visible en un tenant que nunca lo contrató.
 */
export function modulosNavegables(entitlements: Readonly<Record<string, boolean>>): ModuloManifest[] {
  const grupoDaasActivo = MODULOS_GRUPO_DAAS.filter((m) => entitlements[m.clave] === true);
  return [...MODULOS_SIEMPRE, ...grupoDaasActivo];
}

/** Fixture del entitlement de cada modo, para las mismas semillas de e2e que ya usa el
 *  Nivel 0 del semáforo (`?seed=a` daas, `?seed=c` mi_flota — `semaforo-fixtures.ts`). Ningún
 *  tenant real tiene hoy estas cuatro features en `features`/`plan_features` (el hito f/g/08
 *  todavía no las siembra), así que esto es lo que ese snapshot entregaría el día que exista,
 *  no una lectura en caliente de nada. */
export function entitlementsDeModo(modo: "mi_flota" | "daas"): Readonly<Record<string, boolean>> {
  const encendido = modo === "daas";
  return Object.fromEntries(MODULOS_GRUPO_DAAS.map((m) => [m.clave, encendido]));
}
