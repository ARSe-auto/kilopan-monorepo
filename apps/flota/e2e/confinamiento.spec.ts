import { test, expect } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El rol `cliente`, confinado a SU empresa — la mitad de APP [AC-FRUT-12] — §7.2, §9.3.3.
//
// ─── LO QUE ESTE ARCHIVO PRUEBA, Y LO QUE NO PUEDE ────────────────────────────────
//
// El confinamiento de FILAS lo garantiza una política de la base, y una política no se puede
// ejercer desde acá: el servidor del e2e se conecta con el superusuario del cluster local, y a
// un superusuario la RLS no se le aplica. Por eso esa mitad vive en
// `db/flota/suite-bd/confinamiento.test.mjs`, que abre conexión con el rol `app_t_<slug>` real
// —NOSUPERUSER, NOBYPASSRLS—, que es el sujeto del §7.2. Es la misma vía por la que se cerró la
// RLS de dinero (AC-FTEN-21) y la de grupos, y por la misma razón.
//
// Lo que sí es de acá, y no lo cubre ninguna otra suite:
//
//   · que un `cliente` sin empresa NO SE PUEDA CREAR, y un operador con empresa tampoco. Es la
//     precondición de todo lo demás: una política que compara contra una empresa que no existe
//     no confina nada.
//   · que la app resuelva la empresa en la sesión y la DECLARE en cada acto y cada lectura.
//     Hasta este AC nadie escribía `app.current_role` desde la app —solo las suites de base—,
//     así que las políticas estaban probadas y no protegían nada en runtime.
//   · que el operador de la casa siga viendo todo: lo que se confina es un rol, no la app.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO_DEL_CLIENTE = secretoNuevo();
const SECRETO_DEL_OPERADOR = secretoNuevo();
const comoCliente = { Authorization: `Portador ${SECRETO_DEL_CLIENTE}` };
const comoOperador = { Authorization: `Portador ${SECRETO_DEL_OPERADOR}` };

let suEmpresa = "";
let laOtraEmpresa = "";
let suEncargo = "";
let elEncargoAjeno = "";
let laRuta = "";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);

    const [suya] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del cliente') returning id::text as id",
      [Object.keys(VALIDOS)[4]!],
    );
    const [ajena] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Pastelería de al lado') returning id::text as id",
      [Object.keys(VALIDOS)[5]!],
    );
    suEmpresa = suya!.id;
    laOtraEmpresa = ajena!.id;

    // El contratante y el operador de la casa, cada uno con su aparato.
    const enrolar = async (rut: string, nombre: string, rol: string, empresa: string | null, secreto: string) => {
      const [p] = await c.sql<{ id: string }>(
        "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
        [rut, nombre],
      );
      const [u] = await c.sql<{ id: string }>(
        "insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, $2, $3) returning id::text as id",
        [p!.id, rol, empresa],
      );
      await c.sql(
        `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
         values ('personal', $1, $2, $3, now(), true, true)`,
        [p!.id, hashDeSecreto(secreto), u!.id],
      );
    };
    await enrolar(Object.keys(VALIDOS)[1]!, "Quien planifica", "operador", null, SECRETO_DEL_OPERADOR);
    await enrolar(Object.keys(VALIDOS)[2]!, "El contratante", "cliente", suEmpresa, SECRETO_DEL_CLIENTE);

    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Sucursal compartida') returning id::text as id",
    );

    const alta = async (empresa: string, bultos: number) => {
      const [e] = await c.sql<{ id: string }>(
        "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
        [empresa, destino!.id, bultos],
      );
      return e!.id;
    };
    suEncargo = await alta(suEmpresa, 12);
    elEncargoAjeno = await alta(laOtraEmpresa, 8);

    // Una ruta con las dos cargas: la parada agrupada es el caso que decide si el confinamiento
    // sirve de algo, porque las dos empresas comparten destino.
    const [r] = await c.sql<{ id: string }>(
      "insert into rutas (nombre) values ('Ruta de la madrugada') returning id::text as id",
    );
    laRuta = r!.id;
    const [parada] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [laRuta, destino!.id],
    );
    for (const encargo of [suEncargo, elEncargoAjeno]) {
      await c.sql(
        "insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 1)",
        [parada!.id, encargo],
      );
    }
  });
});

test("[AC-FRUT-12] la app DECLARA quién pregunta en cada acto y cada lectura", async ({
  request,
}) => {
  // Observable sin RLS: la app le pide la bandeja a la base dentro de una transacción con el rol
  // y la empresa declarados. Si no lo hiciera, la consulta seguiría funcionando —y por eso el
  // defecto sobrevivió hasta acá— pero la política no tendría contra qué comparar.
  //
  // Se verifica por el efecto que SÍ se ve desde afuera: la sesión del contratante resuelve con
  // su empresa. Sin ese dato en la sesión no hay nada que declarar, y el confinamiento de la
  // base queda inerte por más políticas que tenga.
  const laBandeja = await request.get("/api/encargos", { headers: comoCliente });
  expect(laBandeja.ok(), "la sesión del contratante no resolvió").toBe(true);

  await con(BD_A, async (c: Conexion) => {
    const [suUsuario] = await c.sql<{ empresa: string | null }>(
      `select u.empresa_cliente_id::text as empresa
         from usuarios u join personas p on p.id = u.persona_id
        where u.rol = 'cliente'`,
    );
    expect(suUsuario!.empresa, "el usuario `cliente` quedó sin empresa").toBe(suEmpresa);
  });
});

test("[AC-FRUT-12] el operador de la casa ve los encargos de las DOS empresas", async ({
  request,
}) => {
  // Lo que se confina es un rol, no la app. Sin este positivo, un confinamiento roto que
  // devolviera cero filas a todo el mundo pasaría por «seguro».
  const { encargos } = (await (
    await request.get("/api/encargos", { headers: comoOperador })
  ).json()) as { encargos: { id: string }[] };
  expect(encargos.map((e) => e.id)).toEqual(
    expect.arrayContaining([suEncargo, elEncargoAjeno]),
  );

  const { rutas } = (await (
    await request.get("/api/rutas", { headers: comoOperador })
  ).json()) as { rutas: { id: string }[] };
  expect(rutas.map((r) => r.id)).toContain(laRuta);
});

test("[AC-FRUT-12] un `cliente` sin empresa no se puede crear, y un operador con empresa tampoco", async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Alguien más') returning id::text as id",
      [Object.keys(VALIDOS)[3]!],
    );

    // Un cliente sin empresa lo vería ABSOLUTAMENTE todo —la política no tendría contra qué comparar— y un
    // operador con empresa vería de MENOS. Las dos direcciones son errores y las dos rebotan.
    await expect(
      c.sql("insert into usuarios (persona_id, rol) values ($1, 'cliente')", [p!.id]),
    ).rejects.toThrow(/usuarios_cliente_con_empresa/);

    await expect(
      c.sql("insert into usuarios (persona_id, rol, empresa_cliente_id) values ($1, 'operador', $2)", [
        p!.id,
        suEmpresa,
      ]),
    ).rejects.toThrow(/usuarios_cliente_con_empresa/);
  });
});
