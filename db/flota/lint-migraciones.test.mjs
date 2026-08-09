#!/usr/bin/env node
// Mutantes del linter de migraciones [AC-FTEN-06].
//
// El caso de rebote del AC: «una migración de fixture que omite CUALQUIERA de las cinco
// exigencias produce exit ≠ 0». Se prueba una por una, partiendo de una migración conforme
// y quitándole exactamente una cosa: así se sabe que cada regla está viva por separado, y
// no que una sola las tapa a todas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const LINTER = join(RAIZ, "db/flota/lint-migraciones.mjs");

/** Migración conforme: las cinco exigencias presentes. De acá salen todos los mutantes. */
const CONFORME = `
create table paradas (
  id          uuid primary key default uuidv7(),
  tenant_id   uuid not null check (tenant_id = tenant_actual()),
  ruta_id     uuid not null,
  orden       int  not null,
  unique (tenant_id, id),
  foreign key (tenant_id, ruta_id) references rutas (tenant_id, id)
);
create index paradas_tenant_ruta_idx on paradas (tenant_id, ruta_id);
comment on table paradas is 'PLANIFICACIÓN — el orden de la ruta se decide con red y rebota.';
`;

function correr(archivos) {
  const dir = mkdtempSync(join(tmpdir(), "flota-mig-"));
  for (const [rel, contenido] of Object.entries(archivos)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), contenido);
  }
  try {
    return { codigo: 0, salida: execFileSync("node", [LINTER, `--dir=${dir}`], { encoding: "utf8" }) };
  } catch (e) {
    return { codigo: e.status ?? 1, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const conMutacion = (buscar, reemplazo) => ({
  "tenant/0001_x.sql": CONFORME.replace(buscar, reemplazo),
});

test("la migración conforme pasa (el linter no es un no-op al revés)", () => {
  const { codigo, salida } = correr({ "tenant/0001_x.sql": CONFORME });
  assert.equal(codigo, 0, salida);
  assert.match(salida, /1 tablas de dominio/);
});

test("exigencia 1 — sin `tenant_id uuid NOT NULL` ⇒ rojo", () => {
  const { codigo, salida } = correr(
    conMutacion("tenant_id   uuid not null check", "tenant_id   uuid check"),
  );
  assert.equal(codigo, 1);
  assert.match(salida, /sin `tenant_id uuid NOT NULL`/);
});

test("exigencia 2 — sin el CHECK contra la constante de la BD ⇒ rojo", () => {
  const { codigo, salida } = correr(
    conMutacion("uuid not null check (tenant_id = tenant_actual())", "uuid not null"),
  );
  assert.equal(codigo, 1);
  assert.match(salida, /sin `CHECK \(tenant_id = tenant_actual\(\)\)`/);
});

test("exigencia 3 — una FK compuesta sin índice que la encabece ⇒ rojo", () => {
  // La primera versión de este mutante quitaba el índice y esperaba «sin índice que empiece
  // por tenant_id» — y el linter, con razón, seguía en verde: `UNIQUE (tenant_id, id)` de la
  // exigencia 4a YA es un índice encabezado por tenant_id. O sea que la regla 3, tal como
  // estaba escrita, no podía ponerse roja nunca. Lo que de verdad falta cuando se borra ese
  // índice es la cobertura de la FK: Postgres no indexa las FK solo, y cada borrado en
  // `rutas` haría un scan completo de `paradas`.
  const { codigo, salida } = correr(
    conMutacion(
      "create index paradas_tenant_ruta_idx on paradas (tenant_id, ruta_id);",
      "create index paradas_orden_idx on paradas (orden);",
    ),
  );
  assert.equal(codigo, 1);
  assert.match(salida, /no tiene índice que la encabece/);
});

test("exigencia 3 — sin ningún índice encabezado por tenant_id ⇒ rojo", () => {
  const suelta = `
create table notas (
  id        uuid primary key default uuidv7(),
  tenant_id uuid not null check (tenant_id = tenant_actual()),
  texto     text not null,
  unique (id, tenant_id)
);
create index notas_texto_idx on notas (texto);
comment on table notas is 'CAPTURA — la nota se escribe en terreno.';
`;
  const { codigo, salida } = correr({ "tenant/0002_notas.sql": suelta });
  assert.equal(codigo, 1);
  assert.match(salida, /sin índice que empiece por `tenant_id`/);
});

test("exigencia 4 — sin `UNIQUE (tenant_id, id)` nadie puede referenciarla compuesta ⇒ rojo", () => {
  const { codigo, salida } = correr(conMutacion("  unique (tenant_id, id),\n", ""));
  assert.equal(codigo, 1);
  assert.match(salida, /sin `UNIQUE \(tenant_id, id\)`/);
});

test("exigencia 4 — una FK que no lleva tenant_id ⇒ rojo", () => {
  const { codigo, salida } = correr(
    conMutacion(
      "foreign key (tenant_id, ruta_id) references rutas (tenant_id, id)",
      "foreign key (ruta_id) references rutas (id)",
    ),
  );
  assert.equal(codigo, 1);
  assert.match(salida, /no es compuesta: le falta tenant_id/);
});

test("exigencia 4 — una REFERENCES en línea (columna) ⇒ rojo: nunca puede ser compuesta", () => {
  const { codigo, salida } = correr(
    conMutacion("  ruta_id     uuid not null,", "  ruta_id     uuid not null references rutas (id),"),
  );
  assert.equal(codigo, 1);
  assert.match(salida, /REFERENCES en línea/);
});

test("exigencia 5 — sin COMMENT ON TABLE ⇒ rojo", () => {
  const { codigo, salida } = correr(
    conMutacion(/comment on table paradas is '[^']*';/, ""),
  );
  assert.equal(codigo, 1);
  assert.match(salida, /sin `COMMENT ON TABLE`/);
});

test("exigencia 5 — un COMMENT sin clase de la regla de oro ⇒ rojo", () => {
  const { codigo, salida } = correr(
    conMutacion("'PLANIFICACIÓN — el orden", "'Tabla de paradas — el orden"),
  );
  assert.equal(codigo, 1);
  assert.match(salida, /no empieza por su clase/);
});

test("CAPTURA también es una clase válida", () => {
  const { codigo } = correr(conMutacion("'PLANIFICACIÓN — el orden", "'CAPTURA — el orden"));
  assert.equal(codigo, 0);
});

test("las tablas del plano de control no llevan tenant_id, pero sí clase", () => {
  const control = `
create table tenants (
  id     uuid primary key default uuidv7(),
  slug   text not null unique,
  bd     text not null,
  estado text not null
);
comment on table tenants is 'PLANIFICACIÓN — el registro de tenants se edita con red.';
`;
  const ok = correr({ "control/0001_tenants.sql": control });
  assert.equal(ok.codigo, 0, ok.salida);
  assert.match(ok.salida, /1 tablas de control/);

  const sinClase = correr({
    "control/0001_tenants.sql": control.replace(/comment on table[^;]*;/, ""),
  });
  assert.equal(sinClase.codigo, 1);
  assert.match(sinClase.salida, /sin `COMMENT ON TABLE`/);
});

test("una exención se respeta, pero queda CONTADA e impresa (jamás silenciosa)", () => {
  const sinNada = `
-- linter: exenta tenant_info — es la fila que DEFINE la constante del tenant; no puede
-- llevar un CHECK contra sí misma.
create table tenant_info (
  id   uuid primary key,
  slug text not null
);
comment on table tenant_info is 'PLANIFICACIÓN — identidad de la BD, se siembra al provisionar.';
`;
  const { codigo, salida } = correr({ "tenant/0000_info.sql": sinNada });
  assert.equal(codigo, 0, salida);
  assert.match(salida, /exención declarada: tenant_info/);
  assert.match(salida, /1 exenciones/);
  assert.match(salida, /0 tablas de dominio/);
});

test("sin migraciones, el linter lo DICE en vez de reportar un verde vacuo", () => {
  const { codigo, salida } = correr({});
  assert.equal(codigo, 0);
  assert.match(salida, /SIN MIGRACIONES TODAVÍA/);
});

test("dos tablas en un archivo: el problema de la segunda no lo tapa la primera", () => {
  const dos =
    CONFORME +
    `
create table items (
  id        uuid primary key default uuidv7(),
  tenant_id uuid not null,
  unique (tenant_id, id)
);
create index items_tenant_idx on items (tenant_id);
comment on table items is 'CAPTURA — el conteo real se hace en el punto.';
`;
  const { codigo, salida } = correr({ "tenant/0001_x.sql": dos });
  assert.equal(codigo, 1);
  assert.match(salida, /items: sin `CHECK \(tenant_id = tenant_actual\(\)\)`/);
  assert.doesNotMatch(salida, /paradas: sin/);
});

// --- Dinero (§0 fila Dinero, §4.8) --------------------------------------------------- [AC-FTEN-09]
// El sufijo `_clp` ES la convención de una columna de monto. Un `numeric` ahí no es
// precisión: en CLP no hay centavos, y el decimal aparece recién en el primer total que no
// cuadra por un peso.
const CON_MONTO = (tipo) => `
create table tarifas (
  id          uuid primary key default uuidv7(),
  tenant_id   uuid not null check (tenant_id = tenant_actual()),
  costo_clp   ${tipo} not null,
  unique (tenant_id, id)
);
create index tarifas_tenant_idx on tarifas (tenant_id);
comment on table tarifas is 'PLANIFICACIÓN — la tarifa se pacta con red y rebota.';
`;

test("[AC-FTEN-09] una columna `*_clp` en bigint pasa (el guard no es un no-op al revés)", () => {
  const { codigo, salida } = correr({ "tenant/0001_x.sql": CON_MONTO("bigint") });
  assert.equal(codigo, 0, salida);
});

for (const tipo of ["numeric", "numeric(12,2)", "double precision", "real", "money", "int"]) {
  test(`[AC-FTEN-09] una columna de dinero en \`${tipo}\` ⇒ gate rojo`, () => {
    const { codigo, salida } = correr({ "tenant/0001_x.sql": CON_MONTO(tipo) });
    assert.equal(codigo, 1, salida);
    assert.match(salida, /la columna de dinero `costo_clp`/);
  });
}
