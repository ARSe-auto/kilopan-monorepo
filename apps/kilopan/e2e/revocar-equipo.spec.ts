import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-ADM-08 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): revocar un equipo
// enrolado desde /arreglar exige un motivo escrito y no vacío, deja su evento
// (`equipo_revocado`, AC-ADM-10), corta EN EL ACTO cualquier sesión de operador viva en
// ese equipo, y bloquea un login posterior. Se ataca la ruta real por HTTP con sesión de
// verdad (login por pantalla para el admin); el equipo que se revoca es uno enrolado
// DESECHABLE dentro del propio test — revocar `datos.dispositivo` (el de la semilla)
// rompería todo el resto de los e2e que corren en el mismo proceso.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

test.describe.configure({ mode: "serial" });
// IP de prueba propia: el limitador de intentos de login es compartido (AC-SEC-02) —
// ver camino-dorado.spec.ts para el detalle. .51 ya la usa dashboard-cta-leads.spec.ts.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.64" } });

test("AC-ADM-08: revocar un equipo exige motivo, mata su sesión viva, y bloquea el login", async ({
  page,
  request,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  // Equipo nuevo y desechable, enrolado con credenciales de admin (pre-sesión, misma
  // ruta que usaría un teléfono real vinculándose por primera vez).
  const enrolado = await page.request.post("/api/dispositivos/enrolar", {
    data: {
      nombreDispositivo: "Tablet desechable ADM-08",
      rutAdmin: datos.usuarios.admin!.rut,
      pinAdmin: datos.pin,
    },
  });
  expect(enrolado.ok()).toBeTruthy();
  const { dispositivoId, secreto } = (await enrolado.json()) as {
    dispositivoId: string;
    secreto: string;
  };

  // `request` (a diferencia de `page.request`) es un cookie jar INDEPENDIENTE del admin
  // de arriba: simula el equipo desechable abriendo su propia sesión, sin pisar la del
  // admin. Login directo por HTTP —misma ruta que usa el teclado en pantalla— con el
  // vendedor de la semilla, no el admin: si acá entrara el admin, el trigger de AC-ID-04
  // desplazaría la sesión del admin que `page` acaba de abrir en el equipo de la semilla.
  const login = await request.post("/api/auth/login", {
    data: {
      rut: datos.usuarios.vendedor!.rut,
      pin: datos.pin,
      dispositivoId,
      dispositivoSecreto: secreto,
    },
  });
  expect(login.ok()).toBeTruthy();
  const antes = await request.get("/api/rutas");
  expect(antes.ok()).toBeTruthy();

  // Sin motivo escrito no se revoca: la confirmación es escribir el porqué, no marcar
  // una casilla (regla transversal de la sección).
  const sinMotivo = await page.request.post("/api/dispositivos/revocar", {
    data: { dispositivoId, motivo: "   " },
  });
  expect(sinMotivo.status()).toBe(400);

  // Un id inventado no existe.
  const inexistente = await page.request.post("/api/dispositivos/revocar", {
    data: { dispositivoId: crypto.randomUUID(), motivo: "prueba" },
  });
  expect(inexistente.status()).toBe(404);

  // Camino feliz: revoca con motivo.
  const revocado = await page.request.post("/api/dispositivos/revocar", {
    data: { dispositivoId, motivo: "equipo perdido, se retira de circulación" },
  });
  expect(revocado.ok()).toBeTruthy();

  // La sesión que estaba viva en el equipo revocado murió EN EL ACTO — no es teatro que
  // solo surte efecto la próxima vez que alguien intente entrar.
  const despues = await request.get("/api/rutas");
  expect(despues.status()).toBe(401);

  // Y el equipo revocado ya no puede volver a entrar.
  const reintento = await request.post("/api/auth/login", {
    data: {
      rut: datos.usuarios.vendedor!.rut,
      pin: datos.pin,
      dispositivoId,
      dispositivoSecreto: secreto,
    },
  });
  expect(reintento.status()).toBe(401);

  // Doble-tap: ya estaba revocado, no se pisa el evento con uno segundo.
  const dobleTap = await page.request.post("/api/dispositivos/revocar", {
    data: { dispositivoId, motivo: "segundo intento" },
  });
  expect(dobleTap.status()).toBe(409);
});

test("AC-ADM-08: un vendedor NO puede revocar un equipo — el servidor lo rebota con 403", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.vendedor!.rut, datos.pin);
  const r = await page.request.post("/api/dispositivos/revocar", {
    data: { dispositivoId: crypto.randomUUID(), motivo: "no debería poder" },
  });
  expect(r.status()).toBe(403);
});
