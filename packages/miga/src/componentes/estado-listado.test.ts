import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const fuente = readFileSync(join(DIR, "EstadoListado.tsx"), "utf8");
const codigo = fuente.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// AC-H0-11. Lo que estos casos protegen es la DIFERENCIA entre los cuatro estados: si un
// error se ve igual que un vacío, el repartidor cuya ruta no carga se va a la casa creyendo
// que no hay reparto. Ese es el daño que el maestro nombra y el que el AC existe para
// cerrar — no la estética de tres cajas.

test("el error trae su botón de reintentar — sin él es una noticia sin salida [AC-H0-11]", () => {
  assert.match(codigo, /alReintentar/, "EstadoError no recibe una acción de reintento");
  assert.match(codigo, /Reintentar/, "el botón de reintentar no tiene texto visible");
});

test("el error se anuncia como alerta y el vacío como estado — no son lo mismo [AC-H0-11]", () => {
  // La distinción no es cosmética: `role="alert"` interrumpe al lector de pantalla, y un
  // listado vacío no debe interrumpir a nadie. Si los dos usaran el mismo rol, el operador
  // que no ve la pantalla no podría distinguir «no hay nada» de «falló».
  assert.match(codigo, /role="alert"/, "el error no se anuncia como alerta");
  assert.match(codigo, /role="status"/, "el vacío/cargando no se anuncia como estado");
});

test("el cargando es un skeleton, no un texto — ocupa el lugar de lo que viene [AC-H0-11]", () => {
  assert.match(codigo, /EstadoCargando/);
  // Un `Cargando…` en texto salta cuando llega el dato y se confunde con un vacío de un
  // vistazo. El skeleton reserva el alto y se distingue sin leer.
  assert.match(codigo, /height:\s*56/, "el skeleton no reserva alto: la pantalla saltaría al llegar el dato");
  assert.doesNotMatch(codigo, />\s*Cargando…?\s*</, "el estado de carga es un texto, no un skeleton");
});

test("el vacío es ACCIONABLE: acepta una acción, no solo un mensaje [AC-H0-11]", () => {
  assert.match(codigo, /accion/, "EstadoVacio no acepta una acción — un vacío sin salida deja al operador atascado");
});

test("el botón de reintentar respeta el mínimo táctil de 48 px [AC-H0-11]", () => {
  // §5: el maestro toca con las manos enharinadas. Un botón de 32 px es un botón que no se
  // acierta, y un reintento que no se acierta es lo mismo que no tenerlo.
  assert.match(codigo, /minHeight:\s*48/, "el botón de reintentar queda bajo el mínimo táctil");
});

test("los tres estados se exportan desde el barril de miga [AC-H0-11]", () => {
  const barril = readFileSync(join(DIR, "index.tsx"), "utf8");
  for (const c of ["EstadoCargando", "EstadoVacio", "EstadoError"]) {
    assert.match(barril, new RegExp(c), `${c} no se exporta: ninguna pantalla puede usarlo`);
  }
});
