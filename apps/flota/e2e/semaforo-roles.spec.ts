import { test, expect } from "@playwright/test";
import { request as pedirHttp } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { ROLES, type Rol } from "../../../packages/nucleo-comun/src/constants.ts";
import { TENANTS } from "./preparar-tenants.mjs";

// Aislamiento y roles del tablero [AC-FSEM-09] — spec 05 §2.8, §4.
//
// El AC pide TRES cosas de naturaleza distinta:
//
//   (1) «manifest solo `admin_tenant`»: `chofer`/`responsable_carga`/`cliente`/`operador`/
//       `responsable_tecnico` ⇒ 403 en su GET al digest — literalmente los 5 roles del enum
//       que NO son `admin_tenant` (§0: `ROLES` es la lista cerrada). `guardia()` es la MISMA
//       puerta que ya usan reconocer/resolver/toques (AC-FSEM-04/05), wireada al digest en
//       este mismo AC (`api/semaforo/digest/route.ts`) — sin sesión ⇒ 404 pelado (no es el caso
//       que este AC pide, pero se prueba igual: es la otra mitad de «manifest solo admin_tenant»).
//   (2) «suite A-contra-B total»: la suite HTTP autogenerada del manifiesto (AC-FTEN-26,
//       `cruce-tenant.spec.ts`) YA cubre TODAS las rutas declaradas, incluidas las de este
//       módulo — este AC no agrega una segunda suite genérica, solo confirma que el digest
//       sigue en el manifiesto con su `cruce` documentado (no hay caso que agregar acá).
//   (3) «cero CLP a roles vetados»: sale gratis de (1) —un rol vetado recibe 403 sin cuerpo de
//       datos, cero tarjetas, cero CLP— y se refuerza con un grep-gate: `review_queue`,
//       `client_metric` y `signal_rule` (las únicas tablas que este módulo lee, migraciones
//       0002 y 0058) no tienen NINGUNA columna de dinero, así que ni siquiera `admin_tenant`
//       puede recibir un CLP de este módulo. El grep vigila que eso no cambie sin que alguien
//       lo note.

const PUERTO = 3311;
const DOMINIO = "localhost";
const SLUG = "hechos";
const HOST = `${SLUG}.${DOMINIO}:${PUERTO}`;
const BD = bdDeTenant(SLUG);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };
type Respuesta = { status: number; cuerpo: string };

function pedirDigest(secreto?: string): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { Host: HOST };
  if (secreto) cabeceras.Authorization = `Portador ${secreto}`;
  return new Promise((resolver, rechazar) => {
    const req = pedirHttp(
      { host: "127.0.0.1", port: PUERTO, path: "/api/semaforo/digest?seed=a", method: "GET", headers: cabeceras },
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

// Índices [20..25] de `VALIDOS`: los primeros libres en el tenant `hechos` — 0-9/11-14/18/19 ya
// los toman otras suites que comparten esta base (apertura, chequeos, carga, entrega, pod-*,
// recargas, peek-n1, detalle-n2). `cliente` necesita además una `empresas_cliente` propia
// (CHECK `usuarios_cliente_con_empresa`, migración 0011): se siembra con el RUT de empresa del
// índice 6, ya usado por otras suites vía `on conflict … do update` (idempotente, mismo patrón
// que `entrega.spec.ts::empresa()`) — no crea una fila nueva que otra suite no espere.
const INDICE_BASE = 20;
const ROLES_VETADOS = ROLES.filter((r) => r !== "admin_tenant");

async function empresaCliente(): Promise<string> {
  return con(BD, async (c: Conexion) => {
    const [fila] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, $2)
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [Object.keys(VALIDOS)[6]!, "Empresa cliente de los roles del semáforo"],
    );
    return fila!.id;
  });
}

async function enrolar(rut: string, nombre: string, rol: Rol, empresaClienteId: string | null): Promise<string> {
  const secreto = secretoNuevo();
  await con(BD, async (c: Conexion) => {
    // Idempotente ante un reintento de Playwright (CI: retries=2) que vuelva a correr este
    // `beforeAll` — sin esto, el segundo intento choca con `personas_tenant_id_rut_key` y el
    // AC entero se ve rojo por una carrera del arnés, no por el módulo.
    await c.sql(
      "delete from dispositivos where persona_id in (select id from personas where rut = $1)",
      [rut],
    );
    await c.sql("delete from usuarios where persona_id in (select id from personas where rut = $1)", [rut]);
    await c.sql("delete from personas where rut = $1", [rut]);
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
      [rut, nombre],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, $2::rol_usuario, $3) returning id::text as id",
      [p!.id, rol, empresaClienteId],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
       values ('personal', $1, $2, $3, now())`,
      [p!.id, hashDeSecreto(secreto), u!.id],
    );
  });
  return secreto;
}

const secretosPorRol: Partial<Record<Rol, string>> = {};

test.beforeAll(async () => {
  const empresaId = await empresaCliente();
  await Promise.all(
    ROLES.map(async (rol, i) => {
      const rut = Object.keys(VALIDOS)[INDICE_BASE + i]!;
      secretosPorRol[rol] = await enrolar(rut, `Rol ${rol} del semáforo`, rol, rol === "cliente" ? empresaId : null);
    }),
  );
});

test.describe("manifest solo admin_tenant (§2.8)", () => {
  for (const rol of ROLES_VETADOS) {
    test(`[AC-FSEM-09] GET /api/semaforo/digest con sesión \`${rol}\` ⇒ 403, cero tarjetas`, async () => {
      const r = await pedirDigest(secretosPorRol[rol]!);
      expect(r.status).toBe(403);
      // Cero CLP a un rol vetado sale de acá: 403 no trae cuerpo de datos, así que no hay
      // tarjeta, agregado ni excepción que pudiera cargar un monto.
      expect(r.cuerpo).not.toContain('"tarjetas"');
    });
  }

  test("[AC-FSEM-09] GET /api/semaforo/digest con sesión `admin_tenant` ⇒ 200 con tarjetas", async () => {
    const r = await pedirDigest(secretosPorRol.admin_tenant!);
    expect(r.status).toBe(200);
    const cuerpo = JSON.parse(r.cuerpo) as { tarjetas: unknown[] };
    expect(cuerpo.tarjetas.length).toBeGreaterThan(0);
  });

  test("[AC-FSEM-09] GET /api/semaforo/digest sin sesión ⇒ 404 pelado (misma guardia que reconocer/resolver)", async () => {
    const r = await pedirDigest();
    expect(r.status).toBe(404);
    expect(r.cuerpo).toBe("");
  });
});

