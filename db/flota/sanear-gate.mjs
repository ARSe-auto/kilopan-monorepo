// Saneo de fixtures huérfanos ANTES del job exportador [AC-FTEN-20].
//
// Una corrida ABORTADA de la suite (Ctrl-C, sesión que muere entre el `provisionar()` y su
// `finally`) deja en `control.tenants` filas `gate_*`/`canary` cuya base ya no existe. Son
// fixtures, no tenants: si se quedan, el exportador las nombra como rezago REAL y el gate
// queda rojo para siempre — nadie las limpia porque el `finally` que las limpiaba ya murió.
//
// Se borra SOLO lo que cumple las DOS condiciones: slug de prueba (`gate_*`/`canary`) Y base
// inexistente. Un huérfano con slug real se sigue nombrando, que es exactamente el AC.
import { con, BD_CONTROL } from "./conectar.mjs";
import { HIJAS_DE_TENANTS } from "./suite-bd/desregistrar.mjs";

try {
  const saneados = await con(BD_CONTROL, async ({ sql }) => {
    const huerfanos = await sql(
      `select id::text as id, slug, bd from tenants
        where (slug like 'gate\\_%' or slug = 'canary')
          and bd not in (select datname from pg_database)`,
    );
    for (const h of huerfanos) {
      for (const hija of HIJAS_DE_TENANTS) {
        await sql(`delete from ${hija} where tenant_id = $1`, [h.id]);
      }
      await sql("delete from tenants where id = $1", [h.id]);
    }
    return huerfanos;
  });
  for (const h of saneados) {
    console.log(`saneado: ${h.slug} — fila sin base (${h.bd}), fixture de una corrida abortada`);
  }
  if (saneados.length === 0) console.log("sin fixtures huérfanos: nada que sanear");
} catch (e) {
  if (e.code === "3D000" || e.code === "42P01") {
    console.log("sin base `control` todavía: nada que sanear");
  } else {
    throw e;
  }
}
