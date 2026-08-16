import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { abrir, parDelAparato, hashDeSecreto } from "../src/dominio/secretos.ts";
import { codigoNuevo, hashDeCodigo, expiraEn } from "../src/dominio/invitaciones.ts";
import { aprobar, rechazar, retirarSobre } from "../src/servidor/aprobacion.ts";
import { con, bdDeTenant, ROL_MIGRADOR, destinoDelCluster } from "../../../db/flota/conectar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// La aprobación del dueño contra la base de verdad [AC-FIDN-04] — §4.3, §5.4 F-C.
//
// El sobre se prueba puro en `src/dominio/secretos.test.ts`. Acá va lo que eso no puede dar:
// que la aprobación cree persona + usuario + dispositivo EN UNA transacción, que el secreto
// se emita UNA vez, que el rechazo no emita nada, y los dos rebotes tipados que el AC nombra.
//
// El aparato del trabajador está representado por su par de claves REAL: el sobre se abre con
// la privada no extraíble, con el mismo código que va a correr en la PWA. Sin eso, «se emite
// contra la clave pública» sería una frase y no una propiedad.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

let pool: Pool;
let duenaId: string;

async function contar(tabla: string): Promise<number> {
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(`select count(*)::text as n from ${tabla}`),
  );
  return Number(f!.n);
}

/** Una invitación viva del rol pedido, con su solicitud pendiente. Devuelve todo lo que hace falta. */
async function solicitudPendiente(rol: string, rut: string, nombre = "Quien solicita") {
  const aparato = await parDelAparato();
  const codigo = codigoNuevo();
  const [s] = await con(BD_A, async (c: Conexion) => {
    const [inv] = await c.sql<{ id: string }>(
      `insert into invitaciones (rol, token_hash, expira_at, creada_por)
       values ($1::rol_usuario, $2, $3, $4) returning id::text as id`,
      [rol, hashDeCodigo(codigo), expiraEn(new Date()), duenaId],
    );
    return c.sql<{ id: string }>(
      `insert into solicitudes_acceso
         (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
       values ($1, $2, $3, '$argon2id$de-prueba', $4, 'huella') returning id::text as id`,
      [inv!.id, rut, nombre, aparato.publica],
    );
  });
  return { solicitudId: s!.id, aparato };
}

test.beforeAll(async () => {
  pool = new Pool({
    host: destinoDelCluster().host,
    port: Number(destinoDelCluster().puerto),
    database: BD_A,
    user: ROL_MIGRADOR,
  });
  await con(BD_A, async (c: Conexion) => {
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
    duenaId = u!.id;
  });
});

test.afterAll(async () => {
  await pool?.end();
});

test("[AC-FIDN-04] la aprobación empareja persona+dispositivo+rol y el APARATO abre su secreto", async () => {
  const { solicitudId, aparato } = await solicitudPendiente("chofer", "12.345.678-5", "Chofer Nuevo");

  const r = await aprobar(pool, solicitudId, duenaId);
  expect(r.tipo).toBe("aprobada");
  if (r.tipo !== "aprobada") return;

  // El secreto lo abre la privada que nunca salió del teléfono. Esta línea es la que convierte
  // «se emite contra la clave pública» de frase en propiedad verificada.
  const secreto = await abrir(r.sobre, aparato.privada);
  expect(secreto.length).toBeGreaterThan(20);

  const [d] = await con(BD_A, (c: Conexion) =>
    c.sql<{ h: string; tipo: string; enrolado: string | null }>(
      "select secreto_hash as h, tipo::text as tipo, enrolado_por::text as enrolado from dispositivos where id = $1",
      [r.dispositivoId],
    ),
  );
  // En la BD queda SOLO el hash (§4.3): el secreto en claro no está en ninguna columna.
  expect(d!.h).toBe(hashDeSecreto(secreto));
  expect(d!.h).not.toBe(secreto);
  expect(d!.tipo).toBe("personal");
  expect(d!.enrolado).toBe(duenaId);

  // El rol sale de la INVITACIÓN, no de quien aprueba: lo que se aprueba ya estaba definido.
  const [u] = await con(BD_A, (c: Conexion) =>
    c.sql<{ rol: string }>("select rol::text as rol from usuarios where id = $1", [r.usuarioId]),
  );
  expect(u!.rol).toBe("chofer");
});

test("[AC-FIDN-04] una SEGUNDA aprobación de la misma solicitud rebota y no re-emite", async () => {
  const { solicitudId } = await solicitudPendiente("operador", "20.347.878-K");
  const primera = await aprobar(pool, solicitudId, duenaId);
  expect(primera.tipo).toBe("aprobada");

  const dispositivos = await contar("dispositivos");
  const segunda = await aprobar(pool, solicitudId, duenaId);

  expect(segunda.tipo).toBe("rebote");
  expect(segunda.tipo === "rebote" && segunda.motivo).toBe("ya_resuelta");
  expect(await contar("dispositivos"), "la segunda aprobación emitió otro secreto").toBe(dispositivos);
});

