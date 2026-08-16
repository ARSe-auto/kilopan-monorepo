// Mutantes del manifiesto de rutas [AC-FTEN-26].
//
// Las reglas de este archivo van a estar años sin disparar, porque el código que las viola
// FUNCIONA: una ruta que entra sin caso de cruce anda perfecto hasta el día que sirve el
// dato de otro tenant. Así que cada una se ejerce contra el caso que atrapa Y contra un
// positivo que impide que sea un no-op al revés — mismo estándar que el linter de
// migraciones (AC-FTEN-06), donde un patrón demasiado angosto se veía igual que uno bueno.
//
// El árbol de laboratorio se arma en disco de verdad, no con un mock del sistema de
// archivos: lo que se está probando es precisamente leer el árbol que Next lee.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inventariar,
  verbosDe,
  componer,
  serializar,
  leerExenciones,
  auditar,
  emitirCasos,
  LARGO_MINIMO_JUSTIFICACION,
} from "./manifiesto.mjs";

const JUSTIFICACION = "no se puede montar el cruce porque el proveedor externo no admite dos cuentas de prueba";

/** Arma un árbol `src/app/**` de laboratorio. `archivos` es {ruta relativa: contenido}. */
function arbol(archivos) {
  const base = mkdtempSync(join(tmpdir(), "flota-rutas-"));
  for (const [rel, contenido] of Object.entries(archivos)) {
    const destino = join(base, "src", "app", rel);
    mkdirSync(join(destino, ".."), { recursive: true });
    writeFileSync(destino, contenido);
  }
  return {
    base,
    inventario: () => inventariar(join(base, "src", "app"), base),
    borrar: () => rmSync(base, { recursive: true, force: true }),
  };
}

const CRUCE_SIMPLE = { tipo: "sin_recurso", nota: "ruta sin identificador de recurso" };
const conCruce = (m, ruta, cruce) => ({
  ...m,
  rutas: m.rutas.map((r) => (r.ruta === ruta ? { ...r, cruce } : r)),
});

// ─── El inventario: lo que la app SIRVE, no lo que hay en el directorio ────────────────

test("page.tsx y route.ts con sus verbos, ordenados [AC-FTEN-26]", () => {
  const a = arbol({
    "page.tsx": "export default function P() { return null }",
    "api/tenant/route.ts": "export async function GET() {}\nexport async function POST() {}",
  });
  try {
    assert.deepEqual(a.inventario(), [
      { ruta: "/", archivo: "src/app/page.tsx", metodos: ["GET"], params: [] },
      { ruta: "/api/tenant", archivo: "src/app/api/tenant/route.ts", metodos: ["GET", "POST"], params: [] },
    ]);
  } finally {
    a.borrar();
  }
});

test("las dos formas de exportar un handler de Next cuentan [AC-FTEN-26]", () => {
  // `export const GET = handler` es tan handler como la declaración de función. Reconocer
  // solo una de las dos dejaría rutas invisibles para el manifiesto — y una ruta invisible
  // es exactamente el agujero que las pruebas de ausencia de los módulos 06 y 07 no verían.
  assert.deepEqual(verbosDe("export async function DELETE() {}"), ["DELETE"]);
  assert.deepEqual(verbosDe("export const PATCH = manejar"), ["PATCH"]);
  // Y no cuenta lo que solo se MENCIONA: un comentario o una llamada no es un handler.
  assert.deepEqual(verbosDe("// export async function POST() {}\nfetch(url, { method: 'POST' })"), []);
});

test("grupos, privados y slots no son segmentos de URL [AC-FTEN-26]", () => {
  const a = arbol({
    "(panel)/vehiculos/page.tsx": "export default function P() { return null }",
    "_interno/page.tsx": "export default function P() { return null }",
    "@modal/page.tsx": "export default function P() { return null }",
  });
  try {
    // `(panel)` sale de la URL; `_interno` y `@modal` no se sirven y no entran al manifiesto.
    assert.deepEqual(a.inventario().map((r) => r.ruta), ["/vehiculos"]);
  } finally {
    a.borrar();
  }
});

test("los segmentos dinámicos quedan declarados como parámetros [AC-FTEN-26]", () => {
  const a = arbol({
    "vehiculos/[id]/page.tsx": "export default function P() { return null }",
    "archivos/[...resto]/route.ts": "export async function GET() {}",
  });
  try {
    const inv = a.inventario();
    assert.deepEqual(inv[0], {
      ruta: "/archivos/[...resto]",
      archivo: "src/app/archivos/[...resto]/route.ts",
      metodos: ["GET"],
      params: ["resto"],
    });
    assert.deepEqual(inv[1].params, ["id"]);
  } finally {
    a.borrar();
  }
});

