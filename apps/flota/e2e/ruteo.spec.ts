import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { con, BD_CONTROL, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { componer, tenantsRegistrados, POOL_POR_TENANT } from "../../../db/flota/pgbouncer.mjs";
import { TENANTS, SLUG_INEXISTENTE } from "./preparar-tenants.mjs";

// AC-FTEN-05 — ruteo subdominio → lookup en `control` → pool de SU base.
//
// Los requests se hacen con `node:http` y NO con el navegador ni con la API de Playwright: el
// AC se juega entero en la cabecera `Host`, y un navegador tiene prohibido fijarla (es una
// cabecera controlada por el agente de usuario, justamente para que una página no pueda
// hacerse pasar por otro origen). Probar esto con el navegador obligaría a inventar un
// bypass —una cabecera propia que eligiera tenant—, y ese bypass sería un agujero real en
// producción: cualquiera elegiría tenant mandándola.
//
// El servidor lo levanta el `webServer` de Playwright: es el MISMO `servidor.mjs` que corre
// en producción, con su build de producción. No hay simulación de nada.

const PUERTO = 3311;
// El mismo dominio base que `playwright.config.ts` le pasa al servidor. Un valor distinto
// acá haría que cada request diera 404 y el test estaría verde por la razón equivocada.
const DOMINIO = "localhost";

// `db/flota/conectar.mjs` es JavaScript de operación y no exporta tipos: se declara acá la
// forma mínima que este archivo usa, en vez de dejar que `any` se cuele en las aserciones.
type Conexion = { sql: <T = Record<string, string>>(texto: string, params?: unknown[]) => Promise<T[]> };

type Respuesta = { status: number; cuerpo: string; cabeceras: Record<string, string | string[] | undefined> };

/** GET con la cabecera `Host` que se le antoje. Eso es todo lo que este AC necesita. */
function pedirComo(host: string, ruta = "/", extra: Record<string, string> = {}): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const req = pedir(
      { host: "127.0.0.1", port: PUERTO, path: ruta, method: "GET", headers: { Host: host, ...extra } },
      (res) => {
        let cuerpo = "";
        res.setEncoding("utf8");
        res.on("data", (trozo) => (cuerpo += trozo));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, cuerpo, cabeceras: res.headers }));
      },
    );
    req.on("error", rechazar);
    req.end();
  });
}

const hostDe = (slug: string) => `${slug}.${DOMINIO}:${PUERTO}`;

/** Los tenants activos del fixture, en orden estable. Son DOS a propósito (ver el fixture). */
const ACTIVOS = TENANTS.filter((t) => t.estado === "activo");

/** Conexiones abiertas contra una base, leídas del catálogo. No se puede fingir. */
async function conexionesContra(bd: string): Promise<number> {
  return await con(BD_CONTROL, async (control: Conexion) => {
    const filas = await control.sql<{ n: string }>(
      "select count(*)::text as n from pg_stat_activity where datname = $1",
      [bd],
    );
    return Number(filas[0]?.n ?? "0");
  });
}

// ─── La mitad positiva: el subdominio de A opera sobre la BD de A ─────────────────────

test("el subdominio de un tenant activo opera sobre SU base [AC-FTEN-05]", async () => {
  const activo = ACTIVOS[0]!;
  const r = await pedirComo(hostDe(activo.slug), "/api/tenant");

  expect(r.status).toBe(200);
  const cuerpo = JSON.parse(r.cuerpo) as { slug: string; bd: string };
  // El slug NO viene de la cabecera ni de `control`: se lee de `tenant_info` DE SU BASE, que
  // es la fila que la provisión sembró ahí. Es la única forma de probar que el pool que se
  // abrió es el de esa base y no el de otra.
  expect(cuerpo.slug).toBe(activo.slug);
  expect(cuerpo.bd).toBe(bdDeTenant(activo.slug));
});

