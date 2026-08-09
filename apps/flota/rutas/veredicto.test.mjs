// Mutantes del juicio de la suite A-contra-B [AC-FTEN-26].
//
// Cada regla se ejerce contra el caso que atrapa Y contra un positivo que impide que sea un
// no-op al revés: un juicio demasiado laxo se ve exactamente igual que uno que funciona
// mientras ninguna ruta filtre nada. Y las reglas del tipo «recurso» —el 404 jamás 403— no
// tienen todavía ninguna ruta de producto que las ejerza (nacen en el módulo 01): estos
// mutantes son, hoy, la ÚNICA evidencia de que ese emisor hace lo que dice.

import test from "node:test";
import assert from "node:assert/strict";
import {
  juzgarCruce,
  juzgarHuella,
  centinelasDe,
  centinelasEn,
  centinelasIndistinguibles,
} from "./veredicto.mjs";

const B = { slug: "vecino", bd: "t_vecino", id: "0f8c1a22-0000-4000-8000-000000000001" };
const CENTINELAS = centinelasDe(B);
const recurso = (respuesta) => juzgarCruce(respuesta, { tipo: "recurso", centinelas: CENTINELAS });
const sinRecurso = (r) => juzgarCruce(r, { tipo: "sin_recurso", centinelas: CENTINELAS });

// ─── tipo «recurso»: 404 y JAMÁS 403 ──────────────────────────────────────────────────

test("403 sobre el recurso de otro tenant ⇒ rojo, y el motivo lo nombra [AC-FTEN-26]", () => {
  // EL rebote que nombra el AC. Un 403 responde «existe», que es la pregunta que el
  // atacante vino a hacer; el 404 la deja sin responder.
  const v = recurso({ status: 403, cuerpo: "" });
  assert.equal(v.ok, false);
  assert.match(v.motivo, /403/);
  assert.match(v.motivo, /404/);
});

test("servir el recurso de otro tenant (2xx) ⇒ rojo por fuga [AC-FTEN-26]", () => {
  const v = recurso({ status: 200, cuerpo: "{}" });
  assert.equal(v.ok, false);
  assert.match(v.motivo, /fuga/i);
});

test("401 sobre el recurso ajeno también revela existencia ⇒ rojo [AC-FTEN-26]", () => {
  // Un 401 dice «esto existe, autenticate». Con sesión de A ya autenticada, es la misma
  // filtración que el 403 con otro número.
  assert.equal(recurso({ status: 401, cuerpo: "" }).ok, false);
  assert.equal(recurso({ status: 422, cuerpo: "" }).ok, false);
});

test("404 pelado sobre el recurso ajeno ⇒ verde [AC-FTEN-26]", () => {
  // El positivo. Sin él, un juicio que rechazara cualquier respuesta se vería idéntico a
  // uno correcto: el rojo permanente y el aislamiento real dan el mismo resultado en verde.
  const v = recurso({ status: 404, cuerpo: "no encontrado", cabeceras: {} });
  assert.equal(v.ok, true);
  assert.equal(v.motivo, null);
});

test("404 que igual filtra una cadena del otro tenant ⇒ rojo [AC-FTEN-26]", () => {
  // El 404 solo no alcanza: el AC pide 404 Y body sin cadenas centinela de B. Un «no existe
  // el vehículo de t_vecino» cumple el código y regala el nombre de la base.
  const v = recurso({ status: 404, cuerpo: `no existe en ${B.bd}` });
  assert.equal(v.ok, false);
  assert.match(v.motivo, /centinela/);
  assert.match(v.motivo, /t_vecino/);
});

test("la fuga por CABECERA cuenta igual que la del cuerpo [AC-FTEN-26]", () => {
  const v = recurso({ status: 404, cuerpo: "", cabeceras: { "x-diagnostico": B.id } });
  assert.equal(v.ok, false);
  assert.match(v.motivo, new RegExp(B.id));
});

// ─── tipo «sin_recurso»: la respuesta sigue siendo la de A ────────────────────────────

test("la ruta sin parámetros que responde lo suyo ⇒ verde [AC-FTEN-26]", () => {
  const v = sinRecurso({ status: 200, cuerpo: '{"slug":"propio","bd":"t_propio"}' });
  assert.equal(v.ok, true);
});

