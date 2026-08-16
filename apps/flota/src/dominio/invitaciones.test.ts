import test from "node:test";
import assert from "node:assert/strict";
import { INVITACION } from "../../../../packages/nucleo-comun/src/constants.ts";
import {
  codigoNuevo,
  normalizarCodigo,
  hashDeCodigo,
  expiraEn,
  veredictoDe,
  pausar,
  reanudar,
  type Invitacion,
} from "./invitaciones.ts";

// Mutantes del dominio de la invitación [AC-FIDN-03].
//
// Todo lo que acá se asierta contra un número o un alfabeto se lee del canónico §0: escribir
// el 8 o la lista de caracteres en este archivo lo volvería una copia de la familia, y la
// copia es la que se queda vieja. El gate de constantes lo pondría en rojo, y con razón.

const AHORA = new Date("2026-08-09T12:00:00Z");
const invitacion = (parcial: Partial<Invitacion> = {}): Invitacion => ({
  expira_at: expiraEn(AHORA),
  pausada_at: null,
  revocada_at: null,
  ...parcial,
});

// ─── El código: largo, alfabeto y uniformidad ────────────────────────────────────────

test("[AC-FIDN-03] el código tiene el largo y el alfabeto del §0, sin caracteres ambiguos", () => {
  for (let i = 0; i < 200; i++) {
    const c = codigoNuevo();
    assert.equal(c.length, INVITACION.codigo_corto_largo);
    for (const ch of c) {
      assert.ok(INVITACION.codigo_corto_alfabeto.includes(ch), `carácter fuera del alfabeto: ${ch}`);
    }
  }
});

test("[AC-FIDN-03] el alfabeto no trae ningún par que se confunda al oído ni a la vista", () => {
  // El código se dicta en un galpón ruidoso y se teclea con guantes. Esta prueba está acá y
  // no en el canónico porque es la propiedad que hace que el alfabeto SIRVA: alguien podría
  // «completarlo» agregando letras y el largo seguiría siendo 8.
  for (const ambiguo of ["0", "O", "1", "I", "L"]) {
    assert.ok(
      !INVITACION.codigo_corto_alfabeto.includes(ambiguo),
      `el alfabeto trae «${ambiguo}», que se confunde al dictarlo`,
    );
  }
});

test("[AC-FIDN-03] dos códigos seguidos no son el mismo: hay azar de verdad", () => {
  // Una generación rota —un contador, una semilla fija, un Math.random() congelado en un
  // test— se ve exactamente igual que una buena mirando UN código.
  const vistos = new Set<string>();
  for (let i = 0; i < 500; i++) vistos.add(codigoNuevo());
  assert.equal(vistos.size, 500, "hubo códigos repetidos en 500 tiradas");
});

test("[AC-FIDN-03] el alfabeto se usa ENTERO: ningún carácter queda inalcanzable", () => {
  // Un `% ALFABETO.length` mal escrito, o un randomInt con el borde corrido, deja el último
  // carácter sin salir nunca y nadie lo nota: los códigos siguen pareciendo códigos. Con
  // 500×8 tiradas sobre 31 caracteres, que falte uno es prácticamente imposible por azar.
  const salieron = new Set<string>();
  for (let i = 0; i < 500; i++) for (const c of codigoNuevo()) salieron.add(c);
  assert.equal(
    salieron.size,
    INVITACION.codigo_corto_alfabeto.length,
    `quedaron caracteres inalcanzables: ${[...INVITACION.codigo_corto_alfabeto].filter((c) => !salieron.has(c)).join("")}`,
  );
});

// ─── Normalizar lo que tecleó una persona ────────────────────────────────────────────

test("[AC-FIDN-03] minúsculas, espacios y guiones no cambian QUÉ código es", () => {
  const c = codigoNuevo();
  assert.equal(normalizarCodigo(c.toLowerCase()), c);
  assert.equal(normalizarCodigo(`  ${c}  `), c);
  assert.equal(normalizarCodigo(`${c.slice(0, 4)}-${c.slice(4)}`), c);
});