test("dos subdominios activos se sirven de bases DISTINTAS [AC-FTEN-05]", async () => {
  // Con un solo tenant activo esto se cumpliría por accidente: cualquier base devolvería el
  // único slug que hay. Con dos, un pool compartido o un lookup que ignora el host se delatan.
  const [a, b] = ACTIVOS as [typeof ACTIVOS[0], typeof ACTIVOS[0]];
  const ra = await pedirComo(hostDe(a.slug), "/api/tenant");
  const rb = await pedirComo(hostDe(b.slug), "/api/tenant");
  expect(JSON.parse(ra.cuerpo).slug).toBe(a.slug);
  expect(JSON.parse(rb.cuerpo).slug).toBe(b.slug);
  expect(JSON.parse(ra.cuerpo).bd).not.toBe(JSON.parse(rb.cuerpo).bd);
});

test("una cabecera de tenant falsificada NO elige base [AC-FTEN-05]", async () => {
  // EL ataque de verdad, y el que la primera versión de este test NO montaba: se pedía con un
  // host inexistente, así que el 404 saltaba ANTES de llegar al código de las cabeceras y un
  // servidor que las respetara pasaba igual (mutante vivo, 09-ago-2026). El atacante tiene su
  // propia cuenta: manda un host VÁLIDO —el suyo— y apunta las cabeceras a la base del vecino.
  //
  // El servidor las SOBRESCRIBE después de resolver contra `control`. Si las respetara, todo
  // el aislamiento del §4.1 se caería por una cabecera.
  const [propio, vecino] = ACTIVOS as [typeof ACTIVOS[0], typeof ACTIVOS[0]];
  const r = await pedirComo(hostDe(propio.slug), "/api/tenant", {
    "x-flota-tenant-slug": vecino.slug,
    "x-flota-tenant-bd": bdDeTenant(vecino.slug),
  });

  expect(r.status).toBe(200);
  const cuerpo = JSON.parse(r.cuerpo) as { slug: string; bd: string };
  expect(cuerpo.slug).toBe(propio.slug);
  expect(cuerpo.bd).toBe(bdDeTenant(propio.slug));
  // Y ni rastro del vecino en la respuesta.
  expect(r.cuerpo).not.toContain(vecino.slug);
});

// ─── Los tres rebotes que dictó el dueño: 404 · 503 · 404 ─────────────────────────────

test("subdominio SIN tenant en control ⇒ 404 en es-CL [AC-FTEN-05]", async () => {
  const r = await pedirComo(hostDe(SLUG_INEXISTENTE));
  expect(r.status).toBe(404);
  expect(r.cuerpo).toContain('lang="es-CL"');
  // El cuerpo no puede decir qué pasó: si dijera «no existe» vs «archivado», el texto sería
  // el oráculo que la elección del 404 vino a cerrar.
  expect(r.cuerpo.toLowerCase()).not.toContain("archivad");
  expect(r.cuerpo.toLowerCase()).not.toContain("suspend");
});

test("tenant archivado ⇒ 404 IDÉNTICO al del subdominio inexistente [AC-FTEN-05]", async () => {
  const arch = TENANTS.find((t) => t.estado === "archivado")!;
  const archivado = await pedirComo(hostDe(arch.slug));
  const fantasma = await pedirComo(hostDe(SLUG_INEXISTENTE));

  expect(archivado.status).toBe(404);
  // Idénticos byte a byte, y esa igualdad ES el requisito: cualquier diferencia —una palabra,
  // una cabecera, un largo— distingue el subdominio que existió del que nunca existió.
  expect(archivado.cuerpo).toBe(fantasma.cuerpo);
  expect(archivado.status).toBe(fantasma.status);
});

test("tenant suspendido ⇒ 503 con página propia en es-CL [AC-FTEN-05]", async () => {
  const susp = TENANTS.find((t) => t.estado === "suspendido")!;
  const r = await pedirComo(hostDe(susp.slug));

  expect(r.status).toBe(503);
  expect(r.cuerpo).toContain('lang="es-CL"');
  expect(r.cuerpo).toContain("suspendida");
  expect(r.cabeceras["content-type"]).toContain("text/html");
});

