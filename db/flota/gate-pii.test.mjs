#!/usr/bin/env node
// Mutantes del gate de PII estructural [AC-FIDN-14].
//
// Esta regla va a estar años sin disparar, porque el esquema que la viola FUNCIONA: un RUT
// dentro de `eventos` anda perfecto hasta el día que alguien ejerce su derecho de supresión y
// resulta que el dato está en una tabla append-only que no se puede tocar. Así que cada
// patrón se ejerce contra el caso que atrapa Y contra un positivo: un patrón demasiado ancho
// marca `grupos.nombre`, alguien lo apaga, y una regla apagada no protege nada.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { revisarSql, TABLAS_DE_IDENTIDAD } from "./gate-pii.mjs";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const donde = (sql, rel = "db/migraciones-flota/tenant/9999_prueba.sql") =>
  revisarSql(rel, sql).problemas.map((p) => p.donde);

const tabla = (nombre, columnas, clase = "PLANIFICACIÓN") =>
  `create table ${nombre} (\n  id uuid not null,\n  ${columnas.join(",\n  ")}\n);\n` +
  `comment on table ${nombre} is '${clase} — de prueba.';\n`;

test("[AC-FIDN-14] el repo real pasa el gate", () => {
  const salida = execFileSync("node", [`${RAIZ}/db/flota/gate-pii.mjs`], { encoding: "utf8" });
  assert.match(salida, /gate-pii: VERDE/);
  // ANCLADO al separador, y no es cosmética [AC-FIDN-05]: `/0 migraciones/` a secas también
  // casa con «20 migraciones», así que esta guardia anti-vacuidad se rompió sola el día que el
  // repo llegó a la vigésima migración — con el gate sano. Una guardia que falla por contar
  // bien es peor que no tenerla: enseña a ignorarla.
  assert.doesNotMatch(salida, /:\s0 migraciones\b/, "el gate no revisó ninguna migración");
});

// ─── Los identificadores inequívocos ─────────────────────────────────────────────────

test("[AC-FIDN-14] un RUT dentro de una tabla de hechos ⇒ ROJO", () => {
  // EL caso. Un RUT en `eventos` rompe las dos mitades del §7.8 a la vez: la supresión deja
  // de ser posible y el ledger pasa a ser un archivo de datos personales.
  assert.deepEqual(donde(tabla("eventos", ["rut text not null"], "CAPTURA")), ["eventos.rut"]);
  assert.deepEqual(donde(tabla("review_queue", ["contacto text"])), ["review_queue.contacto"]);
  assert.deepEqual(donde(tabla("entregas_pod", ["telefono text"], "CAPTURA")), ["entregas_pod.telefono"]);
  assert.deepEqual(donde(tabla("client_metric", ["email text"], "CAPTURA")), ["client_metric.email"]);
  assert.deepEqual(donde(tabla("paradas", ["direccion_destinatario text"])), ["paradas.direccion_destinatario"]);
});

test("[AC-FIDN-14] en el plano de identidad, los mismos identificadores pasan", () => {
  // El positivo, y el que hace útil a la regla: si `personas.rut` también fuera rojo, la
  // única forma de tener el gate en verde sería no guardar identidades en ningún lado.
  for (const t of TABLAS_DE_IDENTIDAD) {
    assert.deepEqual(donde(tabla(t, ["rut text", "contacto text"])), [], `${t} disparó`);
  }
});

test("[AC-FIDN-14] el plano de CONTROL no está sujeto a esta regla, y se dice", () => {
  // `control` guarda a los clientes de la plataforma, no a las personas de la operación; el
  // §7.8 rige sobre estas últimas. Se declara en vez de mirar para otro lado.
  const r = revisarSql("db/migraciones-flota/control/0001_x.sql", tabla("invitaciones_tenant", ["correo text"]));
  assert.deepEqual(r.problemas, []);
  assert.equal(r.plano, "control");
});

