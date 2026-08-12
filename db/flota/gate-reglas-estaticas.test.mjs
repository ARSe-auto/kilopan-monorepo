#!/usr/bin/env node
// Fixtures de las reglas estáticas del §7.2 [AC-FTEN-16].
//
// Estas reglas van a estar años sin disparar, porque el código que las viola FUNCIONA: anda
// perfecto hasta el día que cruza datos de dos tenants. Por eso cada una se ejerce acá contra
// el caso que atrapa, y hay un positivo por regla que impide que el guard sea un no-op al
// revés — un patrón demasiado angosto se ve exactamente igual que uno que funciona.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { revisar, REGLAS, WRAPPER } from "./gate-reglas-estaticas.mjs";

/** Un repo de mentira con los archivos que se le pasen. */
function conArchivos(archivos) {
  const raiz = mkdtempSync(join(tmpdir(), "flota-reglas-"));
  for (const [rel, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(join(raiz, rel)), { recursive: true });
    writeFileSync(join(raiz, rel), contenido);
  }
  return revisar(raiz);
}

const EN_LA_APP = "apps/flota/src/servidor.ts";

/** Un archivo de producto que no viola nada. De acá salen todos los mutantes. */
const LIMPIO = `
import { alcance } from "@kilopan/nucleo-comun/tenant-scope";

export async function encargosDelTurno(pool, tenant, rol) {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    await cliente.query("select set_config('app.current_role', $1, true)", [rol]);
    const { rows } = await cliente.query("select id, estado from encargos order by creado_en");
    await cliente.query("commit");
    alcance(tenant).log("encargos leidos", { n: rows.length });
    return rows;
  } finally {
    cliente.release();
  }
}
`;

test("[AC-FTEN-16] un archivo de producto conforme pasa (el guard no es un no-op al revés)", () => {
  const { problemas, revisados } = conArchivos({ [EN_LA_APP]: LIMPIO });
  assert.deepEqual(problemas, []);
  assert.equal(revisados.length, 1, "el gate no miró el archivo");
});

test("[AC-FTEN-16] sin código de producto, el gate lo DECLARA y no reporta verde a secas", () => {
  const { problemas, revisados, arbolesPresentes } = conArchivos({});
  assert.deepEqual(problemas, []);
  assert.equal(revisados.length, 0);
  assert.deepEqual(arbolesPresentes, [], "declaró árboles que no existen");
});

test("[AC-FTEN-16] regla 1 — la conexión de la app con un rol privilegiado ⇒ rojo", () => {
  for (const mal of [
    `const pool = new Pool({ user: "flota_admin", database: "t_alfa" });`,
    `const pool = new Pool({ user: "migrator" });`,
    `await sql("create role app_t_alfa login superuser");`,
    `await sql("alter role app_t_alfa bypassrls");`,
  ]) {
    const { problemas } = conArchivos({ [EN_LA_APP]: mal });
    assert.equal(problemas.length, 1, `no disparó con: ${mal}`);
    assert.match(problemas[0], /rol privilegiado/);
  }
});

test("[AC-FTEN-16] regla 2 — un SET de sesión sobre `app.*` ⇒ rojo", () => {
  for (const mal of [
    `await cliente.query("select set_config('app.current_role', $1, false)", [rol]);`,
    `await cliente.query("SET app.current_role = 'operador'");`,
  ]) {
    const { problemas } = conArchivos({ [EN_LA_APP]: mal });
    assert.equal(problemas.length, 1, `no disparó con: ${mal}`);
    assert.match(problemas[0], /SET LOCAL/);
  }
});

test("[AC-FTEN-16] regla 2 — el SET LOCAL legítimo NO dispara: la regla distingue", () => {
  // Sin este positivo, un patrón que se disparara con cualquier `set_config` pasaría los
  // mutantes de arriba y rompería todo el código correcto.
  const { problemas } = conArchivos({
    [EN_LA_APP]: `await cliente.query("select set_config('app.current_role', $1, true)", [rol]);
await cliente.query("SET LOCAL app.current_role = 'operador'");`,
  });
  assert.deepEqual(problemas, []);
});

test("[AC-FTEN-16] regla 3 — una consulta cross-database en runtime ⇒ rojo", () => {
  for (const mal of [
    `await sql("select * from dblink('dbname=t_beta', 'select id from encargos') as t(id uuid)");`,
    `await sql("create extension if not exists postgres_fdw");`,
    `await sql("CREATE SERVER otro_tenant FOREIGN DATA WRAPPER postgres_fdw");`,
  ]) {
    const { problemas } = conArchivos({ [EN_LA_APP]: mal });
    assert.equal(problemas.length, 1, `no disparó con: ${mal}`);
    assert.match(problemas[0], /cross-database/);
  }
});

