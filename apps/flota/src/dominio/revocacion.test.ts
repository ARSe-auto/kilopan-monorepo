import test from "node:test";
import assert from "node:assert/strict";
import { REVOCACION } from "../../../../packages/nucleo-comun/src/constants.ts";
import { clasificar, flagDe, revisionDe, rechaza } from "./revocacion.ts";

// Mutantes de la clasificación post-revocación [AC-FIDN-09] — centinela 4 del §9.3.
//
// Ni una hora escrita acá: la ventana se lee del canónico §0. Si el maestro la cambiara, este
// test seguiría siendo cierto — y si alguien la copiara en el código, el gate de constantes
// lo marcaría.

const REVOCADO = new Date("2026-08-09T04:00:00Z");
const enHoras = (h: number) => new Date(REVOCADO.getTime() + h * 3_600_000);

test("[AC-FIDN-09] un aparato vigente no marca nada", () => {
  assert.equal(clasificar(null, enHoras(1000)), "vigente");
  assert.equal(flagDe("vigente"), null);
  assert.equal(revisionDe("vigente"), null);
});

test("[AC-FIDN-09] dentro de la ventana: flag y NADA de bandeja", () => {
  // La que llega tarde por falta de señal se marca y se sigue. Si cada captura demorada
  // abriera una fila de revisión, la bandeja se llenaría de ruido el día que un camión pasa
  // la noche en un valle sin cobertura — y la que importa se perdería entre ellas.
  for (const h of [0, 1, REVOCACION.ventana_horas - 1, REVOCACION.ventana_horas]) {
    assert.equal(clasificar(REVOCADO, enHoras(h)), "post_revocacion", `a las ${h} h`);
  }
  assert.equal(flagDe("post_revocacion"), REVOCACION.flag_dentro);
  assert.equal(revisionDe("post_revocacion"), null);
});

test("[AC-FIDN-09] pasada la ventana: otro flag y bandeja con severidad alta", () => {
  // Un aparato revocado que sigue sincronizando pasada la ventana ya no se explica por falta
  // de señal. Ahí deja de ser una anomalía y pasa a ser un incidente.
  const apenas = new Date(enHoras(REVOCACION.ventana_horas).getTime() + 1);
  assert.equal(clasificar(REVOCADO, apenas), "post_revocacion_tardia");
  assert.equal(clasificar(REVOCADO, enHoras(REVOCACION.ventana_horas * 10)), "post_revocacion_tardia");
  assert.equal(flagDe("post_revocacion_tardia"), REVOCACION.flag_fuera);
  assert.deepEqual(revisionDe("post_revocacion_tardia"), { severidad: "alta" });
});

test("[AC-FIDN-09] el borde exacto de la ventana todavía es «dentro»", () => {
  // El único lugar donde alguien va a mirar. Con `<` en vez de `<=`, la captura que llega
  // justo en el segundo del corte saltaría a severidad alta sin que nada lo justifique.
  assert.equal(clasificar(REVOCADO, enHoras(REVOCACION.ventana_horas)), "post_revocacion");
  assert.equal(
    clasificar(REVOCADO, new Date(enHoras(REVOCACION.ventana_horas).getTime() + 1)),
    "post_revocacion_tardia",
  );
});

test("[AC-FIDN-09] los dos flags son distintos y salen del canónico", () => {
  // Con un solo flag para los dos casos, la bandeja no podría distinguir «venía sin señal» de
  // «sigue usando un aparato dado de baja», que es toda la información que este AC produce.
  assert.notEqual(REVOCACION.flag_dentro, REVOCACION.flag_fuera);
  assert.notEqual(flagDe("post_revocacion"), flagDe("post_revocacion_tardia"));
});

test("[AC-FIDN-09] NINGUNA clase rechaza: rechazos = 0 (centinela 4)", () => {
  // La mitad del centinela que no se puede probar mirando una respuesta: no hay camino, en
  // ninguna de las tres clases, que termine en un rebote. La captura del terreno jamás rebota.
  for (const clase of ["vigente", "post_revocacion", "post_revocacion_tardia"] as const) {
    assert.equal(rechaza(clase), false, `la clase ${clase} rechaza`);
  }
});
