import test from "node:test";
import assert from "node:assert/strict";
import { SESION } from "../../../../packages/nucleo-comun/src/constants.ts";
import { HUELLA_ANDEN, huellaNueva, vencioPorInactividad } from "./anden.ts";

// Mutantes de la identidad rotatoria del andén [AC-FIDN-07] — §5.4 F-D, §0 (`SESION`), §4.7.
//
// Se prueba puro lo que no necesita cluster: el borde del plazo (sin esperar tres minutos de
// reloj real) y la forma de la huella. Lo que sí necesita base —la rotación, el lockout por
// usuario, el replay del outbox del anterior— vive en `e2e/anden.spec.ts`.

const T0 = new Date("2026-08-12T09:00:00.000Z");
const enMinutos = (m: number) => new Date(T0.getTime() + m * 60_000);

test("[AC-FIDN-07] recién rotada, la identidad del andén está viva", () => {
  assert.equal(vencioPorInactividad(T0, T0), false);
});

test("[AC-FIDN-07] el plazo sale de la constante del §0 y no de un número escrito acá", () => {
  const justoEnElBorde = enMinutos(SESION.anden_inactividad_minutos);
  // Exactamente en el borde sigue viva: el operario tiene el plazo COMPLETO que se le prometió.
  assert.equal(vencioPorInactividad(T0, justoEnElBorde), false);
  assert.equal(vencioPorInactividad(T0, new Date(justoEnElBorde.getTime() + 1)), true);
});

test("[AC-FIDN-07] el andén sí cierra por inactividad — es lo que lo separa del teléfono personal", () => {
  // El §0 lo dice con las dos mitades: `personal_caduca: false` y el andén con su plazo. Si esta
  // función devolviera siempre `false` sería el aparato personal, y la firma de quien se fue
  // quedaría puesta sobre el trabajo de quien llegó.
  assert.equal(SESION.personal_caduca, false);
  assert.equal(vencioPorInactividad(T0, enMinutos(SESION.anden_inactividad_minutos + 1)), true);
  assert.equal(vencioPorInactividad(T0, enMinutos(600)), true);
});

test("[AC-FIDN-07] un reloj que va para atrás no vence nada", () => {
  // `ultimo_uso_en` lo escribe el servidor, pero la comparación tiene que ser sana igual: una
  // resta negativa jamás puede leerse como un plazo cumplido.
  assert.equal(vencioPorInactividad(enMinutos(10), T0), false);
});

test("[AC-FIDN-07] la huella tiene la MISMA forma que la del enrolamiento personal", () => {
  // El lote de sync manda un solo campo `enrolamiento` (cliente/outbox.ts) y el servidor resuelve
  // las dos clases contra él. Si la huella del andén tuviera otra forma, el filtro de
  // `servidor/capturas.ts` la descartaría antes de buscarla y las capturas del andén aterrizarían
  // a nombre de quien las transmitió — el bug exacto que el centinela 9 prohíbe.
  assert.match(huellaNueva(), HUELLA_ANDEN);
  assert.equal(huellaNueva().length, 64);
});

test("[AC-FIDN-07] dos huellas nunca son la misma: la partición de A no es la de B", () => {
  const emitidas = new Set(Array.from({ length: 200 }, () => huellaNueva()));
  assert.equal(emitidas.size, 200);
});

test("[AC-FIDN-07] la huella NO es derivable de los ids: 32 bytes de entropía, no un hash de datos conocidos", () => {
  // Un mutante que cambiara `randomBytes(32)` por un hash de (aparato, operario) pasaría los dos
  // tests de arriba y rompería la propiedad que importa. Lo que se puede exigir sin conocer la
  // implementación es que el resultado no se pueda predecir: ninguna posición del hexa queda
  // fija entre emisiones, que es lo que un derivado de constantes sí dejaría.
  const muestras = Array.from({ length: 64 }, () => huellaNueva());
  for (let i = 0; i < 64; i += 1) {
    const distintos = new Set(muestras.map((h) => h[i]));
    assert.ok(distintos.size > 1, `la posición ${i} de la huella no varía entre emisiones`);
  }
});
