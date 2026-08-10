import { test, expect } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El catálogo de motivos del tenant [AC-FRUT-13] — §4.5, §4.4, §4.2.
//
// ─── LO QUE ESTE ARCHIVO PROTEGE ──────────────────────────────────────────────────
//
// Que un motivo NO se pueda borrar. No es una regla de higiene: cada fila es la explicación que
// quedó escrita en un acto que ya ocurrió, y borrar «local cerrado» del catálogo porque este año
// no se usa deja sin sentido todas las no-entregas del año pasado que lo referencian — las
// mismas que sostienen la disputa cuando el cliente reclama y el devengo de la línea
// `por_devolucion` (§3.E1.9).
//
// Y su gemelo, sin el cual la regla sería una cárcel: apagarlo SÍ se puede, y apagarlo saca al
// motivo de los flujos nuevos dejando la historia intacta.
//
// ─── LO QUE NO SE PRUEBA ACÁ, Y ESTÁ DICHO ────────────────────────────────────────
//
// `require_notes` se exige en el CLIENTE contra el snapshot (§4.2) y la pantalla que lo consume
// —la no-entrega en ruta— es del módulo 04. Lo que este AC garantiza y sí se ejerce abajo es la
// mitad que le corresponde: que el catálogo llegue con su `require_notes` para que esa pantalla
// pueda exigirlo, y que ni el servidor ni la BASE lo exijan — una captura sin nota no puede
// rebotar, porque el mundo físico ya ocurrió.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const comoOperador = { Authorization: `Portador ${SECRETO}` };
const VERTICAL = "reparto_de_pan";
/** Los del vertical, en el orden en que se siembran. */
const DEL_VERTICAL = ["local_cerrado", "direccion_no_encontrada", "rechazo_del_cliente"];

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    // Los motivos NO se borran ni siquiera para armar un fixture: es la regla que este archivo
    // ejerce. Se apagan, y la suite trabaja con los del vertical que ella misma siembra.
    await c.sql("update motivos set activo = false");
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien administra el catálogo') returning id::text as id",
      [Object.keys(VALIDOS)[1]!],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'operador') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );

    await c.sql(
      `insert into vertical_template (vertical, motivos, meta_eevd) values ($1, $2, 0.9)
         on conflict (tenant_id, vertical) do update set motivos = excluded.motivos`,
      [VERTICAL, DEL_VERTICAL],
    );
  });
});

const sembrar = (request: import("@playwright/test").APIRequestContext) =>
  request.post("/api/motivos", { headers: comoOperador, data: { vertical: VERTICAL } });

const listar = async (
  request: import("@playwright/test").APIRequestContext,
  todos = false,
): Promise<{ id: string; codigo: string; activo: boolean; require_notes: boolean }[]> => {
  const r = await request.get(`/api/motivos${todos ? "?todos=1" : ""}`, { headers: comoOperador });
  return ((await r.json()) as { motivos: never[] }).motivos;
};

test("[AC-FRUT-13] el catálogo se siembra desde el vertical, y resembrarlo no duplica", async ({
  request,
}) => {
  const primera = await sembrar(request);
  expect(primera.ok()).toBe(true);
  expect((await primera.json()) as { sembrados: number }).toMatchObject({
    sembrados: DEL_VERTICAL.length,
  });

  // Idempotente: el alta de un tenant y el cambio de vertical la llaman más de una vez, y una
  // segunda corrida no puede duplicar la lista ni pisar el orden que el tenant ya ajustó.
  const segunda = await sembrar(request);
  expect((await segunda.json()) as { sembrados: number }).toMatchObject({ sembrados: 0 });

  const catalogo = await listar(request);
  expect(catalogo.map((m) => m.codigo)).toEqual(DEL_VERTICAL);

  // La etiqueta es legible desde el primer día: una lista de códigos crudos en la pantalla de
  // quien está en la calle se elige al azar.
  const conEtiquetas = (await (
    await request.get("/api/motivos", { headers: comoOperador })
  ).json()) as { motivos: { codigo: string; etiqueta: string }[] };
  expect(conEtiquetas.motivos.find((m) => m.codigo === "local_cerrado")!.etiqueta).toBe(
    "Local cerrado",
  );
});

