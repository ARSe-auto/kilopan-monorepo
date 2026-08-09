#!/usr/bin/env node
// Fixture del e2e de ruteo [AC-FTEN-05]: tres tenants REGISTRADOS en `control`, uno por
// estado del enum cerrado, cada uno con su base de verdad provisionada desde la plantilla.
//
// Las bases de los NO activos existen a propósito. Sin ellas, «cero acceso a la base del
// suspendido» sería verdad por accidente —no hay base contra la cual conectarse— y el caso
// que el dueño pidió cerrar quedaría sin probar. Con la base viva, contar conexiones en
// `pg_stat_activity` sí dice algo.
//
// Se recrea en cada corrida, igual que la suite de provisión del gate: un fixture que
// sobrevive entre corridas es un fixture que un día quedó en un estado que nadie escribió.
import { provisionar } from "../../../db/flota/provisionar.mjs";
import { con, BD_CONTROL, bdDeTenant } from "../../../db/flota/conectar.mjs";

/** Un tenant por estado, más el cuarto caso —el subdominio que NO está en `control`— que
 *  por definición no se siembra: su ausencia ES el caso. */
export const TENANTS = [
  { slug: "ruteo_activo", estado: "activo" },
  // DOS activos y no uno. Con uno solo, «el subdominio de A va a la base de A» se puede
  // cumplir por accidente —cualquier base daría ese slug si solo hay una— y el ataque de
  // cabecera falsificada no se puede ni montar: hace falta una segunda base VIVA a la que
  // apuntar. El segundo activo es lo que convierte los dos casos en pruebas de verdad.
  { slug: "ruteo_activo_b", estado: "activo" },
  { slug: "ruteo_susp", estado: "suspendido" },
  { slug: "ruteo_arch", estado: "archivado" },
];

/** Subdominio que jamás se registra. Nombrarlo acá evita que el test lo invente distinto. */
export const SLUG_INEXISTENTE = "ruteo_fantasma";

export async function prepararTenants() {
  for (const { slug } of TENANTS) await provisionar(slug, { recrear: true });

  await con(BD_CONTROL, async (control) => {
    for (const { slug, estado } of TENANTS) {
      await control.sql(
        `insert into tenants (slug, bd, estado) values ($1, $2, $3::tenant_estado)
         on conflict (slug) do update set estado = excluded.estado`,
        [slug, bdDeTenant(slug), estado],
      );
    }
    // El inexistente no debe quedar de una corrida anterior: si quedara, el caso del 404
    // por subdominio desconocido estaría probando otra cosa.
    await control.sql("delete from tenants where slug = $1", [SLUG_INEXISTENTE]);
  });

  console.log(`preparar-tenants: ${TENANTS.map((t) => `${t.slug}=${t.estado}`).join(" · ")}`);
}

if (process.argv[1]?.endsWith("preparar-tenants.mjs")) {
  await prepararTenants();
  process.exit(0);
}
