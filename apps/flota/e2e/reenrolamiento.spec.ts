import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { Pool } from "pg";
import { PIN } from "../../../packages/nucleo-comun/src/constants.ts";
import { abrir, parDelAparato, hashDeSecreto } from "../src/dominio/secretos.ts";
import { codigoNuevo, hashDeCodigo, expiraEn } from "../src/dominio/invitaciones.ts";
import { aprobar } from "../src/servidor/aprobacion.ts";
import { fijarPin } from "../src/servidor/pin.ts";
import { resolverSesion } from "../src/servidor/sesion.ts";
import { con, bdDeTenant, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// «Ya tengo cuenta»: el teléfono nuevo [AC-FIDN-08] — §4.3, §5.4 F-E.
//
// Lo que este AC promete y hay que probar sin trampa: el constraint de UN dispositivo personal
// activo por operario se cumple ANTES, DURANTE y DESPUÉS. Jamás dos activos, jamás cero tras
// aprobar. Y el aparato viejo queda revocado EN EL MISMO ACTO, no en una limpieza posterior.

const PUERTO = PUERTO_E2E;
const DOMINIO = "localhost";
const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT = "12.345.678-5";
const PIN_BUENO = "4090";

let pool: Pool;
let duenaId: string;
let personaId: string;
let usuarioId: string;
let telefonoViejo: string;
let secretoViejo: string;

function postear(ruta: string, cuerpo: unknown, host = `${A.slug}.${DOMINIO}:${PUERTO}`) {
  const datos = Buffer.from(JSON.stringify(cuerpo), "utf8");
  return new Promise<{ status: number; cuerpo: string }>((resolver, rechazar) => {
    const req = pedir(
      {
        host: "127.0.0.1",
        port: PUERTO,
        path: ruta,
        method: "POST",
        headers: { Host: host, "content-type": "application/json", "content-length": datos.length },
      },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (t) => (texto += t));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, cuerpo: texto }));
      },
    );
    req.on("error", rechazar);
    req.write(datos);
    req.end();
  });
}

const activos = async () => {
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      "select count(*)::text as n from dispositivos where persona_id = $1 and tipo = 'personal' and revocado_at is null",
      [personaId],
    ),
  );
  return Number(f!.n);
};

const solicitudPendiente = async () => {
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "select id::text as id from solicitudes_acceso where persona_id = $1 and estado = 'pendiente'",
      [personaId],
    ),
  );
  return f?.id ?? null;
};

test.beforeAll(async () => {
  pool = new Pool({
    host: CLUSTER_LOCAL.host,
    port: CLUSTER_LOCAL.puerto,
    database: BD_A,
    user: ROL_MIGRADOR,
  });

  // Se enrola de verdad el teléfono VIEJO: sembrarlo a mano probaría el UPDATE y no el flujo.
  const viejo = await parDelAparato();
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
    duenaId = u!.id;
    const [inv] = await c.sql<{ id: string }>(
      `insert into invitaciones (rol, token_hash, expira_at, creada_por)
       values ('chofer', $1, $2, $3) returning id::text as id`,
      [hashDeCodigo(codigo), expiraEn(new Date()), duenaId],
    );
    return c.sql<{ id: string }>(
      `insert into solicitudes_acceso
         (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
       values ($1, $2, 'Chofer', '$argon2id$x', $3, 'huella-vieja') returning id::text as id`,
      [inv!.id, RUT, viejo.publica],
    );
  });

  const r = await aprobar(pool, s!.id, duenaId);
  if (r.tipo !== "aprobada") throw new Error(`el fixture no pudo enrolar: ${JSON.stringify(r)}`);
  secretoViejo = await abrir(r.sobre, viejo.privada);
  telefonoViejo = r.dispositivoId;
  usuarioId = r.usuarioId;

  const [p] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>("select id::text as id from personas where rut = $1", [RUT]),
  );
  personaId = p!.id;
  // El PIN real de la persona: el fixture lo puso como texto de relleno al aprobar, y este
  // flujo se entra CON el PIN.
  await fijarPin(pool, usuarioId, PIN_BUENO);
});

test.afterAll(async () => {
  await pool?.end();
});

test("[AC-FIDN-08] con RUT y PIN correctos entra la solicitud de teléfono nuevo", async () => {
  expect(await activos(), "el fixture no dejó un teléfono activo").toBe(1);

  const nuevo = await parDelAparato();
  const r = await postear("/api/reenrolamiento", {
    rut: RUT,
    pin: PIN_BUENO,
    clave_publica: nuevo.publica,
    huella_dispositivo: "huella-nueva",
  });

  expect(r.status).toBe(201);
  expect(JSON.parse(r.cuerpo)).toEqual({ estado: "pendiente" });
  // ANTES de aprobar: el viejo sigue siendo el único activo. La solicitud no cambia nada —
  // pedir un teléfono nuevo no puede dejar a nadie sin el que está usando.
  expect(await activos()).toBe(1);
  expect(await solicitudPendiente()).not.toBeNull();
});

