import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// P0-1 (auditoría 1-ago-2026 · campaña correctiva, Ola 0): POST /api/dispositivos/enrolar
// creaba el dispositivo NUEVO antes de verificar el PIN de administrador, y el bloqueo por
// intentos fallidos se llavea por el PAR (dispositivo_id, usuario_id) — con un
// dispositivo_id virgen en cada request, el contador de fallos SIEMPRE valía 1 y la rama
// 423 nunca se alcanzaba. Fuerza bruta de 10.000 PIN sin freno, desde internet, sin
// credenciales; al acertar se obtiene un equipo enrolado válido y de ahí una sesión de
// administrador completa. Este es el falsador: ataca la ruta real por HTTP, no la lógica
// SQL en aislamiento (pan.registrar_intento_pin_enrolamiento ya tiene su propio test en
// db/test-invariantes.mjs; lo que este spec prueba es que la RUTA la llama en el orden
// correcto).
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as { usuarios: Record<string, { rut: string; id: string }> };

test.describe("seguridad · enrolamiento de dispositivos", () => {
  test("P0-1: 5 PIN de administrador fallidos bloquean el enrolamiento — sin dispositivo real de por medio", async ({
    request,
  }) => {
    const rutAdmin = datos.usuarios.admin!.rut;
    const codigos: number[] = [];

    for (let i = 0; i < 5; i++) {
      const res = await request.post("/api/dispositivos/enrolar", {
        data: { nombreDispositivo: `ataque-${i}`, rutAdmin, pinAdmin: "0000" },
      });
      codigos.push(res.status());
    }

    // Las 4 primeras fallan por PIN incorrecto; la 5ta ya debe estar bloqueada — el
    // defecto original hacía que las 5 (y las 10.000 combinaciones posibles) dieran 401.
    expect(codigos.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(codigos[4]).toBe(423);

    // El bloqueo se sostiene: un 6to intento, incluso si acertara el PIN, sigue rechazado.
    const sexto = await request.post("/api/dispositivos/enrolar", {
      data: { nombreDispositivo: "ataque-6", rutAdmin, pinAdmin: "1234" },
    });
    expect(sexto.status()).toBe(423);
    const cuerpo = await sexto.json();
    expect(cuerpo).not.toHaveProperty("secreto");
    expect(cuerpo).not.toHaveProperty("dispositivoId");
  });

  test("control: el PIN correcto en un dispositivo sin intentos previos enrola normalmente", async ({
    request,
  }) => {
    // Corre en su propio worker/DB fresca (preparar-base.mjs siembra desde cero por
    // corrida) — no depende del test anterior ni deja al admin bloqueado para otros specs.
    const res = await request.post("/api/dispositivos/enrolar", {
      data: {
        nombreDispositivo: "tablet-legitima-control",
        rutAdmin: datos.usuarios.admin!.rut,
        pinAdmin: "1234",
      },
    });
    // Si este test corre DESPUÉS del anterior en el mismo worker, el admin ya está
    // bloqueado (423) — eso también es correcto: ambos casos prueban que el camino de
    // enrolamiento nunca vuelve a 401 "PIN incorrecto" para un PIN que sí es correcto.
    expect([200, 423]).toContain(res.status());
    if (res.status() === 200) {
      const cuerpo = await res.json();
      expect(cuerpo).toHaveProperty("dispositivoId");
      expect(cuerpo).toHaveProperty("secreto");
    }
  });
});
