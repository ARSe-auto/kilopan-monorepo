import type { Pool } from "pg";
import { hashDeSecreto } from "../dominio/secretos.ts";

// La sesión de FLOTA [AC-FIDN-09] — §4.3, §5.4, y la respuesta del dueño a la pregunta 1
// (09-ago-2026): en el teléfono personal la sesión dura mientras el dispositivo siga enrolado
// y sin revocar.
//
// QUÉ ES UNA SESIÓN ACÁ. El secreto que la aprobación emitió al aparato (AC-FIDN-04),
// presentado en cada request. No hay cookie, no hay token con vencimiento, no hay refresh: la
// sesión ES el aparato, y por eso el dueño la corta poniendo `revocado_at`.
//
// POR QUÉ ESO ES LO CORRECTO Y NO UN ATAJO. Un token con vencimiento propio tendría que
// caducar para que la revocación surtiera efecto, y esa ventana es justo la que no puede
// existir cuando alguien perdió el teléfono en la calle. Acá cada request vuelve a preguntar
// por la fila del aparato, así que el corte del §5.4 F-F es inmediato de verdad: sin trabajo
// de fondo, sin lista de revocados que sincronizar, sin nada que se pueda olvidar de correr.
// El costo es una consulta por request contra la BD del tenant, que ya está abierta.
//
// El secreto llega en `Authorization: Portador <secreto>`. Se compara por HASH: en la base no
// hay con qué entrar aunque alguien se la lleve entera.

export type Sesion = {
  dispositivoId: string;
  personaId: string;
  usuarioId: string;
  rol: string;
  /** Las dos condiciones del §4.3 [AC-FIDN-05]. Un aparato al que le falte una TIENE sesión
   *  —si no, no habría dónde decirle qué le falta, que es la degradación VISIBLE que el AC
   *  pide— pero no está operable para capturar en terreno. Quien pregunte por lo segundo usa
   *  `enrolamientoCompleto`, no el hecho de que la sesión resuelva. */
  isStandalone: boolean;
  storagePersisted: boolean;
  /** La empresa contratante, SOLO para el rol `cliente` [AC-FRUT-12]. Es lo que la política de
   *  fila del §7.2 compara: sin ella, una sesión de cliente no ve ninguna fila —falla hacia el
   *  cierre— porque una sesión de cliente sin empresa es un error de programación. */
  empresaClienteId: string | null;
};

export type VeredictoSesion =
  | { tipo: "valida"; sesion: Sesion }
  | { tipo: "invalida"; motivo: "sin_credencial" | "desconocida" | "revocada" | "usuario_inactivo" };

/** `Authorization: Portador <secreto>` → el secreto, o null. */
export function secretoDe(cabecera: string | null | undefined): string | null {
  const m = /^Portador\s+(\S+)$/i.exec(String(cabecera ?? "").trim());
  return m ? m[1]! : null;
}

/**
 * Resuelve la sesión de un request. Devuelve el motivo cuando no hay, porque el servidor lo
 * necesita para decidir entre «autenticate» y «te revocaron» — pero quien responda al cliente
 * NO tiene que reenviar ese detalle: un aparato robado no necesita enterarse de que lo dieron
 * de baja, solo de que no entra.
 */
export async function resolverSesion(pool: Pool, cabecera: string | null): Promise<VeredictoSesion> {
  const secreto = secretoDe(cabecera);
  if (!secreto) return { tipo: "invalida", motivo: "sin_credencial" };

  const { rows } = await pool.query<{
    dispositivo_id: string;
    persona_id: string;
    usuario_id: string | null;
    rol: string | null;
    revocado_at: Date | null;
    activo: boolean | null;
    is_standalone: boolean;
    storage_persisted: boolean;
    empresa_cliente_id: string | null;
  }>(
    `select d.id::text  as dispositivo_id,
            d.persona_id::text as persona_id,
            u.id::text  as usuario_id,
            u.rol::text as rol,
            d.revocado_at,
            u.activo,
            d.is_standalone,
            d.storage_persisted,
            u.empresa_cliente_id::text as empresa_cliente_id
       from dispositivos d
       left join usuarios u on u.persona_id = d.persona_id
      where d.secreto_hash = $1`,
    [hashDeSecreto(secreto)],
  );

  const fila = rows[0];
  if (!fila) return { tipo: "invalida", motivo: "desconocida" };
  // EL CORTE. Se mira en CADA request y contra la fila, no contra una copia en memoria: es lo
  // que hace que «revocar en 1 toque» tenga efecto en el request siguiente y no en el próximo
  // vencimiento de algo.
  if (fila.revocado_at !== null) return { tipo: "invalida", motivo: "revocada" };
  // La anonimización de la 21.719 desactiva al usuario (AC-FIDN-19); un aparato que sobreviva
  // a eso no puede seguir teniendo sesión.
  if (!fila.usuario_id || fila.activo !== true) return { tipo: "invalida", motivo: "usuario_inactivo" };

  return {
    tipo: "valida",
    sesion: {
      dispositivoId: fila.dispositivo_id,
      personaId: fila.persona_id,
      usuarioId: fila.usuario_id,
      rol: fila.rol!,
      isStandalone: fila.is_standalone,
      storagePersisted: fila.storage_persisted,
      empresaClienteId: fila.empresa_cliente_id,
    },
  };
}

/** Revocar un aparato: un UPDATE, y el efecto es el request siguiente (§5.4 F-F). */
export async function revocarDispositivo(pool: Pool, dispositivoId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "update dispositivos set revocado_at = now() where id = $1 and revocado_at is null",
    [dispositivoId],
  );
  return (rowCount ?? 0) > 0;
}
