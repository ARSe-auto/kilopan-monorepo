import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-ADM-08 (Ola 2 «Marcha atrás», specs/kilopan/10-administracion.md): desbloquear un PIN
// desde /arreglar exige un motivo escrito y no vacío, deja su evento (`pin_desbloqueado`,
// AC-ADM-10), y deja entrar de nuevo ANTES de los 15 minutos del bloqueo de AC-SEC-01 —
// eso es justamente lo que hoy exige SQL a mano (Anexo C, docs/PROMPT_CORRECTIVO.md). Se
// dispara el bloqueo real con 5 PIN errados seguidos (la misma regla que prueba
// AC-SEC-01), no se inserta la fila de `pan.bloqueos_pin` a mano.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

test.describe.configure({ mode: "serial" });
// IP de prueba propia: el limitador de intentos de login es compartido (AC-SEC-02) —
// ver camino-dorado.spec.ts para el detalle.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.52" } });

test("AC-ADM-08: desbloquear un PIN exige motivo, y deja entrar antes de los 15 minutos", async ({
  page,
  request,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  // Equipo nuevo y desechable para los intentos del vendedor — NO el dispositivo de la
  // semilla: `abrir_sesion()` hace el relevo atómico de operador en equipo compartido, así
  // que loguear al vendedor en el MISMO equipo que usa `page` para el admin cerraría la
  // sesión de `page` a mitad del test (murió así la primera vez: el doble-tap de más abajo
  // veía 401 en vez de 409 porque el admin ya no tenía sesión viva).
  const enrolado = await page.request.post("/api/dispositivos/enrolar", {
    data: {
      nombreDispositivo: "Tablet desechable ADM-08 PIN",
      rutAdmin: datos.usuarios.admin!.rut,
      pinAdmin: datos.pin,
    },
  });
  expect(enrolado.ok()).toBeTruthy();
  const { dispositivoId, secreto } = (await enrolado.json()) as {
    dispositivoId: string;
    secreto: string;
  };

  // `request` es un cookie jar aparte del admin de `page`: simula al vendedor golpeando
  // la puerta desde el equipo desechable, sin sesión (todavía no entró ni una vez).
  const vendedor = datos.usuarios.vendedor!;
  let bloqueado = false;
  for (let i = 0; i < 5; i++) {
    const intento = await request.post("/api/auth/login", {
      data: {
        rut: vendedor.rut,
        pin: "0000",
        dispositivoId,
        dispositivoSecreto: secreto,
      },
    });
    if (intento.status() === 423) bloqueado = true;
  }
  expect(bloqueado).toBe(true);

  // Con el PIN correcto, sigue bloqueado — el candado no distingue si el sexto intento
  // acierta.
  const conPinCorrecto = await request.post("/api/auth/login", {
    data: {
      rut: vendedor.rut,
      pin: datos.pin,
      dispositivoId,
      dispositivoSecreto: secreto,
    },
  });
  expect(conPinCorrecto.status()).toBe(423);

  // Sin motivo escrito no se desbloquea.
  const sinMotivo = await page.request.post("/api/usuarios/desbloquear-pin", {
    data: { usuarioId: vendedor.id, motivo: "  " },
  });
  expect(sinMotivo.status()).toBe(400);

  // Un id inventado no existe.
  const inexistente = await page.request.post("/api/usuarios/desbloquear-pin", {
    data: { usuarioId: crypto.randomUUID(), motivo: "prueba" },
  });
  expect(inexistente.status()).toBe(404);

  // Camino feliz: desbloquea con motivo.
  const desbloqueo = await page.request.post("/api/usuarios/desbloquear-pin", {
    data: { usuarioId: vendedor.id, motivo: "se le olvidó el PIN, ya lo confirmó por teléfono" },
  });
  expect(desbloqueo.ok()).toBeTruthy();

  // Entra de inmediato, sin esperar los 15 minutos.
  const login = await request.post("/api/auth/login", {
    data: {
      rut: vendedor.rut,
      pin: datos.pin,
      dispositivoId,
      dispositivoSecreto: secreto,
    },
  });
  expect(login.ok()).toBeTruthy();

  // Doble-tap: ya no hay nada que desbloquear.
  const dobleTap = await page.request.post("/api/usuarios/desbloquear-pin", {
    data: { usuarioId: vendedor.id, motivo: "segundo intento" },
  });
  expect(dobleTap.status()).toBe(409);
});

test("AC-ADM-08: un vendedor NO puede desbloquear un PIN — el servidor lo rebota con 403", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.vendedor!.rut, datos.pin);
  const r = await page.request.post("/api/usuarios/desbloquear-pin", {
    data: { usuarioId: crypto.randomUUID(), motivo: "no debería poder" },
  });
  expect(r.status()).toBe(403);
});
