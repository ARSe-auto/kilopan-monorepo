#!/usr/bin/env node
// Seed del tenant C «Demo Mi Flota» contra el cluster real [AC-FMIG-18].
//
// specs/flota/08-diseno-miga-onboarding.md §7, §10 del maestro: «modo `mi_flota`, demo: 1 EV48,
// 1 chofer, empresa implícita, navegación contraída, 1 día de encargos propios con PODs y
// semáforo».
//
// Lo que este test NO aserta, y por qué: la contracción a nivel de MANIFEST de navegación. Ver
// el comentario de cabecera de `db/flota/seeds/tenant-c.mjs` — los módulos de tarifas,
// liquidación, portal y facturación todavía no tienen `lookup_key` en `features`, así que
// «el manifest de C no los ofrece» sería verde vacuo. Lo que sí se aserta es la contracción de
// la capa de datos: la empresa IMPLÍCITA es la única empresa de C, y sin contratantes no hay
// portal ni liquidación por cliente que ofrecer.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { con } from "../conectar.mjs";
import { sembrarTenantC, CENTINELA_C, EV48 } from "../seeds/tenant-c.mjs";

const SLUG = "gate_seed_c";

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

test("[AC-FMIG-18] tenant C «Demo Mi Flota»: mi_flota, 1 EV48, 1 chofer, empresa implícita, día con PODs y semáforo", async () => {
  const r = await sembrarTenantC(SLUG, { recrear: true });

  assert.equal(r.modo, "mi_flota");

  // Empresa IMPLÍCITA y ÚNICA (§10: «empresa implícita»; §4.5: la crea el trigger, no el seed).
  assert.equal(r.empresaImplicita.implicita, true);
  assert.ok(r.empresaImplicita.razon_social.includes(CENTINELA_C), "la empresa implícita no lleva el centinela de C");
  const [empresas] = await con(r.bd, ({ sql }) => sql("select count(*)::int as n from empresas_cliente"));
  assert.equal(empresas.n, 1, "C es mi_flota: la implícita tiene que ser su ÚNICA empresa");

  // 1 EV48 con la ficha completa del §10 + Anexo A — no un vehículo genérico.
  assert.equal(r.vehiculo.capacidad_bultos, EV48.capacidad_bultos);
  assert.equal(r.vehiculo.bateria_wh, EV48.bateria_wh);
  assert.equal(r.vehiculo.autonomia_nominal_km, EV48.autonomia_nominal_km);
  assert.equal(r.vehiculo.soh_pct, EV48.soh_pct);
  const [vehiculos] = await con(r.bd, ({ sql }) => sql("select count(*)::int as n from vehiculos"));
  assert.equal(vehiculos.n, 1, "§10 pide UN EV48 en C, ni más ni menos");

  // 1 chofer REAL: pasó por invitación + aprobación (§5.4), así que tiene aparato enrolado.
  const [choferes] = await con(r.bd, ({ sql }) =>
    sql("select count(*)::int as n from usuarios where rol = 'chofer'"),
  );
  assert.equal(choferes.n, 1);
  assert.ok(r.chofer.dispositivoId, "el chofer de C quedó sin dispositivo: la aprobación no selló nada");

  // Un día de encargos PROPIOS con sus PODs: todas las paradas de entrega quedaron cerradas.
  assert.equal(r.encargos.length, 3);
  assert.equal(r.paradas.length, 3);
  const [cerradas] = await con(r.bd, ({ sql }) =>
    sql("select count(*)::int as n from entregas_pod where cerrada and resultado = 'exito'"),
  );
  assert.equal(cerradas.n, 3, "el día demo de C tiene que quedar con sus 3 PODs aterrizados");

  // Semáforo: el tablero F1 responde por el EV48 y no le falta ningún dato para decidir. La
  // captura de carga es lo que lo saca de `sin_datos` por SOC — un seed sin lectura dejaría la
  // demo con un tablero mudo, que es justo lo que §10 pide que no pase.
  assert.equal(r.semaforo.length, 1);
  assert.equal(r.semaforo[0].soc, r.soc);
  assert.deepEqual(r.semaforo[0].falta, [], `al tablero de C le falta: ${r.semaforo[0].falta.join(", ")}`);
  assert.ok(r.semaforo[0].rango_efectivo_km > 0, "el rango efectivo de C no se pudo calcular");

  // Cero datos personales reales (§7.8): el centinela de C está en los datos, y NO venía de la
  // plantilla — si viniera, todo test de cruce que lo buscara sería vacuamente verde.
  const [enPlantilla] = await con("tenant_template", ({ sql }) =>
    sql("select exists(select 1 from destinos where nombre like $1) as existe", [`%${CENTINELA_C}%`]),
  );
  assert.equal(enPlantilla.existe, false, "el centinela de C ya vivía en tenant_template");
});
