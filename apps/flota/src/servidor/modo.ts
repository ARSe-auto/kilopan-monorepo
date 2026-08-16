import { poolDe } from "./conexion.ts";
import { enActo, registrarEvento, EVENTOS } from "./gobierno.ts";
import type { Acto } from "./gobierno.ts";

// El selector de modo del tenant [AC-FRUT-14] — §3, §4.5, §9.3.11.
//
// ─── DOS BASES, UNA DECISIÓN ──────────────────────────────────────────────────────
//
// `control.tenants.modo` es la AUTORIDAD: es lo que lee el ruteo y lo que define el preset de
// entitlements. `tenant_info.modo` es una RÉPLICA que existe por una razón concreta: el trigger
// que crea la empresa implícita vive en la base del tenant y el §7.2 prohíbe que cruce a
// `control`. Sin la réplica, ese trigger no podría saber en qué modo está.
//
// No hay transacción que abarque las dos bases y no la va a haber: son bases distintas por
// diseño (§4.1). El orden es autoridad primero, réplica después, y si la réplica falla se
// deshace la autoridad. Queda una ventana en la que las dos podrían discrepar; se cierra
// devolviendo el error y dejando `control` como estaba, que es el estado desde el que reintentar
// es seguro.
//
// ─── CONMUTAR ES ADITIVO, JAMÁS DESTRUCTIVO (centinela 11) ───────────────────────
//
// Este archivo no borra nada, en ningún modo. Pasar a `daas` deja la empresa implícita donde
// está —solo deja de ser la única— y volver a `mi_flota` no la crea de nuevo ni toca las
// contratantes que se dieron de alta mientras tanto. Que eso sea cierto lo sostiene el `on
// conflict do nothing` del trigger, no la buena voluntad de esta función.

export const MODOS = ["mi_flota", "daas"] as const;
export type Modo = (typeof MODOS)[number];

export const esModo = (valor: string): valor is Modo => (MODOS as readonly string[]).includes(valor);

export type CambioDeModo =
  | { tipo: "ok"; modo: Modo; empresas: number }
  | { tipo: "tenant_no_existe" };

export async function modoVigente(slug: string): Promise<Modo | null> {
  const { rows } = await poolDe("control").query<{ modo: Modo }>(
    "select modo::text as modo from tenants where slug = $1",
    [slug],
  );
  return rows[0]?.modo ?? null;
}

export async function conmutarModo(acto: Acto, modo: Modo): Promise<CambioDeModo> {
  const anterior = await modoVigente(acto.slug);
  if (anterior === null) return { tipo: "tenant_no_existe" };

  await poolDe("control").query("update tenants set modo = $2::tenant_modo where slug = $1", [
    acto.slug,
    modo,
  ]);

  try {
    return await enActo(acto.pool, async (c) => {
      // El UPDATE dispara el trigger que crea la empresa implícita si corresponde. No se la crea
      // desde acá a propósito: el §4.5 dice «creada por trigger», y un segundo camino que
      // escribiera la misma fila sería el que se olvida de actualizar cuando la regla cambie.
      const { rows: info } = await c.query<{ id: string }>(
        "update tenant_info set modo = $1 returning id::text as id",
        [modo],
      );
      const { rows } = await c.query<{ n: string }>(
        "select count(*)::text as n from empresas_cliente",
      );
      // `tenant_info` no lleva el trigger genérico `auditar()` (solo el de la empresa
      // implícita, 0039) — engancharlo pedía una migración, y el esquema es de sesión
      // supervisada (AGENTS.md). Se escribe a mano, mismo patrón que `soporte.ts`
      // (`registrarAcceso`) para lo que tampoco cuelga de ese trigger. AC-FPOR-15 exige
      // «cada conmutación a audit_trail»: sin esta línea, el acto solo queda en `eventos`.
      await c.query(
        `insert into audit_trail (tabla, registro_id, operacion, antes, despues)
         values ('tenant_info', $1::uuid, 'UPDATE', $2::jsonb, $3::jsonb)`,
        [info[0]!.id, JSON.stringify({ modo: anterior }), JSON.stringify({ modo })],
      );
      await registrarEvento(c, {
        codigo: EVENTOS.modo_conmutado,
        objetoTabla: "tenant_info",
        objetoId: info[0]!.id,
        sesion: acto.sesion,
        payload: { de: anterior, a: modo },
      });
      return { tipo: "ok", modo, empresas: Number(rows[0]!.n) };
    }, acto.sesion);
  } catch (error) {
    // La réplica no quedó escrita: se devuelve `control` a donde estaba, que es el único estado
    // desde el que reintentar es seguro. Dejarlo conmutado con la réplica atrás daría un tenant
    // que el ruteo cree en `daas` y cuyo trigger sigue creyéndose en `mi_flota`.
    await poolDe("control").query("update tenants set modo = $2::tenant_modo where slug = $1", [
      acto.slug,
      anterior,
    ]);
    throw error;
  }
}
