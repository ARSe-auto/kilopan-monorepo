import type { Pool } from "pg";

// Break-glass: el acceso de emergencia de la plataforma [AC-FIDN-18] — §4.3, §7.9.
//
// CUÁNDO SE USA. Cuando el dueño del tenant NO está disponible y hay algo que atender: de
// madrugada, incomunicado, con el sistema caído. Por eso no puede depender de él — si pudiera
// aprobarlo, otorgaría un grant normal (AC-FIDN-11) y este mecanismo no haría falta.
//
// LAS TRES COSAS QUE EL §7.9 EXIGE, y ninguna es opcional:
//
//   1. DOBLE CONTROL. Dos personas DISTINTAS de la plataforma —quien lo pide y quien lo
//      aprueba—, decisión de Alexis del 09-ago-2026 (pregunta 7). Lo garantiza un CHECK de la
//      base y no la disciplina de quien llama a esta función.
//   2. NOTIFICACIÓN FORZOSA. «Forzosa» quiere decir que no hay camino sin ella: el aviso se
//      escribe en la bandeja del tenant ANTES de que exista la fila del break-glass, y la
//      columna `aviso_id` es NOT NULL. Un break-glass sin aviso no se puede ni insertar.
//   3. REGISTRO INMUTABLE. La tabla es append-only: lo que audita es el acceso de quien tiene
//      todos los permisos, así que un registro editable no auditaría nada.
//
// EL AVISO VIVE EN LA BANDEJA DEL TENANT (`review_queue`), y no es una elección de comodidad:
// el dueño respondió que el canal es «correo Y aviso persistente en el panel hasta que lo
// reconozca», y `review_queue` ya tiene exactamente esa forma — estados nueva → reconocida →
// resuelta (§4.6). Un aviso que se pueda cerrar sin reconocerlo no es persistente.
//
// ALCANCE DECLARADO: la mitad de CORREO del canal no se implementa acá. No hay proveedor de
// correo en el proyecto y E1 no despliega; queda como ítem, igual que el runbook de brechas
// (AC-FTEN-25) declara su plazo sin tener quién mande el mensaje. Lo que sí está construido y
// probado es la mitad que no depende de nadie: el aviso persistente en el panel del tenant.

export type Solicitud = {
  tenantId: string;
  /** Viaja denormalizado: el registro tiene que seguir siendo legible si el tenant se va. */
  tenantSlug: string;
  solicitadoPor: string;
  aprobadoPor: string;
  motivo: string;
  horas: number;
};

export type ResultadoBreakGlass =
  | { tipo: "abierto"; id: string; avisoId: string }
  | { tipo: "rebote"; motivo: "control_unico" | "sin_motivo" };

/**
 * Abre un break-glass. El aviso al tenant se escribe PRIMERO: si algo falla después, queda un
 * aviso sin acceso —ruido que el dueño puede descartar— y jamás un acceso sin aviso, que es la
 * falla que el §7.9 no admite. El orden es la garantía, no un detalle de implementación.
 */
export async function abrir(
  control: Pool,
  tenant: Pool,
  datos: Solicitud,
): Promise<ResultadoBreakGlass> {
  // Se rebota acá con motivo tipado además del CHECK de la base: el CHECK es la red que no se
  // puede saltar, esto es lo que la UI puede leer.
  if (datos.solicitadoPor === datos.aprobadoPor) return { tipo: "rebote", motivo: "control_unico" };
  if (datos.motivo.trim().length === 0) return { tipo: "rebote", motivo: "sin_motivo" };

  const { rows: avisos } = await tenant.query<{ id: string }>(
    `insert into review_queue (origen, severidad, estado, nota)
     values ('break_glass', 'alta', 'nueva', $1)
     returning id::text as id`,
    [
      `Acceso de emergencia de la plataforma. Pedido por ${datos.solicitadoPor} y aprobado por ` +
        `${datos.aprobadoPor}. Motivo: ${datos.motivo}`,
    ],
  );
  const avisoId = avisos[0]!.id;

  const { rows } = await control.query<{ id: string }>(
    `insert into break_glass (tenant_id, tenant_slug, solicitado_por, aprobado_por, motivo, expira_en, aviso_id)
     values ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), $7)
     returning id::text as id`,
    [datos.tenantId, datos.tenantSlug, datos.solicitadoPor, datos.aprobadoPor, datos.motivo, datos.horas, avisoId],
  );

  return { tipo: "abierto", id: rows[0]!.id, avisoId };
}

/** ¿Hay un break-glass abierto ahora? Igual que el grant: el vencimiento es una comparación. */
export async function vigente(control: Pool, tenantId: string): Promise<{ id: string } | null> {
  const { rows } = await control.query<{ id: string }>(
    "select id::text as id from break_glass where tenant_id = $1 and expira_en > now() order by expira_en desc limit 1",
    [tenantId],
  );
  return rows[0] ?? null;
}

/** ¿El dueño ya reconoció el aviso? Mientras no, sigue en su bandeja (§4.6). */
export async function avisoReconocido(tenant: Pool, avisoId: string): Promise<boolean> {
  const { rows } = await tenant.query<{ estado: string }>(
    "select estado from review_queue where id = $1",
    [avisoId],
  );
  return rows[0]?.estado !== "nueva";
}
