import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { codigoNuevo, hashDeCodigo, expiraEn } from "../src/dominio/invitaciones.ts";
import { TENANTS } from "./preparar-tenants.mjs";

// F-B del §5.4 contra el servidor y la base de verdad [AC-FIDN-03].
//
// La invitación da derecho a SOLICITAR y jamás a entrar, y eso es lo que estas pruebas
// miran: que un código válido NO deje sesión ni secreto, solo una fila `pendiente`; que los
// tres rebotes del §4.2 salgan 422 tipados; y —lo que el dueño decidió el 09-ago-2026— que
// un RUT ya registrado en el tenant sea INDISTINGUIBLE de uno que no lo está, porque quien
// tiene el código no está autenticado y el código viaja por WhatsApp.
//
// Todo con `node:http` y contra el `servidor.mjs` de producción, igual que el resto del e2e:
// la identidad del tenant se juega en la cabecera `Host`.

const PUERTO = 3311;
const DOMINIO = "localhost";
const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };
type Respuesta = { status: number; cuerpo: string };

function postear(ruta: string, cuerpo: unknown, host = `${A.slug}.${DOMINIO}:${PUERTO}`): Promise<Respuesta> {
  const datos = Buffer.from(JSON.stringify(cuerpo), "utf8");
  return new Promise((resolver, rechazar) => {
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

/** RUTs sintácticamente válidos e IRREALES (§7.8). */
const RUT_NUEVO = "12.345.678-5";
const RUT_DE_LA_CASA = "11.111.111-1";

const solicitud = (codigo: string, extra: Record<string, unknown> = {}) => ({
  codigo,
  rut: RUT_NUEVO,
  nombre: "Persona de prueba",
  pin: "4090",
  clave_publica: "clave-publica-de-prueba",
  huella_dispositivo: "huella-de-prueba",
  ...extra,
});

/** Emite una invitación directamente en la BD de A y devuelve su código en claro. */
async function emitir(estado: "vigente" | "expirada" | "pausada" | "revocada" = "vigente") {
  const codigo = codigoNuevo();
  const ahora = new Date();
  const expira = estado === "expirada" ? new Date(ahora.getTime() - 1000) : expiraEn(ahora);
  await con(BD_A, async (c: Conexion) => {
    const [admin] = await c.sql<{ id: string }>("select id::text as id from usuarios limit 1");
    await c.sql(
      `insert into invitaciones (rol, token_hash, expira_at, pausada_at, revocada_at, creada_por)
       values ('chofer', $1, $2, $3, $4, $5)`,
      [
        hashDeCodigo(codigo),
        expira,
        estado === "pausada" ? ahora : null,
        estado === "revocada" ? ahora : null,
        admin!.id,
      ],
    );
  });
  return codigo;
}

async function contarSolicitudes(): Promise<number> {
  const filas = await con(BD_A, (c: Conexion) => c.sql<{ n: string }>("select count(*)::text as n from solicitudes_acceso"));
  return Number(filas[0]?.n ?? "0");
}

test.beforeAll(async () => {
  // El dueño que EMITE las invitaciones. La aprobación es de AC-FIDN-04; acá solo hace falta
  // que la FK `creada_por` apunte a alguien de verdad.
  await con(BD_A, async (c: Conexion) => {
    await c.sql("delete from solicitudes_acceso");
    await c.sql("delete from invitaciones");
    // Antes que `usuarios`: `dispositivos.enrolado_por` apunta ahí desde AC-FIDN-04, y
    // las suites comparten la base del fixture.
    await c.sql("delete from dispositivos");
    await c.sql("delete from usuarios");
    await c.sql("delete from personas");
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Dueña') returning id::text as id",
      [RUT_DE_LA_CASA],
    );
    await c.sql("insert into usuarios (persona_id, rol) values ($1, 'admin_tenant')", [p!.id]);
  });
});

test("[AC-FIDN-03] un código válido crea una solicitud PENDIENTE y nada más", async () => {
  const antes = await contarSolicitudes();
  const r = await postear("/api/solicitudes", solicitud(await emitir()));

  expect(r.status).toBe(201);
  expect(JSON.parse(r.cuerpo)).toEqual({ estado: "pendiente" });
  expect(await contarSolicitudes()).toBe(antes + 1);

  const filas = await con(BD_A, (c: Conexion) =>
    c.sql<{ estado: string; pin_hash: string }>(
      "select estado, pin_hash from solicitudes_acceso order by creada_en desc limit 1",
    ),
  );
  expect(filas[0]!.estado).toBe("pendiente");
  // El PIN se hashea server-side con argon2id y en la fila queda solo el hash (§4.3, §7.8).
  expect(filas[0]!.pin_hash).toMatch(/^\$argon2id\$/);
  expect(filas[0]!.pin_hash).not.toContain("4090");
});

test("[AC-FIDN-03] el código NO abre sesión ni emite secreto de dispositivo", async () => {
  // El corazón del AC. Un endpoint que de paso dejara una cookie o creara el dispositivo
  // convertiría la invitación en una llave, y el §4.3 dice que da derecho a SOLICITAR.
  const codigo = await emitir();
  const datos = Buffer.from(JSON.stringify(solicitud(codigo)), "utf8");
  const cabeceras = await new Promise<Record<string, string | string[] | undefined>>((res, rej) => {
    const req = pedir(
      {
        host: "127.0.0.1",
        port: PUERTO,
        path: "/api/solicitudes",
        method: "POST",
        headers: {
          Host: `${A.slug}.${DOMINIO}:${PUERTO}`,
          "content-type": "application/json",
          "content-length": datos.length,
        },
      },
      (r) => {
        r.resume();
        r.on("end", () => res(r.headers));
      },
    );
    req.on("error", rej);
    req.write(datos);
    req.end();
  });

  expect(cabeceras["set-cookie"], "la solicitud dejó una cookie de sesión").toBeUndefined();

  const [{ n: dispositivos }] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from dispositivos"),
  );
  expect(Number(dispositivos), "la solicitud creó un dispositivo antes de que nadie aprobara").toBe(0);
  const [{ n: personas }] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from personas"),
  );
  // Solo la dueña del fixture: la persona PROPUESTA no se materializa hasta la aprobación.
  // Crearla al solicitar dejaría que cualquiera con el link sembrara identidades y consumiera
  // el UNIQUE del RUT sin que nadie lo autorizara.
  expect(Number(personas)).toBe(1);
});

