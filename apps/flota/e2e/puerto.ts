// El puerto del e2e, en UN solo lugar.
//
// Estaba clavado en 35 archivos —`const PUERTO = 3311` o `…localhost:3311` dentro de un
// template—, así que `playwright.config.ts` podía escuchar en otro puerto y las 493 pruebas
// seguían golpeando el 3311: 262 fallaron con ECONNREFUSED la primera vez que el SEGUNDO motor
// corrió su gate (12-ago-2026). Un dato repetido en 35 lugares no es un dato, son 35 datos que
// envejecen por separado.
//
// 3311 por omisión —el del contrato de puertos— y `FLOTA_E2E_PUERTO` para el segundo worktree,
// que corre en el 3312 con su propio cluster.
export const PUERTO_E2E = Number(process.env.FLOTA_E2E_PUERTO ?? 3311);

/** El origen de un tenant, que es como lo alcanza el navegador: subdominio + puerto. */
export function origenDe(slug: string): string {
  return `http://${slug}.localhost:${PUERTO_E2E}`;
}
