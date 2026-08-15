// NO EXISTE endpoint de línea manual de liquidación [AC-FTAR-04] — §3.E1.9, §7.5.
//
// El §7.5 pide que las líneas de `liquidacion_lineas` SOLO las cree `devengar_entrega()`, la
// función `SECURITY DEFINER` de la 0063/0064 — el candado en la BD (INSERT revocado al rol de
// app + trigger que rebota con 42501) ya está probado en `db/flota/pgtap/0028_devengo_unico.
// sql`. Lo que falta y es de este árbol es la mitad HTTP: que nadie pueda rodear ese candado
// exponiendo una ruta que inserte una línea «a mano». Igual que AC-FIDN-11 con la
// impersonación, la prueba se apoya en el manifiesto GENERADO (AC-FTEN-26) y no en una lista
// escrita a mano, porque «no existe una ruta que haga X» solo prueba algo si el inventario no
// puede quedar incompleto.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MANIFIESTO = JSON.parse(readFileSync(join(import.meta.dirname, "manifiesto.json"), "utf8"));

/** Métodos que MUTAN. El drill-down línea→evidencia del §3.E1.9 (AC-FTAR-07) es GET y no le pega a esta regla. */
const MUTA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Patrones de CÓMO se llamaría una ruta que crea o edita líneas a mano. Son de forma y no de
 * nombre exacto a propósito: quien la agregue no la va a llamar `/api/linea-manual` — la va a
 * llamar `/api/liquidaciones/[id]/lineas` o `/api/liquidacion-lineas`, y la regla tiene que
 * alcanzarla igual.
 */
const LINEA_MANUAL = [/\blineas?\b/i, /linea[-_]?manual/i, /crear[-_]?linea/i, /agregar[-_]?linea/i];

test("[AC-FTAR-04] el manifiesto no declara NINGUNA ruta que MUTE una línea de liquidación a mano", () => {
  const sospechosas = MANIFIESTO.rutas.filter(
    (r) => r.metodos.some((m) => MUTA.has(m)) && LINEA_MANUAL.some((p) => p.test(r.ruta)),
  );
  assert.deepEqual(
    sospechosas.map((r) => r.ruta),
    [],
    "hay una ruta que mutaría liquidacion_lineas por HTTP: el §7.5 exige que NO EXISTA — el " +
      "devengo es la ÚNICA fuente, y ya rebota con 42501 hasta al migrador (db/flota/pgtap/0028)",
  );
});

test("[AC-FTAR-04] el manifiesto tiene rutas que revisar: la ausencia no es por estar vacío", () => {
  // El verde vacuo de este AC: con el manifiesto vacío, «no hay ruta de línea manual» sería
  // trivialmente cierto y no diría nada del producto.
  assert.ok(MANIFIESTO.rutas.length > 0, "el manifiesto está vacío");
});

test("[AC-FTAR-04] los patrones atrapan de verdad lo que dicen atrapar", () => {
  // Sin esto, una lista de patrones mal escritos daría el mismo verde que una buena, y este AC
  // pasaría para siempre sin mirar nada. Se ejerce contra los nombres que alguien pondría.
  for (const ruta of [
    "/api/liquidaciones/[id]/lineas",
    "/api/liquidacion-lineas",
    "/api/lineas",
    "/api/lineas/[id]",
    "/api/linea-manual",
    "/api/liquidaciones/[id]/crear-linea",
    "/api/liquidaciones/[id]/agregar-linea",
  ]) {
    assert.ok(
      LINEA_MANUAL.some((p) => p.test(ruta)),
      `«${ruta}» pasaría el gate sin que nadie lo note`,
    );
  }
  // Y el positivo: el futuro drill-down GET línea→evidencia (AC-FTAR-07) y las rutas legítimas
  // del producto no disparan por el VERBO HTTP — el patrón solo bloquea cuando además MUTA.
  for (const ruta of ["/api/sesion", "/api/encargos", "/api/tarifas", "/"]) {
    assert.ok(!LINEA_MANUAL.some((p) => p.test(ruta)), `«${ruta}» disparó y es legítima`);
  }
});

test("[AC-FTAR-04] el drill-down línea→evidencia (GET) no dispararía el gate aunque exista", () => {
  // Documenta la frontera: el patrón atrapa el NOMBRE «líneas», así que el filtro real es el
  // VERBO HTTP. Un GET sobre esa misma forma de ruta es AC-FTAR-07 y no está prohibido.
  const rutaFutura = "/api/liquidaciones/[id]/lineas/[lineaId]/evidencia";
  assert.ok(LINEA_MANUAL.some((p) => p.test(rutaFutura)), "el patrón de nombre sí matchea");
  assert.ok(!MUTA.has("GET"), "pero GET no está en el set de métodos que mutan");
});
