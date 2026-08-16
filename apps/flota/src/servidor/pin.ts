import { verify as verificarHash, hash as hashear } from "@node-rs/argon2";
import type { Pool } from "pg";
import { evaluarIntento, type EstadoPin, type Veredicto } from "../dominio/pin.ts";

// La aplicación del intento de PIN contra la base [AC-FIDN-06].
//
// Tres líneas de transacción y ni una regla: toda la lógica —cuándo bloquea, cuánto, cuándo
// se resetea— vive en `dominio/pin.ts` y se prueba sin cluster ni reloj real. Acá está lo
// único que la base tiene que aportar: que dos intentos simultáneos no se pisen el contador.
//
// `SELECT … FOR UPDATE` y no un `UPDATE … SET intentos = intentos + 1`: la decisión depende
// del estado leído (si bloquea, cuánto), así que la fila se toma antes de decidir. Sin el
// candado, cinco golpes en paralelo leen todos «0 fallidos» y ninguno llega al umbral —
// exactamente el ataque que el lockout existe para frenar, y que un contador optimista deja
// pasar sin que nada se ponga rojo.
//
// NADA DE ESTE ARCHIVO ESCRIBE UN LOG. El PIN en claro entra por parámetro, se usa para
// verificar el hash y se va; no se guarda, no se devuelve y no se imprime (§7.8, y el gate de
// `db/flota/gate-logs.mjs` lo verifica sobre el código).

type Fila = { intentos_fallidos: number; bloqueado_hasta: Date | null; pin_hash: string | null };

export type ResultadoPin = Veredicto | { tipo: "sin_pin"; estado: EstadoPin };

/**
 * Verifica el PIN de un usuario y deja el contador donde corresponda. Devuelve el veredicto
 * del dominio, ya persistido.
 *
 * El usuario que no existe y el que existe con PIN equivocado tienen que ser indistinguibles
 * para quien pregunta; por eso este módulo devuelve el veredicto y NO explica de más, y quien
 * lo llame responde lo mismo en los dos casos.
 */
export async function verificarPin(
  pool: Pool,
  usuarioId: string,
  pin: string,
  ahora: Date = new Date(),
): Promise<ResultadoPin> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    const { rows } = await cliente.query<Fila>(
      `select intentos_fallidos, bloqueado_hasta, pin_hash
         from usuarios where id = $1 and activo for update`,
      [usuarioId],
    );
    const fila = rows[0];
    if (!fila || !fila.pin_hash) {
      await cliente.query("commit");
      return { tipo: "sin_pin", estado: { intentos_fallidos: 0, bloqueado_hasta: null } };
    }

    const estado: EstadoPin = {
      intentos_fallidos: fila.intentos_fallidos,
      bloqueado_hasta: fila.bloqueado_hasta,
    };

    // El hash NO se verifica si ya está bloqueado: el dominio decide eso, y respetarlo acá es
    // lo que evita gastar un argon2id por cada golpe de un ataque que de todos modos no entra.
    const esCorrecto = estaBloqueadoSegunDominio(estado, ahora)
      ? false
      : await verificarHash(fila.pin_hash, pin);

    const veredicto = evaluarIntento(estado, esCorrecto, ahora);
    await cliente.query(
      "update usuarios set intentos_fallidos = $2, bloqueado_hasta = $3 where id = $1",
      [usuarioId, veredicto.estado.intentos_fallidos, veredicto.estado.bloqueado_hasta],
    );
    await cliente.query("commit");
    return veredicto;
  } catch (error) {
    await cliente.query("rollback");
    throw error;
  } finally {
    cliente.release();
  }
}

/** Se importa la regla en vez de repetirla; el `import` directo dejaría un ciclo feo. */
function estaBloqueadoSegunDominio(estado: EstadoPin, ahora: Date): boolean {
  return estado.bloqueado_hasta !== null && estado.bloqueado_hasta.getTime() > ahora.getTime();
}

/**
 * Rotación de PIN y desbloqueo por el dueño (§5.4). Va junto porque es UN acto: el dueño no
 * puede conocer el PIN nuevo —argon2id, jamás en logs— así que reabrir el acceso y fijar la
 * credencial son la misma operación desde el punto de vista del contador.
 *
 * El `audit_trail` no se escribe acá: lo pone el trigger de la tabla (AC-FIDN-01). Escribirlo
 * a mano dejaría fuera todo lo que no pase por esta función, que es justo lo que un rastro de
 * auditoría no puede permitirse.
 */
export async function fijarPin(pool: Pool, usuarioId: string, pinNuevo: string): Promise<void> {
  const hash = await hashear(pinNuevo);
  await pool.query(
    "update usuarios set pin_hash = $2, intentos_fallidos = 0, bloqueado_hasta = null where id = $1",
    [usuarioId, hash],
  );
}

/** Desbloquear sin tocar la credencial: el operario se acordó del PIN, solo estaba esperando. */
export async function desbloquear(pool: Pool, usuarioId: string): Promise<void> {
  await pool.query(
    "update usuarios set intentos_fallidos = 0, bloqueado_hasta = null where id = $1",
    [usuarioId],
  );
}