test("[AC-FSEM-09] el digest sigue declarado en el manifiesto de rutas, con su cruce (suite A-contra-B, AC-FTEN-26)", () => {
  const manifiesto = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "rutas", "manifiesto.json"), "utf8"),
  ) as { rutas: { ruta: string; cruce: { tipo: string } }[] };
  const digest = manifiesto.rutas.find((r) => r.ruta === "/api/semaforo/digest");
  expect(digest, "el digest desapareció del manifiesto: la suite A-contra-B dejaría de ejercerlo").toBeTruthy();
  expect(digest!.cruce.tipo).toBe("sin_recurso");
});

test("[AC-FSEM-09] grep-gate: `review_queue`/`client_metric`/`signal_rule` — las únicas tablas que lee este módulo — no ganan una columna de dinero sin que este AC se entere", () => {
  const migraciones = [
    join(import.meta.dirname, "..", "..", "..", "db", "migraciones-flota", "tenant", "0002_hechos_evidencia_y_revision.sql"),
    join(import.meta.dirname, "..", "..", "..", "db", "migraciones-flota", "tenant", "0058_signal_rule_con_histeresis.sql"),
  ];
  const PALABRAS_DE_DINERO = /\b(clp|costo|monto|precio|tarifa)\w*\s+/i;
  for (const migracion of migraciones) {
    const texto = readFileSync(migracion, "utf8");
    for (const tabla of ["review_queue", "client_metric", "signal_rule"]) {
      const bloque = texto.match(new RegExp(`create table ${tabla} \\(([\\s\\S]*?)\\n\\);`));
      if (!bloque) continue;
      expect(bloque[1], `${tabla} en ${migracion} suma una columna de dinero: revisar RLS §4.8 antes de sembrarla`).not.toMatch(
        PALABRAS_DE_DINERO,
      );
    }
  }
});

test("[AC-FSEM-09] grep del módulo: ninguna respuesta del digest arma un campo de dinero", () => {
  const archivo = join(import.meta.dirname, "..", "src", "app", "api", "semaforo", "digest", "route.ts");
  const dominio = join(import.meta.dirname, "..", "src", "dominio", "semaforo.ts");
  const PALABRAS_DE_DINERO = /\bclp\b|\bcosto\w*\b|\bmonto\w*\b/i;
  for (const ruta of [archivo, dominio]) {
    expect(readFileSync(ruta, "utf8"), `${ruta} menciona dinero — revisar RLS §4.8`).not.toMatch(PALABRAS_DE_DINERO);
  }
});

test("[AC-FSEM-09] `hechos` sigue siendo un tenant ACTIVO real del fixture — sin esto los 200/403 de arriba no distinguirían nada", () => {
  const t = TENANTS.find((x) => x.slug === SLUG);
  expect(t?.estado).toBe("activo");
});
