import test from "node:test";
import assert from "node:assert/strict";
import { profundidadDeManifiesto, profundidadValida, type NodoDeNavegacion } from "./manifiesto-profundidad.ts";

// Mutantes de "máx 2 niveles de profundidad" [AC-FMIG-21] — §5.1.
//
// El caso que tiene que poder fallar es el de 3 niveles: eso es exactamente lo que el manifest
// de HOY (`servidor/manifiesto.ts`) no puede producir todavía (es plano), pero que la spec
// admite mañana vía `subitems` — el chequeo tiene que rechazarlo cuando aparezca.

test("[AC-FMIG-21] manifest vacío: profundidad 0, válida", () => {
  assert.equal(profundidadDeManifiesto([]), 0);
  assert.equal(profundidadValida([]), true);
});

test("[AC-FMIG-21] manifest plano (sin subitems): profundidad 1, válida", () => {
  const items: NodoDeNavegacion[] = [{}, {}];
  assert.equal(profundidadDeManifiesto(items), 1);
  assert.equal(profundidadValida(items), true);
});

test("[AC-FMIG-21] un nivel de subitems: profundidad 2, todavía válida (el límite exacto)", () => {
  const items: NodoDeNavegacion[] = [{ subitems: [{}, {}] }, {}];
  assert.equal(profundidadDeManifiesto(items), 2);
  assert.equal(profundidadValida(items), true);
});

test("[AC-FMIG-21] MUTANTE — subitems con sus propios subitems: profundidad 3 ⇒ rojo", () => {
  const items: NodoDeNavegacion[] = [{ subitems: [{ subitems: [{}] }] }];
  assert.equal(profundidadDeManifiesto(items), 3);
  assert.equal(profundidadValida(items), false);
});

test("[AC-FMIG-21] la profundidad es la del hijo MÁS hondo, no el promedio", () => {
  const items: NodoDeNavegacion[] = [{ subitems: [{}] }, { subitems: [{ subitems: [{}] }] }];
  assert.equal(profundidadDeManifiesto(items), 3);
  assert.equal(profundidadValida(items), false);
});
