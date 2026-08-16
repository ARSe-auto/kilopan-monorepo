import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPOS_AGREGADO_CONTROL_CRUDO,
  filaTenantDesdeAgregado,
  filasPlanoEauto,
  validarSchemaAgregadoControl,
  type AgregadoControlCrudo,
} from "./plano-eauto.ts";
import { seedPlanoEauto } from "./plano-eauto-fixtures.ts";

// Plano B — vista cross-tenant de e-auto (spec 05, §3) [AC-FSEM-10].

const CRUDO_VALIDO: AgregadoControlCrudo = {
  tenant_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  ventana_inicio: new Date("2026-08-12T13:55:00-04:00"),
  ventana_fin: new Date("2026-08-12T14:00:00-04:00"),
  eventos_ultima_hora: 100,
  errores_sync_pct: 1,
  dispositivos_activos: 5,
  usuarios_activos: 6,
  pwa_version_min: "2026.8.3",
  eevd_semanal: 0.7,
  backlog_sync_max_min: 10,
};

test("[AC-FSEM-10] un payload conforme al schema fijo NO rebota (el guard no es un no-op)", () => {
  assert.doesNotThrow(() => validarSchemaAgregadoControl(CRUDO_VALIDO));
});

test("[AC-FSEM-10] CENTINELA 14 en la vista: inyectar una columna de dinero ⇒ rebota en rojo", () => {
  for (const clave of ["monto_clp", "tarifa_promedio", "cliente_principal", "rut_titular", "factura_pendiente"]) {
    const conyectado = { ...CRUDO_VALIDO, [clave]: 1 };
    assert.throws(
      () => validarSchemaAgregadoControl(conyectado),
      /huele a dato comercial/,
      `«${clave}» debía rebotar y no rebotó`,
    );
  }
});

test("[AC-FSEM-10] una clave fuera del schema fijo del exportador ⇒ rebota, aunque no huela a dinero", () => {
  const conColumnaInventada = { ...CRUDO_VALIDO, region_geografica: "RM" };
  assert.throws(() => validarSchemaAgregadoControl(conColumnaInventada), /no está en el schema fijo/);
});

test("[AC-FSEM-10] CAMPOS_AGREGADO_CONTROL_CRUDO no contiene, por construcción, una palabra prohibida", () => {
  // Si alguien agregara "tarifa_x" a la lista blanca de columnas, el propio guard quedaría
  // contradicho: una columna «permitida» que huele a dinero. Este test lo atrapa acá.
  for (const campo of CAMPOS_AGREGADO_CONTROL_CRUDO) {
    assert.doesNotMatch(campo, /clp|monto|tarifa|precio|costo|factura|liquidacion|cliente|rut/i);
  }
});

test("[AC-FSEM-10] filaTenantDesdeAgregado mapea los 6 agregados + color por tenant, sin hueco", () => {
  const fila = filaTenantDesdeAgregado("daas", "verde", CRUDO_VALIDO, {
    actividadVsMediaMovil7dPct: null,
    latenciaP95Ms: null,
  });
  assert.equal(fila.tenantSlug, "daas");
  assert.equal(fila.color, "verde");
  assert.equal(fila.erroresSyncPct, 1);
  assert.equal(fila.backlogSyncMaxMin, 10);
  assert.equal(fila.pwaVersionMin, "2026.8.3");
  assert.equal(fila.eevdAgregada, 0.7);
  // Pendientes de wiring real: NULL declarado, jamás un campo ausente del objeto (sin hueco).
  assert.ok("actividadVsMediaMovil7dPct" in fila);
  assert.ok("latenciaP95Ms" in fila);
  assert.equal(fila.actividadVsMediaMovil7dPct, null);
  assert.equal(fila.latenciaP95Ms, null);
});

test("[AC-FSEM-10] filaTenantDesdeAgregado rebota si el crudo que le pasan trae dinero", () => {
  const crudoConDinero = { ...CRUDO_VALIDO, monto_clp: 5000 };
  assert.throws(() => filaTenantDesdeAgregado("daas", "verde", crudoConDinero as AgregadoControlCrudo));
});

test("[AC-FSEM-10] el seed de fixtures produce 3 tenants (verde/amarillo/rojo) con NULL declarado donde corresponde", () => {
  const filas = filasPlanoEauto(seedPlanoEauto());
  assert.equal(filas.length, 3);
  assert.deepEqual(
    filas.map((f) => f.color).sort(),
    ["amarillo", "rojo", "verde"],
  );
  const miFlota = filas.find((f) => f.tenantSlug === "mi_flota");
  assert.ok(miFlota);
  // Sin empresa cliente, la EEVD del tenant `mi_flota` sigue NULL hasta que el hito c la
  // pueble — un cero acá sería una afirmación falsa (AC-FTEN-04: NULL declarado, no inventado).
  assert.equal(miFlota?.eevdAgregada, null);
});
