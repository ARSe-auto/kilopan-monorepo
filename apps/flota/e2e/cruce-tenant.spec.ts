import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { casosDelRepo } from "../rutas/generar.mjs";
import {
  juzgarCruce,
  juzgarHuella,
  centinelasDe,
  centinelasIndistinguibles,
} from "../rutas/veredicto.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Suite HTTP A-contra-B AUTOGENERADA del manifiesto de rutas [AC-FTEN-26] — centinela 2 del
// §9.3, exigida por §9.2 dentro de `check.sh --full`.
//
// Este archivo NO enumera rutas: las lee del manifiesto comiteado (`rutas/manifiesto.json`,
// derivado del árbol de `src/app/**`) y emite un caso por cada ruta y método. Es a propósito
// que no haya una lista acá: una lista escrita a mano se queda corta el día que alguien
// agrega un endpoint, y ese día el aislamiento del §4.1 deja de estar probado sin que ningún
// test se ponga rojo. Ningún módulo 01–08 escribe su propia suite: la declaran en
// Dependencias apuntando a este AC.
//
// Los requests van con `node:http` y no con la API de Playwright por la misma razón que en
// `ruteo.spec.ts`: la identidad del tenant se juega en la cabecera `Host`, que un navegador
// tiene prohibido fijar.

const PUERTO = PUERTO_E2E;
const DOMINIO = "localhost";

const ACTIVOS = TENANTS.filter((t) => t.estado === "activo");
// A es quien pide; B es el vecino cuyos datos jamás pueden salir. El orden NO es arbitrario:
// «ruteo_activo» es subcadena de «ruteo_activo_b», así que al revés los centinelas de B
// dispararían contra la respuesta legítima de A. Lo verifica el primer test, para que el día
// que entre otro par de nombres esto se caiga en vez de ponerse verde por casualidad.
const A = ACTIVOS[0]!;
const B = ACTIVOS[1]!;
const BD_A = bdDeTenant(A.slug);
const BD_B = bdDeTenant(B.slug);

// `rutas/*.mjs` es JavaScript de operación y no exporta tipos (mismo trato que
// `db/flota/*.mjs` en `ruteo.spec.ts`): se declara acá la forma que este archivo usa, en vez
// de dejar que `any` se cuele en las aserciones.
type Ruta = { ruta: string; metodos: string[]; params: string[]; cruce: unknown };
type Exencion = { ruta: string; justificacion: string };
type Caso = {
  ruta: string;
  metodo: string;
  tipo: string;
  muta: boolean;
  ids_de_b: { tabla: string; columna: string } | null;
};

const { manifiesto, exenciones, casos } = casosDelRepo() as {
  manifiesto: { rutas: Ruta[] };
  exenciones: Exencion[];
  casos: Caso[];
};

type Conexion = { sql: <T = Record<string, string>>(texto: string, params?: unknown[]) => Promise<T[]> };
type Respuesta = { status: number; cuerpo: string; cabeceras: Record<string, string | string[] | undefined> };

/** Un request con el método, la ruta y las cabeceras que se le antojen. */
function pedirA(
  host: string,
  ruta: string,
  metodo: string,
  extra: Record<string, string> = {},
): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const req = pedir(
      { host: "127.0.0.1", port: PUERTO, path: ruta, method: metodo, headers: { Host: host, ...extra } },
      (res) => {
        let cuerpo = "";
        res.setEncoding("utf8");
        res.on("data", (t) => (cuerpo += t));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, cuerpo, cabeceras: res.headers }));
      },
    );
    req.on("error", rechazar);
    req.end();
  });
}

const hostDe = (slug: string) => `${slug}.${DOMINIO}:${PUERTO}`;

const SQL_TABLAS = `select table_schema || '.' || table_name as t
                    from information_schema.tables
                    where table_type = 'BASE TABLE'
                      and table_schema not in ('pg_catalog', 'information_schema')
                    order by 1`;

/**
 * Conteo de filas por tabla de una base. Es la huella contra la que se compara «la BD de B
 * sin cambios» después de una mutación. Se lee del catálogo y no de una lista escrita acá:
 * una tabla que nace en el módulo 03 quedaría fuera de una lista y su fuga no se vería.
 */
async function huellaDe(bd: string): Promise<Record<string, number>> {
  return await con(bd, async (c: Conexion) => {
    const tablas = await c.sql<{ t: string }>(SQL_TABLAS);
    const huella: Record<string, number> = {};
    for (const { t } of tablas) {
      // Los nombres salen del catálogo de esta misma base, pero se validan igual antes de
      // interpolarlos: una interpolación sin guardia es una interpolación sin guardia.
      if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`tabla rara: ${t}`);
      const filas = await c.sql<{ n: string }>(`select count(*)::text as n from ${t}`);
      huella[t] = Number(filas[0]?.n ?? "0");
    }
    return huella;
  });
}

// ─── Guardias: sin esto, un verde de esta suite no significaría nada ──────────────────

