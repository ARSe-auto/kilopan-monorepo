import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-PERF-02: techo duro de 1,5 MB en el servidor (`api/fotos/route.ts`, MAX_BYTES =
// 1_500_000). El cliente comprime a ~400 KB, pero eso es una convención del cliente —
// la garantía real es del servidor, que tiene que rebotar a CUALQUIERA que le mande algo
// más pesado, venga de la app o de una petición HTTP directa. Anexo D (auditoría 2-ago-
// 2026): existía el código de los dos lados pero cero test subía una foto pesada
// esperando 413. Este spec pega contra `POST /api/fotos` con `page.request` (comparte la
// cookie de sesión — el fixture `request` pelado va sin sesión y da 401 antes de llegar
// al chequeo de tamaño).
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

test("AC-PERF-02: POST /api/fotos rebota 413 apenas se pasa de 1,5 MB, y acepta justo en el techo", async ({
  page,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.admin!.rut, datos.pin);

  // Un byte sobre el techo duro (1_500_000): el servidor tiene que rebotarla, sin
  // importar que el contenido no sea un JPEG real — la validación de tamaño va antes
  // que cualquier otra cosa.
  const pesada = await page.request.post("/api/fotos", {
    multipart: {
      foto: {
        name: "pesada.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.alloc(1_500_001, 1),
      },
    },
  });
  expect(pesada.status()).toBe(413);
  const cuerpo = (await pesada.json()) as { error: string };
  expect(cuerpo.error).toMatch(/pesada/i);

  // Exactamente en el techo (1_500_000 bytes): el AC dice «techo duro de 1,5 MB», no
  // «menos de 1,5 MB» — el límite mismo tiene que entrar.
  const enElTecho = await page.request.post("/api/fotos", {
    multipart: {
      foto: {
        name: "en-el-techo.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.alloc(1_500_000, 1),
      },
    },
  });
  expect(enElTecho.ok()).toBeTruthy();
  const subida = (await enElTecho.json()) as { bytes: number };
  expect(subida.bytes).toBe(1_500_000);
});