// ─── `nombre`, que es la palabra más reusada del esquema ─────────────────────────────

test("[AC-FIDN-14] `nombre` en una tabla CAPTURA ⇒ ROJO", () => {
  assert.deepEqual(donde(tabla("firmas", ["nombre text"], "CAPTURA")), ["firmas.nombre"]);
  assert.deepEqual(donde(tabla("evidence", ["nombre_receptor text"], "CAPTURA")), ["evidence.nombre_receptor"]);
});

test("[AC-FIDN-14] `nombre` en un catálogo de PLANIFICACIÓN NO dispara", () => {
  // Los grupos, los tipos de carga y los planes tienen nombre y ninguno es una persona.
  // Prohibirlo en todas partes obligaría a una exención por catálogo, y una regla con doce
  // exenciones es una regla que nadie lee — y que alguien termina apagando.
  assert.deepEqual(donde(tabla("grupos", ["nombre text not null"])), []);
  assert.deepEqual(donde(tabla("cargo_type", ["nombre text not null"])), []);
});

test("[AC-FIDN-14] una tabla SIN clase declarada no se usa para colar un nombre", () => {
  // Sin `COMMENT ON TABLE` el otro linter (AC-FTEN-06) ya la rebota, así que acá no hace
  // falta duplicar el rojo; lo que importa es que la ausencia de clase no valga como permiso.
  const sinComment = "create table x (\n  id uuid,\n  nombre text\n);\n";
  assert.deepEqual(donde(sinComment), [], "sin clase no se inventa un rojo que es de otro gate");
  assert.deepEqual(donde(sinComment.replace("nombre text", "rut text")), ["x.rut"],
    "pero un identificador inequívoco sí dispara, con clase o sin ella");
});

// ─── La vía de escape que había que cerrar ───────────────────────────────────────────

test("[AC-FIDN-14] una columna AGREGADA después cuenta igual que una del CREATE", () => {
  // Sin esto, la forma de meter un RUT en `eventos` sería escribir la migración siguiente, y
  // el gate seguiría en verde mirando solo los CREATE TABLE.
  assert.deepEqual(donde("alter table eventos add column rut text;"), ["eventos.rut"]);
  assert.deepEqual(donde("alter table eventos\n  add column a int,\n  add column contacto text;"), [
    "eventos.contacto",
  ]);
  assert.deepEqual(donde("alter table personas add column contacto text;"), []);
});

// ─── Las exenciones: escritas y CONTADAS ─────────────────────────────────────────────

test("[AC-FIDN-14] una exención escrita libera esa columna y queda contada", () => {
  const sql = "-- pii: exenta eventos.rut — razón escrita y con nombre en el git blame.\n" +
    tabla("eventos", ["rut text"], "CAPTURA");
  const r = revisarSql("db/migraciones-flota/tenant/9999_prueba.sql", sql);
  assert.deepEqual(r.problemas, []);
  assert.equal(r.exenciones.length, 1);
  assert.match(r.exenciones[0].razon, /git blame/);
});

test("[AC-FIDN-14] la exención es de UNA columna, no de la tabla entera", () => {
  // Una exención que abriera la tabla completa sería la puerta por la que entra la segunda
  // columna, la que nadie declaró.
  const sql = "-- pii: exenta eventos.rut — declarada.\n" + tabla("eventos", ["rut text", "email text"], "CAPTURA");
  assert.deepEqual(revisarSql("db/migraciones-flota/tenant/9999.sql", sql).problemas.map((p) => p.donde), [
    "eventos.email",
  ]);
});

test("[AC-FIDN-14] el motivo dice qué hacer, no solo que no", () => {
  const [p] = revisarSql("x.sql", tabla("eventos", ["rut text"], "CAPTURA")).problemas;
  assert.match(p.motivo, /ID opaco/);
  assert.match(p.motivo, /pii: exenta eventos\.rut/);
});
