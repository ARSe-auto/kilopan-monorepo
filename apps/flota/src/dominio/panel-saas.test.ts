import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPOS_EEVD_TENDENCIA_TENANT,
  calidadNorte,
  contadorExenciones,
  embudoActivacion,
  filaEevdTendencia,
  saludPlataforma,
  validarSchemaEevdTendencia,
  type EevdTendenciaTenantCrudo,
} from "./panel-saas.ts";
import {
  seedActivacionTenants,
  seedCalidadNorte,
  seedEevdTendenciaCruda,
  seedSaludTenants,
  seedTendenciaExenciones,
} from "./panel-saas-fixtures.ts";

// Panel interno SaaS de e-auto (spec 05 §3, maestro §10) [AC-FSEM-22].

const CRUDO_VALIDO: EevdTendenciaTenantCrudo = {
  tenant_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  eevd_semana_1: 0.6,
  eevd_semana_2: 0.65,
  eevd_semana_3: 0.7,
  eevd_semana_4: 0.75,
};

test("[AC-FSEM-22] un payload de EEVD-tendencia conforme al schema fijo NO rebota", () => {
  assert.doesNotThrow(() => validarSchemaEevdTendencia(CRUDO_VALIDO));
});

test("[AC-FSEM-22] CENTINELA 14 en la vista: inyectar una columna de dinero al agregado nuevo ⇒ rebota en rojo", () => {
  for (const clave of ["monto_clp", "tarifa_promedio", "cliente_principal", "rut_titular"]) {
    const contaminado = { ...CRUDO_VALIDO, [clave]: 1 };
    assert.throws(
      () => validarSchemaEevdTendencia(contaminado),
      /huele a dato comercial/,
      `«${clave}» debía rebotar y no rebotó`,
    );
  }
});

test("[AC-FSEM-22] una clave fuera del schema fijo del exportador ⇒ rebota, aunque no huela a dinero", () => {
  const conColumnaInventada = { ...CRUDO_VALIDO, region_geografica: "RM" };
  assert.throws(() => validarSchemaEevdTendencia(conColumnaInventada), /no está en el schema fijo/);
});

test("[AC-FSEM-22] CAMPOS_EEVD_TENDENCIA_TENANT no contiene, por construcción, una palabra prohibida", () => {
  for (const campo of CAMPOS_EEVD_TENDENCIA_TENANT) {
    assert.doesNotMatch(campo, /clp|monto|tarifa|precio|costo|factura|liquidacion|cliente|rut/i);
  }
});

test("[AC-FSEM-22] filaEevdTendencia arma las 4 semanas en orden, sin hueco cuando hay NULL declarado", () => {
  const conNull: EevdTendenciaTenantCrudo = { ...CRUDO_VALIDO, eevd_semana_1: null };
  const fila = filaEevdTendencia("daas", conNull);
  assert.equal(fila.tenantSlug, "daas");
  assert.deepEqual(fila.semanas, [null, 0.65, 0.7, 0.75]);
});

test("[AC-FSEM-22] fixture: EEVD con tendencia por tenant — daas sube, mi_flota NULL declarado, ruteo_activo cae", () => {
  const filas = seedEevdTendenciaCruda().map(({ tenantSlug, crudo }) => filaEevdTendencia(tenantSlug, crudo));
  assert.equal(filas.length, 3);
  const daas = filas.find((f) => f.tenantSlug === "daas");
  assert.deepEqual(daas?.semanas, [0.71, 0.76, 0.79, 0.82]);
  const miFlota = filas.find((f) => f.tenantSlug === "mi_flota");
  assert.deepEqual(miFlota?.semanas, [null, null, null, null]);
});

test("[AC-FSEM-22] embudoActivacion calcula p50/p90 en horas alta→primera entrega, excluyendo los sin evidencia todavía", () => {
  const resultado = embudoActivacion(seedActivacionTenants());
  assert.equal(resultado.tenantsActivados, 2);
  assert.equal(resultado.tenantsPendientes, 1);
  assert.equal(resultado.p50Horas, 6);
  assert.equal(resultado.p90Horas, 28);
});

test("[AC-FSEM-22] embudoActivacion sin ningún tenant con primera entrega ⇒ p50/p90 NULL declarado, jamás cero", () => {
  const resultado = embudoActivacion([{ tenantSlug: "nuevo", altaEn: new Date("2026-08-12T00:00:00Z"), primeraEntregaEn: null }]);
  assert.equal(resultado.p50Horas, null);
  assert.equal(resultado.p90Horas, null);
  assert.equal(resultado.tenantsActivados, 0);
  assert.equal(resultado.tenantsPendientes, 1);
});

test("[AC-FSEM-22] saludPlataforma cuenta tenants activos y el % de vehículos con turno agregado", () => {
  const resultado = saludPlataforma(seedSaludTenants());
  assert.equal(resultado.tenantsActivos, 2);
  // 4 de 6 vehículos con turno (daas 3/3, mi_flota 1/1, ruteo_activo 0/2)
  assert.equal(resultado.pctVehiculosConTurno, 4 / 6);
});

test("[AC-FSEM-22] saludPlataforma sin ningún vehículo ⇒ % NULL declarado, no división por cero disfrazada", () => {
  const resultado = saludPlataforma([{ tenantSlug: "vacio", activo: true, vehiculosActivos: 0, vehiculosConTurno: 0 }]);
  assert.equal(resultado.pctVehiculosConTurno, null);
});

test("[AC-FSEM-22] calidadNorte: un supersede con motivo=undo NO cuenta como POD supersedido (§4.7)", () => {
  const { paradas, pods } = seedCalidadNorte();
  const resultado = calidadNorte(paradas, pods);
  assert.equal(resultado.pctParadasSinEvidencia, 3 / 40);
  // 3 supersedidos reales de 10 PODs (el 4to, motivo=undo, queda excluido) — no 4/10.
  assert.equal(resultado.pctPodsSupersedidosSinUndo, 3 / 10);
});

test("[AC-FSEM-22] calidadNorte sin PODs ⇒ NULL declarado", () => {
  const resultado = calidadNorte({ totalEntrega: 0, sinEvidencia: 0 }, { total: 0, supersedidos: [] });
  assert.equal(resultado.pctParadasSinEvidencia, null);
  assert.equal(resultado.pctPodsSupersedidosSinUndo, null);
});

test("[AC-FSEM-22] contadorExenciones marca creciente=true cuando la tendencia sube (bandera roja, §10)", () => {
  const resultado = contadorExenciones(seedTendenciaExenciones());
  assert.equal(resultado.valorActual, 1);
  assert.equal(resultado.creciente, true);
});

test("[AC-FSEM-22] contadorExenciones plano o decreciente ⇒ creciente=false", () => {
  assert.equal(contadorExenciones([2, 2, 1]).creciente, false);
  assert.equal(contadorExenciones([0]).creciente, false);
  assert.equal(contadorExenciones([]).valorActual, 0);
});
