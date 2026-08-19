import { tipografia, superficie } from "@kilopan/miga/tokens.ts";
import { tarjetasNivelCero } from "../../dominio/semaforo.ts";
import { seedA, seedC, seedVacio } from "../../dominio/semaforo-fixtures.ts";
import { filasPeekDeDominio, type FilaPeek } from "../../dominio/peek-n1.ts";
import { resolverTerminologia } from "../../dominio/hoy-terminologia.ts";
import { modulosNavegables, entitlementsDeModo } from "../../dominio/manifest.ts";
import { TableroHoy } from "./tablero-de-hoy.tsx";

// «Hoy» — home del dueño del tenant (§5.2-F6), Nivel 0 [AC-FSEM-01].
//
// El `GET /api/semaforo/digest` que evalúa `signal_rule` contra las señales reales del
// tenant es de AC-FSEM-06/09 y depende de `signal_rule`, que nace en el módulo 00 (hito a) —
// tabla que esta iteración NO crea, porque el esquema es de sesión supervisada (AGENTS.md).
// Mientras esa tubería no exista, esta pantalla renderiza sobre las semillas del maestro
// (`?seed=a` → tenant `daas` con SLA, `?seed=c` → tenant `mi_flota`, `?seed=vacio` → tenant sin
// dominios evaluados [AC-FSEM-12], default `a`) para que el Nivel 0 —qué tarjetas van y cómo se
// resumen— se pueda construir y probar de verdad hoy. `?terminologia=extremo` [AC-FSEM-12]
// resuelve la variante «tenant B» de `dominio/hoy-terminologia.ts` sobre las MISMAS tarjetas,
// sin tocar un solo `data-testid`. El e2e autenticado contra el digest real queda pendiente,
// mismo patrón que AC-FSEM-24 para el plano cross-tenant de e-auto.
//
// El manifest de módulos [AC-FPOR-03] cuelga de la MISMA semilla: seed `c` es el tenant C del
// maestro (`mi_flota`), seed `a`/`vacio` son `daas`. Se resuelve ACÁ, en el Server Component, y
// se pasa ya filtrado — nunca un fetch en el cliente que muestre el grupo DaaS un instante y lo
// retire después. Sin ese fetch, no hay parpadeo posible: el e2e (`manifest-contraccion.spec.ts`)
// lo verifica de forma mecánica igual, con un `MutationObserver` instalado antes de navegar.
export default async function Hoy({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string; terminologia?: string }>;
}) {
  const { seed, terminologia } = await searchParams;
  const seedUsada = seed === "c" ? "c" : seed === "vacio" ? "vacio" : "a";
  const estados = seedUsada === "c" ? seedC() : seedUsada === "vacio" ? seedVacio() : seedA();
  const tarjetas = tarjetasNivelCero(estados);
  // Peek N1 [AC-FSEM-04]: plano, no un `Map` — cruza el borde servidor/cliente hacia
  // `TableroHoy` ("use client") y RSC no serializa un `Map`.
  const peekPorDominio: Record<string, FilaPeek[]> = Object.fromEntries(
    estados.map((estado) => [estado.clave, filasPeekDeDominio(estado)]),
  );
  const modo = seedUsada === "c" ? "mi_flota" : "daas";
  const modulos = modulosNavegables(entitlementsDeModo(modo));

  return (
    <main>
      <h1 style={{ fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 }}>Hoy</h1>
      <nav data-testid="manifest-modulos" aria-label="Módulos">
        {modulos.map((m) => (
          // `color` explícito y no el del user-agent: sin él, en modo oscuro WebKit le da a un
          // `<a>` su lavanda de sistema (#9e9eff) mientras el fondo de la página sigue claro, y
          // el contraste cae a 2.38 — axe lo reporta y el gate se pone rojo por una pantalla que
          // nadie tocó. Mismo token que ya usa la nav del portal (`cliente/layout.tsx`).
          <a
            key={m.clave}
            data-testid="modulo-nav"
            data-modulo={m.clave}
            href={m.ruta}
            style={{ color: superficie.texto }}
          >
            {m.titulo}
          </a>
        ))}
      </nav>
      <TableroHoy
        tarjetas={tarjetas}
        peekPorDominio={peekPorDominio}
        seed={seedUsada === "vacio" ? "a" : seedUsada}
        terminologia={resolverTerminologia(terminologia)}
      />
    </main>
  );
}
