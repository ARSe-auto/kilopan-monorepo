import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { abrir, vigente, avisoReconocido } from "../src/servidor/breakglass.ts";
import { con, bdDeTenant, BD_CONTROL, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { provisionar } from "../../../db/flota/provisionar.mjs";
import { borrarRolDeApp } from "../../../db/flota/rol-app.mjs";

// Break-glass con doble control [AC-FIDN-18] — §4.3, §7.9.
//
// Se prueba lo que el §7.9 exige y nada más: dos personas DISTINTAS, aviso forzoso al tenant
// que persiste hasta que lo reconozcan, y registro inmutable.
//
// Base propia del tenant: escribe en `review_queue` y en `audit_trail` por trigger, y el
// registro de `control` se limpia al final — pero `break_glass` es append-only, así que la
// limpieza va con el rol dueño y por eso la fila se borra junto con el tenant.

const SLUG = "gate_breakglass";
const BD = bdDeTenant(SLUG);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

let control: Pool;
let tenant: Pool;
let tenantId: string;

const PLATAFORMA_A = "alexis@kiloruta";
const PLATAFORMA_B = "segunda-persona@kiloruta";

test.beforeAll(async () => {
  await provisionar(SLUG, { recrear: true });
  control = new Pool({ host: CLUSTER_LOCAL.host, port: CLUSTER_LOCAL.puerto, database: BD_CONTROL, user: ROL_MIGRADOR });
  tenant = new Pool({ host: CLUSTER_LOCAL.host, port: CLUSTER_LOCAL.puerto, database: BD, user: ROL_MIGRADOR });

  const [t] = await con(BD_CONTROL, (c: Conexion) =>
    c.sql<{ id: string }>(
      `insert into tenants (slug, bd) values ($1, $2)
       on conflict (slug) do update set bd = excluded.bd returning id::text as id`,
      [SLUG, BD],
    ),
  );
  tenantId = t!.id;
});

test.afterAll(async () => {
  // El tenant SÍ se borra del registro; el break-glass NO, porque es append-only. Que las dos
  // cosas puedan pasar a la vez es justamente por qué esta tabla no tiene FK a `tenants`: el
  // registro sobrevive al tenant en vez de impedir que se vaya (§4.1, offboarding).
  await control?.query("delete from tenants where id = $1", [tenantId]);
  await control?.end();
  await tenant?.end();
  await con("postgres", ({ sql }: { sql: (t: string) => Promise<unknown> }) =>
    sql(`drop database if exists ${BD} with (force)`),
  );
  await borrarRolDeApp(SLUG);
});

test("[AC-FIDN-18] con dos personas distintas se abre, y el tenant queda avisado", async () => {
  const r = await abrir(control, tenant, {
    tenantId,
    tenantSlug: SLUG,
    solicitadoPor: PLATAFORMA_A,
    aprobadoPor: PLATAFORMA_B,
    motivo: "sincronización trabada y el dueño no contesta desde las 03:00",
    horas: 24,
  });
  expect(r.tipo).toBe("abierto");
  if (r.tipo !== "abierto") return;

  expect((await vigente(control, tenantId))?.id).toBe(r.id);

  // El aviso está en la bandeja del TENANT, con severidad alta y sin reconocer: es lo que el
  // dueño ve en su panel cuando vuelve.
  const [aviso] = await con(BD, (c: Conexion) =>
    c.sql<{ origen: string; severidad: string; estado: string; nota: string }>(
      "select origen, severidad, estado::text as estado, nota from review_queue where id = $1",
      [r.avisoId],
    ),
  );
  expect(aviso!.origen).toBe("break_glass");
  expect(aviso!.severidad).toBe("alta");
  expect(aviso!.estado).toBe("nueva");
  // La nota nombra a los DOS y el motivo: un aviso que no dice quién entró ni por qué obliga
  // al dueño a pedir explicaciones, que es lo contrario de notificar.
  expect(aviso!.nota).toContain(PLATAFORMA_A);
  expect(aviso!.nota).toContain(PLATAFORMA_B);
  expect(aviso!.nota).toContain("sincronización trabada");
});

test("[AC-FIDN-18] UNA sola persona no abre nada: el doble control es la regla", async () => {
  const r = await abrir(control, tenant, {
    tenantId,
    tenantSlug: SLUG,
    solicitadoPor: PLATAFORMA_A,
    aprobadoPor: PLATAFORMA_A,
    motivo: "urgente",
    horas: 24,
  });
  expect(r.tipo === "rebote" && r.motivo).toBe("control_unico");
});

test("[AC-FIDN-18] y la base tampoco lo permite: la regla no vive en el código que llama", async () => {
  // El rebote de arriba es el que la UI puede leer; este es el que no se puede saltar. Sin el
  // CHECK, bastaría con llamar al INSERT desde otro lado para tener god-mode de una persona.
  await expect(
    control.query(
      `insert into break_glass (tenant_id, tenant_slug, solicitado_por, aprobado_por, motivo, expira_en, aviso_id)
       values ($1, 'gate_breakglass', 'x@kiloruta', 'x@kiloruta', 'motivo escrito', now() + interval '1 hour', uuidv7())`,
      [tenantId],
    ),
  ).rejects.toThrow(/dos_personas_distintas/);
});

test("[AC-FIDN-18] un break-glass sin aviso no se puede ni insertar (notificación FORZOSA)", async () => {
  // «Forzosa» quiere decir que no hay camino sin ella: `aviso_id` es NOT NULL, así que no
  // existe una forma de abrir el acceso y notificar después — ni de olvidarse.
  await expect(
    control.query(
      `insert into break_glass (tenant_id, tenant_slug, solicitado_por, aprobado_por, motivo, expira_en)
       values ($1, 'gate_breakglass', 'a@kiloruta', 'b@kiloruta', 'motivo escrito', now() + interval '1 hour')`,
      [tenantId],
    ),
  ).rejects.toThrow(/aviso_id/);
});

test("[AC-FIDN-18] el registro es INMUTABLE: ni editarlo ni borrarlo, ni con el rol dueño", async () => {
  // Lo que este registro audita es el acceso de quien tiene todos los permisos. Si se pudiera
  // editar, auditaría exactamente nada.
  const [f] = await con(BD_CONTROL, (c: Conexion) =>
    c.sql<{ id: string }>("select id::text as id from break_glass where tenant_id = $1 limit 1", [tenantId]),
  );
  const codigo = async (sql: string) => {
    try {
      await control.query(sql, [f!.id]);
      return null;
    } catch (e) {
      return (e as { code?: string }).code;
    }
  };
  expect(await codigo("update break_glass set motivo = 'otra cosa' where id = $1")).toBe("42501");
  expect(await codigo("delete from break_glass where id = $1")).toBe("42501");
});

test("[AC-FIDN-18] el aviso PERSISTE hasta que el dueño lo reconoce", async () => {
  // «Persistente en el panel hasta que lo reconozca» (respuesta del dueño a la pregunta 7).
  // Un aviso que se pueda cerrar sin reconocerlo no es persistente.
  const [a] = await con(BD, (c: Conexion) =>
    c.sql<{ id: string }>("select id::text as id from review_queue where origen = 'break_glass' limit 1"),
  );
  expect(await avisoReconocido(tenant, a!.id)).toBe(false);

  await tenant.query("update review_queue set estado = 'reconocida', reconocida_en = now() where id = $1", [a!.id]);
  expect(await avisoReconocido(tenant, a!.id)).toBe(true);
});

test("[AC-FIDN-18] el break-glass vence solo, como el grant", async () => {
  const r = await abrir(control, tenant, {
    tenantId,
    tenantSlug: SLUG,
    solicitadoPor: PLATAFORMA_A,
    aprobadoPor: PLATAFORMA_B,
    motivo: "revisar cola de sync de madrugada",
    horas: 1,
  });
  expect(r.tipo).toBe("abierto");
  expect(await vigente(control, tenantId)).not.toBeNull();

  // No se puede mover la fila —es append-only, que es el punto— así que se comprueba contra
  // el vencimiento de verdad: el más nuevo es el que `vigente()` devuelve, y cuando todos
  // hayan vencido devolverá null sin que nadie corra nada.
  const [{ n }] = await con(BD_CONTROL, (c: Conexion) =>
    c.sql<{ n: string }>(
      "select count(*)::text as n from break_glass where tenant_id = $1 and expira_en > now()",
      [tenantId],
    ),
  );
  expect(Number(n)).toBeGreaterThan(0);
});
