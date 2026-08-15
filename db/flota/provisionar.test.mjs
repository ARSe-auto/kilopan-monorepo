#!/usr/bin/env node
// Mutantes de la regla de rezago de la plantilla [AC-FTEN-02].
//
// La regla es el caso de rebote del AC —«migración aplicada a tenants pero no a la plantilla
// deja la provisión de tenant nuevo desactualizada»— y está aislada como función pura para
// poder ejercerla en cada iteración, sin cluster. La mitad que SÍ necesita base de datos
// (crear, sembrar, coherencia) vive en `db/flota/suite-bd/provisionar.test.mjs` y corre con
// `--full`; acá se prueba que la regla misma no sea decorativa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rezagosDeLaPlantilla, UUID_CENTINELA_PLANTILLA, provisionar } from "./provisionar.mjs";

test("[AC-FTEN-02] plantilla al día con el disco y con los tenants: cero rezagos", () => {
  const motivos = rezagosDeLaPlantilla({
    enDisco: ["0001_identidad_del_tenant"],
    plantilla: ["0001_identidad_del_tenant"],
    tenants: [
      { bd: "t_alfa", versiones: ["0001_identidad_del_tenant"] },
      { bd: "t_beta", versiones: ["0001_identidad_del_tenant"] },
    ],
  });
  assert.deepEqual(motivos, []);
});

test("[AC-FTEN-02] el caso de rebote: 0002 aplicada a un tenant y no a la plantilla ⇒ rezago", () => {
  const motivos = rezagosDeLaPlantilla({
    enDisco: ["0001_identidad", "0002_paradas"],
    plantilla: ["0001_identidad"],
    tenants: [{ bd: "t_alfa", versiones: ["0001_identidad", "0002_paradas"] }],
  });
  assert.equal(motivos.length, 1);
  assert.match(motivos[0], /0002_paradas/);
  assert.match(motivos[0], /el disco/);
  assert.match(motivos[0], /t_alfa/);
  assert.match(motivos[0], /nacería desactualizado/);
});

test("[AC-FTEN-02] una migración solo en disco ya es rezago, sin ningún tenant todavía", () => {
  // El primer tenant se provisiona DESPUÉS: si esperáramos a que alguno la tuviera aplicada,
  // el gate estaría verde exactamente durante la ventana en la que el daño se comete.
  const motivos = rezagosDeLaPlantilla({
    enDisco: ["0001_identidad", "0002_paradas"],
    plantilla: ["0001_identidad"],
    tenants: [],
  });
  assert.equal(motivos.length, 1);
  assert.match(motivos[0], /0002_paradas/);
});

test("[AC-FTEN-02] una migración solo en un tenant, borrada del disco, sigue siendo rezago", () => {
  // La plantilla es la 4ª vida de todo cambio de esquema (§4.1): que el archivo ya no esté
  // no arregla que un tenant tenga esquema que la plantilla no sabe reproducir.
  const motivos = rezagosDeLaPlantilla({
    enDisco: ["0001_identidad"],
    plantilla: ["0001_identidad"],
    tenants: [{ bd: "t_alfa", versiones: ["0001_identidad", "0009_a_mano"] }],
  });
  assert.equal(motivos.length, 1);
  assert.match(motivos[0], /0009_a_mano/);
  assert.doesNotMatch(motivos[0], /el disco/);
});

test("[AC-FTEN-02] una misma versión faltante en varios lados se reporta UNA vez, nombrándolos", () => {
  const motivos = rezagosDeLaPlantilla({
    enDisco: ["0002_paradas"],
    plantilla: [],
    tenants: [
      { bd: "t_alfa", versiones: ["0002_paradas"] },
      { bd: "t_beta", versiones: ["0002_paradas"] },
    ],
  });
  assert.equal(motivos.length, 1);
  assert.match(motivos[0], /el disco, t_alfa, t_beta/);
});

test("[AC-FTEN-02] plantilla ADELANTADA no es rezago suyo: el tenant atrasado es del runner", () => {
  // Centinela 13 (BD tenant rezagada ⇒ deploy no verde) es AC-FTEN-07. Esta función mira
  // una sola cosa; si mirara las dos, un rojo del runner se leería como culpa de la plantilla.
  const motivos = rezagosDeLaPlantilla({
    enDisco: ["0001_identidad", "0002_paradas"],
    plantilla: ["0001_identidad", "0002_paradas"],
    tenants: [{ bd: "t_alfa", versiones: ["0001_identidad"] }],
  });
  assert.deepEqual(motivos, []);
});

test("[AC-FTEN-02] cluster vacío y sin migraciones: verde, pero por vacío y no por omisión", () => {
  assert.deepEqual(rezagosDeLaPlantilla(), []);
});

test("[AC-FTEN-02] el centinela de la plantilla es un UUIDv7 con su nibble de versión en 7", () => {
  // Si el centinela dejara de ser v7, el pgTAP de AC-FTEN-08 («toda PK de dominio tiene bits
  // de versión 7») tendría un contraejemplo sembrado por nosotros mismos.
  assert.equal(UUID_CENTINELA_PLANTILLA[14], "7");
  assert.match(UUID_CENTINELA_PLANTILLA, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
});

// --- Dominio de `control.tenants.modo` [AC-FPOR-01] -------------------------------------
// El rebote sobre un modo fuera de dominio se prueba SIN cluster: `provisionar()` valida
// ANTES de la primera llamada a la base, así que un `modo` inválido nunca llega a tocar red
// ni deja una CREATE DATABASE a medio camino — es 0 filas por construcción, no por suerte.

test("[AC-FPOR-01] modo fuera del dominio mi_flota|daas rebota SIN tocar el cluster", async () => {
  await assert.rejects(
    () => provisionar("gate_modo_invalido", { modo: "premium" }),
    /modo inválido.*premium.*mi_flota\|daas/s,
  );
});

test("[AC-FPOR-01] modo vacío o de otro tipo también rebota: el dominio es CERRADO", async () => {
  await assert.rejects(() => provisionar("gate_modo_vacio", { modo: "" }), /modo inválido/);
  await assert.rejects(() => provisionar("gate_modo_mayus", { modo: "DAAS" }), /modo inválido/);
});
