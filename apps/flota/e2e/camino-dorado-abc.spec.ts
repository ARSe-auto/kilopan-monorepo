import { test, expect } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { con } from "../../../db/flota/conectar.mjs";
import { sembrarTenantA, CENTINELA_A } from "../../../db/flota/seeds/tenant-a.mjs";
import { sembrarTenantB, CENTINELA_B } from "../../../db/flota/seeds/tenant-b.mjs";
import { sembrarTenantC, CENTINELA_C } from "../../../db/flota/seeds/tenant-c.mjs";
import { huellaDeCentinela } from "../../../db/flota/seeds/comun.mjs";
import { hashDeSecreto } from "../src/dominio/secretos.ts";
import { PUERTO_E2E } from "./puerto.ts";

// El e2e HTTP del camino dorado A/B/C sobre los 3 seeds del hito (g) [AC-FMIG-27] —
// specs/flota/08-diseno-miga-onboarding.md §7, §10 y §9.3.2 (centinela 2) del maestro
// (docs/PROMPT_MAESTRO_FLOTA.md). Depende de AC-FMIG-25 (tenant A) y AC-FMIG-26 (operación de
// B): sin ellos no hay camino dorado de los tres tenants que recorrer.
//
// ─── QUÉ RECORRE, Y POR QUÉ ESTOS TRES SALTOS Y NO LA MATRIZ ENTERA ────────────────────────
//
// La suite HTTP A-contra-B del manifiesto de rutas (AC-FTEN-26, `cruce-tenant.spec.ts`) YA
// cubre —con fixtures genéricos, exhaustivamente— cada ruta × método del catálogo. Este AC no
// repite esa cobertura: recorre el camino dorado con los datos REALES de los 3 seeds del §10
// (A «e-auto DaaS», B «Rutapan», C «Demo Mi Flota») y prueba, con UNA fila real de cada
// vecino, el caso de rebote que el texto del AC nombra: «una fila cruzada entre tenants ⇒
// rojo, verificado por el 404 de la ruta Y por el barrido de huella de la BD del vecino».
// A → B → C → A cierra el ciclo tocando cada par una vez, sin pagar el costo de recrear los 3
// seeds por cada combinación.
//
// ─── LA IDENTIDAD QUE HACE LOS REQUESTS ────────────────────────────────────────────────────
//
// La sesión de FLOTA es `Authorization: Portador <secreto>` (apps/flota/src/servidor/sesion.ts)
// y el secreto de los actores que YA siembran `tenant-a/b/c.mjs` no sirve para autenticar por
// HTTP a propósito: el de `admin_tenant` es un literal inerte («no abre nada», comun.mjs) y el
// de cada chofer real sale SELLADO contra una clave ECDH efímera que el propio seed descarta
// (`aprobar()`, AC-FIDN-04 — «el valor en claro no se guarda ni se devuelve», por diseño de
// seguridad). Por eso este archivo sigue el MISMO patrón que `apertura.spec.ts`/
// `pod-feliz.spec.ts`: siembra su PROPIO dispositivo por tenant, con un secreto que sí conoce
// (`hashDeSecreto` es el mismo que usa `resolverSesion` para compararlo). No es un atajo sobre
// el AC dueño de la identidad: es una identidad de LECTURA nueva y propia de este archivo,
// sobre la base física que los seeds de A/B/C ya dejaron con datos reales.
const SLUG_A = "camino_dorado_a";
const SLUG_B = "camino_dorado_b";
const SLUG_C = "camino_dorado_c";

/** RUT sin usar por ninguno de los tres seeds (`db/flota/ruts-sinteticos.mjs`, AC-FIDN-21):
 *  ninguna de las personas que `tenant-a/b/c.mjs` siembran lleva este RUT en su propia base
 *  física, así que el visor no choca con ningún UNIQUE de identidad del seed que extiende. */
const RUT_VISOR = "20.347.878-K";

type Fila = Record<string, string>;
type Conexion = { sql: <T = Fila>(t: string, p?: unknown[]) => Promise<T[]> };

/** Siembra un dispositivo de LECTURA propio de este archivo, por el camino directo —igual que
 *  `apertura.spec.ts`—, y devuelve el secreto en claro para el header `Authorization`. */
