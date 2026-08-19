import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import {
  PASSKEY,
  retoNuevo,
  opcionesDeRegistro,
  opcionesDeAutenticacion,
  verificarRegistro,
  verificarAutenticacion,
  type OpcionesDeRegistro,
  type OpcionesDeAutenticacion,
  type CredencialDeRegistro,
  type CredencialDeAutenticacion,
} from "../dominio/passkey.ts";

// Transferir propiedad con passkey/WebAuthn [AC-FIDN-13] — §5.4 F-H, Pregunta 4 respondida
// el 11-ago-2026: la credencial se registra AL PRIMER USO de esta acción.
//
// LOS ROLES QUE PUEDEN RECIBIR EL GOBIERNO. `cliente` queda fuera: es el contratante externo
// del §4.5, con sesión web y sin enrolamiento de aparato (Pregunta 3) — no tiene con qué
// operar el resto del plano de control. `admin_tenant` queda fuera porque ya lo es. Los
// cuatro roles internos que quedan son exactamente los que este panel SÍ invita
// (`gobierno.ts::emitirInvitacion`).
const ROLES_TRANSFERIBLES = ["operador", "chofer", "responsable_carga", "responsable_tecnico"];

export type MotivoDeRebote = "destino_invalido" | "reto_invalido" | "reto_vencido" | "passkey_invalida";

export type Opciones =
  | { ceremonia: "registro"; retoId: string; opciones: OpcionesDeRegistro }
  | { ceremonia: "autenticacion"; retoId: string; opciones: OpcionesDeAutenticacion };

export type ResultadoOpciones = { tipo: "ok"; datos: Opciones } | { tipo: "rebote"; motivo: MotivoDeRebote };
export type ResultadoTransferencia =
  | { tipo: "ok"; nuevoAdminUsuarioId: string }
  | { tipo: "rebote"; motivo: MotivoDeRebote };

type Passkey = { credentialId: string; clavePublicaRaw: Uint8Array; contador: number };

async function passkeyDe(pool: Pool, usuarioId: string): Promise<Passkey | null> {
  const { rows } = await pool.query<{ credential_id: string; clave_publica_raw: Buffer; contador: string }>(
    "select credential_id, clave_publica_raw, contador::text as contador from admin_passkeys where usuario_id = $1",
    [usuarioId],
  );
  const fila = rows[0];
  if (!fila) return null;
  return {
    credentialId: fila.credential_id,
    clavePublicaRaw: new Uint8Array(fila.clave_publica_raw),
    contador: Number(fila.contador),
  };
}

/** El destino tiene que existir, estar activo, y ser un rol que este panel efectivamente
 *  gobierna — y no ser quien ya está pidiendo la transferencia. */
async function destinoValido(pool: Pool, sesion: Sesion, usuarioId: string): Promise<boolean> {
  if (usuarioId === sesion.usuarioId) return false;
  const { rows } = await pool.query<{ rol: string }>("select rol::text as rol from usuarios where id = $1 and activo", [
    usuarioId,
  ]);
  const rol = rows[0]?.rol;
  return !!rol && ROLES_TRANSFERIBLES.includes(rol);
}

async function nombreDe(pool: Pool, usuarioId: string): Promise<string> {
  const { rows } = await pool.query<{ nombre: string | null }>(
    "select p.nombre from usuarios u join personas p on p.id = u.persona_id where u.id = $1",
    [usuarioId],
  );
  return rows[0]?.nombre ?? "Dueña o dueño";
}

/**
 * Arma la ceremonia: `registro` si esta persona nunca tuvo passkey en este tenant,
 * `autenticacion` si ya la tiene —de esta vuelta como admin o de una anterior—. El reto
 * fija el DESTINO desde este momento: el cuerpo de la confirmación no puede apuntar a otro.
 *
 * Un reto vivo anterior de esta persona se anula al emitir uno nuevo, mismo criterio que
 * `emitirCodigoPuente` con `codigos_puente`: el segundo intento del dueño no tiene por qué
 * rebotar contra el primero.
 */
export async function emitirOpciones(
  pool: Pool,
  sesion: Sesion,
  rpId: string,
  nuevoAdminUsuarioId: string,
): Promise<ResultadoOpciones> {
  if (!(await destinoValido(pool, sesion, nuevoAdminUsuarioId))) {
    return { tipo: "rebote", motivo: "destino_invalido" };
  }

  const existente = await passkeyDe(pool, sesion.usuarioId);
  const reto = retoNuevo();
  const expiraAt = new Date(Date.now() + PASSKEY.reto_vigencia_min * 60_000);

  const retoId = await enActo(pool, async (c) => {
    await c.query("delete from retos_webauthn where usuario_id = $1 and usado_en is null", [sesion.usuarioId]);
    const { rows } = await c.query<{ id: string }>(
      `insert into retos_webauthn (usuario_id, tipo, reto, nuevo_admin_usuario_id, expira_at)
       values ($1, $2, $3, $4, $5) returning id::text as id`,
      [sesion.usuarioId, existente ? "autenticacion" : "registro", reto, nuevoAdminUsuarioId, expiraAt],
    );
    return rows[0]!.id;
  });

  if (existente) {
    return {
      tipo: "ok",
      datos: {
        ceremonia: "autenticacion",
        retoId,
        opciones: opcionesDeAutenticacion({ rpId, reto, credentialId: existente.credentialId }),
      },
    };
  }
  return {
    tipo: "ok",
    datos: {
      ceremonia: "registro",
      retoId,
      opciones: opcionesDeRegistro({ rpId, reto, usuarioId: sesion.usuarioId, nombre: await nombreDe(pool, sesion.usuarioId) }),
    },
  };
}

