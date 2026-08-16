import { tipografia } from "@kilopan/miga/tokens.ts";
import { tarjetasNivelCero } from "../../dominio/semaforo.ts";
import { seedA, seedC, seedVacio } from "../../dominio/semaforo-fixtures.ts";
import { filasPeekDeDominio, type FilaPeek } from "../../dominio/peek-n1.ts";
import { resolverTerminologia } from "../../dominio/hoy-terminologia.ts";
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

  return (
    <main>
      <h1 style={{ fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 }}>Hoy</h1>
      <TableroHoy
        tarjetas={tarjetas}
        peekPorDominio={peekPorDominio}
        seed={seedUsada === "vacio" ? "a" : seedUsada}
        terminologia={resolverTerminologia(terminologia)}
      />
    </main>
  );
}
