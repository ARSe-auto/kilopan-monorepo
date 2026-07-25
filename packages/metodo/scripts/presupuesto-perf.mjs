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
// Se mide GZIP, no bytes crudos: es lo que de verdad viaja por la red. Medir crudo
// exagera ~3x y llevaría a poner un presupuesto falso o a "optimizar" lo que no duele.
const PRESUPUESTO_KB = 150;

// Las pantallas del flujo dorado. Si alguna se pasa, el gate se pone rojo.
const RUTAS_CRITICAS = ["/pesar", "/vender", "/ruta", "/ingresar"];

function leerManifiesto() {
  const ruta = join(RAIZ, "apps", "kilopan", ".next", "app-build-manifest.json");
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, "utf8"));
}

function pesoKb(archivos) {
  let bytes = 0;
  const vistos = new Set(); // los chunks compartidos se bajan UNA vez, no por página
  for (const archivo of archivos) {
    if (vistos.has(archivo)) continue;
    vistos.add(archivo);
    const ruta = join(RAIZ, "apps", "kilopan", ".next", archivo);
    if (existsSync(ruta)) bytes += gzipSync(readFileSync(ruta)).length;
  }
  return Math.round(bytes / 1024);
}

function main() {
  const manifiesto = leerManifiesto();
  if (!manifiesto) {
    console.log("presupuesto-perf: SALTADO — no hay build (correr `pnpm --filter kilopan build` primero)");
    return;
  }

  let excedidas = 0;
  for (const ruta of RUTAS_CRITICAS) {
    const clave = `/${ruta.replace(/^\//, "")}/page`;
    const archivos = manifiesto.pages?.[clave];
    if (!archivos) {
      console.log(`  —     ${ruta} (no está en el manifiesto todavía)`);
      continue;
    }
    const kb = pesoKb(archivos);
    const ok = kb <= PRESUPUESTO_KB;
    if (!ok) excedidas++;
    console.log(`  ${ok ? "OK  " : "PASA"} ${ruta}: ${kb} KB (presupuesto ${PRESUPUESTO_KB} KB)`);
  }

  if (excedidas > 0) {
    console.error(
      `presupuesto-perf: FALLÓ — ${excedidas} pantalla(s) del flujo dorado se pasan del presupuesto.`
    );
    process.exit(1);
  }
  console.log("presupuesto-perf: OK");
}

main();
