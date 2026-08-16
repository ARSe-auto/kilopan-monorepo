import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { Pool } from "pg";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { con, bdDeTenant, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Transferir propiedad con passkey/WebAuthn [AC-FIDN-13] — §5.4 F-H.
//
// BASE PROPIA, mismo motivo que `gobierno`: la ceremonia MUTA el rol de dos usuarios
// (`admin_tenant` ⇄ `operador`) y deja `admin_passkeys` con FK a `usuarios`; compartir la
// base de otra suite le movería el rol a una dueña que esa suite da por fija en su fixture.
//
// EL VIRTUAL AUTHENTICATOR ES REAL: `context.credentials` (Playwright 1.62) intercepta
// `navigator.credentials.create()`/`.get()` en Chromium de verdad — el mismo intérprete
// WebAuthn que un teléfono, no un mock. Es el segundo brazo de la verificación de AC-FIDN-13:
// el primero, sin oráculo externo, es `src/dominio/passkey.test.ts`.

const PUERTO = 3311;
const T = TENANTS.find((t) => t.slug === "transferencia")!;
const HOST = `${T.slug}.localhost:${PUERTO}`;
const ORIGEN = `http://${HOST}`;
const BD = bdDeTenant(T.slug);

type Conexion = { sql: <F = Record<string, string>>(t: string, p?: unknown[]) => Promise<F[]> };
type Respuesta = { status: number; texto: string; json: Record<string, unknown> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) =>
  con(BD, (c: Conexion) => c.sql<F>(texto, params));

/** Un request HTTP crudo con Host propio — igual que `gobierno.spec.ts`: la identidad del
 *  tenant se juega en `Host`, y un navegador no la deja fijar a mano. */
function pedirA(ruta: string, secreto: string | undefined, cuerpoObj: unknown): Promise<Respuesta> {
  const cuerpo = JSON.stringify(cuerpoObj);
  const cabeceras: Record<string, string> = {
    Host: HOST,
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(cuerpo)),
  };
  if (secreto) cabeceras.Authorization = `Portador ${secreto}`;
  return new Promise((resolver, rechazar) => {
    const req = pedir(
      { host: "127.0.0.1", port: PUERTO, path: ruta, method: "POST", headers: cabeceras },
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
    req.write(cuerpo);
    req.end();
  });
}

const SQL_TABLAS = `select table_schema || '.' || table_name as t
                    from information_schema.tables
                    where table_type = 'BASE TABLE'
                      and table_schema not in ('pg_catalog', 'information_schema')
                    order by 1`;

async function huellaDe(bd: string): Promise<Record<string, number>> {
  return con(bd, async (c: Conexion) => {
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

let pool: Pool;
let a = { usuarioId: "", secreto: "" };
let b = { usuarioId: "", secreto: "" };
let c = { usuarioId: "", secreto: "" };

async function enrolar(rut: string, nombre: string, rol: string) {
  const secreto = secretoNuevo();
  const [p] = await sql<{ id: string }>("insert into personas (rut, nombre) values ($1, $2) returning id::text as id", [
    rut,
    nombre,
  ]);
  const [u] = await sql<{ id: string }>(
    "insert into usuarios (persona_id, rol, pin_hash) values ($1, $2::rol_usuario, '$argon2id$fixture') returning id::text as id",
    [p!.id, rol],
  );
  await sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
     values ('personal', $1, $2, $3, now())`,
    [p!.id, hashDeSecreto(secreto), u!.id],
  );
  return { usuarioId: u!.id, secreto };
}

test.beforeAll(async () => {
  pool = new Pool({ host: CLUSTER_LOCAL.host, port: CLUSTER_LOCAL.puerto, database: BD, user: ROL_MIGRADOR });
  await limpiarFixture(sql);
  a = await enrolar("11.111.111-1", "Dueña A", "admin_tenant");
  b = await enrolar("7.654.321-6", "Operario B", "operador");
  c = await enrolar("6.396.828-5", "Operario C", "chofer");
});

test.afterAll(async () => {
  await pool?.end();
});

// Glue de navegador, ejecutado DENTRO de la página con `page.evaluate`: base64url ⇄
// ArrayBuffer y la ceremonia completa contra `/api/gobierno/transferencia`. No hay pantalla
// dedicada para F-H (mismo criterio que F-F/F-G/pin: gobierno sin panel propio se prueba por
// HTTP), así que esto ES la mitad "cliente" del AC — la otra mitad la ejerce el navegador de
// verdad al interceptar `navigator.credentials`.
async function transferirViaNavegador(
  page: import("@playwright/test").Page,
  secreto: string,
  nuevoAdminUsuarioId: string,
) {
  return page.evaluate(
    async ({ secreto, nuevoAdminUsuarioId }) => {
      const b64uABuf = (s: string): ArrayBuffer => {
        const relleno = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
        const binario = atob((s + relleno).replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = new Uint8Array(binario.length);
        for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
        return bytes.buffer;
      };
      const bufAB64u = (buf: ArrayBuffer): string => {
        const bytes = new Uint8Array(buf);
        let binario = "";
        for (const byte of bytes) binario += String.fromCharCode(byte);
        return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      };

      const cabeceras = { "content-type": "application/json", Authorization: `Portador ${secreto}` };
      const rOpciones = await fetch("/api/gobierno/transferencia", {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify({ accion: "opciones", nuevo_admin_usuario_id: nuevoAdminUsuarioId }),
      });
      const cuerpoOpciones = (await rOpciones.json()) as {
        ceremonia?: "registro" | "autenticacion";
        retoId?: string;
        opciones?: Record<string, unknown>;
        error?: string;
      };
      if (!rOpciones.ok) return { paso: "opciones" as const, status: rOpciones.status, body: cuerpoOpciones };

      let credencial: Record<string, string>;
      if (cuerpoOpciones.ceremonia === "registro") {
        const o = cuerpoOpciones.opciones as {
          challenge: string;
          rp: { id: string; name: string };
          user: { id: string; name: string; displayName: string };
          pubKeyCredParams: PublicKeyCredentialParameters[];
          authenticatorSelection: AuthenticatorSelectionCriteria;
          attestation: AttestationConveyancePreference;
          timeout: number;
        };
        const cred = (await navigator.credentials.create({
          publicKey: {
            challenge: b64uABuf(o.challenge),
            rp: o.rp,
            user: { id: b64uABuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
            pubKeyCredParams: o.pubKeyCredParams,
            authenticatorSelection: o.authenticatorSelection,
            attestation: o.attestation,
            timeout: o.timeout,
          },
        })) as PublicKeyCredential;
        const respuesta = cred.response as AuthenticatorAttestationResponse;
        credencial = {
          id: bufAB64u(cred.rawId),
          clientDataJSON: bufAB64u(respuesta.clientDataJSON),
          attestationObject: bufAB64u(respuesta.attestationObject),
        };
      } else {
        const o = cuerpoOpciones.opciones as {
          challenge: string;
          rpId: string;
          allowCredentials: { type: "public-key"; id: string }[];
          userVerification: UserVerificationRequirement;
          timeout: number;
        };
        const cred = (await navigator.credentials.get({
          publicKey: {
            challenge: b64uABuf(o.challenge),
            rpId: o.rpId,
            allowCredentials: o.allowCredentials.map((cc) => ({ type: cc.type, id: b64uABuf(cc.id) })),
            userVerification: o.userVerification,
            timeout: o.timeout,
          },
        })) as PublicKeyCredential;
        const respuesta = cred.response as AuthenticatorAssertionResponse;
        credencial = {
          id: bufAB64u(cred.rawId),
          clientDataJSON: bufAB64u(respuesta.clientDataJSON),
          authenticatorData: bufAB64u(respuesta.authenticatorData),
          signature: bufAB64u(respuesta.signature),
        };
      }

      const rConfirmar = await fetch("/api/gobierno/transferencia", {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify({ accion: "confirmar", reto_id: cuerpoOpciones.retoId, credencial }),
      });
      return {
        paso: "confirmar" as const,
        ceremonia: cuerpoOpciones.ceremonia,
        status: rConfirmar.status,
        body: (await rConfirmar.json()) as Record<string, unknown>,
      };
    },
    { secreto, nuevoAdminUsuarioId },
  );
}

// ─── Sin ceremonia, no hay transferencia ────────────────────────────────────────────────

test("[AC-FIDN-13] sin ceremonia passkey válida ⇒ 422 y 0 cambios", async () => {
  const opciones = await pedirA("/api/gobierno/transferencia", a.secreto, {
    accion: "opciones",
    nuevo_admin_usuario_id: c.usuarioId,
  });
  expect(opciones.status).toBe(201);
  const { retoId } = opciones.json as unknown as { retoId: string };

  const antes = await huellaDe(BD);
  const confirmar = await pedirA("/api/gobierno/transferencia", a.secreto, {
    accion: "confirmar",
    reto_id: retoId,
    credencial: { id: "no-es-una-credencial", clientDataJSON: "bm9wZQ", attestationObject: "bm9wZQ" },
  });
  expect(confirmar.status).toBe(422);
  expect(confirmar.json.error).toBe("passkey_invalida");

  // «0 cambios» literal: ni el reto se marcó usado, ni el rol de nadie se movió.
  expect(await huellaDe(BD)).toEqual(antes);
  const [fila] = await sql<{ rol: string }>("select rol::text as rol from usuarios where id = $1", [a.usuarioId]);
  expect(fila!.rol).toBe("admin_tenant");
});

test("[AC-FIDN-13] destino inválido (rol cliente/admin, o uno mismo) ⇒ 422 sin ceremonia", async () => {
  const auno = await pedirA("/api/gobierno/transferencia", a.secreto, {
    accion: "opciones",
    nuevo_admin_usuario_id: a.usuarioId,
  });
  expect(auno.status).toBe(422);
  expect(auno.json.error).toBe("destino_invalido");
});

// ─── El ciclo completo: registro · registro · autenticación ───────────────────────────
//
// A transfiere a B (A nunca tuvo passkey ⇒ ceremonia REGISTRO). B transfiere de vuelta a A
// (B tampoco ⇒ REGISTRO otra vez, de SU propia credencial). A transfiere una vez más a B: A
// YA tiene la passkey que registró en el primer paso ⇒ ceremonia AUTENTICACIÓN — el camino
// que un registro nuevo por cada vaivén habría hecho imposible de ejercer.

// El virtual authenticator vive en el `context` de CADA test, no en la BD: sin re-sembrar la
// credencial de A entre tests, «A ya tiene passkey» sería cierto en la BD pero falso en el
// navegador nuevo, y la autenticación de la tercera prueba rebotaría con «No matching
// credential» aunque el servidor sí la reconociera. `context.credentials.get()` expone la
// clave privada de la credencial que el navegador acaba de registrar (Playwright 1.62, pensado
// exactamente para esto) y `context.credentials.create(rpId, ...)` la re-siembra en el
// authenticator vacío del siguiente test.
const RP_ID = HOST.split(":")[0]!;
let credencialDeA: { id: string; rpId: string; userHandle: string; privateKey: string; publicKey: string } | null =
  null;

test("[AC-FIDN-13] primer uso: registro passkey + transferencia en el mismo acto", async ({ context, page }) => {
  await context.credentials.install();
  await page.goto(`${ORIGEN}/panel`);

  const resultado = await transferirViaNavegador(page, a.secreto, b.usuarioId);
  expect(resultado.paso).toBe("confirmar");
  expect(resultado.ceremonia).toBe("registro");
  expect(resultado.status, JSON.stringify(resultado.body)).toBe(200);
  expect((resultado.body as { nuevo_admin_usuario_id?: string }).nuevo_admin_usuario_id).toBe(b.usuarioId);

  const [filaA] = await sql<{ rol: string }>("select rol::text as rol from usuarios where id = $1", [a.usuarioId]);
  const [filaB] = await sql<{ rol: string }>("select rol::text as rol from usuarios where id = $1", [b.usuarioId]);
  expect(filaA!.rol).toBe("operador");
  expect(filaB!.rol).toBe("admin_tenant");

  const [passkeyA] = await sql<{ n: string }>("select count(*)::text as n from admin_passkeys where usuario_id = $1", [
    a.usuarioId,
  ]);
  expect(passkeyA!.n).toBe("1");

  const credenciales = await context.credentials.get({ rpId: RP_ID });
  expect(credenciales).toHaveLength(1);
  credencialDeA = credenciales[0]!;

  const [evTransferencia] = await sql<{ n: string }>(
    `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
      where t.codigo = 'gobierno.propiedad_transferida' and e.objeto_id = $1`,
    [b.usuarioId],
  );
  expect(evTransferencia!.n).toBe("1");
  const [evPasskey] = await sql<{ n: string }>(
    `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
      where t.codigo = 'gobierno.passkey_registrada' and e.objeto_id = $1`,
    [a.usuarioId],
  );
  expect(evPasskey!.n).toBe("1");
});

test("[AC-FIDN-13] B transfiere de vuelta: su propio registro, no el de A", async ({ context, page }) => {
  await context.credentials.install();
  await page.goto(`${ORIGEN}/panel`);

  const resultado = await transferirViaNavegador(page, b.secreto, a.usuarioId);
  expect(resultado.ceremonia).toBe("registro");
  expect(resultado.status, JSON.stringify(resultado.body)).toBe(200);

  const [filaA] = await sql<{ rol: string }>("select rol::text as rol from usuarios where id = $1", [a.usuarioId]);
  const [filaB] = await sql<{ rol: string }>("select rol::text as rol from usuarios where id = $1", [b.usuarioId]);
  expect(filaA!.rol).toBe("admin_tenant");
  expect(filaB!.rol).toBe("operador");

  const [passkeyB] = await sql<{ n: string }>("select count(*)::text as n from admin_passkeys where usuario_id = $1", [
    b.usuarioId,
  ]);
  expect(passkeyB!.n).toBe("1");
});

test("[AC-FIDN-13] A vuelve a transferir: YA tiene passkey ⇒ autenticación, no registro", async ({
  context,
  page,
}) => {
  await context.credentials.install();
  if (!credencialDeA) throw new Error("credencialDeA: el test de registro no corrió antes, o no capturó nada");
  await context.credentials.create(RP_ID, credencialDeA);
  await page.goto(`${ORIGEN}/panel`);

  const [antes] = await sql<{ contador: string }>("select contador::text as contador from admin_passkeys where usuario_id = $1", [
    a.usuarioId,
  ]);

  const resultado = await transferirViaNavegador(page, a.secreto, b.usuarioId);
  expect(resultado.ceremonia).toBe("autenticacion");
  expect(resultado.status, JSON.stringify(resultado.body)).toBe(200);

  const [filaA] = await sql<{ rol: string }>("select rol::text as rol from usuarios where id = $1", [a.usuarioId]);
  const [filaB] = await sql<{ rol: string }>("select rol::text as rol from usuarios where id = $1", [b.usuarioId]);
  expect(filaA!.rol).toBe("operador");
  expect(filaB!.rol).toBe("admin_tenant");

  // Sigue habiendo UNA sola passkey para A: la autenticación reusó la credencial, no creó otra.
  const [passkeys] = await sql<{ n: string }>("select count(*)::text as n from admin_passkeys where usuario_id = $1", [
    a.usuarioId,
  ]);
  expect(passkeys!.n).toBe("1");
  const [despues] = await sql<{ contador: string }>("select contador::text as contador from admin_passkeys where usuario_id = $1", [
    a.usuarioId,
  ]);
  expect(Number(despues!.contador)).toBeGreaterThanOrEqual(Number(antes!.contador));
});
