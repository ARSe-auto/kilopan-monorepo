import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// AC-ID-07 (specs/kilopan/01-identidad.md, Fuente: §5 F5): chip con el nombre del
// operador SIEMPRE visible en cada pantalla. El Anexo D (auditoría 2-ago-2026) marcó
// HUECO: el componente (`ChipOperador.tsx`, renderizado por `Pantalla.tsx`) existía,
// pero el test descrito en el propio AC —"recorrer las rutas de operación con sesión
// abierta y fallar si alguna no muestra el nombre"— nunca se escribió.
//
// Este test recorre, para CADA rol, TODAS las pantallas a las que ese rol tiene acceso
// (la lista exacta de `DESTINOS_POR_ROL` en src/app/navegacion.ts) más «Hoy» (/inicio) y
// «Más» (/mas), que son comunes a los cuatro. El chip se ubica por su atributo `title`
// (ChipOperador.tsx lo fija al nombre completo) para no confundirlo con el nombre que
// también aparece como texto suelto en «Hoy» (bajada) y en «Más» (sección «Tu cuenta»).
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.90" } });

async function esperarChip(page: import("@playwright/test").Page, nombre: string, ruta: string) {
  await page.goto(ruta);
  await expect(page.locator(`[title="${nombre}"]`), `chip en ${ruta}`).toBeVisible({ timeout: 5000 });
}

test.describe("identidad · chip del operador visible en toda pantalla de su rol (AC-ID-07)", () => {
  test("maestro (Pedro Maestro): /pesar, /historial, /pendientes, /inicio, /mas", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.maestro!.rut, datos.pin);
    for (const ruta of ["/pesar", "/historial", "/pendientes", "/inicio", "/mas"]) {
      await esperarChip(page, "Pedro Maestro", ruta);
    }
  });

  test("repartidor (Luis Repartidor): /ruta, /pendientes, /inicio, /mas", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.repartidor!.rut, datos.pin);
    for (const ruta of ["/ruta", "/pendientes", "/inicio", "/mas"]) {
      await esperarChip(page, "Luis Repartidor", ruta);
    }
  });

  test("vendedor (Sofía Vendedora): /vender, /caja, /pendientes, /inicio, /mas", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.vendedor!.rut, datos.pin);
    for (const ruta of ["/vender", "/caja", "/pendientes", "/inicio", "/mas"]) {
      await esperarChip(page, "Sofía Vendedora", ruta);
    }
  });

  test("admin (Ana Dueña): las diez pantallas de su rol, más /inicio y /mas", async ({ page }) => {
    await sembrarDispositivo(page, datos.dispositivo);
    await ingresar(page, datos.usuarios.admin!.rut, datos.pin);
    const rutas = [
      "/pesar",
      "/historial",
      "/vender",
      "/pedidos",
      "/caja",
      "/facturar",
      "/dashboard",
      "/admin",
      "/arreglar",
      "/pendientes",
      "/inicio",
      "/mas",
    ];
    for (const ruta of rutas) {
      await esperarChip(page, "Ana Dueña", ruta);
    }
  });
});
