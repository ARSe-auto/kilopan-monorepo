import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// P0-4 (auditoría 1-ago-2026 · campaña correctiva, Ola 0 · decisión del dueño
// 1-ago-2026: "por turno, con apertura explícita"): el cierre de caja calculaba lo
// esperado por (dispositivo, DÍA COMPLETO) pero la unicidad del cierre era por (fecha,
// medio_pago, VENDEDOR) — con dos turnos en la misma tablet el mismo día, a quien
// cierra después se le exige responder también por lo que vendió el turno anterior.
//
// Este test prueba exactamente eso: dos turnos seguidos en el MISMO dispositivo, cada
// uno con su propia venta, y verifica que el segundo cierre NO incluye la venta del
// primer turno — que es la aserción que con el código viejo (esperado por día
// completo) es FALSA.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
  productos: Record<string, string>;
};

async function teclear(page: Page, texto: string) {
  for (const caracter of texto) {
    await page.getByRole("button", { name: caracter, exact: true }).click();
  }
}

async function ingresar(page: Page, rol: keyof typeof datos.usuarios) {
  await page.addInitScript((d) => {
    window.localStorage.setItem("kp_dispositivo", JSON.stringify(d));
  }, datos.dispositivo);
  await page.goto("/ingresar");
  const campoRut = page.getByPlaceholder("12.345.678-5");
  await expect(async () => {
    await campoRut.fill(datos.usuarios[rol]!.rut);
    await expect(campoRut).toHaveValue(datos.usuarios[rol]!.rut, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await teclear(page, datos.pin);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).not.toHaveURL(/\/ingresar/, { timeout: 10_000 });
  await expect(page.getByRole("link").first()).toBeVisible();
}

async function abrirTurno(page: Page, fondoInicialClp = 5000) {
  const r = await page.request.post("/api/turnos", { data: { fondoInicialClp } });
  expect(r.ok()).toBeTruthy();
}

async function vender(page: Page, gramos: number) {
  const r = await page.request.post("/api/ventas", {
    data: {
      clientUuid: crypto.randomUUID(),
      medioPago: "efectivo",
      lineas: [{ productoId: datos.productos.Frica, gramos }],
    },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { id: string; totalClp: number };
}

async function cerrarCaja(page: Page, declaradoClp: number) {
  return page.request.post("/api/cierre-caja", {
    data: { declarados: [{ medioPago: "efectivo", declaradoClp }] },
  });
}

test.describe.configure({ mode: "serial" });

test("P0-4: el esperado del cierre no cruza turnos, y los controles de apertura/cierre", async ({
  page,
}) => {
  // Turno 1: vende $X y cierra. El esperado del turno 1 debe ser exactamente $X.
  await ingresar(page, "vendedor");
  await abrirTurno(page, 5000);
  const venta1 = await vender(page, 500);

  const cierre1 = await cerrarCaja(page, venta1.totalClp);
  expect(cierre1.ok()).toBeTruthy();
  const cuerpo1 = (await cierre1.json()) as {
    resultado: { medioPago: string; esperado: number }[];
  };
  expect(cuerpo1.resultado.find((r) => r.medioPago === "efectivo")?.esperado).toBe(venta1.totalClp);

  // Turno 2: mismo dispositivo, mismo día. Vende $Y (Y != X para que un cruce se note).
  await abrirTurno(page, 3000);
  const venta2 = await vender(page, 700);

  const cierre2 = await cerrarCaja(page, venta2.totalClp);
  expect(cierre2.ok()).toBeTruthy();
  const cuerpo2 = (await cierre2.json()) as {
    resultado: { medioPago: string; esperado: number }[];
  };
  // La aserción central: el esperado del turno 2 es SOLO su propia venta, no
  // venta1.totalClp + venta2.totalClp. Con el código viejo (esperado = todo el día en
  // este dispositivo) esto habría dado venta1.totalClp + venta2.totalClp.
  expect(cuerpo2.resultado.find((r) => r.medioPago === "efectivo")?.esperado).toBe(venta2.totalClp);

  // Controles, en la MISMA sesión — sin un segundo login: cada `ingresar()` de más en
  // el e2e completo es una oportunidad más para la carrera de cookie/RSC ya
  // documentada en docs/BITACORA.md ("por qué la cookie recién seteada no viaja en el
  // fetch RSC…"), y ninguno de los dos controles necesita una sesión distinta.
  await abrirTurno(page, 1000);
  const segundo = await page.request.post("/api/turnos", { data: { fondoInicialClp: 1000 } });
  expect(segundo.status()).toBe(409); // no se puede abrir un segundo turno con uno abierto
  await cerrarCaja(page, 0);

  const actual = await page.request.get("/api/turnos/actual");
  const { turno } = (await actual.json()) as { turno: unknown };
  expect(turno).toBeNull(); // el cierre de arriba lo dejó cerrado

  const r = await cerrarCaja(page, 0);
  expect(r.status()).toBe(409); // cerrar sin turno abierto rebota
});
