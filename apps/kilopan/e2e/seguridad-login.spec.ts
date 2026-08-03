import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// AC-ID-03 (Anexo D, auditoría 2-ago-2026): el 423 de POST /api/auth/login estaba
// "probado en vivo" solo de palabra — manual, no en el gate. El bloqueo por PIN en BD
// (pan.registrar_intento_pin) ya tiene su test a nivel SQL (AC-SEC-01), y el enrolamiento
// tiene el suyo (seguridad-enrolamiento.spec.ts), pero nadie golpeaba la RUTA de login por
// HTTP para confirmar que llama a esa función en el orden correcto y que el 423 sale de
// verdad. Este spec es ese falsador: ataca /api/auth/login, no la función SQL aislada.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

// IP propia: comparte el limitador por IP (20/min, AC-SEC-02) con el resto del e2e — sin
// esta cabecera, el barrido de 6 intentos de este archivo compite por el mismo cupo que
// camino-dorado.spec.ts y demás (ver el mismo patrón en seguridad-enrolamiento.spec.ts).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.70" } });

test.describe("seguridad · login", () => {
  test("P0: PIN correcto entra, incorrecto rebota con 401, el 5º fallido bloquea con 423 y el PIN correcto ya no sirve hasta que expire", async ({
    request,
  }) => {
    // `repartidor` no lo toca ningún otro spec de login: el contador de fallos de
    // pan.registrar_intento_pin es por (dispositivo_id, usuario_id), así que compartir
    // usuario con otro archivo del mismo run de e2e (misma base pglite para todo el
    // run) contaminaría el conteo y el 5º intento de este test podría no ser el que en
    // verdad cruza el umbral.
    const rut = datos.usuarios.repartidor!.rut;
    const intento = (pin: string) =>
      request.post("/api/auth/login", {
        data: {
          rut,
          pin,
          dispositivoId: datos.dispositivo.id,
          dispositivoSecreto: datos.dispositivo.secreto,
        },
      });

    const codigos: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await intento("0000"); // pin real de la semilla es "1234"
      codigos.push(res.status());
    }
    expect(codigos).toEqual([401, 401, 401, 401]);

    const quinto = await intento("0000");
    expect(quinto.status()).toBe(423);
    const cuerpoQuinto = await quinto.json();
    expect(cuerpoQuinto.error ?? "").toMatch(/bloqueado/i);

    // El bloqueo se sostiene incluso con el PIN correcto: no vuelve a 401 (incorrecto) ni
    // a 200 (entra), sigue en 423 hasta que expire.
    const sexto = await intento(datos.pin);
    expect(sexto.status()).toBe(423);
    const cuerpoSexto = await sexto.json();
    expect(cuerpoSexto).not.toHaveProperty("usuario");
    expect(sexto.headers()["set-cookie"]).toBeUndefined();
  });

  test("control: el PIN correcto sin intentos previos entra con 200 y deja cookie de sesión", async ({
    request,
  }) => {
    // `maestro` no participa del ataque de arriba (usa `repartidor`), así que este login
    // llega limpio sin importar el orden de ejecución entre los dos tests.
    const res = await request.post("/api/auth/login", {
      data: {
        rut: datos.usuarios.maestro!.rut,
        pin: datos.pin,
        dispositivoId: datos.dispositivo.id,
        dispositivoSecreto: datos.dispositivo.secreto,
      },
    });
    expect(res.status()).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.usuario?.id).toBe(datos.usuarios.maestro!.id);
    expect(res.headers()["set-cookie"] ?? "").toMatch(/kp_sesion=/);
  });
});