test("[AC-FIDN-03] multi-uso: N solicitudes del MISMO código ⇒ N filas", async () => {
  const codigo = await emitir();
  const antes = await contarSolicitudes();
  for (const rut of ["12.345.678-5", "20.347.878-K", "9.999.999-3"]) {
    const r = await postear("/api/solicitudes", solicitud(codigo, { rut }));
    expect(r.status).toBe(201);
  }
  expect(await contarSolicitudes()).toBe(antes + 3);
});

test("[AC-FIDN-03] los tres rebotes del dueño salen 422 TIPADOS y sin crear fila", async () => {
  for (const [estado, error] of [
    ["expirada", "invitacion_expirada"],
    ["pausada", "invitacion_pausada"],
    ["revocada", "invitacion_revocada"],
  ] as const) {
    const antes = await contarSolicitudes();
    const r = await postear("/api/solicitudes", solicitud(await emitir(estado)));
    expect(r.status, `invitación ${estado}`).toBe(422);
    const cuerpo = JSON.parse(r.cuerpo) as { error: string; mensaje: string };
    expect(cuerpo.error).toBe(error);
    // El mensaje es para una persona, en es-CL y con la salida a mano: un código de error
    // pelado deja al trabajador mirando la pantalla sin saber a quién reclamarle.
    expect(cuerpo.mensaje.length).toBeGreaterThan(20);
    expect(await contarSolicitudes(), `${estado} dejó una fila`).toBe(antes);
  }
});

test("[AC-FIDN-03] un código que no existe, o mal formado, rebota sin tocar la base", async () => {
  const antes = await contarSolicitudes();

  const inexistente = await postear("/api/solicitudes", solicitud(codigoNuevo()));
  expect(inexistente.status).toBe(422);
  expect(JSON.parse(inexistente.cuerpo).error).toBe("invitacion_invalida");

  const malFormado = await postear("/api/solicitudes", solicitud("O0O0O0O0"));
  expect(malFormado.status).toBe(422);
  expect(JSON.parse(malFormado.cuerpo).error).toBe("codigo_invalido");

  expect(await contarSolicitudes()).toBe(antes);
});

test("[AC-FIDN-03] RUT inválido y PIN de otro largo rebotan 422 tipados", async () => {
  const codigo = await emitir();
  const antes = await contarSolicitudes();

  const rutMalo = await postear("/api/solicitudes", solicitud(codigo, { rut: "12.345.678-9" }));
  expect(rutMalo.status).toBe(422);
  // El módulo 11 tiene UNA implementación y vive en la BD (AC-FIDN-01); el endpoint traduce
  // su rebote al 422 tipado en vez de repetir el algoritmo y que los dos se separen.
  expect(JSON.parse(rutMalo.cuerpo).error).toBe("rut_invalido");

  const pinMalo = await postear("/api/solicitudes", solicitud(codigo, { pin: "123" }));
  expect(pinMalo.status).toBe(422);
  expect(JSON.parse(pinMalo.cuerpo).error).toBe("pin_invalido");

  expect(await contarSolicitudes()).toBe(antes);
});

test("[AC-FIDN-03] un RUT YA REGISTRADO es indistinguible de uno nuevo (pregunta 10)", async () => {
  // La decisión del dueño del 09-ago-2026, y la prueba de que se cumple donde importa: quien
  // tiene el link no está autenticado, así que la respuesta no puede ser el oráculo. Byte a
  // byte igual: si el cuerpo, el código o la forma difirieran, enumerar la nómina de la
  // empresa quedaría a un RUT por intento.
  const codigo = await emitir();
  const propio = await postear("/api/solicitudes", solicitud(codigo, { rut: RUT_DE_LA_CASA }));
  const ajeno = await postear("/api/solicitudes", solicitud(codigo, { rut: "20.347.878-K" }));

  expect(propio.status).toBe(201);
  expect(propio.status).toBe(ajeno.status);
  expect(propio.cuerpo).toBe(ajeno.cuerpo);

  // Y la fila entra igual: el rebote es de la aprobación (AC-FIDN-04), no de acá.
  const [{ n }] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from solicitudes_acceso where rut_propuesto = $1", [
      RUT_DE_LA_CASA,
    ]),
  );
  expect(Number(n)).toBe(1);
});

test("[AC-FIDN-03] sin subdominio de tenant no hay solicitud que crear ⇒ 404", async () => {
  // El mismo 404 del AC-FTEN-05: un host que no es de nadie no llega a este handler. Sin
  // esto, el endpoint público sería la puerta por la que alguien escribe sin elegir tenant.
  const r = await postear("/api/solicitudes", solicitud(await emitir()), `${DOMINIO}:${PUERTO}`);
  expect(r.status).toBe(404);
});