// ─── Los cuatro rebotes que exige el AC ───────────────────────────────────────────────

test("ruta nueva sin caso de cruce ni exención escrita ⇒ ROJO [AC-FTEN-26]", () => {
  // EL rebote del AC: alguien agrega una ruta y la suite A-contra-B no la cubre. El
  // manifiesto la inventaria sola (viene del árbol), pero entra sin declarar y frena el gate.
  const a = arbol({ "api/nueva/route.ts": "export async function GET() {}" });
  try {
    const m = componer(a.inventario(), null);
    const problemas = auditar(m, []);
    assert.equal(problemas.length, 1);
    assert.match(problemas[0], /\/api\/nueva/);
    assert.match(problemas[0], /exenciones\.md/);
    // Y el positivo: declarado el cruce, el mismo árbol pasa. Sin esto, una auditoría que
    // rechazara todo se vería idéntica a esta.
    assert.deepEqual(auditar(conCruce(m, "/api/nueva", CRUCE_SIMPLE), []), []);
  } finally {
    a.borrar();
  }
});

test("exención sin justificación escrita ⇒ ROJO; con justificación ⇒ verde y CONTADA [AC-FTEN-26]", () => {
  const a = arbol({ "api/nueva/route.ts": "export async function GET() {}" });
  try {
    const m = componer(a.inventario(), null);
    const corta = [{ ruta: "/api/nueva", justificacion: "por ahora no" }];
    const problemas = auditar(m, corta);
    assert.equal(problemas.length, 1);
    assert.match(problemas[0], /no está justificada por escrito/);
    assert.ok(corta[0].justificacion.length < LARGO_MINIMO_JUSTIFICACION);

    const escrita = [{ ruta: "/api/nueva", justificacion: JUSTIFICACION }];
    assert.deepEqual(auditar(m, escrita), []);
    // Exenta = fuera de la suite. Que el contador exista es lo que hace que se note.
    assert.deepEqual(emitirCasos(m, escrita), []);
  } finally {
    a.borrar();
  }
});

test("exención de una ruta que no existe ⇒ ROJO (exención muerta) [AC-FTEN-26]", () => {
  const a = arbol({ "api/nueva/route.ts": "export async function GET() {}" });
  try {
    const m = conCruce(componer(a.inventario(), null), "/api/nueva", CRUCE_SIMPLE);
    const problemas = auditar(m, [{ ruta: "/api/vieja", justificacion: JUSTIFICACION }]);
    assert.equal(problemas.length, 1);
    assert.match(problemas[0], /no es una ruta de la app/);
  } finally {
    a.borrar();
  }
});

test("exenta Y con cruce declarado ⇒ ROJO: el caso declarado no correría nunca [AC-FTEN-26]", () => {
  const a = arbol({ "api/nueva/route.ts": "export async function GET() {}" });
  try {
    const m = conCruce(componer(a.inventario(), null), "/api/nueva", CRUCE_SIMPLE);
    const problemas = auditar(m, [{ ruta: "/api/nueva", justificacion: JUSTIFICACION }]);
    assert.equal(problemas.length, 1);
    assert.match(problemas[0], /una de las dos sobra/);
  } finally {
    a.borrar();
  }
});

test("un cruce mal declarado no pasa por declarado [AC-FTEN-26]", () => {
  const a = arbol({
    "api/nueva/route.ts": "export async function GET() {}",
    "vehiculos/[id]/page.tsx": "export default function P() { return null }",
  });
  try {
    const m = componer(a.inventario(), null);
    // Tipo inventado.
    assert.match(auditar(conCruce(m, "/api/nueva", { tipo: "magia" }), [])[0], /tipo desconocido/);
    // `recurso` sin decir de qué tabla de la BD de B sale el identificador.
    assert.match(
      auditar(conCruce(m, "/api/nueva", { tipo: "recurso" }), [])[0],
      /ids_de_b/,
    );
    // Una ruta CON parámetro declarada «sin recurso»: es la vía elegante de saltarse el
    // 404-jamás-403, porque `sin_recurso` no lo exige. Se rebota.
    const conParam = conCruce(
      conCruce(m, "/api/nueva", CRUCE_SIMPLE),
      "/vehiculos/[id]",
      CRUCE_SIMPLE,
    );
    assert.match(auditar(conParam, [])[0], /una ruta que recibe un identificador/);
    // Positivo: bien declarada, pasa.
    const bien = conCruce(conCruce(m, "/api/nueva", CRUCE_SIMPLE), "/vehiculos/[id]", {
      tipo: "recurso",
      ids_de_b: { tabla: "vehiculos", columna: "id" },
    });
    assert.deepEqual(auditar(bien, []), []);
  } finally {
    a.borrar();
  }
});