test("[AC-FTEN-16] regla 4 — una API cruda de cache, cola, job o log fuera del wrapper ⇒ rojo", () => {
  for (const mal of [
    `const cache = new Redis(process.env.REDIS_URL);`,
    `import { Queue } from "bullmq";`,
    `cron.schedule("*/5 * * * *", exportar);`,
    `console.log("encargo creado", encargo.id);`,
  ]) {
    const { problemas } = conArchivos({ [EN_LA_APP]: mal });
    assert.equal(problemas.length, 1, `no disparó con: ${mal}`);
    assert.match(problemas[0], /wrapper/);
  }
});

test("[AC-FTEN-16] regla 4 — el wrapper SÍ puede usar la API cruda: es su único lugar", () => {
  // Si el wrapper no estuviera exento, la convención sería inaplicable: alguien tendría que
  // apagar la regla para poder escribir el wrapper, y una regla apagada no protege nada.
  const { problemas } = conArchivos({
    [WRAPPER]: `import Redis from "ioredis";
const crudo = new Redis(process.env.REDIS_URL);
export const alcance = (tenant) => ({
  log: (m, d) => console.log(JSON.stringify({ tenant, m, ...d })),
  cache: { get: (k) => crudo.get(\`\${tenant}:\${k}\`) },
});`,
  });
  assert.deepEqual(problemas, []);
});

test("[AC-FTEN-16] los COMENTARIOS no disparan: una regla que se pisa a sí misma se apaga sola", () => {
  const { problemas } = conArchivos({
    [EN_LA_APP]: `// jamás usar dblink ni postgres_fdw acá: la agregación va por el exportador
// y el rol nunca es flota_admin ni migrator
${LIMPIO}`,
  });
  assert.deepEqual(problemas, []);
});

test("[AC-FTEN-16] un archivo que viola VARIAS reglas las reporta todas, no solo la primera", () => {
  const { problemas } = conArchivos({
    [EN_LA_APP]: `const pool = new Pool({ user: "flota_admin" });
await sql("select set_config('app.current_role', $1, false)", [rol]);
console.log("listo");`,
  });
  assert.equal(problemas.length, 3, JSON.stringify(problemas));
});

test("[AC-FSEM-10] regla plano-eauto — el Plano B referenciando una BD t_<slug> ⇒ rojo", () => {
  for (const mal of [
    `const bd = bdDeTenant(slug);`,
    `const pool = poolDe("t_alfa");`,
    `const bd = \`t_\${slug}\`;`,
    `import { poolDe } from "../servidor/conexion.ts";`,
  ]) {
    const { problemas } = conArchivos({ "apps/flota/src/dominio/plano-eauto.ts": mal });
    assert.equal(problemas.length, 1, `no disparó con: ${mal}`);
    assert.match(problemas[0], /Plano B lee EXCLUSIVAMENTE/);
  }
});

test("[AC-FSEM-10] regla plano-eauto — el mismo texto en OTRO archivo de la app no dispara: es de alcance acotado", () => {
  // Sin `soloEn`, esta regla sería global y rompería el resto de la app, que SÍ necesita
  // conectarse a BDs de tenant para operar — sería una regla que nadie podría dejar encendida.
  const { problemas } = conArchivos({
    "apps/flota/src/servidor/encargos.ts": `const bd = bdDeTenant(slug);`,
  });
  assert.deepEqual(problemas, []);
});

test("[AC-FSEM-10] regla plano-eauto — un archivo conforme bajo su alcance pasa (el guard no es un no-op)", () => {
  const { problemas, revisados } = conArchivos({
    "apps/flota/src/plano-eauto/tablero-cross-tenant.tsx": `export function TableroCrossTenant({ filas }) {
  return filas.map((f) => f.tenantSlug);
}`,
  });
  assert.deepEqual(problemas, []);
  assert.equal(revisados.length, 1);
});

test("[AC-FTEN-16] cada regla del contrato tiene su razón escrita y su id", () => {
  // Un `GATE: ...` sin razón obliga a leer el regex para entender qué se rompió.
  for (const r of REGLAS) {
    assert.match(r.id, /^[a-z0-9-]+$/);
    assert.ok(r.razon.length > 40, `la razón de ${r.id} es demasiado corta para servir`);
  }
});

test("[AC-FTEN-16] la familia de constantes puede NOMBRAR los roles, pero sigue bajo las otras reglas", () => {
  // El §0 la obliga a nombrar `migrator` y `app_t_<slug>`, así que la regla 1 la exenta. La
  // exención es de UNA regla y no del archivo: sin este fixture, «exento» se leería como
  // «invisible» y el canónico sería el mejor escondite del repo.
  const CANONICO = "packages/nucleo-comun/src/constants.ts";
  const nombrando = conArchivos({
    [CANONICO]: `export const TENANCY = { rol_migraciones: "migrator", patron_rol_app: "app_t_<slug>" } as const;`,
  });
  assert.deepEqual(nombrando.problemas, []);

  const escondiendo = conArchivos({
    [CANONICO]: `export const X = 1;
await sql("select * from dblink('dbname=t_beta', 'select 1') as t(x int)");
console.log("hola");`,
  });
  assert.equal(escondiendo.problemas.length, 2, JSON.stringify(escondiendo.problemas));
});
