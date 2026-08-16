import type { Pool } from "pg";

// Supresión de la Ley 21.719 sobre una persona [AC-FIDN-19] — §4.3, §7.8.
//
// LA FORMA QUE TOMA LA SUPRESIÓN ACÁ, y es la razón por la que el §7.8 separó los planos: se
// anonimiza UNA fila de `personas` y el ledger no se toca. No es un atajo — es lo único
// correcto. El ledger es append-only por el §7.4 y encima es PRUEBA de entregas: borrar la
// historia operativa para cumplir una solicitud de supresión destruiría evidencia de un
// tercero (el contratante) que nadie pidió borrar, y dejaría liquidaciones sin respaldo.
//
// Lo que queda después: las mismas filas de eventos y firmas, con el mismo ID opaco, y una
// persona de la que no se puede decir quién era. Que eso alcance es exactamente lo que
// AC-FIDN-14 mecaniza: si un RUT se hubiera copiado dentro de una tabla de hechos, esta
// función sería mentira y la supresión, imposible.

export type ResultadoAnonimizacion =
  | { tipo: "anonimizada"; dispositivosRevocados: number; usuariosDesactivados: number }
  | { tipo: "rebote"; motivo: "persona_inexistente" | "ya_anonimizada" };

/**
 * Anonimiza a una persona y cierra sus accesos, en una transacción.
 *
 * DECISIÓN DECLARADA — la supresión también REVOCA los aparatos y desactiva al usuario. El AC
 * pide la fila y el ledger intacto; esto es la consecuencia que no se puede dejar afuera sin
 * romper algo: un aparato que sigue capturando en nombre de una identidad suprimida escribiría
 * hechos nuevos atribuidos a alguien que ya no se puede nombrar, y las pantallas del §5 —que
 * muestran quién hizo qué— quedarían con un hueco en vez de un nombre. Suprimir es cerrar la
 * relación, no dejarla andando sin etiqueta.
 *
 * Lo que NO hace, y es deliberado: no toca `eventos`, `firmas`, `evidence` ni `audit_trail`.
 * Ni siquiera lo intenta — el trigger del §7.4 lo rebotaría con 42501, y que la función ni
 * siquiera los nombre es lo que hace que el centinela 6 no se pueda violar desde acá.
 */
export async function anonimizar(pool: Pool, personaId: string): Promise<ResultadoAnonimizacion> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");

    const { rows } = await cliente.query<{ anonimizada_en: Date | null }>(
      "select anonimizada_en from personas where id = $1 for update",
      [personaId],
    );
    if (!rows[0]) {
      await cliente.query("commit");
      return { tipo: "rebote", motivo: "persona_inexistente" };
    }
    if (rows[0].anonimizada_en !== null) {
      // Idempotente hacia afuera pero explícito: una segunda anonimización no rompe nada, y
      // decirlo evita que un reintento se lea como que la primera no funcionó.
      await cliente.query("commit");
      return { tipo: "rebote", motivo: "ya_anonimizada" };
    }

    // Los tres campos identificantes se van JUNTOS. El CHECK de la tabla (AC-FIDN-01) hace
    // imposible dejarlo a medias: una fila con fecha de anonimización que conserva el RUT no
    // está anonimizada, es una fila con una fecha puesta.
    await cliente.query(
      `update personas
          set rut = null, nombre = null, contacto = null, anonimizada_en = now()
        where id = $1`,
      [personaId],
    );

    const { rowCount: revocados } = await cliente.query(
      "update dispositivos set revocado_at = now() where persona_id = $1 and revocado_at is null",
      [personaId],
    );
    const { rowCount: desactivados } = await cliente.query(
      "update usuarios set activo = false where persona_id = $1 and activo",
      [personaId],
    );

    await cliente.query("commit");
    return {
      tipo: "anonimizada",
      dispositivosRevocados: revocados ?? 0,
      usuariosDesactivados: desactivados ?? 0,
    };
  } catch (error) {
    await cliente.query("rollback");
    throw error;
  } finally {
    cliente.release();
  }
}
