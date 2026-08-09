import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { otorgar, revocar, vigente, registrarAcceso, ALCANCES, DURACIONES } from "../src/servidor/soporte.ts";
import { con, bdDeTenant, BD_CONTROL, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Soporte sin god-mode, contra el cluster [AC-FIDN-11] — §4.3, §7.9.
//
// Lo que este AC promete y no se puede probar mirando código: que sin grant no hay acceso, que
// el grant se apaga SOLO al vencer —sin que nadie corra nada— y que el dueño del tenant puede
// ver, en SU auditoría, cuándo entró soporte.
//
// La otra mitad, «no existe endpoint de impersonación», se prueba contra el manifiesto de
// rutas en `rutas/impersonacion.test.mjs`: es una ausencia, y una ausencia solo se prueba
// contra un inventario que no puede quedar incompleto.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

let control: Pool;
let tenantPool: Pool;
let tenantId: string;

const conexion = (bd: string) =>
  new Pool({ host: CLUSTER_LOCAL.host, port: CLUSTER_LOCAL.puerto, database: bd, user: ROL_MIGRADOR });

test.beforeAll(async () => {
  control = conexion(BD_CONTROL);
  tenantPool = conexion(BD_A);
  const [t] = await con(BD_CONTROL, (c: Conexion) =>
    c.sql<{ id: string }>("select id::text as id from tenants where slug = $1", [A.slug]),
  );
  tenantId = t!.id;
  await control.query("delete from grants_soporte where tenant_id = $1", [tenantId]);
});

// Cada prueba arranca sin grants. Compartir estado acá sería peor que en otras suites: la
// pregunta que casi todas hacen es «¿hay acceso vigente?», y un grant que sobrevive de la
// prueba anterior contesta que sí por la razón equivocada.
test.beforeEach(async () => {
  await control.query("delete from grants_soporte where tenant_id = $1", [tenantId]);
});

test.afterAll(async () => {
  await control?.query("delete from grants_soporte where tenant_id = $1", [tenantId]);
  await control?.end();
  await tenantPool?.end();
});

test("[AC-FIDN-11] sin grant NO hay acceso: el estado por omisión es cero", async () => {
  // No hay un permiso que se pueda quitar — no hay permiso. Es al revés de como suele estar,
  // y es lo que hace que «god-mode» no sea algo que alguien pueda encender por error.
  expect(await vigente(control, tenantId)).toBeNull();
});

test("[AC-FIDN-11] el grant del dueño lleva alcance y una de las DOS duraciones", async () => {
  const g = await otorgar(control, {
    tenantId,
    otorgadoA: "soporte@kiloruta",
    motivo: "revisar sincronización trabada del 09-ago",
    alcance: "solo_lectura",
    duracion: "24h",
  });

  const activo = await vigente(control, tenantId);
  expect(activo?.id).toBe(g.id);
  expect(activo?.alcance).toBe("solo_lectura");

  const horas = (g.expiraEn.getTime() - Date.now()) / 3_600_000;
  expect(Math.round(horas)).toBe(DURACIONES["24h"]);
});

test("[AC-FIDN-11] una duración fuera de las dos del §4.3 no se puede ni insertar", async () => {
  // Con un campo libre, el día que alguien tenga apuro va a poner un año y nadie va a estar
  // mirando esa fila. Con dos opciones, extender el acceso obliga a otorgar otro grant — que
  // queda registrado.
  await expect(
    control.query(
      `insert into grants_soporte (tenant_id, otorgado_a, motivo, expira_en)
       values ($1, 'x', 'apuro', now() + interval '365 days')`,
      [tenantId],
    ),
  ).rejects.toThrow(/grants_soporte_duracion_cerrada/);
});

test("[AC-FIDN-11] un grant sin motivo escrito no entra", async () => {
  await expect(
    control.query(
      `insert into grants_soporte (tenant_id, otorgado_a, motivo, expira_en)
       values ($1, 'x', '   ', now() + interval '24 hours')`,
      [tenantId],
    ),
  ).rejects.toThrow(/motivo_no_vacio/);
});

test("[AC-FIDN-11] al vencer, el acceso cae SOLO: nadie corre nada", async () => {
  // La mitad del AC que no se puede delegar a un job. Se fuerza el vencimiento en la fila —el
  // único atajo posible sin esperar 24 horas— y se comprueba que la caída no necesita ninguna
  // otra acción: la misma consulta que antes devolvía el grant ahora devuelve null.
  const g = await otorgar(control, {
    tenantId,
    otorgadoA: "soporte@kiloruta",
    motivo: "revisar exportador",
    alcance: "modulos",
    duracion: "7d",
  });
  expect((await vigente(control, tenantId))?.id).toBe(g.id);

  // Se corren las DOS fechas juntas, no solo el vencimiento: el CHECK de duración cerrada
  // rebota un `expira_en` movido a solas, y con razón — así se simula un grant otorgado hace
  // más de un día en vez de uno con una duración que nadie podría haber pedido.
  await control.query(
    `update grants_soporte
        set otorgado_en = otorgado_en - interval '8 days', expira_en = expira_en - interval '8 days'
      where id = $1`,
    [g.id],
  );
  expect(await vigente(control, tenantId), "el grant vencido seguía dando acceso").toBeNull();
});

test("[AC-FIDN-11] la revocación anticipada corta sin esperar el vencimiento", async () => {
  const g = await otorgar(control, {
    tenantId,
    otorgadoA: "soporte@kiloruta",
    motivo: "revisar cola de sync",
    alcance: "solo_lectura",
    duracion: "24h",
  });
  expect((await vigente(control, tenantId))?.id).toBe(g.id);

  expect(await revocar(control, g.id)).toBe(true);
  expect(await vigente(control, tenantId)).toBeNull();
  // Revocar dos veces no rompe nada y lo dice: la segunda no encuentra nada que revocar.
  expect(await revocar(control, g.id)).toBe(false);
});

test("[AC-FIDN-11] el begin/end del acceso queda en la auditoría VISIBLE del tenant", async () => {
  // Si el registro viviera solo en `control`, el dueño tendría que pedirle a la plataforma el
  // listado de las veces que la plataforma lo miró — y eso no es una auditoría, es un favor.
  const g = await otorgar(control, {
    tenantId,
    otorgadoA: "soporte@kiloruta",
    motivo: "revisar tablero",
    alcance: "solo_lectura",
    duracion: "24h",
  });

  await registrarAcceso(tenantPool, g.id, "inicio", "soporte@kiloruta");
  await registrarAcceso(tenantPool, g.id, "fin", "soporte@kiloruta");

  const filas: { momento: string }[] = await con(BD_A, (c: Conexion) =>
    c.sql<{ momento: string }>(
      "select despues->>'momento' as momento from audit_trail where tabla = 'soporte' and registro_id = $1 order by ocurrido_en",
      [g.id],
    ),
  );
  expect(filas.map((f) => f.momento)).toEqual(["inicio", "fin"]);

  // Y no se puede borrar: una sesión de soporte registrada sobrevive incluso al rol dueño de
  // la base (§7.4). Sin esto, la auditoría sería tan buena como la voluntad de quien la mira.
  await expect(tenantPool.query("delete from audit_trail where tabla = 'soporte'")).rejects.toThrow();
});

test("[AC-FIDN-11] el alcance es un conjunto CERRADO: no hay valor que signifique «todo»", async () => {
  expect([...ALCANCES]).toEqual(["solo_lectura", "modulos"]);
  await expect(
    control.query(
      `insert into grants_soporte (tenant_id, otorgado_a, motivo, alcance, expira_en)
       values ($1, 'x', 'motivo escrito', 'todo', now() + interval '24 hours')`,
      [tenantId],
    ),
  ).rejects.toThrow();
});
