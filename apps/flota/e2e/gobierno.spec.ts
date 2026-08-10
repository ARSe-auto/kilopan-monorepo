import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { Pool } from "pg";
import { secretoNuevo, hashDeSecreto, parDelAparato } from "../src/dominio/secretos.ts";
import { registrarAcceso } from "../src/servidor/soporte.ts";
import { enActo, registrarEvento, type CodigoDeEvento } from "../src/servidor/gobierno.ts";
import { casosDelRepo } from "../rutas/generar.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { con, bdDeTenant, BD_CONTROL, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { TENANTS, VECINO } from "./preparar-tenants.mjs";
import { PIN } from "../../../packages/nucleo-comun/src/constants.ts";

// El plano de control exclusivo del dueño, por HTTP [AC-FIDN-12] — §4.3, §5.4, §3.E1.14.
//
// POR QUÉ ESTA SUITE TIENE BASE PROPIA. El gobierno escribe en `eventos` y `audit_trail`, que
// son append-only (§7.4), y deja `codigos_puente` con FK a `usuarios`. Compartiendo la base
// del primer activo, el `delete from usuarios` del `beforeAll` de otra suite rebotaría por esa
// FK — y el módulo que se pondría rojo sería el que no hizo nada. El tenant `gobierno` está en
// el fixture por esa razón y por ninguna otra.
//
// LOS DOS BARRIDOS DE ARRIBA SON EL AC. El texto dice «CADA acción de gobierno», y una lista
// de rutas escrita a mano acá se queda corta el día que alguien agrega la undécima: el barrido
// sale del MANIFIESTO (AC-FTEN-26), que se deriva del árbol. Una ruta de gobierno nueva entra
// sola a los dos barridos, o el gate se pone rojo antes por no tener cruce declarado.

const PUERTO = 3311;
const DOMINIO = "localhost";

const T = TENANTS.find((t) => t.slug === "gobierno")!;
const BD = bdDeTenant(T.slug);
const BD_VECINO = bdDeTenant(VECINO!.slug);
const HOST = `${T.slug}.${DOMINIO}:${PUERTO}`;

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };
type Respuesta = { status: number; texto: string; json: Record<string, unknown> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) =>
  con(BD, (c: Conexion) => c.sql<F>(texto, params));

/** Un request con Host propio: la identidad del tenant se juega ahí y un navegador no la fija. */
function pedirA(
  ruta: string,
  metodo: string,
  opciones: { secreto?: string; cuerpo?: unknown; host?: string } = {},
): Promise<Respuesta> {
  // Sin cuerpo en GET ni DELETE: un body ahí lo ignoran el servidor y el estándar, y lo que
  // se quiere probar es la guardia, no cómo Next trata un request raro.
  const llevaCuerpo = opciones.cuerpo !== undefined && metodo !== "GET" && metodo !== "DELETE";
  const cuerpo = llevaCuerpo ? JSON.stringify(opciones.cuerpo) : null;
  const cabeceras: Record<string, string> = { Host: opciones.host ?? HOST };
  if (opciones.secreto) cabeceras.Authorization = `Portador ${opciones.secreto}`;
  if (cuerpo !== null) {
    cabeceras["content-type"] = "application/json";
    cabeceras["content-length"] = String(Buffer.byteLength(cuerpo));
  }
  return new Promise((resolver, rechazar) => {
    const req = pedir(
      { host: "127.0.0.1", port: PUERTO, path: ruta, method: metodo, headers: cabeceras },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (t) => (texto += t));
        res.on("end", () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(texto) as Record<string, unknown>;
          } catch {
            json = {};
          }
          resolver({ status: res.statusCode ?? 0, texto, json });
        });
      },
    );
    req.on("error", rechazar);
    if (cuerpo !== null) req.write(cuerpo);
    req.end();
  });
}

const SQL_TABLAS = `select table_schema || '.' || table_name as t
                    from information_schema.tables
                    where table_type = 'BASE TABLE'
                      and table_schema not in ('pg_catalog', 'information_schema')
                    order by 1`;

/** Conteo de filas por tabla, leído del catálogo. Es la evidencia de «0 filas» del AC: no una
 *  lista de tablas escrita acá, que dejaría fuera la que nace en el módulo siguiente. */
async function huellaDe(bd: string): Promise<Record<string, number>> {
  return await con(bd, async (c: Conexion) => {
    const tablas = await c.sql<{ t: string }>(SQL_TABLAS);
    const huella: Record<string, number> = {};
    for (const { t } of tablas) {
      if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`tabla rara: ${t}`);
      const filas = await c.sql<{ n: string }>(`select count(*)::text as n from ${t}`);
      huella[t] = Number(filas[0]?.n ?? "0");
    }
    return huella;
  });
}

