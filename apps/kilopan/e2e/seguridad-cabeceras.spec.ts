import { test, expect } from "@playwright/test";

// AC-SEC-04: `next.config.ts` declara X-Content-Type-Options, Referrer-Policy y
// X-Frame-Options, pero una declaración no es una garantía — una entrada borrada por
// error de `headers()` no la detecta nada que solo lea el archivo. Este test pega
// contra el servidor real (mismo binario standalone que produce el webServer de
// playwright.config.ts) y lee `response.headers()`, la única fuente de verdad de lo
// que el navegador recibe de verdad. /ingresar es pública (ver autorizacion.spec.ts),
// así que no depende de sesión ni de datos-semilla.json.
function exigirCabeceras(cabeceras: Record<string, string>, donde: string) {
  expect(cabeceras["x-content-type-options"], `X-Content-Type-Options en ${donde}`).toBe("nosniff");
  expect(cabeceras["referrer-policy"], `Referrer-Policy en ${donde}`).toBe("strict-origin-when-cross-origin");
  expect(cabeceras["x-frame-options"], `X-Frame-Options en ${donde}`).toBe("DENY");
}

test("el servidor emite las cabeceras de seguridad base en toda ruta", async ({ page }) => {
  const respuesta = await page.goto("/ingresar");
  expect(respuesta).not.toBeNull();
  exigirCabeceras(respuesta!.headers(), "/ingresar (página)");

  // Una ruta de API además de una página: `source: "/:path*"` las cubre a las dos, pero
  // angostarlo a rutas de página es un error plausible y no lo delataría un test que solo
  // mire /ingresar. /api/auth/me responde 401 sin sesión — da igual, lo que se afirma acá
  // es la CABECERA, que el servidor debe emitir con cualquier código de estado.
  const api = await page.request.get("/api/auth/me");
  exigirCabeceras(api.headers(), "/api/auth/me (API)");
});