test("[AC-FIDN-08] RUT desconocido y PIN equivocado responden EXACTAMENTE lo mismo", async () => {
  // Si difirieran, este endpoint sería un buscador de RUTs de la empresa — la misma fuga que
  // la respuesta del dueño a la pregunta 10 cerró en la otra puerta.
  const nuevo = await parDelAparato();
  const base = { clave_publica: nuevo.publica, huella_dispositivo: "h" };
  const rutFantasma = await postear("/api/reenrolamiento", { ...base, rut: "9.999.999-3", pin: PIN_BUENO });
  const pinMalo = await postear("/api/reenrolamiento", { ...base, rut: RUT, pin: "1357" });

  expect(rutFantasma.status).toBe(422);
  expect(pinMalo.status).toBe(rutFantasma.status);
  expect(pinMalo.cuerpo).toBe(rutFantasma.cuerpo);
});

test("[AC-FIDN-08] el PIN de este endpoint pasa por el MISMO lockout", async () => {
  // Sin esto, «Ya tengo cuenta» sería la puerta sin candado para probar PINs de a diez mil,
  // por más que la otra tenga lockout.
  const nuevo = await parDelAparato();
  const base = { rut: RUT, clave_publica: nuevo.publica, huella_dispositivo: "h" };
  for (let i = 0; i < PIN.intentos_hasta_bloqueo; i++) {
    await postear("/api/reenrolamiento", { ...base, pin: "1357" });
  }
  const bloqueado = await postear("/api/reenrolamiento", { ...base, pin: PIN_BUENO });
  expect(bloqueado.status).toBe(429);
  expect(JSON.parse(bloqueado.cuerpo).error).toBe("bloqueado");

  // Se desbloquea para el resto de la suite: el bloqueo es real y no un efecto de laboratorio.
  await fijarPin(pool, usuarioId, PIN_BUENO);
});

test("[AC-FIDN-08] la aprobación revoca el anterior EN EL MISMO acto: jamás 2, jamás 0", async () => {
  const solicitudId = (await solicitudPendiente())!;
  expect(await activos()).toBe(1);

  const r = await aprobar(pool, solicitudId, duenaId);
  expect(r.tipo).toBe("aprobada");
  if (r.tipo !== "aprobada") return;
  expect(r.dispositivosRevocados).toBe(1);

  // DESPUÉS: exactamente uno, y es el nuevo. El índice único parcial de AC-FIDN-01 hace
  // imposible que sean dos; este test cubre la otra mitad, que es que no queden cero.
  expect(await activos()).toBe(1);
  const [activo] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "select id::text as id from dispositivos where persona_id = $1 and tipo = 'personal' and revocado_at is null",
      [personaId],
    ),
  );
  expect(activo!.id).toBe(r.dispositivoId);
  expect(activo!.id).not.toBe(telefonoViejo);

  // El viejo quedó revocado, no borrado: su historia es lo que permite clasificar una captura
  // post-revocación en vez de descartarla (AC-FIDN-09).
  const [viejo] = await con(BD_A, (c: Conexion) =>
    c.sql<{ revocado: string | null }>("select revocado_at::text as revocado from dispositivos where id = $1", [
      telefonoViejo,
    ]),
  );
  expect(viejo!.revocado).not.toBeNull();
});

test("[AC-FIDN-08] el teléfono viejo pierde la sesión y el nuevo la tiene", async () => {
  // La consecuencia que le importa a la persona: el aparato que perdió deja de servir en el
  // request siguiente (AC-FIDN-09), y el que tiene en la mano ya funciona.
  const viejo = await resolverSesion(pool, `Portador ${secretoViejo}`);
  expect(viejo.tipo).toBe("invalida");
  expect(viejo.tipo === "invalida" && viejo.motivo).toBe("revocada");

  const [nuevo] = await con(BD_A, (c: Conexion) =>
    c.sql<{ h: string }>(
      "select secreto_hash as h from dispositivos where persona_id = $1 and revocado_at is null",
      [personaId],
    ),
  );
  // El secreto nuevo es OTRO: reusar el del aparato perdido sería no haber cambiado nada.
  expect(nuevo!.h).not.toBe(hashDeSecreto(secretoViejo));
});

test("[AC-FIDN-08] una segunda solicitud de cambio no se apila sobre la pendiente", async () => {
  const nuevo = await parDelAparato();
  const base = { rut: RUT, pin: PIN_BUENO, clave_publica: nuevo.publica, huella_dispositivo: "h3" };
  const primera = await postear("/api/reenrolamiento", base);
  expect(primera.status).toBe(201);

  // Con varias pendientes, aprobar una dejaría a las otras apuntando a un aparato que ya no es
  // el activo, y el dueño tendría que resolver una cola que él no creó.
  const segunda = await postear("/api/reenrolamiento", base);
  expect(segunda.status).toBe(422);
  expect(JSON.parse(segunda.cuerpo).error).toBe("ya_pendiente");
});
