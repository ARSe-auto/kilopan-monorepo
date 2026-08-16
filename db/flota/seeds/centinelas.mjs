// Las cadenas centinela de los 3 tenants del seed §10 [AC-FMIG-18] —
// specs/flota/08-diseno-miga-onboarding.md §7, §10 y §9.3.2 del maestro.
//
// SIN IMPORTS A PROPÓSITO. Este archivo lo carga tanto el seed (que arrastra medio servidor y
// necesita cluster) como su test puro, que corre en el gate RÁPIDO. Meterle una dependencia lo
// ataría al cluster y la propiedad que verifica —la más barata de todas— dejaría de mirarse
// hasta el `--full`.
//
// ─── POR QUÉ TIENEN QUE SER DISJUNTOS ────────────────────────────────────────────────
//
// §10 pide «cadenas centinela ÚNICAS por tenant» y §9.3.2 (centinela 2) pide que el caso de
// rebote de cruce entre tenants no se conforme con un 404: hay que mirar la HUELLA de la base
// del vecino. El oráculo que eso habilita es barrer las columnas de texto de la base de un
// tenant buscando el centinela de OTRO (`huellaDeCentinela`, seeds/comun.mjs), y ese barrido
// usa `like '%centinela%'`.
//
// Ahí están las dos formas silenciosas de romperlo: si dos tenants COMPARTIERAN centinela, el
// «fila cruzada ⇒ rojo» sería verde para siempre; si el de uno fuera SUBCADENA del de otro,
// sería rojo para siempre. Ninguna de las dos se nota mirando el resultado del test — por eso
// la propiedad se verifica sola, en carga de módulo, y tiene su propio test de mutantes.

/**
 * Una por tenant. El sufijo hexadecimal no es decorativo: hace que la cadena no pueda aparecer
 * por accidente en un dato de plantilla ni en un texto escrito a mano, que es lo único que
 * distingue un centinela de una palabra común.
 */
export const CENTINELAS = Object.freeze({
  a: "CENTINELA-EAUTO-A4d1",
  b: "CENTINELA-RUTAPAN-B7f2",
  c: "CENTINELA-MIFLOTA-C3a9",
});

/** Largo mínimo para que la cadena no aparezca por azar en un texto de negocio. */
const LARGO_MINIMO = 12;

/**
 * Los motivos por los que un juego de centinelas NO sirve como oráculo de cruce; lista vacía =
 * sirve. Pura y con el juego por parámetro, para que el test pueda pasarle mutantes en vez de
 * verificar solamente el juego real (que hoy está bien y no probaría nada).
 */
export function centinelasNoDisjuntos(centinelas = CENTINELAS) {
  const motivos = [];
  const entradas = Object.entries(centinelas);

  for (const [tenant, valor] of entradas) {
    if (typeof valor !== "string" || valor.length < LARGO_MINIMO) {
      motivos.push(
        `el centinela del tenant ${tenant} («${valor}») no llega a ${LARGO_MINIMO} caracteres: ` +
          "demasiado corto para no aparecer por azar en un texto de negocio",
      );
    }
  }

  for (const [tenantA, valorA] of entradas) {
    for (const [tenantB, valorB] of entradas) {
      if (tenantA === tenantB) continue;
      if (valorA === valorB) {
        motivos.push(
          `los tenants ${tenantA} y ${tenantB} comparten el centinela «${valorA}»: el cruce entre ` +
            "ellos sería verde siempre",
        );
      } else if (typeof valorA === "string" && String(valorB).includes(valorA)) {
        motivos.push(
          `el centinela de ${tenantA} («${valorA}») es subcadena del de ${tenantB} («${valorB}»): ` +
            "el barrido `like` daría cruce siempre",
        );
      }
    }
  }

  return motivos;
}

const rotos = centinelasNoDisjuntos();
if (rotos.length > 0) {
  throw new Error(`seeds/centinelas.mjs: los centinelas del §10 no sirven como oráculo:\n- ${rotos.join("\n- ")}`);
}