test("[AC-FIDN-03] un carácter ambiguo NO se «corrige»: abriría códigos que nadie emitió", () => {
  // Mapear O→0 o l→1 parece amable y es un agujero: el alfabeto del §0 ya excluye esos
  // caracteres, así que una O no es un cero mal escrito — es un carácter que no existe en
  // ningún código emitido, y aceptarlo multiplicaría el espacio que un atacante puede probar.
  const base = codigoNuevo();
  const conAmbiguo = "O" + base.slice(1);
  assert.equal(normalizarCodigo(conAmbiguo), null);
  assert.equal(normalizarCodigo(base.slice(1)), null, "un código corto de menos no vale");
  assert.equal(normalizarCodigo(base + "Z"), null, "ni uno de más");
  assert.equal(normalizarCodigo(""), null);
});

// ─── El hash: la invitación no se puede leer de la base y reusar ─────────────────────

test("[AC-FIDN-03] en la BD queda el hash, no el código", () => {
  const c = codigoNuevo();
  const h = hashDeCodigo(c);
  assert.notEqual(h, c);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashDeCodigo(c), h, "el mismo código tiene que dar el mismo hash");
  assert.notEqual(hashDeCodigo(codigoNuevo()), h);
});

// ─── El plazo y los cuatro desenlaces ────────────────────────────────────────────────

test("[AC-FIDN-03] el plazo es el del §0, leído y no reescrito", () => {
  const dias = (expiraEn(AHORA).getTime() - AHORA.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(dias, INVITACION.expira_dias);
});

test("[AC-FIDN-03] una invitación recién emitida está vigente", () => {
  assert.equal(veredictoDe(invitacion(), AHORA), "vigente");
});

test("[AC-FIDN-03] vencida es vencida, y el instante exacto ya cuenta como vencido", () => {
  const inv = invitacion();
  const justo = new Date(inv.expira_at.getTime());
  assert.equal(veredictoDe(inv, justo), "expirada");
  assert.equal(veredictoDe(inv, new Date(justo.getTime() - 1)), "vigente");
});

test("[AC-FIDN-03] pausada rebota, y reanudar NO mueve la fecha de vencimiento", () => {
  const inv = invitacion();
  const pausada = pausar(inv, AHORA);
  assert.equal(veredictoDe(pausada, AHORA), "pausada");
  assert.equal(pausada.expira_at.getTime(), inv.expira_at.getTime(), "la pausa movió expira_at");

  const reanudada = reanudar(pausada);
  assert.equal(veredictoDe(reanudada, AHORA), "vigente");
  assert.equal(reanudada.expira_at.getTime(), inv.expira_at.getTime(), "reanudar movió expira_at");

  // Y la consecuencia que el §5.4 pide de frente: pausada el día 6 y reanudada el día 9,
  // está vencida. El plazo acota la VENTANA, no cuenta tiempo de uso.
  const dia9 = new Date(inv.expira_at.getTime() + 2 * 24 * 60 * 60 * 1000);
  assert.equal(veredictoDe(reanudada, dia9), "expirada");
});

test("[AC-FIDN-03] revocada gana sobre pausada y sobre expirada", () => {
  // Revocar es el acto deliberado del dueño y tiene efecto inmediato (F-F). Si una revocada
  // vencida dijera «expiró», el dueño no podría distinguir su propia acción de que se le pasó
  // la fecha — y esa distinción es la que necesita cuando alguien reclama que no puede entrar.
  const revocada = invitacion({ revocada_at: AHORA, pausada_at: AHORA });
  assert.equal(veredictoDe(revocada, AHORA), "revocada");
  const vieja = invitacion({ revocada_at: AHORA, expira_at: new Date(AHORA.getTime() - 1) });
  assert.equal(veredictoDe(vieja, AHORA), "revocada");
});

test("[AC-FIDN-03] pausar dos veces no corre la marca: la primera pausa manda", () => {
  const inv = invitacion();
  const luego = new Date(AHORA.getTime() + 60_000);
  assert.equal(pausar(pausar(inv, AHORA), luego).pausada_at?.getTime(), AHORA.getTime());
});