test("[AC-FRUT-13] un motivo NO se puede borrar, ni siquiera como dueño del esquema", async () => {
  await con(BD_A, async (c: Conexion) => {
    const [motivo] = await c.sql<{ id: string }>(
      "select id::text as id from motivos where codigo = $1",
      ["local_cerrado"],
    );

    // 42501 (`insufficient_privilege`): el trigger lo rebota para TODOS. Un REVOKE no alcanzaba
    // —el tenant necesita UPDATE para apagar la fila—, así que lo único que se cierra es el
    // borrado.
    await expect(
      c.sql("delete from motivos where id = $1", [motivo!.id]),
    ).rejects.toThrow(/APAGA|jamás se borra/);

    const [sigue] = await c.sql<{ n: string }>(
      "select count(*)::text as n from motivos where id = $1",
      [motivo!.id],
    );
    expect(sigue!.n).toBe("1");
  });
});

test("[AC-FRUT-13] apagar saca al motivo de los flujos nuevos y deja la historia intacta", async ({
  request,
}) => {
  const antes = await listar(request);
  const cerrado = antes.find((m) => m.codigo === "local_cerrado")!;

  // Una parada histórica que lo referencia: es lo que hay que proteger.
  await con(BD_A, async (c: Conexion) => {
    const [d] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Local que estuvo cerrado') returning id::text as id",
    );
    const [r] = await c.sql<{ id: string }>(
      "insert into rutas (nombre) values ('Ruta de ayer') returning id::text as id",
    );
    await c.sql(
      `insert into paradas (ruta_id, tipo, orden, destino_id, estado, resultado, motivo_id)
       values ($1, 'entrega', 1, $2, 'done', 'fallo', $3)`,
      [r!.id, d!.id, cerrado.id],
    );
  });

  const apagado = await request.patch(`/api/motivos/${cerrado.id}`, {
    headers: comoOperador,
    data: { activo: false },
  });
  expect(apagado.ok()).toBe(true);

  // No se ofrece en flujos nuevos…
  expect((await listar(request)).map((m) => m.codigo)).not.toContain("local_cerrado");
  // …pero el panel que administra el catálogo lo sigue viendo: una fila que desaparece de su
  // propia pantalla de administración se lee como un dato perdido y nadie la vuelve a encender.
  expect((await listar(request, true)).map((m) => m.codigo)).toContain("local_cerrado");

  await con(BD_A, async (c: Conexion) => {
    const [parada] = await c.sql<{ motivo: string }>(
      "select motivo_id::text as motivo from paradas where resultado = 'fallo'",
    );
    // La historia INTACTA: la parada de ayer sigue diciendo por qué falló.
    expect(parada!.motivo).toBe(cerrado.id);
  });

  // Y se puede volver a encender: la regla es que no se pierde, no que no se administra.
  await request.patch(`/api/motivos/${cerrado.id}`, {
    headers: comoOperador,
    data: { activo: true },
  });
  expect((await listar(request)).map((m) => m.codigo)).toContain("local_cerrado");
});

test("[AC-FRUT-13] `require_notes` viaja en el catálogo, y la base no lo exige", async ({
  request,
}) => {
  const catalogo = await listar(request);
  // Viaja: sin este campo, la pantalla del módulo 04 no podría exigir la nota con el camión
  // detenido y la persona ahí, que es donde el §4.2 pone la validación bloqueante.
  expect(catalogo.every((m) => typeof m.require_notes === "boolean")).toBe(true);

  await con(BD_A, async (c: Conexion) => {
    const [motivo] = await c.sql<{ id: string }>(
      "update motivos set require_notes = true where codigo = $1 returning id::text as id",
      ["rechazo_del_cliente"],
    );
    const [d] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Local del rechazo') returning id::text as id",
    );
    const [r] = await c.sql<{ id: string }>(
      "insert into rutas (nombre) values ('Ruta con rechazo') returning id::text as id",
    );

    // Y la BASE no lo exige: una captura que llegue sin nota entra igual. Un CHECK acá sería
    // exactamente el rebote que el §4.2 prohíbe — el mundo físico ya ocurrió y esa fila es la
    // única constancia de que la entrega falló.
    await c.sql(
      `insert into paradas (ruta_id, tipo, orden, destino_id, estado, resultado, motivo_id)
       values ($1, 'entrega', 1, $2, 'done', 'fallo', $3)`,
      [r!.id, d!.id, motivo!.id],
    );
    const [n] = await c.sql<{ n: string }>(
      "select count(*)::text as n from paradas where motivo_id = $1",
      [motivo!.id],
    );
    expect(n!.n).toBe("1");
  });
});
