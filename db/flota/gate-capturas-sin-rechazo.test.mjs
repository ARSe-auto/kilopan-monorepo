import test from "node:test";
import assert from "node:assert/strict";
import {
  canalDeFracasoEn,
  ramasDeFracasoEn,
  muestraPorSincronizar,
  sinComentarios,
} from "./gate-capturas-sin-rechazo.mjs";

// Mutantes de «las capturas JAMÁS muestran rechazo» [AC-FMIG-10] — §5.7, §4.2.
//
// Cada caso rojo de acá es la forma REAL en que el cartel nace: nunca alguien escribiendo «acá
// pongo un rechazo», siempre alguien mirando el replay, viendo que puede no llegar, y decidiendo
// avisar. Cada gemelo verde es el código que HOY existe y que no puede rebotar — un gate que
// muerde el camino correcto se termina apagando.

// ─── (b) La rama de fracaso en la pantalla ──────────────────────────────────────────

test("un `if (confirmadas.length === 0)` es la rama de fracaso y se detecta", () => {
  const tsx = `const confirmadas = await replayar(cola, enviar);
               if (confirmadas.length === 0) setErrorDeEnvio(true);`;
  assert.equal(ramasDeFracasoEn(tsx).ofensoras.length, 1);
});

test("su gemelo negado, `if (!confirmadas.length)`, también", () => {
  const tsx = `const confirmadas = await replayar(cola, enviar);
               if (!confirmadas.length) setMensaje("No se pudo entregar");`;
  assert.equal(ramasDeFracasoEn(tsx).ofensoras.length, 1);
});

test("comparar lo acusado contra lo mandado para avisar «faltaron» también rebota", () => {
  // La versión sofisticada del mismo defecto: «el servidor acusó menos de las que mandé».
  const tsx = `const confirmadas = await replayar(lote, enviar);
               if (confirmadas.length < lote.length) setParcial(true);`;
  assert.equal(ramasDeFracasoEn(tsx).ofensoras.length, 1);
});

test("el identificador se descubre solo, se llame como se llame", () => {
  const tsx = `const acuses = await replayarRecargas(cola, enviar);
               if (acuses.length === 0) setFallo(true);`;
  const { ids, ofensoras } = ramasDeFracasoEn(tsx);
  assert.deepEqual(ids, ["acuses"]);
  assert.equal(ofensoras.length, 1);
});

// ─── Los gemelos verdes: el código que hoy existe ───────────────────────────────────

test("sacar de la cola lo acusado es el único uso legítimo, y no rebota", () => {
  const tsx = `const confirmadas = await replayar(recorrido.cola, enviar, huella);
               if (vivo && confirmadas.length > 0) setRecorrido((r) => sacarDeLaCola(r, confirmadas));`;
  assert.deepEqual(ramasDeFracasoEn(tsx).ofensoras, []);
});

test("el guardia positivo con el `Set` de acusadas tampoco rebota", () => {
  const tsx = `const confirmadas = await replayarRecargas(cola, enviar);
               if (vivo && confirmadas.length > 0) {
                 const acusadas = new Set(confirmadas);
                 setCola((c) => c.filter((cap) => !acusadas.has(cap.clientUuid)));
               }`;
  assert.deepEqual(ramasDeFracasoEn(tsx).ofensoras, []);
});

test("explicar en un comentario por qué no hay rechazo jamás rebota", () => {
  const tsx = `const confirmadas = await replayar(cola, enviar);
               // Si confirmadas.length === 0 no hay nada que mostrarle al chofer (§5.7).
               if (confirmadas.length > 0) setCola(sacarDeLaCola(confirmadas));`;
  assert.deepEqual(ramasDeFracasoEn(tsx).ofensoras, []);
  assert.doesNotMatch(sinComentarios(tsx), /nada que mostrarle/);
});

// ─── (a) El canal de fracaso en el transporte ───────────────────────────────────────

test("devolver un fracaso tipado en vez de los acusados se detecta", () => {
  const ts = `export async function replayar(cola, enviar): Promise<{ ok: boolean }> {
                return { ok: false };
              }`;
  assert.equal(canalDeFracasoEn(ts).length, 1);
});

test("dejar salir una excepción hacia la pantalla se detecta", () => {
  const ts = `export async function replayar(cola, enviar): Promise<string[]> {
                if (!respuesta.ok) throw new Error("no llegó");
                return [];
              }`;
  assert.equal(canalDeFracasoEn(ts).length, 1);
});

test("la firma que hoy existe —Promise<string[]>— no rebota", () => {
  const ts = `export async function replayar(
                cola: readonly CapturaDeEntrega[],
                enviar: Enviar,
                enrolamiento: string | null = null,
              ): Promise<string[]> {
                if (!respuesta || !respuesta.ok) return [];
                return acuses;
              }`;
  assert.deepEqual(canalDeFracasoEn(ts), []);
});

// ─── (c) El positivo, contra el verde vacuo ─────────────────────────────────────────

test("una pantalla que borró el «por sincronizar» entero deja de estar verde", () => {
  // El error opuesto: cumplir «cero rechazo» callándose. El §5.7 pide el contador REAL.
  assert.equal(muestraPorSincronizar(`<section data-testid="banda-undo">Entregado.</section>`), false);
});

test("la sección con su testid y su texto visible sí está verde", () => {
  const tsx = `<section data-testid="por-sincronizar">
                 <p>Entregada — por sincronizar</p>
                 <span data-testid="contador-cola">{enCola}</span>
               </section>`;
  assert.equal(muestraPorSincronizar(tsx), true);
});
