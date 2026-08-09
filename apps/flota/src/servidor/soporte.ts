import type { Pool } from "pg";

// Soporte sin god-mode [AC-FIDN-11] — §4.3, §7.9.
//
// LA REGLA, Y ES AL REVÉS DE COMO SUELE ESTAR: por omisión el personal de la plataforma no ve
// NADA de un tenant. No hay un permiso que se pueda quitar — no hay permiso. Lo que existe es
// un grant que el DUEÑO del tenant otorga, con alcance y con fecha, y que se apaga solo.
//
// «SE APAGA SOLO» ES LITERAL Y ES LA MITAD DEL AC. No hay job de expiración, no hay barrido
// nocturno, no hay nada que se pueda olvidar de correr: `vigente()` compara contra el reloj en
// cada consulta, así que un grant vencido deja de servir en el instante exacto en que vence,
// aunque nadie toque nada nunca más. Un vencimiento que dependa de un proceso es un
// vencimiento que un día no ocurre.
//
// El registro vive en `control` (§4.1: el plano de control guarda los grants), y el begin/end
// de cada acceso se espeja en el `audit_trail` del tenant — porque el §4.3 pide que el dueño
// VEA cuándo entró soporte, y una auditoría que solo existe del lado de la plataforma no es
// una auditoría para él.

export const ALCANCES = ["solo_lectura", "modulos"] as const;
export type Alcance = (typeof ALCANCES)[number];

/** Las DOS duraciones del §4.3. Un campo libre terminaría en un año el día que haya apuro. */
export const DURACIONES = { "24h": 24, "7d": 24 * 7 } as const;
export type Duracion = keyof typeof DURACIONES;

export type Grant = {
  id: string;
  tenantId: string;
  alcance: Alcance;
  expiraEn: Date;
};

/**
 * Otorga un grant. Lo hace el DUEÑO del tenant: este módulo no tiene una vía por la que la
 * plataforma se lo otorgue a sí misma, y esa ausencia es parte del contrato.
 */
export async function otorgar(
  control: Pool,
  datos: { tenantId: string; otorgadoA: string; motivo: string; alcance: Alcance; duracion: Duracion },
): Promise<Grant> {
  const { rows } = await control.query<{ id: string; expira_en: Date }>(
    `insert into grants_soporte (tenant_id, otorgado_a, motivo, alcance, expira_en)
     values ($1, $2, $3, $4::alcance_de_soporte, now() + make_interval(hours => $5))
     returning id::text as id, expira_en`,
    [datos.tenantId, datos.otorgadoA, datos.motivo, datos.alcance, DURACIONES[datos.duracion]],
  );
  return {
    id: rows[0]!.id,
    tenantId: datos.tenantId,
    alcance: datos.alcance,
    expiraEn: rows[0]!.expira_en,
  };
}

/** Revocación anticipada: el dueño no tiene que esperar a que venza (§4.3). */
export async function revocar(control: Pool, grantId: string): Promise<boolean> {
  const { rowCount } = await control.query(
    "update grants_soporte set revocado_en = now() where id = $1 and revocado_en is null",
    [grantId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Revocación desde el PANEL del dueño [AC-FIDN-12]. Es `revocar` con el `tenant_id` metido
 * DENTRO del WHERE, y esa diferencia es todo el AC en una línea: el id del grant llega por la
 * URL, o sea de afuera, y sin el filtro por tenant el dueño de A revocaría el grant de B
 * escribiendo el uuid de B. El tenant no llega de afuera nunca: sale de `tenant_info` de la
 * base que el ruteo eligió (§4.1).
 *
 * No reemplaza a `revocar`: aquella la usa el plano de plataforma, que sí opera sobre un grant
 * ya identificado y no sobre uno que alguien nombró.
 */
export async function revocarDelTenant(
  control: Pool,
  tenantId: string,
  grantId: string,
): Promise<boolean> {
  const { rowCount } = await control.query(
    "update grants_soporte set revocado_en = now() where id = $1 and tenant_id = $2 and revocado_en is null",
    [grantId, tenantId],
  );
  return (rowCount ?? 0) > 0;
}

/** Los grants de un tenant para la pantalla del dueño: los vivos y los que ya no. Sin `motivo`
 *  recortado y sin filtrar los vencidos — el dueño necesita ver que soporte estuvo, no solo
 *  que está. */
export async function listarGrants(control: Pool, tenantId: string) {
  const { rows } = await control.query(
    `select id::text as id, otorgado_a, motivo, alcance::text as alcance,
            otorgado_en, expira_en, revocado_en,
            (revocado_en is null and expira_en > now()) as vigente
       from grants_soporte
      where tenant_id = $1
      order by otorgado_en desc`,
    [tenantId],
  );
  return rows;
}

/**
 * El grant vigente de un tenant, o null. **Esta función ES la caída automática**: compara
 * contra `now()` de la base en cada llamada, así que no hay estado que mantener ni proceso que
 * pueda fallar. Un grant vencido y uno revocado se ven exactamente igual desde acá — que es lo
 * correcto, porque en los dos casos la respuesta es la misma: no hay acceso.
 */
export async function vigente(control: Pool, tenantId: string): Promise<Grant | null> {
  const { rows } = await control.query<{
    id: string;
    alcance: Alcance;
    expira_en: Date;
  }>(
    `select id::text as id, alcance::text as alcance, expira_en
       from grants_soporte
      where tenant_id = $1 and revocado_en is null and expira_en > now()
      order by expira_en desc
      limit 1`,
    [tenantId],
  );
  const g = rows[0];
  return g ? { id: g.id, tenantId, alcance: g.alcance, expiraEn: g.expira_en } : null;
}

/**
 * Espeja el begin/end del acceso en la auditoría del TENANT (§4.3, §7.9).
 *
 * Va a `audit_trail`, que es append-only: una sesión de soporte registrada no se puede borrar
 * ni siquiera con el rol dueño de la base. Si el registro viviera solo en `control`, el dueño
 * del tenant tendría que pedirle a la plataforma el listado de las veces que la plataforma lo
 * miró — y eso no es una auditoría, es un favor.
 */
export async function registrarAcceso(
  tenant: Pool,
  grantId: string,
  momento: "inicio" | "fin",
  quien: string,
): Promise<void> {
  await tenant.query(
    `insert into audit_trail (tabla, registro_id, operacion, despues)
     values ('soporte', $1::uuid, 'INSERT', $2::jsonb)`,
    [grantId, JSON.stringify({ momento, quien })],
  );
}