test("la ruta sin parámetros que devuelve algo del vecino ⇒ rojo [AC-FTEN-26]", () => {
  // Exactamente la fuga que la cabecera falsificada busca: el 200 es correcto, lo que está
  // mal es de QUÉ base salió el cuerpo.
  const v = sinRecurso({ status: 200, cuerpo: `{"slug":"${B.slug}","bd":"${B.bd}"}` });
  assert.equal(v.ok, false);
  assert.match(v.motivo, /vecino/);
});

test("caerse (5xx) ante la identidad falsificada NO es aislamiento ⇒ rojo [AC-FTEN-26]", () => {
  // Un 500 no prueba que el dato de B no salió: prueba que no salió esta vez. Declararlo
  // verde dejaría pasar una ruta que revienta con la cabecera del vecino.
  assert.equal(sinRecurso({ status: 500, cuerpo: "" }).ok, false);
});

test("un tipo de cruce que el juicio no conoce ⇒ rojo, jamás verde por omisión [AC-FTEN-26]", () => {
  const v = juzgarCruce({ status: 404, cuerpo: "" }, { tipo: "inventado", centinelas: CENTINELAS });
  assert.equal(v.ok, false);
  assert.match(v.motivo, /desconocido/);
});

// ─── Los centinelas ───────────────────────────────────────────────────────────────────

test("los centinelas se derivan de la identidad de B, sin huecos ni vacíos [AC-FTEN-26]", () => {
  assert.deepEqual(centinelasDe(B), [B.slug, B.bd, B.id]);
  // Sin id (una ruta sin recurso) quedan dos, no tres con un `undefined` que jamás calza.
  assert.deepEqual(centinelasDe({ slug: "v", bd: "t_v" }), ["v", "t_v"]);
  assert.deepEqual(centinelasDe({ slug: "v", bd: "", id: null }), ["v"]);
});

test("el centinela no se escapa por mayúsculas [AC-FTEN-26]", () => {
  // Salen los dos porque el nombre de la BD contiene al slug (`t_` + slug, §4.1): eso es
  // correcto y no hay nada que afinar — una fuga del nombre de la base ES una fuga del slug.
  assert.deepEqual(centinelasEn("Base T_VECINO caída", CENTINELAS), [B.slug, B.bd]);
  assert.deepEqual(centinelasEn("todo en orden", CENTINELAS), []);
});

test("un centinela que es subcadena de la identidad PROPIA se denuncia [AC-FTEN-26]", () => {
  // El par del fixture: `ruteo_activo` y `ruteo_activo_b`. Emparejados al revés, el
  // centinela de B dispara contra la respuesta legítima de A y la suite se pone roja por
  // una coincidencia de nombres — el camino corto a ablandar el centinela.
  const malo = centinelasIndistinguibles(
    ["ruteo_activo_b", "t_ruteo_activo_b"],
    ["ruteo_activo", "t_ruteo_activo"],
  );
  assert.deepEqual(malo, ["ruteo_activo", "t_ruteo_activo"]);

  // Y al derecho no denuncia nada: si lo hiciera, el guard sería inútil por ruidoso.
  assert.deepEqual(
    centinelasIndistinguibles(["ruteo_activo", "t_ruteo_activo"], ["ruteo_activo_b", "t_ruteo_activo_b"]),
    [],
  );
});

// ─── La huella: la BD de B sin cambios ────────────────────────────────────────────────

test("misma huella antes y después de la mutación ⇒ verde [AC-FTEN-26]", () => {
  const h = { "public.vehiculos": 3, "public.eventos": 12 };
  assert.equal(juzgarHuella(h, { ...h }).ok, true);
});

test("una fila de más en la BD del vecino ⇒ rojo, con la tabla y los números [AC-FTEN-26]", () => {
  const v = juzgarHuella({ "public.eventos": 12 }, { "public.eventos": 13 });
  assert.equal(v.ok, false);
  assert.match(v.motivo, /public\.eventos 12 → 13/);
});

test("una tabla que aparece o desaparece también es cambio [AC-FTEN-26]", () => {
  // Un DDL disparado por el cruce es peor que una fila, y comparar solo las tablas comunes
  // lo dejaría pasar sin ruido.
  assert.equal(juzgarHuella({}, { "public.nueva": 0 }).ok, false);
  assert.equal(juzgarHuella({ "public.vieja": 0 }, {}).ok, false);
});
