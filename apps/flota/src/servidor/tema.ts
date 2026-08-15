import type { Pool } from "pg";
import { derivarTema, type TemaDerivado } from "../../../../packages/miga/src/tema.ts";

// El lado servidor de AC-FMIG-02: leer el tema vigente para el bootstrap y guardar el que
// propone el panel admin. La derivación (aclarar/oscurecer) es de `packages/miga`; acá solo
// se lee/escribe la fila y se traduce el rebote de la BD a algo que el servidor pueda
// devolver como 422 tipado (§4.2) — la autoridad sigue siendo `tenant_theme_contraste`.

export type TemaTenant = TemaDerivado & { logoUrl: string | null };

const COLUMNAS = "accent_color, accent_claro, fondo_claro, accent_oscuro, fondo_oscuro, logo_url";

type Fila = {
  accent_color: string;
  accent_claro: string;
  fondo_claro: string;
  accent_oscuro: string;
  fondo_oscuro: string;
  logo_url: string | null;
};

function desdeFila(fila: Fila): TemaTenant {
  return {
    accentColor: fila.accent_color,
    accentClaro: fila.accent_claro,
    fondoClaro: fila.fondo_claro,
    accentOscuro: fila.accent_oscuro,
    fondoOscuro: fila.fondo_oscuro,
    logoUrl: fila.logo_url,
  };
}

/** El tema vigente del tenant, o `null` si todavía no personalizó ninguno (§4.4: nace sin
 *  fila hasta que el wizard o el panel admin la escriben — hito g, no este AC). */
export async function temaDelTenant(pool: Pool): Promise<TemaTenant | null> {
  const { rows } = await pool.query<Fila>(`select ${COLUMNAS} from tenant_theme`);
  const fila = rows[0];
  return fila ? desdeFila(fila) : null;
}

export type GuardarTemaResultado =
  | { tipo: "ok"; tema: TemaTenant }
  | { tipo: "accent_invalido" }
  | { tipo: "contraste_insuficiente"; accentColor: string };

/**
 * Guarda el tema del tenant: UN UPDATE, cero deploys (§2 métrica 3, §5.1). `unica` fuerza
 * una sola fila por tenant, así que esto es siempre un upsert sobre esa fila.
 *
 * El caso de rebote del AC se juega ACÁ, no antes: se intenta el insert con la variante que
 * `derivarTema` propone y se deja que `tenant_theme_contraste` (la BD) tenga la última
 * palabra. Un accent_color cuya derivación no cruza el mínimo hace que el trigger rebote con
 * `check_violation` (23514) y la fila NO cambia — la transacción implícita del INSERT la
 * revierte sola.
 */
export async function guardarTema(
  pool: Pool,
  accentColorCrudo: unknown,
  logoUrlCrudo: unknown,
): Promise<GuardarTemaResultado> {
  if (typeof accentColorCrudo !== "string" || !/^#[0-9a-fA-F]{6}$/.test(accentColorCrudo)) {
    return { tipo: "accent_invalido" };
  }
  const logoUrl = typeof logoUrlCrudo === "string" && logoUrlCrudo.length > 0 ? logoUrlCrudo : null;
  const tema = derivarTema(accentColorCrudo);

  try {
    const { rows } = await pool.query<Fila>(
      `insert into tenant_theme (accent_color, accent_claro, fondo_claro, accent_oscuro, fondo_oscuro, logo_url)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (unica) do update set
         accent_color  = excluded.accent_color,
         accent_claro  = excluded.accent_claro,
         fondo_claro   = excluded.fondo_claro,
         accent_oscuro = excluded.accent_oscuro,
         fondo_oscuro  = excluded.fondo_oscuro,
         logo_url      = excluded.logo_url
       returning ${COLUMNAS}`,
      [tema.accentColor, tema.accentClaro, tema.fondoClaro, tema.accentOscuro, tema.fondoOscuro, logoUrl],
    );
    return { tipo: "ok", tema: desdeFila(rows[0]!) };
  } catch (e) {
    const error = e as { code?: string };
    // 23514 = check_violation: el trigger `validar_contraste_del_tema` rebotó una de las dos
    // variantes. Cualquier otro código no es este AC — que reviente como lo que es.
    if (error.code === "23514") return { tipo: "contraste_insuficiente", accentColor: accentColorCrudo };
    throw e;
  }
}
