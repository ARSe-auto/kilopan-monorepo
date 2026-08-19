import { test, expect } from "@playwright/test";
import { con, bdDeTenant, BD_CONTROL } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// La empresa implícita y el selector de modo [AC-FRUT-14] — §3, §4.5, §9.3.11.
//
// ─── EL CENTINELA 11, EJERCIDO DE VERDAD ──────────────────────────────────────────
//
// «Conmutar mi_flota → daas → mi_flota conserva TODAS las filas; empresa implícita intacta»
// (§9.3.11). Un test que solo mirara la empresa implícita pasaría en verde con una
// implementación que borra los encargos al conmutar. Por eso acá se cuenta CADA COSA que cuelga de
// la bandeja antes y después del viaje de ida y vuelta, y se compara el id de la implícita: si
// se recreara, el id cambiaría y todos los encargos que la referencian quedarían apuntando a una
// fila que ya no es la misma.
//
// ─── Y LO QUE HACE QUE EL MODO NO SEA UN ADORNO ──────────────────────────────────
//
// En `mi_flota` la empresa contratante es la propia y la UI no la muestra, pero la FILA existe:
// encargos, manifiestos y cierres operan contra ella igual que en `daas`. Sin esa fila, cada
// consulta del módulo tendría dos formas —una con empresa y otra sin ella— y la segunda es la
// que nadie prueba.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const comoDuena = { Authorization: `Portador ${SECRETO}` };
const RUT_DE_LA_CASA = "76.111.111-6";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'La dueña de la cuenta') returning id::text as id",
      [Object.keys(VALIDOS)[1]!],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );
  });
  // El modo arranca donde el registro del tenant lo dejó.
  await con(BD_CONTROL, async (c: Conexion) => {
    await c.sql("update tenants set modo = 'mi_flota' where slug = $1", [A.slug]);
  });
});

const conmutar = (request: import("@playwright/test").APIRequestContext, modo: string) =>
  request.patch("/api/gobierno/modo", { headers: comoDuena, data: { modo } });

/** Todo lo que cuelga de la bandeja, para poder decir «no se perdió NADA» y no solo «hay una». */
async function elInventario() {
  return con(BD_A, async (c: Conexion) => {
    const [n] = await c.sql<{ empresas: string; encargos: string; implicita: string }>(
      `select (select count(*) from empresas_cliente)::text as empresas,
              (select count(*) from encargos)::text        as encargos,
              (select coalesce(max(id::text), '')
                 from empresas_cliente where implicita)     as implicita`,
    );
    return n!;
  });
}

test("[AC-FRUT-14] en `mi_flota` la empresa implícita existe, aunque la UI no la muestre", async () => {
  await con(BD_A, async (c: Conexion) => {
    // El wizard del alta (hito g) va a llenar estos dos; hoy los pone el fixture. Sin ellos, el
    // trigger no crea nada y no rebota: un tenant existe antes de terminar de decir quién es.
    await c.sql("update tenant_info set rut_de_la_empresa = $1, razon_social = $2", [
      RUT_DE_LA_CASA,
      "Transportes de la casa",
    ]);

    const implicitas = await c.sql<{ rut: string; razon_social: string }>(
      "select rut, razon_social from empresas_cliente where implicita",
    );
    expect(implicitas).toHaveLength(1);
    expect(implicitas[0]!.rut).toBe(RUT_DE_LA_CASA);

    // Y es UNA sola, garantizado por índice único parcial: dos altas concurrentes al conmutar
    // encontrarían la tabla sin ella las dos.
    await expect(
      c.sql(
        `insert into empresas_cliente (rut, razon_social, implicita)
         values ('77.222.222-K', 'Otra que se dice propia', true)`,
      ),
    ).rejects.toThrow(/empresas_cliente_una_implicita|duplicate key/);
  });
});

