import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registrarEvento } from "./evento.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const API = join(AQUI, "..", "app", "api");

// ── 1. El helper escribe lo que dice escribir ────────────────────────────────────────
test("registrarEvento inserta tipo, entidad, id, payload y QUIÉN lo hizo [AC-ADM-10]", async () => {
  const llamadas: { texto: string; valores: unknown[] }[] = [];
  const tx = { query: async (texto: string, valores?: unknown[]) => { llamadas.push({ texto, valores: valores ?? [] }); return {}; } };

  await registrarEvento(tx, "venta_registrada", "ventas", "id-1", { totalClp: 5475 }, {
    usuarioId: "u-1",
    dispositivoId: "d-1",
  });

  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0]!.texto, /insert into pan\.eventos/);
  // El orden importa: un payload en la posición del usuario deja la auditoría diciendo
  // que la venta la hizo un JSON. Se comprueban los seis valores, no solo que haya seis.
  assert.deepEqual(llamadas[0]!.valores, [
    "venta_registrada",
    "ventas",
    "id-1",
    JSON.stringify({ totalClp: 5475 }),
    "u-1",
    "d-1",
  ]);
});

test("el payload viaja serializado, no como objeto suelto [AC-ADM-10]", async () => {
  let capturado: unknown[] = [];
  const tx = { query: async (_t: string, v?: unknown[]) => { capturado = v ?? []; return {}; } };
  await registrarEvento(tx, "merma_registrada", "pesajes", "p-9", { gramos: 1200 }, { usuarioId: "u", dispositivoId: "d" });
  assert.equal(typeof capturado[3], "string");
  assert.deepEqual(JSON.parse(capturado[3] as string), { gramos: 1200 });
});

// ── 2. Cada operación de plata escribe SU evento ─────────────────────────────────────
// Lista enumerada con su cierre de completitud, mismo patrón que AC-H0-03: sin el cierre,
// agregar un `TipoEvento` nuevo y no cablearlo en ninguna ruta pasaría en silencio, que es
// justamente el defecto que este AC vino a cerrar («hoy solo la escriben identidad y
// parámetros»).
const OPERACIONES: { tipo: string; ruta: string }[] = [
  { tipo: "venta_registrada", ruta: "ventas/route.ts" },
  { tipo: "venta_anulada", ruta: "ventas/anular/route.ts" },
  { tipo: "turno_abierto", ruta: "turnos/route.ts" },
  { tipo: "turno_cerrado", ruta: "cierre-caja/route.ts" },
  { tipo: "cierre_caja_corregido", ruta: "cierre-caja/corregir/route.ts" },
  { tipo: "precio_cambiado", ruta: "productos/route.ts" },
  { tipo: "pin_reseteado", ruta: "usuarios/route.ts" },
  { tipo: "pin_desbloqueado", ruta: "usuarios/desbloquear-pin/route.ts" }, // AC-ADM-08
  { tipo: "equipo_revocado", ruta: "dispositivos/revocar/route.ts" }, // AC-ADM-08
  { tipo: "merma_registrada", ruta: "pesajes/route.ts" },
  { tipo: "merma_resuelta", ruta: "pesajes/resolver-merma/route.ts" },
  { tipo: "ruta_cerrada", ruta: "rutas/route.ts" },
  { tipo: "ruta_salida_con_bultos_pendientes", ruta: "rutas/salir/route.ts" },
  { tipo: "parada_quitada", ruta: "rutas/paradas/quitar/route.ts" }, // AC-ADM-09
];

// Declaradas fuera y con su porqué, no olvidadas: su OPERACIÓN todavía no existe, así que
// no hay dónde escribir el evento. El tipo ya está en el catálogo para que quien construya
// esos ACs lo encuentre y no invente otro nombre.
const SIN_RUTA_TODAVIA = [
  "dte_anulado", // no existe endpoint de anulación de DTE
];

for (const { tipo, ruta } of OPERACIONES) {
  test(`${tipo}: ${ruta} lo registra [AC-ADM-10]`, () => {
    const fuente = readFileSync(join(API, ruta), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.match(
      fuente,
      new RegExp(`registrarEvento\\([^)]*"${tipo}"`),
      `${ruta} no escribe el evento ${tipo} — esa operación de plata quedaría sin rastro en pan.eventos`
    );
  });
}

test("todo TipoEvento del catálogo está cableado o declarado sin ruta [AC-ADM-10]", () => {
  const fuente = readFileSync(join(AQUI, "evento.ts"), "utf8");
  const bloque = fuente.slice(fuente.indexOf("export type TipoEvento"), fuente.indexOf(";", fuente.indexOf("export type TipoEvento")));
  const catalogo = [...bloque.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
  const cubiertos = new Set([...OPERACIONES.map((o) => o.tipo), ...SIN_RUTA_TODAVIA]);
  const huerfanos = catalogo.filter((t) => !cubiertos.has(t));
  assert.deepEqual(
    huerfanos,
    [],
    `tipo(s) de evento en el catálogo que ninguna ruta escribe ni están declarados sin ruta: ${huerfanos.join(", ")}`
  );
});

test("ninguna operación listada apunta a una ruta que no existe [AC-ADM-10]", () => {
  const faltantes = OPERACIONES.filter((o) => {
    try {
      return !statSync(join(API, o.ruta)).isFile();
    } catch {
      return true;
    }
  }).map((o) => o.ruta);
  assert.deepEqual(faltantes, [], `ruta(s) inexistentes en la lista: ${faltantes.join(", ")}`);
});

test("el catálogo no quedó vacío por error [AC-ADM-10]", () => {
  assert.ok(OPERACIONES.length >= 9, `solo ${OPERACIONES.length} operaciones listadas`);
  assert.ok(readdirSync(API).length > 0);
});
