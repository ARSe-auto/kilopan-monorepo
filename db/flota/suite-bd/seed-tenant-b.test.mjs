#!/usr/bin/env node
// Seed del tenant B «Rutapan» contra el cluster real [AC-FMIG-18].
//
// specs/flota/08-diseno-miga-onboarding.md §7, §10 del maestro: 2 EV48 (90 bultos/41.860 Wh),
// 4 panaderías cliente, tema propio, terminología al máximo largo permitido, centinela único.
// Este test verifica la PRIMERA ENTREGA parcial de AC-FMIG-18 (ver AC-ABIERTO del commit): la
// identidad + el paquete de datos de `db/flota/seeds/tenant-b.mjs`, no las rutas/manifiestos/
// DTE/reintento/cierre-cuadrado, que quedan declarados como trabajo pendiente del mismo AC.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { con } from "../conectar.mjs";
import { sembrarTenantB, CENTINELA_B, EV48 } from "../seeds/tenant-b.mjs";

const SLUG = "gate_seed_b";

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
});

test("[AC-FMIG-18] tenant B «Rutapan»: vertical panadería, tema propio, terminología extrema, 2 EV48 y 4 panaderías con centinela", async () => {
  const r = await sembrarTenantB(SLUG, { recrear: true });

  assert.equal(r.modo, "daas");
  assert.equal(r.vertical, "panaderia");

  // Tema propio (AC-FMIG-02): distinto del acento por defecto y con sus 4 derivados WCAG.
  assert.equal(r.tema.accentColor, "#1B5E20");
  assert.ok(r.tema.accentClaro && r.tema.accentOscuro, "el tema no derivó pressed/dark");

  // Terminología al máximo largo permitido (AC-FMIG-04/06): 7 términos, ninguno excede su
  // tope por tipo, y el centinela de este tenant queda embebido en cada uno.
  assert.equal(r.terminos.length, 7);
  const TOPES = { navegacion: 12, titulo: 24, descripcion: 40 };
  for (const t of r.terminos) {
    assert.ok(t.singular.length <= TOPES[t.tipo], `«${t.singular}» excede el tope de ${t.tipo}`);
    assert.ok(t.plural.length <= TOPES[t.tipo], `«${t.plural}» excede el tope de ${t.tipo}`);
  }
  const [filasTerminologia] = await con(r.bd, ({ sql }) =>
    sql("select count(*)::int as n from tenant_terminology"),
  );
  assert.equal(filasTerminologia.n, 7, "no quedaron las 7 filas de tenant_terminology");

  // 2 EV48 con la capacidad y batería reales del §10 — no genéricas.
  assert.equal(r.vehiculos.length, 2);
  for (const v of r.vehiculos) {
    assert.equal(v.capacidad_bultos, EV48.capacidad_bultos);
    assert.equal(v.bateria_wh, EV48.bateria_wh);
  }

  // 4 panaderías cliente, RUT sintético declarado y centinela único por tenant en razon_social.
  assert.equal(r.empresas.length, 4);
  const rutsUnicos = new Set(r.empresas.map((e) => e.rut));
  assert.equal(rutsUnicos.size, 4, "las 4 panaderías deben tener RUT distinto entre sí");
  for (const e of r.empresas) {
    assert.ok(e.razon_social.includes(CENTINELA_B), `«${e.razon_social}» no lleva el centinela de B`);
  }

  // Positivo de aislamiento (§9.3.2 — precondición del «fila cruzada ⇒ rojo»): el centinela de
  // B no es una cadena que ya viviera en `tenant_template` antes de sembrarlo — si lo fuera, un
  // test cross-tenant que la buscara en la respuesta de otro tenant la encontraría siempre y el
  // caso de rebote sería vacuamente verde.
  const [enPlantilla] = await con("tenant_template", ({ sql }) =>
    sql("select exists(select 1 from empresas_cliente where razon_social like $1) as existe", [
      `%${CENTINELA_B}%`,
    ]),
  );
  assert.equal(enPlantilla.existe, false, "el centinela de B ya vivía en tenant_template");
});