// ─── El fixture: una dueña, un operario y algo de cada cosa que se gobierna ────────────

let pool: Pool;
let control: Pool;
let duena = { usuarioId: "", personaId: "", secreto: "" };
let operario = { usuarioId: "", personaId: "", dispositivoId: "", secreto: "" };
let invitacionId = "";
let solicitudId = "";
let vehiculoId = "";

async function enrolar(rut: string, nombre: string, rol: string) {
  const secreto = secretoNuevo();
  const [p] = await sql<{ id: string }>(
    "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
    [rut, nombre],
  );
  const [u] = await sql<{ id: string }>(
    "insert into usuarios (persona_id, rol, pin_hash) values ($1, $2::rol_usuario, '$argon2id$fixture') returning id::text as id",
    [p!.id, rol],
  );
  const [d] = await sql<{ id: string }>(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
     values ('personal', $1, $2, $3, now()) returning id::text as id`,
    [p!.id, hashDeSecreto(secreto), u!.id],
  );
  return { personaId: p!.id, usuarioId: u!.id, dispositivoId: d!.id, secreto };
}

test.beforeAll(async () => {
  pool = new Pool({ host: CLUSTER_LOCAL.host, port: CLUSTER_LOCAL.puerto, database: BD, user: ROL_MIGRADOR });
  control = new Pool({
    host: CLUSTER_LOCAL.host,
    port: CLUSTER_LOCAL.puerto,
    database: BD_CONTROL,
    user: ROL_MIGRADOR,
  });

  // El orden lo dictan las FK, no el gusto, y vive en `limpiar.mjs`.
  await limpiarFixture(sql);

  duena = await enrolar("11.111.111-1", "Dueña", "admin_tenant");
  operario = await enrolar("7.654.321-6", "Operario", "chofer");

  const [i] = await sql<{ id: string }>(
    `insert into invitaciones (rol, token_hash, expira_at, creada_por)
     values ('chofer', 'hash-del-fixture', now() + interval '7 days', $1) returning id::text as id`,
    [duena.usuarioId],
  );
  invitacionId = i!.id;
  const [s] = await sql<{ id: string }>(
    `insert into solicitudes_acceso
       (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
     values ($1, '12.345.678-5', 'Quien espera', '$argon2id$fixture', 'clave-del-fixture', 'huella')
     returning id::text as id`,
    [invitacionId],
  );
  solicitudId = s!.id;

  // Un vehículo, porque las rutas de gobierno de vehículos llevan parámetro [AC-FVEH-02]: el
  // barrido de más abajo necesita un id REAL de esta base para que el 403 signifique algo.
  const [v] = await sql<{ id: string }>(
    "insert into vehiculos (patente, tipo) values ('GOB1234', 'furgón') returning id::text as id",
  );
  vehiculoId = v!.id;
});

test.afterAll(async () => {
  await pool?.end();
  await control?.end();
});

/**
 * Toda acción de gobierno del manifiesto, con un identificador REAL de esta base.
 *
 * Que el id EXISTA es lo que hace valer el 403: contra un uuid inventado, un handler que
 * mirara el recurso antes que el rol respondería 404 y el barrido pasaría en verde sin haber
 * probado el rebote que el AC pide.
 */
function accionesDeGobierno() {
  const { casos } = casosDelRepo() as { casos: { ruta: string; metodo: string }[] };
  const ID_DE: Record<string, string> = {
    "/api/gobierno/invitaciones/[id]": invitacionId,
    "/api/gobierno/solicitudes/[id]": solicitudId,
    "/api/gobierno/dispositivos/[id]": operario.dispositivoId,
    "/api/gobierno/usuarios/[id]/pin": operario.usuarioId,
    "/api/gobierno/vehiculos/[id]": vehiculoId,
    "/api/gobierno/vehiculos/[id]/documentos": vehiculoId,
  };
  return casos
    .filter((c) => c.ruta.startsWith("/api/gobierno/"))
    .map((c) => ({
      metodo: c.metodo,
      ruta: c.ruta.replace(/\[[^\]]+\]/, encodeURIComponent(ID_DE[c.ruta] ?? "")),
      declarada: c.ruta,
    }));
}

/** El payload más peligroso que cada verbo acepta, todo junto: si algo pasara la guardia, esto
 *  es lo que escribiría. Un barrido con el cuerpo vacío probaría el parser, no el rol. */
const CUERPO_PELIGROSO = {
  accion: "revocar",
  rol: "chofer",
  alcance: "modulos",
  duracion: "7d",
  otorgado_a: "quien-no-deberia",
  motivo: "un motivo cualquiera",
  grant_id: "0192f0a0-0000-7000-8000-0000000000aa",
};

// ─── Los dos rebotes que el AC nombra, sobre CADA acción ──────────────────────────────

test("[AC-FIDN-12] cada acción de gobierno con rol NO admin ⇒ 403 y CERO filas", async () => {
  const acciones = accionesDeGobierno();
  // Anti-vacuidad: un barrido de cero casos pasa en verde sin haber pedido una sola vez.
  expect(acciones.length).toBeGreaterThan(0);

  const antes = await huellaDe(BD);
  for (const { metodo, ruta, declarada } of acciones) {
    const r = await pedirA(ruta, metodo, { secreto: operario.secreto, cuerpo: CUERPO_PELIGROSO });
    expect(r.status, `${metodo} ${declarada} con rol chofer`).toBe(403);
    expect(r.json.error, `${metodo} ${declarada}`).toBe("solo_el_dueno");
  }
  // «0 filas» del AC, leído del catálogo: ninguna tabla de la base se movió en todo el barrido.
  expect(await huellaDe(BD)).toEqual(antes);
});

test("[AC-FIDN-12] sin sesión, el panel del dueño no existe: 404 pelado en cada acción", async () => {
  const antes = await huellaDe(BD);
  for (const { metodo, ruta, declarada } of accionesDeGobierno()) {
    const r = await pedirA(ruta, metodo, { cuerpo: CUERPO_PELIGROSO });
    // 404 y NO 401: sobre una ruta que nombra un recurso, un 401 confirma que ese uuid es
    // real. Es el mismo criterio del «404 jamás 403» del §0, aplicado a quien no se identificó.
    expect(r.status, `${metodo} ${declarada} sin credencial`).toBe(404);
    expect(r.texto, `${metodo} ${declarada} contestó con cuerpo`).toBe("");
  }
  expect(await huellaDe(BD)).toEqual(antes);
});

test("[AC-FIDN-12] el recurso de identidad de OTRO tenant ⇒ 404, y su BD sin cambios", async () => {
  // Con sesión de dueño LEGÍTIMA de este tenant, pidiendo los recursos del vecino por su id
  // real. Es el caso que el barrido autogenerado no puede montar —aquel va sin credencial— y
  // el que de verdad importa: acá hay un admin_tenant válido detrás del request.
  const ajenos = await con(BD_VECINO, async (c: Conexion) => ({
    invitacion: (await c.sql<{ id: string }>("select id::text as id from invitaciones limit 1"))[0]!.id,
    solicitud: (await c.sql<{ id: string }>("select id::text as id from solicitudes_acceso limit 1"))[0]!.id,
    dispositivo: (await c.sql<{ id: string }>("select id::text as id from dispositivos limit 1"))[0]!.id,
    usuario: (await c.sql<{ id: string }>("select id::text as id from usuarios limit 1"))[0]!.id,
  }));

  const antes = await huellaDe(BD_VECINO);
  const casos: [string, string, unknown][] = [
    [`/api/gobierno/invitaciones/${ajenos.invitacion}`, "PATCH", { accion: "revocar" }],
    [`/api/gobierno/solicitudes/${ajenos.solicitud}`, "POST", { accion: "aprobar" }],
    [`/api/gobierno/dispositivos/${ajenos.dispositivo}`, "DELETE", undefined],
    [`/api/gobierno/usuarios/${ajenos.usuario}/pin`, "POST", { accion: "rotar" }],
  ];
  for (const [ruta, metodo, cuerpo] of casos) {
    const r = await pedirA(ruta, metodo, { secreto: duena.secreto, cuerpo });
    expect(r.status, `${metodo} ${ruta} con el id del vecino`).toBe(404);
    expect(r.texto).toBe("");
  }
  expect(await huellaDe(BD_VECINO), "el panel de un tenant tocó la BD del vecino").toEqual(antes);
});

// ─── Invitaciones (§5.4 F-A) ──────────────────────────────────────────────────────────

test("[AC-FIDN-12] emitir invitación: el código sale UNA vez y el acto queda en las dos bitácoras", async () => {
  const r = await pedirA("/api/gobierno/invitaciones", "POST", {
    secreto: duena.secreto,
    cuerpo: { rol: "operador" },
  });
  expect(r.status).toBe(201);
  const emitida = r.json as unknown as { id: string; codigo: string };
  expect(emitida.codigo).toHaveLength(8);

  // En la base queda SOLO el hash: de la fila no se saca el código con que solicitar.
  const [fila] = await sql<{ token_hash: string; rol: string }>(
    "select token_hash, rol::text as rol from invitaciones where id = $1",
    [emitida.id],
  );
  expect(fila!.rol).toBe("operador");
  expect(fila!.token_hash).not.toBe(emitida.codigo);

  // El listado del panel NO devuelve el hash: lo que no se puede leer de la base tampoco se
  // puede leer del endpoint que la lee.
  const listado = await pedirA("/api/gobierno/invitaciones", "GET", { secreto: duena.secreto });
  expect(listado.status).toBe(200);
  expect(listado.texto).not.toContain(fila!.token_hash);

  // Las DOS bitácoras que el §3.E1.14 pide, y las dos por caminos distintos: `audit_trail` lo
  // escribió el trigger de la tabla, el evento lo escribió el acto.
  const [auditoria] = await sql<{ n: string }>(
    "select count(*)::text as n from audit_trail where tabla = 'invitaciones' and registro_id = $1",
    [emitida.id],
  );
  expect(Number(auditoria!.n)).toBeGreaterThan(0);
  const [evento] = await sql<{ actor: string; codigo: string }>(
    `select e.actor_id::text as actor, t.codigo from eventos e join evento_tipo t on t.id = e.tipo_id
      where e.objeto_id = $1 and t.codigo = 'gobierno.invitacion_emitida'`,
    [emitida.id],
  );
  expect(evento, "la emisión no dejó evento").toBeDefined();
  // El actor va en el evento porque el trigger de auditoría escribe la FILA, no quién la tocó.
  expect(evento!.actor).toBe(duena.usuarioId);
});

test("[AC-FIDN-12] pausar no mueve el vencimiento, y revocar gana sobre la pausa", async () => {
  const creada = await pedirA("/api/gobierno/invitaciones", "POST", {
    secreto: duena.secreto,
    cuerpo: { rol: "chofer" },
  });
  const id = (creada.json as unknown as { id: string }).id;
  const [original] = await sql<{ expira: string }>(
    "select expira_at::text as expira from invitaciones where id = $1",
    [id],
  );

  expect((await pedirA(`/api/gobierno/invitaciones/${id}`, "PATCH", {
    secreto: duena.secreto, cuerpo: { accion: "pausar" },
  })).json.estado).toBe("aplicada");

  const [pausada] = await sql<{ expira: string; pausada: string | null }>(
    "select expira_at::text as expira, pausada_at::text as pausada from invitaciones where id = $1",
    [id],
  );
  expect(pausada!.pausada).not.toBeNull();
  // El plazo del §0 acota la ventana; no cuenta tiempo de uso. Una pausada el día 6 y
  // reanudada el 9 está vencida, y eso es lo correcto.
  expect(pausada!.expira).toBe(original!.expira);

  // Pausar dos veces no es un error: en un galpón con guantes se toca dos veces el mismo botón.
  expect((await pedirA(`/api/gobierno/invitaciones/${id}`, "PATCH", {
    secreto: duena.secreto, cuerpo: { accion: "pausar" },
  })).json.estado).toBe("sin_cambios");

  await pedirA(`/api/gobierno/invitaciones/${id}`, "PATCH", {
    secreto: duena.secreto, cuerpo: { accion: "revocar" },
  });
  // Y reanudar una revocada NO la revive: el acto deliberado del dueño no se deshace por la
  // puerta de atrás (§5.4 F-F).
  expect((await pedirA(`/api/gobierno/invitaciones/${id}`, "PATCH", {
    secreto: duena.secreto, cuerpo: { accion: "reanudar" },
  })).json.estado).toBe("sin_cambios");
  const [tras] = await sql<{ revocada: string | null }>(
    "select revocada_at::text as revocada from invitaciones where id = $1",
    [id],
  );
  expect(tras!.revocada).not.toBeNull();
});

test("[AC-FIDN-12] los dos roles que este panel NO invita rebotan 422 y no dejan fila", async () => {
  const [antes] = await sql<{ n: string }>("select count(*)::text as n from invitaciones");
  for (const rol of ["cliente", "admin_tenant"]) {
    const r = await pedirA("/api/gobierno/invitaciones", "POST", {
      secreto: duena.secreto,
      cuerpo: { rol },
    });
    // `cliente` se invita desde la ficha de su empresa con el id embebido (Pregunta 3), y
    // `admin_tenant` se transfiere con passkey (§5.4 F-H): si el panel pudiera fabricar un
    // segundo dueño con una invitación, esa ceremonia sería decorativa.
    expect(r.status, `rol ${rol}`).toBe(422);
    expect(r.json.error).toBe("rol_no_invitable");
  }
  const [despues] = await sql<{ n: string }>("select count(*)::text as n from invitaciones");
  expect(despues!.n).toBe(antes!.n);
});

// ─── Solicitudes: el badge y la decisión de 1 toque (§5.4 F-C) ────────────────────────

test("[AC-FIDN-12] aprobar en 1 toque crea la identidad y el evento en el MISMO acto", async () => {
  const aparato = await parDelAparato();
  const [inv] = await sql<{ id: string }>(
    `insert into invitaciones (rol, token_hash, expira_at, creada_por)
     values ('chofer', 'hash-para-aprobar', now() + interval '7 days', $1) returning id::text as id`,
    [duena.usuarioId],
  );
  const [sol] = await sql<{ id: string }>(
    `insert into solicitudes_acceso
       (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
     values ($1, '20.347.878-K', 'Chofer Nuevo', '$argon2id$fixture', $2, 'huella') returning id::text as id`,
    [inv!.id, aparato.publica],
  );

  const pendientes = await pedirA("/api/gobierno/solicitudes", "GET", { secreto: duena.secreto });
  expect(pendientes.status).toBe(200);
  expect((pendientes.json as unknown as { total: number }).total).toBeGreaterThan(0);

  const r = await pedirA(`/api/gobierno/solicitudes/${sol!.id}`, "POST", {
    secreto: duena.secreto,
    cuerpo: { accion: "aprobar" },
  });
  expect(r.status).toBe(200);
  const aprobada = r.json as unknown as { usuario_id: string; dispositivo_id: string };
  expect(aprobada.dispositivo_id).toBeTruthy();

  // EL SOBRE NO VIAJA AL DUEÑO. Lo retira el aparato del trabajador, que es el único que puede
  // abrirlo: mandárselo al dueño pondría un secreto ajeno en una pantalla que se comparte.
  expect(r.texto).not.toContain("sobre");
  const [enBase] = await sql<{ sobre: string | null }>(
    "select sobre::text as sobre from solicitudes_acceso where id = $1",
    [sol!.id],
  );
  expect(enBase!.sobre, "el sobre no quedó esperando al aparato").not.toBeNull();

  const [evento] = await sql<{ n: string }>(
    `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
      where e.objeto_id = $1 and t.codigo = 'gobierno.solicitud_aprobada'`,
    [sol!.id],
  );
  expect(evento!.n).toBe("1");
});

test("[AC-FIDN-12] el evento y la mutación entran juntos, o no entra ninguno", async () => {
  // La prueba de la atomicidad que el AC promete, sin esperar a un fallo de red: se hace una
  // mutación y se le pide un evento de un tipo que NO está en el catálogo. El acto entero se
  // deshace. Sin esto, «audit_trail + evento» sería una intención — y el modo de falla real
  // es justamente ese: la mutación commiteada y el rastro perdido.
  const [antes] = await sql<{ n: string }>("select count(*)::text as n from invitaciones");
  await expect(
    enActo(pool, async (c) => {
      await c.query(
        `insert into invitaciones (rol, token_hash, expira_at, creada_por)
         values ('chofer', 'hash-que-no-debe-sobrevivir', now() + interval '7 days', $1)`,
        [duena.usuarioId],
      );
      await registrarEvento(c, {
        codigo: "gobierno.tipo_que_no_existe" as CodigoDeEvento,
        objetoTabla: "invitaciones",
        objetoId: invitacionId,
        sesion: {
          usuarioId: duena.usuarioId,
          personaId: duena.personaId,
          dispositivoId: operario.dispositivoId,
          rol: "admin_tenant",
          isStandalone: true,
          storagePersisted: true,
        },
      });
    }),
  ).rejects.toThrow(/catálogo/);
  const [despues] = await sql<{ n: string }>("select count(*)::text as n from invitaciones");
  expect(despues!.n, "la mutación sobrevivió a un evento que no se pudo escribir").toBe(antes!.n);
});

test("[AC-FIDN-12] rechazar deja la decisión escrita y no emite nada", async () => {
  const [inv] = await sql<{ id: string }>(
    `insert into invitaciones (rol, token_hash, expira_at, creada_por)
     values ('chofer', 'hash-para-rechazar', now() + interval '7 days', $1) returning id::text as id`,
    [duena.usuarioId],
  );
  const [sol] = await sql<{ id: string }>(
    `insert into solicitudes_acceso
       (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
     values ($1, '5.126.663-3', 'Quien no entra', '$argon2id$fixture', 'clave', 'huella') returning id::text as id`,
    [inv!.id],
  );
  const [personasAntes] = await sql<{ n: string }>("select count(*)::text as n from personas");

  const r = await pedirA(`/api/gobierno/solicitudes/${sol!.id}`, "POST", {
    secreto: duena.secreto,
    cuerpo: { accion: "rechazar" },
  });
  expect(r.json.estado).toBe("rechazada");

  const [personasDespues] = await sql<{ n: string }>("select count(*)::text as n from personas");
  expect(personasDespues!.n).toBe(personasAntes!.n);
  const [evento] = await sql<{ n: string }>(
    `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
      where e.objeto_id = $1 and t.codigo = 'gobierno.solicitud_rechazada'`,
    [sol!.id],
  );
  expect(evento!.n).toBe("1");
});

// ─── Inventario y revocación en 1 toque (§5.4 F-F) ────────────────────────────────────

test("[AC-FIDN-12] revocar en 1 toque corta la sesión en el REQUEST SIGUIENTE", async () => {
  const victima = await enrolar("9.999.999-3", "Quien pierde el teléfono", "operador");

  // Antes: su sesión anda.
  expect((await pedirA("/api/sesion", "GET", { secreto: victima.secreto })).status).toBe(200);

  const inventario = await pedirA("/api/gobierno/dispositivos", "GET", { secreto: duena.secreto });
  expect(inventario.status).toBe(200);
  expect(inventario.texto).toContain(victima.dispositivoId);

  const r = await pedirA(`/api/gobierno/dispositivos/${victima.dispositivoId}`, "DELETE", {
    secreto: duena.secreto,
  });
  expect(r.json.estado).toBe("revocado");

  // Y acá está lo que el §5.4 F-F promete: el corte es el request SIGUIENTE, sin esperar a que
  // venza nada. Es lo que hace que «revocar en 1 toque» signifique algo cuando alguien perdió
  // el teléfono en la calle.
  expect((await pedirA("/api/sesion", "GET", { secreto: victima.secreto })).status).toBe(401);

  // El aparato revocado SIGUE en el inventario: esconderlo dejaría al dueño sin la pantalla
  // donde comprueba que el teléfono perdido está efectivamente afuera.
  const despues = await pedirA("/api/gobierno/dispositivos", "GET", { secreto: duena.secreto });
  expect(despues.texto).toContain(victima.dispositivoId);
  expect((await pedirA(`/api/gobierno/dispositivos/${victima.dispositivoId}`, "DELETE", {
    secreto: duena.secreto,
  })).json.estado).toBe("ya_estaba_revocado");
});

// ─── PIN: el dueño habilita, el operario elige (§5.4, Pregunta 2) ─────────────────────

test("[AC-FIDN-12] rotar PIN: el dueño emite el puente y JAMÁS conoce el PIN", async () => {
  const [antes] = await sql<{ h: string }>("select pin_hash as h from usuarios where id = $1", [
    operario.usuarioId,
  ]);

  const r = await pedirA(`/api/gobierno/usuarios/${operario.usuarioId}/pin`, "POST", {
    secreto: duena.secreto,
    cuerpo: { accion: "rotar" },
  });
  expect(r.status).toBe(201);
  const codigo = (r.json as unknown as { codigo: string }).codigo;
  expect(codigo).toHaveLength(8);

  // El acto del dueño NO tocó la credencial: hasta acá el PIN sigue siendo el viejo. Si el
  // dueño lo eligiera, lo conocería — y la firma por PIN dejaría de probar quién firmó (§4.5 del maestro).
  const [tras] = await sql<{ h: string }>("select pin_hash as h from usuarios where id = $1", [
    operario.usuarioId,
  ]);
  expect(tras!.h).toBe(antes!.h);

  // El código de OTRA persona no sirve en mi aparato: la sesión es la mitad de la credencial.
  const ajeno = await pedirA("/api/pin/puente", "POST", {
    secreto: duena.secreto,
    cuerpo: { codigo, pin: "4321" },
  });
  expect(ajeno.status).toBe(422);
  expect(ajeno.json.error).toBe("codigo_invalido");

  // El operario, en SU aparato, define su PIN nuevo.
  const canje = await pedirA("/api/pin/puente", "POST", {
    secreto: operario.secreto,
    cuerpo: { codigo, pin: "4321" },
  });
  expect(canje.status).toBe(200);
  const [nuevo] = await sql<{ h: string; intentos: string; bloqueado: string | null }>(
    "select pin_hash as h, intentos_fallidos::text as intentos, bloqueado_hasta::text as bloqueado from usuarios where id = $1",
    [operario.usuarioId],
  );
  expect(nuevo!.h).not.toBe(antes!.h);
  expect(nuevo!.h.startsWith("$argon2id$"), "el PIN nuevo no quedó con argon2id").toBe(true);
  // Rotar y desbloquear van juntos: devolverle una credencial nueva con el contador de la
  // vieja lo dejaría bloqueado con un PIN que sí se sabe.
  expect(nuevo!.intentos).toBe("0");
  expect(nuevo!.bloqueado).toBeNull();

  // DE UN SOLO USO. El segundo canje no cambia nada.
  const segundo = await pedirA("/api/pin/puente", "POST", {
    secreto: operario.secreto,
    cuerpo: { codigo, pin: "1111" },
  });
  expect(segundo.status).toBe(422);
  const [final] = await sql<{ h: string }>("select pin_hash as h from usuarios where id = $1", [
    operario.usuarioId,
  ]);
  expect(final!.h).toBe(nuevo!.h);
});

test("[AC-FIDN-12] emitir un puente nuevo ANULA el anterior, y como mucho hay uno vivo", async () => {
  const primero = (
    await pedirA(`/api/gobierno/usuarios/${operario.usuarioId}/pin`, "POST", {
      secreto: duena.secreto,
      cuerpo: { accion: "rotar" },
    })
  ).json as unknown as { codigo: string };
  const segundo = (
    await pedirA(`/api/gobierno/usuarios/${operario.usuarioId}/pin`, "POST", {
      secreto: duena.secreto,
      cuerpo: { accion: "rotar" },
    })
  ).json as unknown as { codigo: string };
  expect(segundo.codigo).not.toBe(primero.codigo);

  // El primero ya no abre nada: sin la anulación, el segundo intento del dueño —el que hace
  // cuando el operario no anotó bien— habría rebotado contra el índice parcial.
  expect((await pedirA("/api/pin/puente", "POST", {
    secreto: operario.secreto, cuerpo: { codigo: primero.codigo, pin: "2222" },
  })).status).toBe(422);
  expect((await pedirA("/api/pin/puente", "POST", {
    secreto: operario.secreto, cuerpo: { codigo: segundo.codigo, pin: "2222" },
  })).status).toBe(200);

  const [vivos] = await sql<{ n: string }>(
    "select count(*)::text as n from codigos_puente where usuario_id = $1 and usado_en is null and anulado_en is null",
    [operario.usuarioId],
  );
  expect(vivos!.n).toBe("0");
});

test("[AC-FIDN-12] desbloquear NO toca la credencial: el operario se acordó del PIN", async () => {
  // El umbral sale del canónico §0 y no escrito a mano: si el lockout cambiara, este fixture
  // seguiría bloqueando con el número viejo y el test diría que desbloquear anda cuando no.
  await sql(
    "update usuarios set intentos_fallidos = $2, bloqueado_hasta = now() + interval '1 hour' where id = $1",
    [operario.usuarioId, PIN.intentos_hasta_bloqueo],
  );
  const [antes] = await sql<{ h: string }>("select pin_hash as h from usuarios where id = $1", [
    operario.usuarioId,
  ]);

  const r = await pedirA(`/api/gobierno/usuarios/${operario.usuarioId}/pin`, "POST", {
    secreto: duena.secreto,
    cuerpo: { accion: "desbloquear" },
  });
  expect(r.json.estado).toBe("desbloqueado");

  const [despues] = await sql<{ h: string; intentos: string; bloqueado: string | null }>(
    "select pin_hash as h, intentos_fallidos::text as intentos, bloqueado_hasta::text as bloqueado from usuarios where id = $1",
    [operario.usuarioId],
  );
  expect(despues!.intentos).toBe("0");
  expect(despues!.bloqueado).toBeNull();
  // Si desbloquear rotara el PIN, cada olvido de cinco minutos costaría una credencial nueva
  // y una llamada telefónica.
  expect(despues!.h).toBe(antes!.h);
});

// ─── Grants de soporte (§5.4 F-G, §7.9) ───────────────────────────────────────────────

test("[AC-FIDN-12] el dueño otorga y revoca el acceso de soporte, y no el del vecino", async () => {
  const r = await pedirA("/api/gobierno/grants", "POST", {
    secreto: duena.secreto,
    cuerpo: { accion: "otorgar", alcance: "solo_lectura", duracion: "24h", otorgado_a: "soporte@kiloruta", motivo: "revisar un sync trabado" },
  });
  expect(r.status).toBe(201);
  const grantId = (r.json as unknown as { id: string }).id;

  const listado = await pedirA("/api/gobierno/grants", "GET", { secreto: duena.secreto });
  expect(listado.texto).toContain(grantId);

  // El grant del VECINO, nombrado por su uuid real desde el panel de este tenant. Tiene que
  // verse igual que uno inexistente —«sin_cambios»— y seguir vigente del otro lado: sin el
  // `tenant_id` dentro del WHERE, este request apagaría el soporte de otra empresa.
  const [vecinoEnControl] = await con(BD_CONTROL, (c: Conexion) =>
    c.sql<{ id: string }>("select id::text as id from tenants where slug = $1", [VECINO!.slug]),
  );
  const { rows: ajeno } = await control.query<{ id: string }>(
    `insert into grants_soporte (tenant_id, otorgado_a, motivo, alcance, expira_en)
     values ($1, 'soporte@kiloruta', 'del vecino', 'solo_lectura', now() + interval '24 hours')
     returning id::text as id`,
    [vecinoEnControl!.id],
  );
  const ajenoId = ajeno[0]!.id;

  const intento = await pedirA("/api/gobierno/grants", "POST", {
    secreto: duena.secreto,
    cuerpo: { accion: "revocar", grant_id: ajenoId },
  });
  expect(intento.json.estado).toBe("sin_cambios");
  const { rows: sigue } = await control.query<{ revocado: string | null }>(
    "select revocado_en::text as revocado from grants_soporte where id = $1",
    [ajenoId],
  );
  expect(sigue[0]!.revocado, "el panel de un tenant revocó el grant del vecino").toBeNull();

  // El propio sí se revoca, y queda el evento.
  expect((await pedirA("/api/gobierno/grants", "POST", {
    secreto: duena.secreto, cuerpo: { accion: "revocar", grant_id: grantId },
  })).json.estado).toBe("revocado");
  const [evento] = await sql<{ n: string }>(
    `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
      where e.objeto_id = $1 and t.codigo = 'gobierno.soporte_revocado'`,
    [grantId],
  );
  expect(evento!.n).toBe("1");

  await control.query("delete from grants_soporte where id = $1", [ajenoId]);
});

// ─── La auditoría de accesos (§3.E1.15, §7.9) ─────────────────────────────────────────

test("[AC-FIDN-12] la auditoría trae los actos de gobierno Y las sesiones de soporte", async () => {
  // El begin/end del acceso de soporte se espeja en el `audit_trail` del TENANT (AC-FIDN-11):
  // si viviera solo en `control`, el dueño tendría que pedirle a la plataforma el listado de
  // las veces que la plataforma lo miró, y eso no es una auditoría sino un favor.
  const grantFalso = "0192f0a0-0000-7000-8000-00000000f00d";
  await registrarAcceso(pool, grantFalso, "inicio", "soporte@kiloruta");
  await registrarAcceso(pool, grantFalso, "fin", "soporte@kiloruta");

  const r = await pedirA("/api/gobierno/auditoria", "GET", { secreto: duena.secreto });
  expect(r.status).toBe(200);
  const accesos = (r.json as unknown as { accesos: { origen: string; que: string; actor: string | null }[] }).accesos;

  const soporte = accesos.filter((a) => a.origen === "soporte");
  expect(soporte.map((a) => a.que).sort()).toEqual(["soporte.fin", "soporte.inicio"]);
  expect(soporte[0]!.actor).toBe("soporte@kiloruta");

  const gobierno = accesos.filter((a) => a.origen === "gobierno");
  expect(gobierno.length).toBeGreaterThan(0);
  // El actor de cada acto de gobierno se ve con nombre y no solo con un uuid: una bitácora que
  // obliga a resolver ids a mano es una bitácora que nadie lee.
  expect(gobierno.some((a) => a.actor === "Dueña")).toBe(true);
  expect(gobierno.some((a) => a.que === "gobierno.dispositivo_revocado")).toBe(true);
});
