// ¿La URL pedida cae dentro del namespace `/cliente/*` del portal del contratante? [AC-FPOR-04]
// spec 07 §1, §2.
//
// Puro y sin IO a propósito: `servidor.mjs` lo usa para decidir SI vale la pena abrir el pool
// del tenant y consultar el entitlement (AC-FPOR-04 exige que la puerta cubra `/cliente` y
// cualquier cosa que cuelgue de `/cliente/…`, real o no — el 403 es del PREFIJO, no de una ruta
// que Next haya registrado). `/clientela` o `/cliente-vip` NO son del portal: comparar por
// prefijo de segmento, no de string, es lo que evita que un nombre parecido caiga en el candado ajeno.
export function esRutaDelPortalCliente(url: string | null | undefined): boolean {
  const ruta = (url ?? "").split("?")[0] ?? "";
  return ruta === "/cliente" || ruta.startsWith("/cliente/");
}
