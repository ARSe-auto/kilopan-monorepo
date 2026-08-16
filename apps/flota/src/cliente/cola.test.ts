import { test } from "node:test";
import assert from "node:assert/strict";
import { profundidadDeCola } from "./cola.ts";
import {
  guardarOutbox,
  guardarOutboxRecarga,
  type AlmacenLocal,
  type Identidad,
} from "./outbox-local.ts";

// El contador REAL del cuarto estado obligatorio [AC-FMIG-10] — §5.7.
//
// Lo que estos casos protegen es que el número sea un CONTEO y no una decoración: el defecto que
// el §5.7 cierra es el cartel fijo de «sincronizando», que dice lo mismo con la cola vacía que
// con doce entregas esperando señal. Por eso cada caso mueve la cola de verdad y espera que el
// número se mueva con ella.

const A: Identidad = { tenant: "miga.localhost", usuario: "hash-de-a" };
const B: Identidad = { tenant: "miga.localhost", usuario: "hash-de-b" };

function almacen(): AlmacenLocal {
  const datos = new Map<string, string>();
  return {
    getItem: (llave) => datos.get(llave) ?? null,
    setItem: (llave, valor) => {
      datos.set(llave, valor);
    },
  };
}

function captura(clientUuid: string) {
  return {
    clientUuid,
    paradaId: "parada-1",
    tsDispositivo: "2026-08-15T12:00:00.000Z",
    tzOffsetMin: -240,
    secuenciaDispositivo: 1,
    resultado: "exito" as const,
    metodoEntrega: "receptor" as const,
    motivoId: null,
    items: null,
    evidencias: [],
    estado: "por_replicar" as const,
    supersedeDe: null,
    motivoSupersede: null,
  };
}

function recarga(clientUuid: string) {
  return {
    clientUuid,
    vehiculoId: "vehiculo-1",
    turnoId: null,
    wh: 12_000,
    socInicial: null,
    socFinal: 80,
    tsDispositivo: "2026-08-15T12:00:00.000Z",
    tzOffsetMin: -240,
    estado: "por_replicar" as const,
  };
}

test("un aparato sin nada encolado cuenta 0 — el estado no se inventa pendientes [AC-FMIG-10]", () => {
  assert.equal(profundidadDeCola(almacen()), 0);
});

test("el contador es el LARGO de la cola, no un cartel: crece captura a captura [AC-FMIG-10]", () => {
  const a = almacen();
  guardarOutbox(a, A, [captura("u1")]);
  assert.equal(profundidadDeCola(a), 1);
  guardarOutbox(a, A, [captura("u1"), captura("u2"), captura("u3")]);
  assert.equal(profundidadDeCola(a), 3);
  // Y baja cuando el replay saca las acusadas: un número que solo sube sería otro cartel.
  guardarOutbox(a, A, [captura("u3")]);
  assert.equal(profundidadDeCola(a), 1);
});

test("las dos colas del aparato suman: POD y recarga esperan la misma señal [AC-FMIG-10]", () => {
  const a = almacen();
  guardarOutbox(a, A, [captura("u1")]);
  guardarOutboxRecarga(a, A, [recarga("r1"), recarga("r2")]);
  assert.equal(profundidadDeCola(a), 3, "la cola de recarga quedó fuera del contador");
});

test("cuenta las capturas de TODAS las identidades del aparato — el relevo de turno no las esconde [AC-FMIG-10]", () => {
  // §4.7/AC-FPOD-09: lo de A sigue en el aparato aunque ahora esté B adentro. Contar solo la
  // partición activa mostraría un 0 tranquilo con entregas de otra persona esperando señal.
  const a = almacen();
  guardarOutbox(a, A, [captura("u1"), captura("u2")]);
  guardarOutbox(a, B, [captura("u3")]);
  assert.equal(profundidadDeCola(a), 3);
});

test("un almacén negado o ilegible cuenta 0 en vez de romper la pantalla [AC-FMIG-10]", () => {
  // Modo privado con cuota agotada: el estado obligatorio no puede ser el que tumbe la pantalla
  // que existe justamente para avisar que algo no anda.
  const negado: AlmacenLocal = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.equal(profundidadDeCola(negado), 0);
});
