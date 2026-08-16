import { test, expect } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { origenDe } from "./puerto.ts";
import { TERMINOLOGIA_BASE_ES_CL } from "../../../packages/miga/src/terminologia.ts";

// AC-FMIG-04 — capa de copy con resolución term_key: tenant → vertical → base es-CL (§5.1).
//
// Este es el oráculo declarado de «selectores SOLO por data-testid/term_key, la MISMA suite
// corre dos veces —terminología base y extrema del tenant B— sin cambiar un selector» (§9.2):
// dos tenants, un tercero SIN fila propia sirve la base es-CL, el otro CON una fila propia al
// LARGO MÁXIMO permitido por su tipo (la extrema de referencia de esta familia de specs — el
// mismo criterio que ya usa `hoy-terminologia.ts` para AC-FSEM-12), y las DOS corridas de abajo
// (`for (const caso of CASOS)`) ejercen los MISMOS selectores contra las dos.
//
// `tenant_terminology` es una tabla que ninguna otra suite toca (igual razón que documenta
// `tema.spec.ts` para `tenant_theme`), así que reutilizar los dos slugs activos del fixture de
// ruteo no le pisa el `beforeAll` a nadie.

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const [A, B] = TENANTS.filter((t) => t.estado === "activo");
const BD_A = bdDeTenant(A!.slug);
const BD_B = bdDeTenant(B!.slug);

// La extrema del tenant B: mismo term_key `parada` (tipo navegacion, LABELS.largo_max=12),
// renombrado al máximo largo que `tenant_terminology_largo_por_tipo` aceptaría. `ruta` queda
// SIN fila propia a propósito: prueba que la cadena resuelve por CLAVE, no por tenant entero —
// un tenant con una sola fila propia sigue sirviendo la base es-CL para todo lo demás.
const EXTREMO_PARADA = { singular: "Punto extra", plural: "Puntos extra" }; // 11 / 12 — el tope
const BASE_PARADA = TERMINOLOGIA_BASE_ES_CL.parada!;
const BASE_RUTA = TERMINOLOGIA_BASE_ES_CL.ruta!;

test.beforeAll(async () => {
  // A: sin fila propia — se asegura por si un run anterior dejó una.
  await con(BD_A, async ({ sql }: Conexion) => {
    await sql("delete from tenant_terminology where term_key = 'parada'");
  });
  // B: una fila real, por el mismo camino que usará el panel de edición de AC-FMIG-06 el día
  // que exista — INSERT directo porque esa pantalla todavía no tiene endpoint de escritura.
  await con(BD_B, async ({ sql }: Conexion) => {
    await sql(
      `insert into tenant_terminology (term_key, tipo, singular, plural)
       values ('parada', 'navegacion', $1, $2)
       on conflict (tenant_id, term_key) do update set singular = excluded.singular, plural = excluded.plural`,
      [EXTREMO_PARADA.singular, EXTREMO_PARADA.plural],
    );
  });
});

const CASOS = [
  {
    nombre: "tenant SIN fila propia sirve la BASE es-CL",
    slug: A!.slug,
    esperado: { parada: BASE_PARADA, ruta: BASE_RUTA },
  },
  {
    nombre: "tenant CON fila propia al largo MÁXIMO sirve la EXTREMA para parada y la BASE para ruta",
    slug: B!.slug,
    esperado: { parada: EXTREMO_PARADA, ruta: BASE_RUTA },
  },
];

// La MISMA suite, dos veces — CERO diferencia de selector entre las dos iteraciones: solo
// cambia `caso`, nunca un `getByTestId`/`locator`.
for (const caso of CASOS) {
  test(`${caso.nombre} — data-testid/term_key estables [AC-FMIG-04]`, async ({ page }) => {
    await page.goto(`${origenDe(caso.slug)}/panel/terminologia`);

    const parada = page.getByTestId("termino-parada");
    const ruta = page.getByTestId("termino-ruta");
    await expect(parada).toBeVisible();
    await expect(ruta).toBeVisible();

    await expect(parada).toContainText(caso.esperado.parada.singular);
    await expect(ruta).toContainText(caso.esperado.ruta.singular);

    // El canónico de fábrica, entre paréntesis, SIEMPRE — el admin lo ve exista o no exista
    // override (§5.1). Es la base, NUNCA el efectivo: incluso cuando `parada` está renombrada,
    // el paréntesis sigue diciendo «parada», no «Punto extra».
    await expect(page.getByTestId("termino-canonico-parada")).toContainText(`(${BASE_PARADA.singular})`);
    await expect(page.getByTestId("termino-canonico-ruta")).toContainText(`(${BASE_RUTA.singular})`);

    // data-term-key es el ancla que el e2e usa en vez del texto — se prueba explícitamente
    // porque es la propiedad que el AC pide, no un efecto colateral de toBeVisible().
    await expect(parada).toHaveAttribute("data-term-key", "parada");
    await expect(ruta).toHaveAttribute("data-term-key", "ruta");
  });
}

test("un UPDATE de tenant_terminology lo sirve el PRÓXIMO request, sin build ni deploy [AC-FMIG-04]", async ({ page }) => {
  // "Punto B" / "Puntos B" — ambos ≤12 (LABELS.largo_max.navegacion), como exige el mismo
  // CHECK que valida EXTREMO_PARADA.
  const OTRO = { singular: "Punto B", plural: "Puntos B" };
  await con(BD_B, async ({ sql }: Conexion) => {
    await sql("update tenant_terminology set singular = $1, plural = $2 where term_key = 'parada'", [
      OTRO.singular,
      OTRO.plural,
    ]);
  });

  await page.goto(`${origenDe(B!.slug)}/panel/terminologia`);
  await expect(page.getByTestId("termino-parada")).toContainText(OTRO.singular);
  await expect(page.getByTestId("termino-parada")).not.toContainText(EXTREMO_PARADA.singular);

  // Se deja la fila como estaba, por si el gate corre este archivo más de una vez seguida en
  // la misma base sin volver a pasar por preparar-tenants.mjs.
  await con(BD_B, async ({ sql }: Conexion) => {
    await sql(
      `update tenant_terminology set singular = $1, plural = $2 where term_key = 'parada'`,
      [EXTREMO_PARADA.singular, EXTREMO_PARADA.plural],
    );
  });
});