/**
 * Confirma la ceremonia y transfiere. La verificación criptográfica corre ANTES de abrir
 * transacción: sin ceremonia válida esto sale por una rama que jamás llamó a `enActo`, así
 * que «0 cambios» no es una promesa — es que ninguna escritura se intentó.
 *
 * Solo con la ceremonia verificada se abre el acto: marcar el reto usado, guardar/actualizar
 * la passkey, mover el rol de los dos usuarios y dejar el evento — todo o nada.
 */
export async function confirmarTransferencia(
  pool: Pool,
  sesion: Sesion,
  rpId: string,
  origen: string,
  retoId: string,
  credencial: unknown,
): Promise<ResultadoTransferencia> {
  const { rows } = await pool.query<{
    id: string;
    tipo: string;
    reto: string;
    nuevo_admin_usuario_id: string;
    expira_at: Date;
  }>(
    `select id::text as id, tipo, reto, nuevo_admin_usuario_id::text as nuevo_admin_usuario_id, expira_at
       from retos_webauthn where id = $1 and usuario_id = $2 and usado_en is null`,
    [retoId, sesion.usuarioId],
  );
  const reto = rows[0];
  if (!reto) return { tipo: "rebote", motivo: "reto_invalido" };
  if (reto.expira_at.getTime() <= Date.now()) return { tipo: "rebote", motivo: "reto_vencido" };
  if (!(await destinoValido(pool, sesion, reto.nuevo_admin_usuario_id))) {
    return { tipo: "rebote", motivo: "destino_invalido" };
  }

  let clavePublicaRaw: Uint8Array;
  let credentialId: string | null = null;
  let contadorNuevo: number | null = null;
  try {
    if (reto.tipo === "registro") {
      const r = await verificarRegistro({
        credencial: credencial as CredencialDeRegistro,
        retoEsperado: reto.reto,
        rpId,
        origenEsperado: origen,
      });
      clavePublicaRaw = r.clavePublicaRaw;
      credentialId = r.credentialId;
    } else {
      const existente = await passkeyDe(pool, sesion.usuarioId);
      if (!existente) return { tipo: "rebote", motivo: "passkey_invalida" };
      const r = await verificarAutenticacion({
        credencial: credencial as CredencialDeAutenticacion,
        retoEsperado: reto.reto,
        rpId,
        origenEsperado: origen,
        clavePublicaRaw: existente.clavePublicaRaw,
        contadorAnterior: existente.contador,
      });
      clavePublicaRaw = existente.clavePublicaRaw;
      contadorNuevo = r.contadorNuevo;
    }
  } catch {
    return { tipo: "rebote", motivo: "passkey_invalida" };
  }

  await enActo(pool, async (c) => {
    const marcado = await c.query("update retos_webauthn set usado_en = now() where id = $1 and usado_en is null", [
      reto.id,
    ]);
    // Ganó otro request con el mismo reto entre la verificación y acá: se deshace, jamás se
    // transfiere dos veces con la misma ceremonia.
    if ((marcado.rowCount ?? 0) === 0) throw new Error("el reto ya se usó en otro request");

    if (reto.tipo === "registro") {
      await c.query(
        `insert into admin_passkeys (usuario_id, credential_id, clave_publica_raw, contador)
         values ($1, $2, $3, 0)`,
        [sesion.usuarioId, credentialId, Buffer.from(clavePublicaRaw)],
      );
      await registrarEvento(c, {
        codigo: EVENTOS.passkey_registrada,
        objetoTabla: "admin_passkeys",
        objetoId: sesion.usuarioId,
        sesion,
      });
    } else {
      await c.query("update admin_passkeys set contador = $2 where usuario_id = $1", [
        sesion.usuarioId,
        contadorNuevo,
      ]);
    }

    // El anterior pierde el gobierno; el nuevo lo recibe. `operador` y no otra cosa: es el
    // rol interno más chico de los cuatro transferibles, sin capacidades de gobierno propias.
    await c.query("update usuarios set rol = 'operador' where id = $1", [sesion.usuarioId]);
    await c.query("update usuarios set rol = 'admin_tenant' where id = $1", [reto.nuevo_admin_usuario_id]);

    await registrarEvento(c, {
      codigo: EVENTOS.propiedad_transferida,
      objetoTabla: "usuarios",
      objetoId: reto.nuevo_admin_usuario_id,
      sesion,
      payload: { anterior_usuario_id: sesion.usuarioId },
    });
  });

  return { tipo: "ok", nuevoAdminUsuarioId: reto.nuevo_admin_usuario_id };
}