test("tenant suspendido ⇒ CERO conexiones contra su base [AC-FTEN-05]", async () => {
  // El corazón de la respuesta del dueño. La base del suspendido EXISTE y está provisionada
  // (el fixture la crea a propósito): si no existiera, «cero conexiones» sería verdad por
  // accidente y este test no diría nada. Se cuenta en `pg_stat_activity`, que es lo único
  // que no se puede fingir desde la app.
  const susp = TENANTS.find((t) => t.estado === "suspendido")!;
  const bd = bdDeTenant(susp.slug);

  const antes = await conexionesContra(bd);
  for (let i = 0; i < 5; i++) await pedirComo(hostDe(susp.slug), i % 2 ? "/api/tenant" : "/");
  const despues = await conexionesContra(bd);

  expect(antes).toBe(0);
  expect(despues).toBe(0);
});

test("el host sin subdominio, o con uno de más, no es de nadie ⇒ 404 [AC-FTEN-05]", async () => {
  const activo = ACTIVOS[0]!;
  for (const host of [
    `${DOMINIO}:${PUERTO}`,
    `www.${DOMINIO}:${PUERTO}`,
    `otro.${activo.slug}.${DOMINIO}:${PUERTO}`,
    `${activo.slug}.otrodominio.cl:${PUERTO}`,
  ]) {
    const r = await pedirComo(host);
    expect(r.status, `host «${host}» debía ser 404`).toBe(404);
  }
});

// ─── La config de pools: un límite POR tenant registrado ──────────────────────────────

test("la config generada declara un límite de pool por cada tenant servido [AC-FTEN-05]", async () => {
  const registrados = (await tenantsRegistrados()) as { slug: string; bd: string; estado: string }[];
  const config = componer(registrados);

  expect(registrados.length).toBeGreaterThan(0);
  for (const t of registrados) {
    if (t.estado === "activo") {
      // Un límite PROPIO por tenant, no uno global: es lo que impide que el pico de una
      // cuenta se lleve puesto el cupo de todas.
      expect(config, `${t.bd} sin límite propio`).toContain(`${t.bd} = `);
      expect(config).toMatch(new RegExp(`${t.bd} = [^\\n]*pool_size=${POOL_POR_TENANT}`));
    } else {
      // Sin entrada routeable, pero DECLARADO: quien lea la config distingue «no existe» de
      // «no recibe tráfico». Omitirlo en silencio sería el mismo agujero con otra manta.
      expect(config).not.toMatch(new RegExp(`^${t.bd} = `, "m"));
      expect(config).toContain(`;   ${t.bd} — ${t.estado}`);
    }
  }
});

test("la config se REGENERA con el registro: un tenant nuevo aparece [AC-FTEN-05]", async () => {
  // Una config escrita a mano se desincroniza el día que entra un tenant, y el síntoma es que
  // ese tenant no puede conectarse. Se ejerce el ciclo entero contra `control`.
  const slug = "ruteo_pool_nuevo";
  const bd = bdDeTenant(slug);
  const antes = componer(await tenantsRegistrados());
  expect(antes).not.toContain(`${bd} = `);

  await con(BD_CONTROL, (c: Conexion) =>
    c.sql("insert into tenants (slug, bd) values ($1, $2) on conflict (slug) do nothing", [slug, bd]),
  );
  try {
    const despues = componer(await tenantsRegistrados());
    expect(despues).toContain(`${bd} = `);
    expect(despues).toMatch(new RegExp(`${bd} = [^\\n]*pool_size=${POOL_POR_TENANT}`));
  } finally {
    await con(BD_CONTROL, (c: Conexion) => c.sql("delete from tenants where slug = $1", [slug]));
  }
  // Y vuelve a salir: sin la mitad de ida y la de vuelta, el rojo no probaría nada.
  expect(componer(await tenantsRegistrados())).not.toContain(`${bd} = `);
});