test("la suite tiene casos que correr y salen del manifiesto [AC-FTEN-26]", () => {
  // Una suite autogenerada que emite cero casos pasa en verde sin haber pedido una sola vez.
  // Es el falso verde más barato de todos, y el que este arnés existe para matar.
  expect(casos.length).toBeGreaterThan(0);
  expect(casos.length).toBe(
    manifiesto.rutas
      .filter((r) => !exenciones.some((e) => e.ruta === r.ruta))
      .reduce((n, r) => n + r.metodos.length, 0),
  );
});

test("los centinelas de B se distinguen de la identidad propia de A [AC-FTEN-26]", () => {
  // Si una cadena de B fuera subcadena de la identidad de A, la respuesta legítima de A
  // dispararía el centinela: la suite se pondría roja por una coincidencia de nombres y el
  // arreglo cómodo sería ablandar el centinela. Se verifica en vez de confiar en el orden.
  expect(centinelasIndistinguibles([A.slug, BD_A], centinelasDe({ slug: B.slug, bd: BD_B }))).toEqual([]);
});

test("la identidad de B es OBSERVABLE por la app: el centinela no es una cadena muerta [AC-FTEN-26]", () => {
  // La otra mitad de la anti-vacuidad. «La respuesta de A no contiene nada de B» es trivial
  // si esas cadenas no salen NUNCA de la app. Acá se prueba que sí salen — por el subdominio
  // de B, que es el único lugar donde deben salir.
  return pedirA(hostDe(B.slug), "/api/tenant", "GET").then((r) => {
    expect(r.status).toBe(200);
    const cuerpo = JSON.parse(r.cuerpo) as { slug: string; bd: string };
    expect(cuerpo.slug).toBe(B.slug);
    expect(cuerpo.bd).toBe(BD_B);
  });
});

test("la huella detecta un cambio real en la BD de B [AC-FTEN-26]", async () => {
  // `juzgarHuella` está probado con mutantes en unit, pero contra objetos inventados. Lo que
  // este test prueba es lo otro: que `huellaDe` lee de verdad la base y que una fila de más
  // se ve. Sin esto, la mitad «la BD de B sin cambios» del centinela 2 sería un comparador
  // perfecto alimentado por un lector que nadie ejerció — y no habrá ruta que mute hasta el
  // módulo 03. La fila se inserta y se borra en la BD del fixture, que se recrea cada corrida.
  const antes = await huellaDe(BD_B);
  expect(Object.keys(antes).length).toBeGreaterThan(0);

  await con(BD_B, (c: Conexion) => c.sql("insert into grupos (nombre) values ($1)", ["cruce-huella"]));
  const conFila = await huellaDe(BD_B);
  const veredicto = juzgarHuella(antes, conFila);
  expect(veredicto.ok).toBe(false);
  expect(veredicto.motivo).toContain("public.grupos");

  await con(BD_B, (c: Conexion) => c.sql("delete from grupos where nombre = $1", ["cruce-huella"]));
  expect(juzgarHuella(antes, await huellaDe(BD_B)).ok).toBe(true);
});

// ─── Los casos, uno por ruta y método, emitidos del manifiesto ─────────────────────────

for (const caso of casos) {
  test(`${caso.metodo} ${caso.ruta} — sesión de A con identidad de B ⇒ sin rastro de B [AC-FTEN-26]`, async () => {
    // El identificador ajeno sale de la BD de B: es el único lugar de donde puede salir un
    // ID de B de verdad. Hoy ninguna ruta es de tipo «recurso» (el primer endpoint con
    // parámetro nace en el módulo 01) y esta rama no se ejerce todavía; su juicio sí, en
    // `veredicto.test.mjs`, que es donde vive la evidencia del «404 jamás 403».
    let idDeB: string | null = null;
    let ruta = caso.ruta;
    if (caso.tipo === "recurso" && caso.ids_de_b) {
      const { tabla, columna } = caso.ids_de_b as { tabla: string; columna: string };
      const filas = await con(BD_B, (c: Conexion) =>
        c.sql<{ v: string }>(`select ${columna}::text as v from ${tabla} limit 1`),
      );
      idDeB = filas[0]?.v ?? null;
      expect(idDeB, `la BD de B no tiene ninguna fila en ${tabla}: el cruce no probaría nada`).not.toBeNull();
      ruta = ruta.replace(/\[\[?\.{0,3}[^\]]+\]\]?/, encodeURIComponent(idDeB!));
    }

    const centinelas = centinelasDe({ slug: B.slug, bd: BD_B, id: idDeB });
    const huellaAntes = caso.muta ? await huellaDe(BD_B) : null;

    // El ataque: host PROPIO —el atacante tiene su cuenta— y la identidad del vecino metida
    // por todos los canales falsificables que existen hoy. Pedirlo desde el host de B no
    // probaría nada: eso es un tenant pidiendo lo suyo.
    const r = await pedirA(hostDe(A.slug), ruta, caso.metodo, {
      "x-flota-tenant-slug": B.slug,
      "x-flota-tenant-bd": BD_B,
    });

    const veredicto = juzgarCruce(r, { tipo: caso.tipo, centinelas });
    expect(veredicto.ok, `${caso.metodo} ${ruta}: ${veredicto.motivo}`).toBe(true);

    if (huellaAntes) {
      const huella = juzgarHuella(huellaAntes, await huellaDe(BD_B));
      expect(huella.ok, huella.motivo ?? "").toBe(true);
    }
  });
}
