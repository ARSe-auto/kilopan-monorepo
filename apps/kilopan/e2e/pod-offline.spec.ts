import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sembrarDispositivo } from "./sembrar-dispositivo.ts";
import { ingresar } from "./ingresar.ts";

// [AC-POD-07] `/ruta` sabe si está offline.
//
// El defecto que este caso fija, verificado en el código antes de escribirlo:
// `ruta/page.tsx` montaba `<ChipEstadoConexion pendientes={pendientes} />` SIN la prop
// `online`, y el componente tiene `online = true` por defecto. Con la cola vacía, /ruta
// mostraba «Sincronizado» en verde de forma permanente — con señal y sin señal. Peor,
// lo montaba sin condición, a diferencia de /pesar y /vender que solo lo muestran si hay
// algo que decir: el único verde mentiroso de la app estaba en la única pantalla que se
// usa lejos del local.
//
// POR QUÉ SE PIERDE LA SEÑAL CON LA PANTALLA YA ABIERTA, y no navegando sin red: el
// service worker (`public/sw.js:84-100`) responde `caches.match("/ingresar")` a toda
// página autenticada pedida sin conexión, así que navegar offline aterriza en el login y
// nunca en /ruta. Un caso escrito así pasaría en verde sin haber ejercido nada. Además el
// escenario real del repartidor es exactamente este: sale con la ruta cargada y pierde
// cobertura en el camino.
const datos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "datos-semilla.json"), "utf8")
) as {
  dispositivo: { id: string; secreto: string; nombre: string };
  pin: string;
  usuarios: Record<string, { rut: string; id: string }>;
};

// IP propia, como cada spec: sin esto todos comparten el cupo del limitador de intentos
// (20/min, AC-SEC-02) y el síntoma es «se queda pegado en /ingresar» por un 429, no por
// una carrera real.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.80" } });

test("el repartidor que pierde señal en la calle lo ve en pantalla [AC-POD-07]", async ({
  page,
  context,
}) => {
  await sembrarDispositivo(page, datos.dispositivo);
  await ingresar(page, datos.usuarios.repartidor!.rut, datos.pin);

  // El repartidor entra DIRECTO a su única pantalla.
  await expect(page).toHaveURL(/\/ruta$/);
  await expect(page.getByRole("heading", { name: "Mi ruta" })).toBeVisible();

  // Con señal y sin cola, el chip dice que está sincronizado. Esto es lo que la pantalla
  // decía ANTES del arreglo también — por eso solo no alcanza como evidencia, y por eso
  // el caso sigue.
  const chip = page.getByText(/Sincronizado|Sin conexión|Subiendo/);
  await expect(chip).toHaveText(/Sincronizado/, { timeout: 15_000 });

  // Se corta la señal con la ruta ya cargada: el furgón entró en la zona sin cobertura.
  await context.setOffline(true);

  // ESTA es la aserción que mata al mutante: sin `online={enLinea}` en ruta/page.tsx, el
  // chip se queda en «Sincronizado» para siempre y esto se pone rojo.
  await expect(chip).toHaveText(/Sin conexión/, { timeout: 15_000 });

  // Y vuelve la señal: el chip tiene que volver, no quedarse pegado en rojo — un estado
  // que solo sabe empeorar es otra forma de mentir.
  await context.setOffline(false);
  await expect(chip).toHaveText(/Sincronizado/, { timeout: 15_000 });
});
