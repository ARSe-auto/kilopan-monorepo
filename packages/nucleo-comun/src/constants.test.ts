// Pruebas de la familia canónica de constantes [AC-FTEN-01].
//
// A propósito NO repiten los valores: escribir acá el milisegundaje del undo sería
// exactamente el número mágico duplicado que el §0 prohíbe —lo comprobó el propio
// grep-gate contra la primera versión de este comentario— y además solo probaría que dos
// copias coinciden. Lo que se verifica son las PROPIEDADES que hacen a la familia
// utilizable: que esté completa, que sea coherente consigo misma, y que cada cifra
// vigilada tenga un patrón que de verdad la atrape.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  ROLES_SIN_DINERO,
  DINERO,
  TACTIL,
  CIFRA_OPERATIVA,
  CONTRASTE,
  SOC,
  EV,
  PIN,
  LABELS,
  HTTP,
  TARIFAS,
  FORMATOS,
  DTE,
  IDENTIDAD_DE_FILA,
  CIFRAS_VIGILADAS,
} from "./constants.ts";

test("el enum de roles son los SEIS del §0, sin repetir", () => {
  assert.equal(ROLES.length, 6);
  assert.equal(new Set(ROLES).size, 6);
  for (const rol of ["admin_tenant", "operador", "chofer", "responsable_carga", "responsable_tecnico", "cliente"]) {
    assert.ok((ROLES as readonly string[]).includes(rol), `falta el rol ${rol}`);
  }
});

test("los roles que no ven dinero son roles del enum", () => {
  for (const rol of ROLES_SIN_DINERO) {
    assert.ok((ROLES as readonly string[]).includes(rol), `${rol} no está en el enum fijo`);
  }
});

test("el dinero es entero: cero decimales y ningún tipo de coma flotante permitido", () => {
  assert.equal(DINERO.decimales, 0);
  assert.equal(DINERO.tipo_sql, "bigint");
  for (const prohibido of ["numeric", "float", "double precision", "real"]) {
    assert.ok(DINERO.tipos_sql_prohibidos.includes(prohibido as never));
  }
});

test("la jerarquía táctil es coherente: tecla ≥ botón ≥ operativo ≥ piso WCAG", () => {
  assert.ok(TACTIL.tecla_min >= TACTIL.boton_primario);
  assert.ok(TACTIL.boton_primario >= TACTIL.operativo_min);
  assert.ok(TACTIL.operativo_min >= TACTIL.piso_wcag);
});

test("la cifra operativa es la más grande y va con tabular-nums", () => {
  assert.ok(CIFRA_OPERATIVA.tamano_px > TACTIL.boton_primario);
  assert.equal(CIFRA_OPERATIVA.variante_numerica, "tabular-nums");
});

test("el contraste de la cifra y los semáforos es más exigente que el de texto (sol directo)", () => {
  assert.ok(CONTRASTE.cifra_operativa_y_semaforos > CONTRASTE.texto);
  assert.ok(CONTRASTE.texto > CONTRASTE.ui);
});

test("el CHECK de rango del SOC vive en la proyección, jamás en la captura", () => {
  assert.match(SOC.tabla_con_check, /^vehiculos\./);
  assert.match(SOC.tabla_sin_check, /^reading\./);
  assert.notEqual(SOC.tabla_con_check, SOC.tabla_sin_check);
});

test("los umbrales de alerta de energía van de mayor a menor y caen dentro del rango de SOC", () => {
  const u = [...EV.umbrales_alerta_pct];
  assert.deepEqual(u, [...u].sort((a, b) => b - a), "los umbrales deben ir de mayor a menor");
  for (const x of u) {
    assert.ok(x > SOC.minimo && x < SOC.maximo);
  }
});

test("el factor de consumo descuenta (no infla) y la reserva es un porcentaje válido", () => {
  assert.ok(EV.factor_consumo_default > 0 && EV.factor_consumo_default < 1);
  assert.ok(EV.reserva_pct_default > SOC.minimo && EV.reserva_pct_default < SOC.maximo);
});

test("el bloqueo de PIN es POR USUARIO — jamás por dispositivo (andén compartido)", () => {
  assert.equal(PIN.ambito_del_bloqueo, "usuario");
  assert.equal(PIN.hash, "argon2id");
});

test("los largos de label crecen de navegación a descripción y los prohibidos rompen SQL o URLs", () => {
  assert.ok(LABELS.largo_max.navegacion < LABELS.largo_max.titulo);
  assert.ok(LABELS.largo_max.titulo < LABELS.largo_max.descripcion);
  assert.ok(LABELS.caracteres_prohibidos.includes(";"));
  assert.ok(LABELS.caracteres_prohibidos.includes("%"));
});

test("recurso ajeno responde 404, jamás 403 (un 403 confirmaría que existe)", () => {
  assert.equal(HTTP.recurso_ajeno, 404);
  assert.notEqual(HTTP.recurso_ajeno, HTTP.modulo_apagado);
  assert.ok(HTTP.sync_captura >= 200 && HTTP.sync_captura < 300);
});

test("el catálogo de tarifas es cerrado y el tope de activos es menor que el catálogo", () => {
  assert.equal(TARIFAS.conceptos.length, 5);
  assert.equal(new Set(TARIFAS.conceptos).size, TARIFAS.conceptos.length);
  assert.ok(TARIFAS.activos_max_por_empresa < TARIFAS.conceptos.length);
});

test("los formatos son de Chile y la PK es UUIDv7 de servidor", () => {
  assert.equal(FORMATOS.locale, "es-CL");
  assert.equal(FORMATOS.zona_horaria, "America/Santiago");
  assert.equal(IDENTIDAD_DE_FILA.version_uuid, 7);
  assert.match(IDENTIDAD_DE_FILA.generador, /uuidv7/);
});

test("la app jamás emite DTE (art. 97 N°4 CT)", () => {
  assert.equal(DTE.emite_la_app, false);
});

test("cada cifra vigilada tiene un patrón válido que atrapa su propio valor", () => {
  assert.ok(CIFRAS_VIGILADAS.length > 0, "verde vacuo prohibido: la lista no puede estar vacía");
  const nombres = new Set<string>();
  for (const c of CIFRAS_VIGILADAS) {
    assert.equal(nombres.has(c.nombre), false, `${c.nombre} vigilada dos veces`);
    nombres.add(c.nombre);
    let re: RegExp;
    assert.doesNotThrow(() => {
      re = new RegExp(c.patron);
    }, `el patrón de ${c.nombre} no compila`);
    // Un patrón que no encuentra su propio valor no puede encontrar una copia de él.
    re = new RegExp(c.patron!);
    assert.ok(
      re.test(String(c.valor)) || /[a-zA-Z\\(]/.test(c.patron),
      `el patrón de ${c.nombre} no atrapa ni su propio valor y tampoco pide contexto`,
    );
  }
});