test("[AC-FRUT-14] conmutar mi_flota → daas → mi_flota no pierde una sola fila (centinela 11)", async ({
  request,
}) => {
  // Un encargo contra la empresa implícita: es lo que se perdería si conmutar fuera destructivo.
  await con(BD_A, async (c: Conexion) => {
    const [d] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Local de la casa') returning id::text as id",
    );
    const [e] = await c.sql<{ id: string }>(
      "select id::text as id from empresas_cliente where implicita",
    );
    await c.sql(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 7)",
      [e!.id, d!.id],
    );
  });

  const antes = await elInventario();
  expect(Number(antes.encargos)).toBeGreaterThan(0);

  const aDaas = await conmutar(request, "daas");
  expect(aDaas.ok()).toBe(true);

  // En `daas` conviven 1..N contratantes: la implícita deja de ser la única, no deja de existir.
  await con(BD_A, async (c: Conexion) => {
    await c.sql(
      `insert into empresas_cliente (rut, razon_social) values ('77.222.222-K', 'Panadería contratante')`,
    );
  });
  const enDaas = await elInventario();
  expect(enDaas.implicita, "pasar a daas borró la empresa implícita").toBe(antes.implicita);
  expect(Number(enDaas.empresas)).toBe(Number(antes.empresas) + 1);

  const deVuelta = await conmutar(request, "mi_flota");
  expect(deVuelta.ok()).toBe(true);

  const despues = await elInventario();
  // El MISMO id: si la implícita se recreara, todos los encargos que la referencian quedarían
  // apuntando a una fila que ya no es la misma.
  expect(despues.implicita, "volver a mi_flota recreó la empresa implícita").toBe(antes.implicita);
  // Y la contratante que se dio de alta en `daas` SIGUE: conmutar es aditivo, jamás destructivo.
  expect(Number(despues.empresas)).toBe(Number(antes.empresas) + 1);
  expect(despues.encargos, "conmutar perdió encargos").toBe(antes.encargos);
});

test("[AC-FRUT-14] las dos bases quedan de acuerdo: autoridad en control, réplica en el tenant", async ({
  request,
}) => {
  await conmutar(request, "daas");

  const [enControl] = await con(BD_CONTROL, (c: Conexion) =>
    c.sql<{ modo: string }>("select modo::text as modo from tenants where slug = $1", [A.slug]),
  );
  const [enTenant] = await con(BD_A, (c: Conexion) =>
    c.sql<{ modo: string }>("select modo from tenant_info"),
  );
  // La réplica existe porque el trigger de la empresa implícita vive en la base del tenant y el
  // §7.2 le prohíbe cruzar a `control`. Si las dos se separaran, el ruteo creería una cosa y el
  // trigger otra.
  expect(enTenant!.modo).toBe(enControl!.modo);
  expect(enControl!.modo).toBe("daas");

  await conmutar(request, "mi_flota");
});

test("[AC-FRUT-14] un modo que no existe rebota 422, y no toca nada", async ({ request }) => {
  const antes = await elInventario();
  const rebote = await conmutar(request, "franquicia");

  expect(rebote.status()).toBe(422);
  expect(((await rebote.json()) as { error: string }).error).toBe("modo_desconocido");
  expect(await elInventario()).toEqual(antes);
});

// El rebote 403 para un rol distinto de `admin_tenant` (y sus 0 filas) ya lo ejerce el barrido
// genérico de `gobierno.spec.ts` [AC-FIDN-12] sobre cada ruta de `/api/gobierno/*`,
// `/api/gobierno/modo` incluido (declarado en `rutas/manifiesto.json`) — no se repite acá. Lo
// que faltaba probar es la otra mitad de [AC-FPOR-15]: que cada conmutación deja rastro en
// `audit_trail`, no solo en `eventos` (§3, §5.4, §5.5).
test("[AC-FPOR-15] cada conmutación de modo queda en audit_trail, con su antes y su después", async ({
  request,
}) => {
  // `audit_trail` es append-only (§7.4): no se limpia, se mira la COLA que dejan estas dos
  // conmutaciones. Es lo que hace que este test valga aunque otras suites hayan escrito antes.
  const [antes] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from audit_trail where tabla = 'tenant_info'"),
  );

  const aDaas = await conmutar(request, "daas");
  expect(aDaas.ok()).toBe(true);
  const deVuelta = await conmutar(request, "mi_flota");
  expect(deVuelta.ok()).toBe(true);

  const filas = await con(BD_A, (c: Conexion) =>
    c.sql<{ operacion: string; antes: string; despues: string }>(
      `select operacion, antes::text as antes, despues::text as despues
         from audit_trail where tabla = 'tenant_info'
        order by ocurrido_en desc limit 2`,
    ),
  );
  // Las dos filas más nuevas, más nuevo primero: la última conmutación fue mi_flota → daas → mi_flota
  // así que el orden cronológico ascendente es [daas, mi_flota] vuelto del revés.
  const [ultima, previa] = filas;
  expect(ultima!.operacion).toBe("UPDATE");
  expect(previa!.operacion).toBe("UPDATE");
  expect(JSON.parse(ultima!.antes)).toEqual({ modo: "daas" });
  expect(JSON.parse(ultima!.despues)).toEqual({ modo: "mi_flota" });
  expect(JSON.parse(previa!.antes)).toEqual({ modo: "mi_flota" });
  expect(JSON.parse(previa!.despues)).toEqual({ modo: "daas" });

  const [despues] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from audit_trail where tabla = 'tenant_info'"),
  );
  expect(Number(despues!.n)).toBe(Number(antes!.n) + 2);
});
