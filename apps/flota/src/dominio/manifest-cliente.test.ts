import test from "node:test";
import assert from "node:assert/strict";
import { MODULOS_PORTAL_CLIENTE } from "./manifest-cliente.ts";

// Manifest del portal del contratante [AC-FPOR-07] — spec 07 §2: «cuatro pantallas, lista
// cerrada».

test("son EXACTAMENTE 4 pantallas, ni una de más ni de menos", () => {
  assert.equal(MODULOS_PORTAL_CLIENTE.length, 4);
});

test("las claves son las del §3.E1.10, en su orden: Hoy · Encargos · Nuevo/CSV · Liquidación", () => {
  assert.deepEqual(
    MODULOS_PORTAL_CLIENTE.map((m) => m.clave),
    ["hoy", "encargos", "nuevo", "liquidacion"],
  );
});

test("todas las rutas viven bajo el namespace /cliente/*", () => {
  for (const m of MODULOS_PORTAL_CLIENTE) {
    assert.ok(
      m.ruta === "/cliente" || m.ruta.startsWith("/cliente/"),
      `«${m.ruta}» (módulo ${m.clave}) no vive bajo /cliente/*`,
    );
  }
});

test("ninguna clave ni ruta del operador se cuela acá (mismo criterio que el manifest del operador)", () => {
  const OPERADOR = ["turno", "rutas", "tarifas", "liquidacion_por_cliente", "portal_contratante", "facturacion"];
  for (const clave of OPERADOR) {
    assert.ok(
      !MODULOS_PORTAL_CLIENTE.some((m) => m.clave === clave),
      `«${clave}» es del manifest del operador, no del portal`,
    );
  }
});

// El contratante jamás ve el mapa de flota [AC-FTEL-05, §4.3]: la torre de control
// (`/torre-de-control`, AC-FTEL-04) no es una de las cuatro pantallas del §3.E1.10 y no lo
// puede llegar a ser sin que este test se ponga rojo primero. No es redundante con «EXACTAMENTE
// 4 pantallas»: esa cuenta detecta un quinto módulo cualquiera, esta nombra CUÁL módulo no
// puede ser ninguno de los cuatro — la ruta del mapa, con cualquier clave que alguien le ponga.
test("[AC-FTEL-05] el mapa de flota (torre de control) no está en el manifest del portal", () => {
  for (const m of MODULOS_PORTAL_CLIENTE) {
    assert.notEqual(m.ruta, "/torre-de-control", `«${m.clave}» expone la ruta del mapa de flota`);
    assert.doesNotMatch(
      m.ruta,
      /torre-de-control/,
      `«${m.clave}» (${m.ruta}) apunta al mapa de flota del gestor`,
    );
  }
});
