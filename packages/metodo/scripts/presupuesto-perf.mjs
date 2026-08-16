#!/usr/bin/env node
// AC-PERF-04: presupuesto de performance de las pantallas de la madrugada.
//
// Decisión deliberada: NO se usa Lighthouse. Lighthouse necesita Chrome headless, pesa
// ~300 MB de dependencias y su puntaje mezcla cosas que acá no aplican (SEO, PWA
// installability) con la única que importa para un maestro panadero a las 4 AM: que la
// pantalla cargue rápido con 4G malo. Se mide directamente lo que gobierna eso —el peso
// del JS que hay que bajar y parsear— contra un presupuesto explícito.
//
// Referencia del presupuesto: en 4G lento (~400 kbps efectivos) cada 100 KB son ~2 s.
// 200 KB de First Load JS ≈ 4 s hasta interactivo, que es el techo de lo tolerable
// para alguien con las manos llenas de harina.
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP = process.argv.slice(2).find((a) => a.startsWith("--app="))?.split("=")[1] ?? "kilopan";
// Se mide GZIP, no bytes crudos: es lo que de verdad viaja por la red. Medir crudo
// exagera ~3x y llevaría a poner un presupuesto falso o a "optimizar" lo que no duele.
const PRESUPUESTO_KB = 150;

// Las pantallas del flujo dorado, POR APP. Estaban cableadas a KiloPan: contra otra app
// las cuatro faltaban del manifiesto y el paso salía rojo sin decir nada útil sobre ella.
// La lista de cada app es su contrato con este presupuesto y crece cuando nacen sus
// pantallas — declarada acá y no adivinada del manifiesto, porque medir «lo que haya»
// deja de medir el día que alguien borra una ruta.
const RUTAS_CRITICAS_POR_APP = {
  kilopan: ["/pesar", "/vender", "/ruta", "/ingresar"],
  // FLOTA: el shell ("/") es el PISO de todas las pantallas de terreno del §5.2
  // —recepción, apertura de turno, parada, cierre—, que nacen en los hitos (c) a (e) y
  // entrarán a esta lista con su propio AC cuando existan como ruta propia. `/panel`,
  // `/panel/funciones` y `/panel/terminologia` son "las pantallas del hito" (g, §9.1.4)
  // que AC-FMIG-19 exige presupuestar — el mismo proxy de peso-JS-gzip que AC-PERF-04 ya
  // fijó como sustituto de Lighthouse (ver encabezado del archivo), extendido a este AC.
  flota: ["/", "/panel", "/panel/funciones", "/panel/terminologia"],
};
const RUTAS_CRITICAS = RUTAS_CRITICAS_POR_APP[APP];

function leerManifiesto() {
  const ruta = join(RAIZ, "apps", APP, ".next", "app-build-manifest.json");
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, "utf8"));
}

function pesoKb(archivos) {
  let bytes = 0;
  const vistos = new Set(); // los chunks compartidos se bajan UNA vez, no por página
  for (const archivo of archivos) {
    if (vistos.has(archivo)) continue;
    vistos.add(archivo);
    const ruta = join(RAIZ, "apps", APP, ".next", archivo);
    if (existsSync(ruta)) bytes += gzipSync(readFileSync(ruta)).length;
  }
  return Math.round(bytes / 1024);
}

function main() {
  // Una app sin lista declarada no se «salta» en silencio: sin contrato no hay medición, y
  // un OK acá diría que el flujo dorado cabe en el presupuesto sin haber pesado una línea.
  if (!RUTAS_CRITICAS?.length) {
    console.error(
      `presupuesto-perf: FALLÓ — la app "${APP}" no declara rutas críticas en RUTAS_CRITICAS_POR_APP. ` +
        `Agregarlas (o el presupuesto no vigila nada).`
    );
    process.exit(1);
  }

  const manifiesto = leerManifiesto();
  if (!manifiesto) {
    // check.sh decide si este paso se corre o se salta ANTES de invocar el script
    // (comprueba que el manifiesto exista); si de todos modos se llega hasta acá sin
    // manifiesto, decir "OK" o salir en 0 sería el mismo verde-sin-medir-nada que este
    // script existe para impedir. Sale en 1: quien lo invoque decide si eso es rojo o
    // una condición de saltado en SU propio nivel, pero nunca en silencio.
    console.error(
      `presupuesto-perf: FALLÓ — no hay build (correr \`pnpm --filter ${APP} build\` primero)`
    );
    process.exit(1);
  }

  let excedidas = 0;
  let medidas = 0;
  const faltantes = [];
  for (const ruta of RUTAS_CRITICAS) {
    // La raíz es `/page` en el manifiesto, no `//page`: normalizar sin este caso hacía
    // que la única ruta declarada de una app nueva pareciera «faltante» siempre.
    const clave = ruta === "/" ? "/page" : `/${ruta.replace(/^\//, "")}/page`;
    const archivos = manifiesto.pages?.[clave];
    if (!archivos) {
      console.log(`  FALTA  ${ruta} (no está en el manifiesto — ¿build incompleto o de \`next dev\`?)`);
      faltantes.push(ruta);
      continue;
    }
    medidas++;
    const kb = pesoKb(archivos);
    const ok = kb <= PRESUPUESTO_KB;
    if (!ok) excedidas++;
    // "PASA" se leía como aprobado cuando significaba "se pasa del presupuesto":
    // una pantalla en rojo salía rotulada con la palabra que uno busca en verde.
    console.log(`  ${ok ? "OK    " : "EXCEDE"} ${ruta}: ${kb} KB (presupuesto ${PRESUPUESTO_KB} KB)`);
  }

  // P2 (auditoría 1-ago-2026): si NINGUNA ruta aparece en el manifiesto (por ejemplo un
  // manifiesto de `next dev` que solo registra lo que el navegador visitó, o un build a
  // medias), `excedidas` se queda en 0 y el script imprimía "OK" habiendo medido CERO
  // pantallas — un verde que no verificó nada. Ahora se exige que las 4 rutas del flujo
  // dorado estén, sin excepción: si falta una, es FALLO, no "saltado".
  if (faltantes.length > 0) {
    console.error(
      `presupuesto-perf: FALLÓ — ${faltantes.length}/${RUTAS_CRITICAS.length} rutas del flujo dorado ` +
        `no están en el manifiesto (${faltantes.join(", ")}). Un build de \`next dev\` no sirve para esto: ` +
        `correr \`pnpm --filter kilopan build\` (producción) antes de este paso.`
    );
    process.exit(1);
  }
  if (excedidas > 0) {
    console.error(
      `presupuesto-perf: FALLÓ — ${excedidas} pantalla(s) del flujo dorado se pasan del presupuesto.`
    );
    process.exit(1);
  }
  console.log(`presupuesto-perf: OK (${medidas}/${RUTAS_CRITICAS.length} rutas medidas)`);
}

main();
