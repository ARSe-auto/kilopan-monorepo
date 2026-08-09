import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { Pool } from "pg";
import { REVOCACION } from "../../../packages/nucleo-comun/src/constants.ts";
import { abrir, parDelAparato } from "../src/dominio/secretos.ts";
import { clasificar, flagDe, revisionDe } from "../src/dominio/revocacion.ts";
import { codigoNuevo, hashDeCodigo, expiraEn } from "../src/dominio/invitaciones.ts";
import { aprobar } from "../src/servidor/aprobacion.ts";
import { revocarDispositivo } from "../src/servidor/sesion.ts";
import { con, bdDeTenant, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { provisionar } from "../../../db/flota/provisionar.mjs";
import { borrarRolDeApp } from "../../../db/flota/rol-app.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Revocación con efecto inmediato, por HTTP [AC-FIDN-09] — §4.3, §5.4 F-F, centinela 4.
//
// El corte se prueba contra el servidor de verdad y en el REQUEST SIGUIENTE, que es lo que el
// AC pide con esas palabras: un aparato que respondía 200 y, tras un UPDATE, responde 401 sin
// que nadie reinicie nada ni espere el vencimiento de ningún token.
//
// La otra mitad —lo que llega DESPUÉS de revocar— se prueba contra la base, porque el endpoint
// de sync nace en el módulo 04 (hito e): acá está la clasificación, el flag, la fila de
// revisión y el evento, que son lo que ese endpoint va a escribir cuando exista.

const PUERTO = 3311;
const DOMINIO = "localhost";
const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
/** Base propia para la parte que escribe hechos append-only (ver anonimizacion.spec.ts). */
const SLUG_HECHOS = "gate_revocacion";
const BD_HECHOS = bdDeTenant(SLUG_HECHOS);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

let pool: Pool;
let secreto: string;
let dispositivoId: string;

function pedirSesion(autorizacion: string | null, host = `${A.slug}.${DOMINIO}:${PUERTO}`) {
  return new Promise<{ status: number; cuerpo: string }>((resolver, rechazar) => {
    const req = pedir(
      {
        host: "127.0.0.1",
        port: PUERTO,
        path: "/api/sesion",
        method: "GET",
        headers: { Host: host, ...(autorizacion ? { authorization: autorizacion } : {}) },
      },
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

test.beforeAll(async () => {
  pool = new Pool({
    host: CLUSTER_LOCAL.host,
    port: CLUSTER_LOCAL.puerto,
    database: BD_A,
    user: ROL_MIGRADOR,
  });

  // Se enrola de verdad: invitación → solicitud → aprobación. Sembrar el `secreto_hash` a
  // mano probaría la consulta de sesión, no el enrolamiento que la produce.
  const aparato = await parDelAparato();
  const codigo = codigoNuevo();
  const [s] = await con(BD_A, async (c: Conexion) => {
    await c.sql("delete from solicitudes_acceso");
    await c.sql("delete from invitaciones");
    await c.sql("delete from dispositivos");
    await c.sql("delete from usuarios");
    await c.sql("delete from personas");
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ('11.111.111-1', 'Dueña') returning id::text as id",
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    const [inv] = await c.sql<{ id: string }>(
      `insert into invitaciones (rol, token_hash, expira_at, creada_por)
       values ('chofer', $1, $2, $3) returning id::text as id`,
      [hashDeCodigo(codigo), expiraEn(new Date()), u!.id],
    );
    return c.sql<{ id: string; duena: string }>(
      `insert into solicitudes_acceso
         (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
       values ($1, '12.345.678-5', 'Chofer', '$argon2id$x', $2, 'huella')
       returning id::text as id, $3::text as duena`,
      [inv!.id, aparato.publica, u!.id],
    );
  });

  const r = await aprobar(pool, s!.id, s!.duena);
  if (r.tipo !== "aprobada") throw new Error(`el fixture no pudo enrolar: ${JSON.stringify(r)}`);
  secreto = await abrir(r.sobre, aparato.privada);
  dispositivoId = r.dispositivoId;
});

test.afterAll(async () => {
  await pool?.end();
  await con("postgres", ({ sql }: { sql: (t: string) => Promise<unknown> }) =>
    sql(`drop database if exists ${BD_HECHOS} with (force)`),
  );
  await borrarRolDeApp(SLUG_HECHOS);
});

// ─── El corte, por HTTP y en el request siguiente ─────────────────────────────────────

test("[AC-FIDN-09] con el secreto emitido, el aparato tiene sesión", async () => {
  // El positivo primero: sin él, «revocado ⇒ 401» lo cumpliría también una ruta rota.
  const r = await pedirSesion(`Portador ${secreto}`);
  expect(r.status).toBe(200);
  const cuerpo = JSON.parse(r.cuerpo) as { rol: string; dispositivo_id: string };
  expect(cuerpo.rol).toBe("chofer");
  expect(cuerpo.dispositivo_id).toBe(dispositivoId);
  // Y no reparte datos personales en cada arranque de la app (§7.8).
  expect(r.cuerpo).not.toContain("12.345.678-5");
  expect(r.cuerpo.toLowerCase()).not.toContain("chofer\",\"nombre");
});

test("[AC-FIDN-09] revocado ⇒ el SIGUIENTE request ya no tiene sesión", async () => {
  // EL caso del AC, con las palabras del §5.4 F-F: efecto inmediato. Sin reiniciar nada, sin
  // esperar el vencimiento de ningún token, sin lista de revocados que sincronizar.
  expect((await pedirSesion(`Portador ${secreto}`)).status).toBe(200);
  expect(await revocarDispositivo(pool, dispositivoId)).toBe(true);

  const despues = await pedirSesion(`Portador ${secreto}`);
  expect(despues.status).toBe(401);
  // El 401 no dice que lo revocaron: a un teléfono robado no le sirve enterarse, y la
  // diferencia sería un oráculo — el mismo criterio del 404 de AC-FTEN-05.
  expect(despues.cuerpo.toLowerCase()).not.toContain("revoc");
});

test("[AC-FIDN-09] las cuatro formas de no tener sesión responden IGUAL", async () => {
  const sinCredencial = await pedirSesion(null);
  const desconocida = await pedirSesion("Portador 0192f0a0-0000-7000-8000-00000000dead");
  const revocada = await pedirSesion(`Portador ${secreto}`);
  const malFormada = await pedirSesion("Bearer algo");

  for (const r of [sinCredencial, desconocida, revocada, malFormada]) {
    expect(r.status).toBe(401);
    expect(r.cuerpo).toBe(sinCredencial.cuerpo);
  }
});

test("[AC-FIDN-09] el secreto de A no abre sesión en el subdominio de B", async () => {
  // Centinela 2 con la credencial de verdad, que el caso autogenerado de AC-FTEN-26 no puede
  // montar porque no sabe cómo se ve un secreto. Cada tenant tiene su base: el hash de A
  // sencillamente no está en la de B.
  const B = TENANTS.filter((t) => t.estado === "activo")[1]!;
  const r = await pedirSesion(`Portador ${secreto}`, `${B.slug}.${DOMINIO}:${PUERTO}`);
  expect(r.status).toBe(401);
});

// ─── Lo que llega DESPUÉS de revocar: entra siempre, con su marca ─────────────────────

test("[AC-FIDN-09] la captura post-revocación entra, se marca y NO rebota (centinela 4)", async () => {
  // Base propia: escribe en `eventos` y `review_queue`, y `eventos` es append-only.
  const tenant = await provisionar(SLUG_HECHOS, { recrear: true });
  const revocadoEn = new Date("2026-08-09T04:00:00Z");
  const dentro = new Date(revocadoEn.getTime() + 3_600_000);
  const fuera = new Date(revocadoEn.getTime() + (REVOCACION.ventana_horas + 1) * 3_600_000);

  await con(tenant.bd, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ('12.345.678-5', 'Revocado') returning id::text as id",
    );
    const [d] = await c.sql<{ id: string }>(
      "insert into dispositivos (tipo, persona_id, revocado_at) values ('personal', $1, $2) returning id::text as id",
      [p!.id, revocadoEn],
    );
    const [tipo] = await c.sql<{ id: string }>(
      "insert into evento_tipo (codigo, descripcion) values ('captura', 'Captura del terreno') returning id::text as id",
    );

    // Las dos capturas: una dentro de la ventana, otra fuera. Las DOS entran — es lo que el
    // §4.2 promete y lo que el centinela 4 cuenta como «rechazos = 0».
    for (const recibida of [dentro, fuera]) {
      const clase = clasificar(revocadoEn, recibida);
      const flag = flagDe(clase);
      await c.sql(
        `insert into eventos (tipo_id, objeto_tabla, objeto_id, actor_id, dispositivo_id,
                              event_time, tz_offset_min, record_time, payload)
         values ($1, 'capturas', uuidv7(), $2, $3, $4, -240, $4, $5::jsonb)`,
        [tipo!.id, p!.id, d!.id, recibida, JSON.stringify({ flag })],
      );
      const revision = revisionDe(clase);
      if (revision) {
        await c.sql(
          "insert into review_queue (origen, severidad, estado) values ($1, $2, 'nueva')",
          [flag, revision.severidad],
        );
      }
    }

    // Las dos capturas entraron: rechazos = 0.
    const conteo = await c.sql<{ n: string }>("select count(*)::text as n from eventos");
    expect(Number(conteo[0]!.n)).toBe(2);

    // Cada una con SU flag. Con un solo flag, la bandeja no podría distinguir «venía sin
    // señal» de «sigue usando un aparato dado de baja».
    const flags = await c.sql<{ flag: string }>(
      "select payload->>'flag' as flag from eventos order by event_time",
    );
    expect(flags.map((f) => f.flag)).toEqual([REVOCACION.flag_dentro, REVOCACION.flag_fuera]);

    // Y solo la tardía abrió revisión, con severidad alta.
    const revisiones = await c.sql<{ origen: string; severidad: string }>(
      "select origen, severidad from review_queue",
    );
    expect(revisiones).toHaveLength(1);
    expect(revisiones[0]!.origen).toBe(REVOCACION.flag_fuera);
    expect(revisiones[0]!.severidad).toBe("alta");
  });
});