test("[AC-FIDN-04] el rechazo deja `rechazada` y NO emite nada", async () => {
  const { solicitudId } = await solicitudPendiente("chofer", "9.999.999-3");
  const antes = { personas: await contar("personas"), dispositivos: await contar("dispositivos") };

  const r = await rechazar(pool, solicitudId, duenaId);
  expect(r.tipo).toBe("rechazada");

  const [s] = await con(BD_A, (c: Conexion) =>
    c.sql<{ estado: string; sobre: string | null }>(
      "select estado::text as estado, sobre::text as sobre from solicitudes_acceso where id = $1",
      [solicitudId],
    ),
  );
  expect(s!.estado).toBe("rechazada");
  expect(s!.sobre, "el rechazo dejó un sobre esperando").toBeNull();
  expect(await contar("personas")).toBe(antes.personas);
  expect(await contar("dispositivos")).toBe(antes.dispositivos);

  // Y una vez rechazada, aprobarla ya no se puede: la decisión del dueño no se deshace por la
  // puerta de atrás.
  const despues = await aprobar(pool, solicitudId, duenaId);
  expect(despues.tipo === "rebote" && despues.motivo).toBe("ya_resuelta");
});

test("[AC-FIDN-04] aprobar un `cliente` sin empresa rebota 422 tipado y no deja nada", async () => {
  const { solicitudId } = await solicitudPendiente("cliente", "7.654.321-6");
  const antes = await contar("personas");

  const sinEmpresa = await aprobar(pool, solicitudId, duenaId);
  expect(sinEmpresa.tipo === "rebote" && sinEmpresa.motivo).toBe("cliente_sin_empresa");
  expect(await contar("personas"), "creó la persona antes de rebotar").toBe(antes);

  // El positivo: con la empresa, el mismo `cliente` entra. Sin esto, un rebote que negara
  // todo se vería idéntico a la regla correcta.
  //
  // La empresa se CREA: desde AC-FRUT-12 la columna lleva su FK compuesta —la que la 0011 dejó
  // anotada para el módulo que creara `empresas_cliente`— y un uuid inventado ya no entra.
  const [empresa] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Contratante del fixture') returning id::text as id",
    ),
  );
  const conEmpresa = await aprobar(pool, solicitudId, duenaId, {
    empresaClienteId: empresa!.id,
  });
  expect(conEmpresa.tipo).toBe("aprobada");
});

test("[AC-FIDN-04] el RUT ya registrado rebota ACÁ, y nombrando al titular (pregunta 10)", async () => {
  // La otra mitad de la decisión del dueño: en la solicitud el RUT repetido no se mira, porque
  // quien la envía no está autenticado. Acá sí se nombra — quien aprueba es el admin_tenant y
  // necesita el dato para decidir en un toque si es la misma persona con teléfono nuevo.
  const { solicitudId } = await solicitudPendiente("chofer", "12.345.678-5", "Homónimo");
  const antes = { personas: await contar("personas"), dispositivos: await contar("dispositivos") };

  const r = await aprobar(pool, solicitudId, duenaId);
  expect(r.tipo).toBe("rebote");
  expect(r.tipo === "rebote" && r.motivo).toBe("rut_ya_registrado");
  expect(r.tipo === "rebote" && r.titularActual?.nombre).toBe("Chofer Nuevo");

  expect(await contar("personas")).toBe(antes.personas);
  expect(await contar("dispositivos")).toBe(antes.dispositivos);
  const [s] = await con(BD_A, (c: Conexion) =>
    c.sql<{ estado: string }>("select estado::text as estado from solicitudes_acceso where id = $1", [
      solicitudId,
    ]),
  );
  expect(s!.estado, "la solicitud quedó resuelta pese al rebote").toBe("pendiente");
});

test("[AC-FIDN-04] el sobre es de UN SOLO USO: el segundo retiro no trae nada", async () => {
  const { solicitudId, aparato } = await solicitudPendiente("chofer", "5.126.663-3");
  const r = await aprobar(pool, solicitudId, duenaId);
  expect(r.tipo).toBe("aprobada");

  const primero = await retirarSobre(pool, solicitudId);
  expect(primero, "el aparato no pudo retirar su sobre").not.toBeNull();
  expect(await abrir(primero!, aparato.privada)).toHaveLength(36);

  // Un sobre que se pudiera retirar dos veces sería un secreto que viaja dos veces, y la
  // segunda por un canal que ya nadie está mirando.
  expect(await retirarSobre(pool, solicitudId)).toBeNull();

  const [s] = await con(BD_A, (c: Conexion) =>
    c.sql<{ sobre: string | null; retirado: string | null }>(
      "select sobre::text as sobre, sobre_retirado_en::text as retirado from solicitudes_acceso where id = $1",
      [solicitudId],
    ),
  );
  expect(s!.sobre).toBeNull();
  expect(s!.retirado).not.toBeNull();
});

test("[AC-FIDN-04] una solicitud que no existe rebota sin explicar de más", async () => {
  const r = await aprobar(pool, "0192f0a0-0000-7000-8000-00000000dead", duenaId);
  expect(r.tipo === "rebote" && r.motivo).toBe("solicitud_inexistente");
  expect(await retirarSobre(pool, "0192f0a0-0000-7000-8000-00000000dead")).toBeNull();
});