async function sembrarVisorDelCaminoDorado(bd: string, centinela: string): Promise<string> {
  const secreto = randomUUID();
  await con(bd, async (c: Conexion) => {
    const [persona] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
      [RUT_VISOR, `Visora del camino dorado ${centinela}`],
    );
    const [usuario] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [persona!.id],
    );
    await c.sql(
      `insert into dispositivos
         (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [persona!.id, hashDeSecreto(secreto), usuario!.id],
    );
  });
  return secreto;
}

type Respuesta = { status: number; cuerpo: string };

/** Un GET real contra el servidor del e2e, con el `Host` del subdominio del tenant —el mismo
 *  ruteo que resuelve `servidor.mjs` en producción (`resolverHost`, AC-FTEN-05)— y la sesión
 *  real del visor. Nada de cabeceras de tenant falsificadas: eso es lo que ya prueba
 *  `cruce-tenant.spec.ts`; acá el ataque es más simple y más real todavía — una sesión legítima
 *  de un tenant pidiendo el id de una fila que vive en la base de OTRO. */
function pedir(slug: string, ruta: string, secreto: string | null): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const cabeceras: Record<string, string> = { Host: `${slug}.localhost:${PUERTO_E2E}` };
    if (secreto) cabeceras.Authorization = `Portador ${secreto}`;
    const req = httpRequest(
      { host: "127.0.0.1", port: PUERTO_E2E, path: ruta, method: "GET", headers: cabeceras },
      (res) => {
        let cuerpo = "";
        res.setEncoding("utf8");
        res.on("data", (t) => (cuerpo += t));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, cuerpo }));
      },
    );
    req.on("error", rechazar);
    req.end();
  });
}

/** `sembrarTenantB` devuelve UNION —con/sin `operacion`— porque `conOperacion` es un default
 *  de runtime y no algo que TS pueda estrechar desde el call site. Este archivo SIEMPRE llama
 *  con el default (`true`), así que la forma real en runtime es la que trae `operacion`. */
type TenantBConOperacion = Awaited<ReturnType<typeof sembrarTenantB>> & {
  operacion: { rutas: { norte: { diaId: string }; sur: { diaId: string } } };
};

let a: Awaited<ReturnType<typeof sembrarTenantA>>;
let b: TenantBConOperacion;
let c: Awaited<ReturnType<typeof sembrarTenantC>>;
let secretoA: string;
let secretoB: string;
let secretoC: string;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  try {
    await con("postgres", (conexion: Conexion) => conexion.sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${(e as Error).message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }

  a = await sembrarTenantA(SLUG_A, { recrear: true });
  b = (await sembrarTenantB(SLUG_B, { recrear: true })) as TenantBConOperacion;
  c = await sembrarTenantC(SLUG_C, { recrear: true });

  secretoA = await sembrarVisorDelCaminoDorado(a.bd, CENTINELA_A);
  secretoB = await sembrarVisorDelCaminoDorado(b.bd, CENTINELA_B);
  secretoC = await sembrarVisorDelCaminoDorado(c.bd, CENTINELA_C);
});

// ─── El camino dorado: cada tenant sirve su PROPIA ruta real, con su propio centinela ──────

test("[AC-FMIG-27] A: la ruta consolidada del día se sirve con la identidad de A y ninguna otra", async () => {
  const r = await pedir(SLUG_A, `/api/rutas/${a.ruta.id}`, secretoA);
  expect(r.status).toBe(200);
  expect(r.cuerpo).toContain(CENTINELA_A);
  expect(r.cuerpo).not.toContain(CENTINELA_B);
  expect(r.cuerpo).not.toContain(CENTINELA_C);
});

test("[AC-FMIG-27] B: el recorrido de madrugada norte se sirve con la identidad de B y ninguna otra", async () => {
  const r = await pedir(SLUG_B, `/api/rutas/${b.operacion.rutas.norte.diaId}`, secretoB);
  expect(r.status).toBe(200);
  expect(r.cuerpo).toContain(CENTINELA_B);
  expect(r.cuerpo).not.toContain(CENTINELA_A);
  expect(r.cuerpo).not.toContain(CENTINELA_C);
});

test("[AC-FMIG-27] C: el día demo se sirve con la identidad de C y ninguna otra", async () => {
  const r = await pedir(SLUG_C, `/api/rutas/${c.ruta.id}`, secretoC);
  expect(r.status).toBe(200);
  expect(r.cuerpo).toContain(CENTINELA_C);
  expect(r.cuerpo).not.toContain(CENTINELA_A);
  expect(r.cuerpo).not.toContain(CENTINELA_B);
});

// ─── El caso de rebote del §10: una fila cruzada entre tenants ⇒ rojo, en las dos mitades ──
//
// Centinela 2 (§9.3.2): un 404 dice que la ruta no sirvió el dato, no que el dato no ESTÉ.
// Por eso cada salto verifica las DOS mitades: la respuesta HTTP (404, y sin una sola cadena
// del vecino) Y el barrido de huella de la BD del vecino (`huellaDeCentinela`, el oráculo
// insustituible de AC-FMIG-18) SIN CAMBIOS entre el antes y el después del request cruzado.
// El control positivo (`antes.length > 0`) es lo que impide que «sin cambios» sea vacuo: si el
// barrido no encontrara nada NUNCA, «sin cambios» sería verdad por accidente.

async function esperarRebote(
  desde: { slug: string; secreto: string },
  idAjeno: string,
  vecino: { bd: string; centinela: string },
) {
  const antes = await huellaDeCentinela(vecino.bd, vecino.centinela);
  expect(antes.length, `el centinela de ${vecino.centinela} no aparece en su propia base ${vecino.bd}`).toBeGreaterThan(0);

  const r = await pedir(desde.slug, `/api/rutas/${idAjeno}`, desde.secreto);
  expect(r.status, `la sesión de ${desde.slug} vio algo de la ruta ajena ${idAjeno}: ${r.cuerpo}`).toBe(404);
  expect(r.cuerpo).not.toContain(vecino.centinela);

  const despues = await huellaDeCentinela(vecino.bd, vecino.centinela);
  expect(despues).toEqual(antes);
}

test("[AC-FMIG-27] fila cruzada A→B: 404 y la base de B sin cambios", async () => {
  await esperarRebote({ slug: SLUG_A, secreto: secretoA }, b.operacion.rutas.norte.diaId, {
    bd: b.bd,
    centinela: CENTINELA_B,
  });
});

test("[AC-FMIG-27] fila cruzada B→C: 404 y la base de C sin cambios", async () => {
  await esperarRebote({ slug: SLUG_B, secreto: secretoB }, c.ruta.id, {
    bd: c.bd,
    centinela: CENTINELA_C,
  });
});

test("[AC-FMIG-27] fila cruzada C→A: 404 y la base de A sin cambios", async () => {
  await esperarRebote({ slug: SLUG_C, secreto: secretoC }, a.ruta.id, {
    bd: a.bd,
    centinela: CENTINELA_A,
  });
});
