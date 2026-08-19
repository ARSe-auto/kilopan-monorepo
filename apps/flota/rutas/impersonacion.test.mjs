// NO EXISTE endpoint de impersonación [AC-FIDN-11] — §7.9.
//
// Esta es la primera prueba de AUSENCIA que se apoya en el manifiesto de rutas, que es
// exactamente para lo que AC-FTEN-26 lo derivó del árbol en vez de dejarlo a mano: «no hay una
// ruta que haga X» solo prueba algo si el inventario NO PUEDE quedar incompleto. Con un
// manifiesto escrito a mano, este test sería compatible con «alguien la agregó y no la
// declaró», que es justo el caso que hay que atrapar.
//
// El §7.9 no dice «la impersonación está desactivada» ni «requiere permiso»: dice que soporte
// trabaja SIN god-mode, y la forma de que eso sea verdad es que el endpoint no exista. Una
// ruta apagada por una bandera es una ruta que alguien enciende.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MANIFIESTO = JSON.parse(readFileSync(join(import.meta.dirname, "manifiesto.json"), "utf8"));

/**
 * Las formas en que se llamaría. La lista es de PATRONES y no de nombres exactos a propósito:
 * quien agregue una ruta así no va a llamarla `/api/impersonar` — va a llamarla
 * `/api/soporte/entrar-como` o `/api/admin/suplantar`, y la regla tiene que alcanzarla igual.
 */
const IMPERSONACION = [
  /impersona/i,
  /suplant/i,
  /\bsudo\b/i,
  /entrar[-_]?como/i,
  /actuar[-_]?como/i,
  /\bcomo[-_]usuario\b/i,
  /god[-_]?mode/i,
  /\bmasquerade\b/i,
  /switch[-_]?user/i,
];

test("[AC-FIDN-11] el manifiesto no declara NINGUNA ruta de impersonación", () => {
  const sospechosas = MANIFIESTO.rutas.filter((r) => IMPERSONACION.some((p) => p.test(r.ruta)));
  assert.deepEqual(
    sospechosas.map((r) => r.ruta),
    [],
    "hay una ruta que permitiría actuar como otra persona: el §7.9 exige que NO EXISTA, no que esté apagada",
  );
});

test("[AC-FIDN-11] el manifiesto tiene rutas que revisar: la ausencia no es por estar vacío", () => {
  // El verde vacuo de este AC: con el manifiesto vacío, «no hay ruta de impersonación» sería
  // trivialmente cierto y no diría nada del producto.
  assert.ok(MANIFIESTO.rutas.length > 0, "el manifiesto está vacío");
});

test("[AC-FIDN-11] los patrones atrapan de verdad lo que dicen atrapar", () => {
  // Sin esto, una lista de patrones mal escritos daría el mismo verde que una buena, y este
  // AC pasaría para siempre sin mirar nada. Se ejerce contra los nombres que alguien pondría.
  for (const ruta of [
    "/api/impersonar",
    "/api/soporte/entrar-como/[id]",
    "/api/admin/suplantar",
    "/api/sudo",
    "/api/usuarios/[id]/actuar-como",
    "/api/switch-user",
  ]) {
    assert.ok(
      IMPERSONACION.some((p) => p.test(ruta)),
      `«${ruta}» pasaría el gate sin que nadie lo note`,
    );
  }
  // Y el positivo: las rutas legítimas del producto no disparan. Un patrón demasiado ancho
  // marcaría código sano y alguien lo apagaría.
  for (const ruta of ["/api/sesion", "/api/solicitudes", "/api/reenrolamiento", "/api/tenant", "/"]) {
    assert.ok(!IMPERSONACION.some((p) => p.test(ruta)), `«${ruta}» disparó y es legítima`);
  }
});
