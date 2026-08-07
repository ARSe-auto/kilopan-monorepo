#!/usr/bin/env node
// verifica-es-cl.mjs — grep de gate para es-CL (specs/kilopan/09-plataforma-miga.md
// [AC-H0-09]). El contrato: kg con coma decimal, CLP con punto de miles y sin
// decimales, fechas dd-mm-aaaa, RUT validado AL ESCRIBIR (no solo al enviar), y cero
// strings visibles en inglés. `apps/kilopan/src/comun/{formato,peso,valida_rut}.ts` YA
// implementan esto (con sus propios tests unitarios) — lo que faltaba, y lo que este
// script cierra, es el guardia que impide que una pantalla nueva lo bypasee a mano
// (exactamente lo que hacía MapaPodsDia.tsx con `.toFixed(1)` antes de este AC).
//
// Uso: node verifica-es-cl.mjs [--app=kilopan]
// Exit: 0 verde · 1 alguna pantalla bypasea el formato es-CL.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const IGNORAR = new Set(["node_modules", ".git", ".claude", ".next", "dist", "build", "test-results", "playwright-report"]);
// Estos archivos SON la implementación de referencia del formato es-CL — el patrón que
// el resto del árbol tiene prohibido reproducir a mano vive legítimamente acá dentro.
export const EXCLUIR_DE_TODO = /\/comun\/(formato|peso|valida_rut)\.ts$/;

// Denylist deliberadamente corta: palabras de UI en inglés que NO tienen lectura
// legítima en un comentario o URL cuando aparecen como texto visible entre `>` y `<`
// (contenido JSX). Ampliar esta lista es baja fricción si aparece un caso nuevo.
const PALABRAS_INGLES = [
  "Cancel", "Submit", "Delete", "Save", "Loading", "Error", "Success", "Yes", "No",
  "Confirm", "Close", "Search", "Login", "Logout", "Email", "Password", "Warning",
  "Continue", "Back", "Next", "Home", "Settings", "Welcome", "Retry", "Download",
  "Upload",
];
const RE_INGLES = new RegExp(`>\\s*(${PALABRAS_INGLES.join("|")})\\s*<`);

/** Revisa UNA línea y devuelve los motivos de violación que encuentra (posiblemente
 *  ninguno). `esImplementacion` desactiva los checks de bypass para los propios
 *  comun/{formato,peso,valida_rut}.ts, que legítimamente contienen estos patrones. */
export function revisarLinea(linea, esImplementacion) {
  const motivos = [];
  if (!esImplementacion) {
    // Peso: dividir gramos por 1000 y formatear a mano da "12.5 kg" (punto, en-US) en
    // vez de "12,45 kg" (coma es-CL) — el bug real que tenía MapaPodsDia.tsx.
    if (/\/\s*1000\s*\)\.toFixed\(/.test(linea)) {
      motivos.push("gramos/1000 formateado a mano — usar formatearKg() de comun/formato.ts");
    }
    // CLP: construir el "$" a mano en vez de formatearClp() se salta el punto de
    // miles chileno (o lo hace mal si alguien copia Intl con locale por defecto).
    if (/`\$\$\{/.test(linea)) {
      motivos.push("CLP formateado a mano con `$${…}` — usar formatearClp() de comun/formato.ts");
    }
    // Fecha: extraer mes/día/año a mano en vez de formatearFecha() es cómo se cuela
    // un mm/dd/aaaa en vez de dd-mm-aaaa.
    if (/\.getMonth\(\)\s*\+\s*1/.test(linea)) {
      motivos.push("fecha armada a mano con getMonth()+1 — usar formatearFecha() de comun/formato.ts");
    }
    // toLocaleDateString/toLocaleString/toLocaleTimeString SIN "es-CL" explícito caen
    // al locale del runtime (no determinista, típicamente en-US en CI/servidor).
    if (/\.toLocale(Date|Time)?String\(/.test(linea) && !linea.includes('"es-CL"')) {
      motivos.push('toLocale*String() sin locale "es-CL" explícito');
    }
  }
  if (RE_INGLES.test(linea)) {
    motivos.push("string visible en inglés (cero strings en inglés, AC-H0-09)");
  }
  return motivos;
}

/** true si el archivo tiene un campo de RUT sin retroalimentación en vivo. Un
 *  <input placeholder="RUT…"> sin estadoRut() solo se entera de que está mal cuando el
 *  usuario ya apretó el botón — el AC exige "validado AL ESCRIBIR". */
export function faltaRutEnVivo(contenido) {
  return /<input[^>]*placeholder="[^"]*rut/i.test(contenido) && !contenido.includes("estadoRut(");
}

/** Revisa un archivo completo (contenido ya leído) y devuelve la lista de violaciones. */
export function revisarArchivo(rutaRelativa, contenido, esImplementacion) {
  const violaciones = [];
  contenido.split("\n").forEach((linea, i) => {
    for (const motivo of revisarLinea(linea, esImplementacion)) {
      violaciones.push({ archivo: rutaRelativa, linea: i + 1, texto: linea.trim(), motivo });
    }
  });
  if (faltaRutEnVivo(contenido)) {
    violaciones.push({ archivo: rutaRelativa, linea: 0, texto: "", motivo: "campo de RUT sin validación en vivo — falta estadoRut() de comun/valida_rut.ts" });
  }
  return violaciones;
}

function archivosFuente(dir) {
  const out = [];
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entradas) {
    if (IGNORAR.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...archivosFuente(full));
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// Solo ejecuta el CLI cuando se invoca directamente (`node verifica-es-cl.mjs`), no
// cuando el test lo importa como módulo para ejercer revisarArchivo() en un fixture.
if (import.meta.url === `file://${process.argv[1]}`) {
  const ROOT = new URL("../../..", import.meta.url).pathname;
  const argv = process.argv.slice(2);
  const app = argv.find((a) => a.startsWith("--app="))?.split("=")[1] ?? "kilopan";

  const RAICES = [`apps/${app}/src`, "packages/miga/src"].map((r) => join(ROOT, r));
  const archivos = RAICES.flatMap((r) => (statSync(r, { throwIfNoEntry: false }) ? archivosFuente(r) : []));

  const violaciones = archivos.flatMap((archivo) => {
    const rutaRelativa = relative(ROOT, archivo);
    const contenido = readFileSync(archivo, "utf8");
    const esImplementacion = EXCLUIR_DE_TODO.test(archivo.replace(/\\/g, "/"));
    return revisarArchivo(rutaRelativa, contenido, esImplementacion);
  });

  if (violaciones.length > 0) {
    console.error(`verifica-es-cl: ${violaciones.length} violación(es) de formato es-CL (AC-H0-09)\n`);
    for (const v of violaciones) {
      const ubic = v.linea ? `${v.archivo}:${v.linea}` : v.archivo;
      console.error(`  ${ubic} — ${v.motivo}`);
      if (v.texto) console.error(`    ${v.texto}`);
    }
    process.exit(1);
  }

  console.log(`verifica-es-cl: OK (${archivos.length} archivos revisados, 0 violaciones)`);
}
