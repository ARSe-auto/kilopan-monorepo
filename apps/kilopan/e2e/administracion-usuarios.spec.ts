import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-ADM-01 (specs/kilopan/10-administracion.md): dar de alta, desactivar, cambiar de rol
// o resetear el PIN de una persona desde la propia app (`/admin` + `POST/PATCH
// /api/usuarios`) — antes esto solo existía por SQL directo. El Anexo D (auditoría
// 2-ago-2026) marcó HUECO: el endpoint ya estaba implementado (`exigirRol(["admin"])`,
// valida RUT/PIN/rol, candado de auto-desactivación) pero ningún test lo ejercitaba.
//
// Mismo patrón que AC-ADM-02 (administracion-productos.spec.ts): HTTP con sesión admin
// real. La afirmación de que el PIN y el estado `activo` de verdad cambian el acceso —no
// solo que el endpoint responda 200— se prueba con un login real por un equipo
// DESECHABLE (nunca el de la semilla: loguear a la persona de prueba ahí desplazaría la
// sesión de admin que `page` tiene abierta — relevo atómico de AC-ID-06, mismo motivo que
// ya documentó revocar-equipo.spec.ts).
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

test.describe.configure({ mode: "serial" });
// IP de prueba propia: el limitador de intentos de login es compartido (AC-SEC-02).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.66" } });

test("AC-ADM-01: dar de alta una persona — RUT duplicado 409, datos inválidos 400", async ({ page }) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  const RUT = "44.444.444-4";
  const alta = await page.request.post("/api/usuarios", {
    data: { nombre: "Persona Alta ADM-01", rut: RUT, rol: "vendedor", pin: "1234" },
  });
  expect(alta.ok()).toBeTruthy();
  const cuerpo = (await alta.json()) as { id: string; rut: string };
  expect(cuerpo.id).toBeTruthy();
  expect(cuerpo.rut).toBe(RUT);

  // El mismo RUT otra vez rebota por la unicidad de `pan.usuarios.rut`.
  const duplicado = await page.request.post("/api/usuarios", {
    data: { nombre: "Otra Persona", rut: RUT, rol: "vendedor", pin: "5678" },
  });
  expect(duplicado.status()).toBe(409);

  const sinNombre = await page.request.post("/api/usuarios", {
    data: { rut: "55.555.555-5", rol: "vendedor", pin: "1234" },
  });
  expect(sinNombre.status()).toBe(400);

  const rutInvalido = await page.request.post("/api/usuarios", {
    data: { nombre: "RUT Malo", rut: "11.111.111-9", rol: "vendedor", pin: "1234" },
  });
  expect(rutInvalido.status()).toBe(400);

  const rolInvalido = await page.request.post("/api/usuarios", {
    data: { nombre: "Rol Malo", rut: "55.555.555-5", rol: "gerente", pin: "1234" },
  });
  expect(rolInvalido.status()).toBe(400);

  const pinInvalido = await page.request.post("/api/usuarios", {
    data: { nombre: "PIN Malo", rut: "55.555.555-5", rol: "vendedor", pin: "12" },
  });
  expect(pinInvalido.status()).toBe(400);
});

