import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componente } from "../estructura.ts";

// Mismo override que `cifras.test.ts` y `estructura.test.ts`: sin él, este archivo leía
// una ruta FIJA y quedaba fuera del ejercicio de mutantes — un mutante sobre el árbol de
// juguete lo dejaba pasar en verde, que es justo lo que el arnés existe para detectar.
const DIR = process.env.MIGA_COMPONENTES_DIR ?? dirname(fileURLToPath(import.meta.url));
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

test("el botón de reintentar respeta el mínimo táctil de la familia canónica [AC-H0-11]", () => {
  // §5: el maestro toca con las manos enharinadas. Un botón bajo el mínimo es un botón que
  // no se acierta, y un reintento que no se acierta es lo mismo que no tenerlo.
  //
  // Desde AC-FMIG-01 el componente NO escribe el número: lo lee de `componente.objetivoTactil`,
  // que lo toma de `TACTIL.operativo_min`. Así que se aserta lo que de verdad protege el AC —
  // que el alto salga del token y que el token siga por encima del piso WCAG—, y no la
  // presencia de un literal que hoy sería, él mismo, una duplicación de la familia §0.
  assert.match(
    codigo,
    /minHeight:\s*componente\.objetivoTactil\.altoMinPx/,
    "el botón de reintentar no toma su alto del token táctil — un valor a mano se desincroniza"
  );
  assert.ok(
    componente.objetivoTactil.altoMinPx >= componente.objetivoTactil.pisoAbsolutoPx,
    "el objetivo táctil operativo quedó por debajo del piso WCAG"
  );
});

test("los tres estados se exportan desde el barril de miga [AC-H0-11]", () => {
  const barril = readFileSync(join(DIR, "index.tsx"), "utf8");
  for (const c of ["EstadoCargando", "EstadoVacio", "EstadoError"]) {
    assert.match(barril, new RegExp(c), `${c} no se exporta: ninguna pantalla puede usarlo`);
  }
});

// AC-FMIG-10 (§5.7): «skeleton <50 ms, spinner solo >400 ms» tenía UNA implementación real
// —a mano, adentro de la pantalla de POD (AC-FPOD-22)— y cero en `miga`. Estos casos
// protegen que la escalada exista como componente ÚNICO reusable, no que una segunda
// pantalla la reinvente con su propio `setTimeout`.

test("la escalada de carga se exporta desde el barril de miga [AC-FMIG-10]", () => {
  const barril = readFileSync(join(DIR, "index.tsx"), "utf8");
  assert.match(barril, /useEscaladaDeCarga/, "useEscaladaDeCarga no se exporta: ninguna pantalla puede usarlo");
});

test("la escalada espera 400 ms por defecto y jamás antes — el spinner temprano es el defecto que el AC cierra [AC-FMIG-10]", () => {
  assert.match(
    codigo,
    /useEscaladaDeCarga\([^)]*umbralMs\s*=\s*400/,
    "el umbral por defecto de la escalada no es 400 ms",
  );
  assert.match(
    codigo,
    /setTimeout\(\(\)\s*=>\s*setDemorado\(true\),\s*umbralMs\)/,
    "la escalada no arma un temporizador contra el umbral — podría disparar antes de tiempo",
  );
});

test("EstadoCargando sin avisoDemora se comporta igual que antes de AC-FMIG-10 — cero ruptura para las pantallas que no lo usan", () => {
  assert.match(
    codigo,
    /avisoDemora\s*!==\s*undefined/,
    "el aviso de demora no es opcional: una pantalla que no lo pasa no puede quedar exactamente como estaba",
  );
});

test("el aviso de demora tiene un testid estable — sin él, cada pantalla que lo necesite tendría que envolverlo a mano [AC-FMIG-10]", () => {
  assert.match(codigo, /data-testid="aviso-demora-carga"/, "el aviso de demora no tiene testid propio");
});