test("un route.ts que no exporta ningún verbo se DICE, no desaparece [AC-FTEN-26]", () => {
  const a = arbol({ "api/muda/route.ts": "export const runtime = 'nodejs'" });
  try {
    const m = conCruce(componer(a.inventario(), null), "/api/muda", CRUCE_SIMPLE);
    assert.match(auditar(m, [])[0], /no exporta ningún verbo/);
  } finally {
    a.borrar();
  }
});

// ─── La derivación: lo declarado se preserva, lo que cambió se vuelve a declarar ──────

test("regenerar PRESERVA el cruce declarado a mano [AC-FTEN-26]", () => {
  // Si no lo preservara, el generador sería un borrador: cada regeneración borraría el
  // trabajo humano y la salida honesta sería no regenerar nunca.
  const a = arbol({ "api/nueva/route.ts": "export async function GET() {}" });
  try {
    const primero = conCruce(componer(a.inventario(), null), "/api/nueva", CRUCE_SIMPLE);
    const segundo = componer(a.inventario(), primero);
    assert.deepEqual(segundo.rutas[0].cruce, CRUCE_SIMPLE);
    assert.equal(serializar(segundo), serializar(primero));
  } finally {
    a.borrar();
  }
});

test("una ruta que gana un verbo pierde su cruce y hay que redeclararlo [AC-FTEN-26]", () => {
  // Un GET declarado no dice nada de un POST: en las mutaciones el AC pide además que la BD
  // de B quede intacta, y eso nadie lo declaró. Arrastrar el cruce viejo dejaría el verbo
  // nuevo cubierto en el papel y sin probar en los hechos.
  const a = arbol({ "api/nueva/route.ts": "export async function GET() {}" });
  try {
    const antes = conCruce(componer(a.inventario(), null), "/api/nueva", CRUCE_SIMPLE);
    writeFileSync(
      join(a.base, "src", "app", "api", "nueva", "route.ts"),
      "export async function GET() {}\nexport async function POST() {}",
    );
    const despues = componer(a.inventario(), antes);
    assert.equal(despues.rutas[0].cruce, null);
    assert.match(auditar(despues, [])[0], /no tiene caso de cruce/);
  } finally {
    a.borrar();
  }
});

// ─── Los casos emitidos ───────────────────────────────────────────────────────────────

test("un caso por ruta y por método, y la mutación la dicta el VERBO [AC-FTEN-26]", () => {
  const a = arbol({
    "api/nueva/route.ts": "export async function GET() {}\nexport async function POST() {}",
  });
  try {
    // Declarado `muta: false` a propósito: un POST escribe igual, y creerle a la
    // declaración dejaría la mitad «la BD de B sin cambios» sin verificar justo donde importa.
    const m = conCruce(componer(a.inventario(), null), "/api/nueva", { ...CRUCE_SIMPLE, muta: false });
    const casos = emitirCasos(m, []);
    assert.deepEqual(
      casos.map((c) => [c.ruta, c.metodo, c.muta]),
      [
        ["/api/nueva", "GET", false],
        ["/api/nueva", "POST", true],
      ],
    );
  } finally {
    a.borrar();
  }
});

// ─── El archivo de exenciones de verdad ───────────────────────────────────────────────

test("el ejemplo del formato NO cuenta como exención [AC-FTEN-26]", () => {
  // `exenciones.md` documenta su propio formato, y un ejemplo bien escrito es idéntico a una
  // exención real: leer el archivo entero convertía «explicar cómo se exime una ruta» en
  // «eximir una ruta», encima inexistente. Solo cuenta lo que está bajo el encabezado.
  const texto = readFileSync(join(import.meta.dirname, "exenciones.md"), "utf8");
  assert.match(texto, /- `\/api\/lo-que-sea` —/, "el ejemplo del formato sigue en el archivo");
  assert.deepEqual(leerExenciones(texto), []);
});

test("una exención escrita bajo el encabezado SÍ cuenta [AC-FTEN-26]", () => {
  // El positivo del anterior: si el parser no leyera nada, el test de arriba pasaría igual
  // y el archivo entero sería decorativo.
  const texto = [
    "# Exenciones",
    "- `/api/ejemplo` — esto está antes del encabezado y no cuenta.",
    "",
    "## Exenciones vigentes",
    "",
    "- `/api/proveedor` — " + JUSTIFICACION,
    "",
    "## Otra sección",
    "- `/api/no` — esto ya no es parte del registro.",
  ].join("\n");
  assert.deepEqual(leerExenciones(texto), [{ ruta: "/api/proveedor", justificacion: JUSTIFICACION }]);
});