test("AC-ADM-01: editar una persona — activar/desactivar, cambiar de rol y resetear el PIN cambian el acceso de verdad", async ({
  page,
  request,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  const RUT = "66.666.666-6";
  const alta = await page.request.post("/api/usuarios", {
    data: { nombre: "Persona Editada ADM-01", rut: RUT, rol: "vendedor", pin: "1111" },
  });
  expect(alta.ok()).toBeTruthy();
  const { id } = (await alta.json()) as { id: string };

  // Equipo desechable SOLO para probar el login de esta persona — ver nota de archivo.
  const enrolado = await page.request.post("/api/dispositivos/enrolar", {
    data: {
      nombreDispositivo: "Tablet desechable ADM-01",
      rutAdmin: datos.usuarios.admin!.rut,
      pinAdmin: datos.pin,
    },
  });
  expect(enrolado.ok()).toBeTruthy();
  const { dispositivoId, secreto } = (await enrolado.json()) as { dispositivoId: string; secreto: string };

  // Camino feliz: la persona recién creada entra con el PIN que se le dio de alta.
  const loginInicial = await request.post("/api/auth/login", {
    data: { rut: RUT, pin: "1111", dispositivoId, dispositivoSecreto: secreto },
  });
  expect(loginInicial.ok()).toBeTruthy();

  // Desactivar: el servidor responde 200 y, de verdad, esa persona ya no puede entrar
  // (mismo 401 genérico que un RUT o PIN incorrecto — no delata que está inactiva).
  const desactivar = await page.request.patch("/api/usuarios", { data: { id, activo: false } });
  expect(desactivar.ok()).toBeTruthy();
  const detalleTrasDesactivar = await page.request.get("/api/usuarios?detalle=1");
  const { usuarios: conInactivos } = (await detalleTrasDesactivar.json()) as {
    usuarios: { id: string; activo: boolean }[];
  };
  expect(conInactivos.find((u) => u.id === id)?.activo).toBe(false);
  const loginTrasDesactivar = await request.post("/api/auth/login", {
    data: { rut: RUT, pin: "1111", dispositivoId, dispositivoSecreto: secreto },
  });
  expect(loginTrasDesactivar.status()).toBe(401);

  // Reactivar: vuelve a entrar con el mismo PIN.
  const reactivar = await page.request.patch("/api/usuarios", { data: { id, activo: true } });
  expect(reactivar.ok()).toBeTruthy();
  const loginTrasReactivar = await request.post("/api/auth/login", {
    data: { rut: RUT, pin: "1111", dispositivoId, dispositivoSecreto: secreto },
  });
  expect(loginTrasReactivar.ok()).toBeTruthy();

  // Cambiar de rol.
  const cambiarRol = await page.request.patch("/api/usuarios", { data: { id, rol: "maestro" } });
  expect(cambiarRol.ok()).toBeTruthy();
  const detalleTrasRol = await page.request.get("/api/usuarios?detalle=1");
  const { usuarios: conRolNuevo } = (await detalleTrasRol.json()) as { usuarios: { id: string; rol: string }[] };
  expect(conRolNuevo.find((u) => u.id === id)?.rol).toBe("maestro");

  // Resetear el PIN: el viejo deja de servir, el nuevo entra de inmediato.
  const resetPin = await page.request.patch("/api/usuarios", { data: { id, pin: "2222" } });
  expect(resetPin.ok()).toBeTruthy();
  const loginPinViejo = await request.post("/api/auth/login", {
    data: { rut: RUT, pin: "1111", dispositivoId, dispositivoSecreto: secreto },
  });
  expect(loginPinViejo.status()).toBe(401);
  const loginPinNuevo = await request.post("/api/auth/login", {
    data: { rut: RUT, pin: "2222", dispositivoId, dispositivoSecreto: secreto },
  });
  expect(loginPinNuevo.ok()).toBeTruthy();

  // Validación de entrada del PATCH.
  const sinId = await page.request.patch("/api/usuarios", { data: { activo: true } });
  expect(sinId.status()).toBe(400);
  const sinNadaQueCambiar = await page.request.patch("/api/usuarios", { data: { id } });
  expect(sinNadaQueCambiar.status()).toBe(400);
  const idInexistente = await page.request.patch("/api/usuarios", {
    data: { id: crypto.randomUUID(), activo: true },
  });
  expect(idInexistente.status()).toBe(404);

  // El candado: el admin no puede quitarse su propio acceso (ni desactivarse ni bajar
  // de rol), o la panadería se queda sin nadie que pueda revertirlo.
  const autoDesactivar = await page.request.patch("/api/usuarios", {
    data: { id: datos.usuarios.admin!.id, activo: false },
  });
  expect(autoDesactivar.status()).toBe(400);
  const autoBajarRol = await page.request.patch("/api/usuarios", {
    data: { id: datos.usuarios.admin!.id, rol: "vendedor" },
  });
  expect(autoBajarRol.status()).toBe(400);
});

test("AC-ADM-01: un vendedor NO puede dar de alta ni editar personal — el servidor rebota 403", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.vendedor!.rut, datos.pin);

  const post = await page.request.post("/api/usuarios", {
    data: { nombre: "No debería crearse", rut: "88.888.888-8", rol: "vendedor", pin: "1234" },
  });
  expect(post.status()).toBe(403);

  const patch = await page.request.patch("/api/usuarios", {
    data: { id: crypto.randomUUID(), activo: false },
  });
  expect(patch.status()).toBe(403);
});
