#!/usr/bin/env node
// Gate de los documentos que el contrato exige que EXISTAN y digan ciertas cosas.
//
// Varios ACs de FLOTA entregan un documento y no código: el runbook de brechas (AC-FTEN-25) y
// la instancia dedicada (AC-FTEN-23) entre ellos. Un documento no se puede probar con un test
// de comportamiento, pero sí se puede exigir que exista, que tenga sus secciones mínimas y que
// diga las cosas que el AC nombra — que es la diferencia entre un runbook y un archivo vacío
// con el nombre correcto.
//
// La tabla de abajo ES el contrato. Agregar un documento acá es un acto visible en el diff.
//
// Uso: node db/flota/gate-documentos.mjs [--raiz=<ruta>]
// Exit: 0 verde · 1 falta un documento, una sección o una exigencia.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ_REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export const DOCUMENTOS = [
  {
    ac: "AC-FTEN-25",
    archivo: "docs/runbook-brechas.md",
    // Secciones mínimas del §7.8, una por una: si el runbook pierde una, se nota acá y no el
    // día del incidente.
    secciones: [
      "Responsable",
      "Detección",
      "Contención",
      "Evaluación de alcance POR TENANT",
      "Preservación de evidencia y registro inmutable",
      "Comunicación al tenant afectado",
    ],
    // Y lo que el AC exige que DIGA, no solo que titule.
    exigencias: [
      { nombre: "el plazo de 72 h dictado por el dueño", patron: /72\s*horas?|72\s*h\b/i },
      { nombre: "los dos canales: correo y panel", patron: /correo/i },
      { nombre: "el aviso persistente en el panel", patron: /panel/i },
      { nombre: "el responsable nombrado", patron: /Alexis/ },
      { nombre: "la remisión a la segregación por tenant (AC-FTEN-16)", patron: /AC-FTEN-16/ },
      { nombre: "el enmascarado de RUT y la ausencia de PIN en logs (§7.8)", patron: /RUT/ },
      { nombre: "que el alcance se evalúa por tenant", patron: /por tenant/i },
      // Exigencia de AC-FTEN-16 que cae sobre este documento: «backups por BD tenant
      // documentados en el runbook del repo».
      { nombre: "los backups por BD tenant (AC-FTEN-16)", patron: /backups por BD tenant/i },
    ],
  },
  {
    ac: "AC-FTEN-23",
    archivo: "docs/instancia-dedicada.md",
    secciones: [
      "Condición: DOCUMENTADA, no construida en el MVP",
      "Qué es",
      "Qué habría que construir cuando toque",
    ],
    // Las tres cosas que el AC nombra literalmente: misma plantilla, otro host, y que NO está
    // construida. Sin la tercera, el documento se leería como una promesa de producto.
    exigencias: [
      { nombre: "que se provisiona desde la MISMA tenant_template", patron: /misma\s+`?tenant_template`?/i },
      { nombre: "que corre en otro host", patron: /otro\s+host/i },
      { nombre: "que NO se construye en el MVP", patron: /no se construye en E1|no construida en el MVP/i },
    ],
  },
];

export function revisar(raiz = RAIZ_REPO, documentos = DOCUMENTOS) {
  const problemas = [];
  for (const doc of documentos) {
    const ruta = join(raiz, doc.archivo);
    if (!existsSync(ruta)) {
      problemas.push(`${doc.archivo}: no existe, y el contrato lo exige (${doc.ac})`);
      continue;
    }
    const texto = readFileSync(ruta, "utf8");
    for (const seccion of doc.secciones) {
      // Encabezado markdown, en cualquier nivel: lo que se exige es la sección, no su rango.
      const encabezado = new RegExp(
        `^#{1,6}\\s+${seccion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
        "im",
      );
      if (!encabezado.test(texto)) {
        problemas.push(`${doc.archivo}: sin la sección «${seccion}» (${doc.ac})`);
      }
    }
    for (const ex of doc.exigencias ?? []) {
      if (!ex.patron.test(texto)) {
        problemas.push(`${doc.archivo}: no dice ${ex.nombre} (${doc.ac})`);
      }
    }
  }
  return problemas;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raiz = process.argv.find((a) => a.startsWith("--raiz="))?.split("=")[1] ?? RAIZ_REPO;
  const problemas = revisar(raiz);
  for (const p of problemas) console.error(`GATE: ${p}`);
  const secciones = DOCUMENTOS.reduce((n, d) => n + d.secciones.length, 0);
  const exigencias = DOCUMENTOS.reduce((n, d) => n + (d.exigencias?.length ?? 0), 0);
  console.log(
    `gate-documentos: ${DOCUMENTOS.length} documento(s) · ${secciones} secciones · ` +
      `${exigencias} exigencias · ${problemas.length} problemas`,
  );
  if (DOCUMENTOS.length === 0) {
    // Verde vacuo declarado: sin documentos en la tabla, este gate no revisó nada.
    console.log("gate-documentos: SIN DOCUMENTOS EN EL CONTRATO — no se verificó ninguno");
  }
  if (problemas.length > 0) {
    console.error("gate-documentos: ROJO");
    process.exit(1);
  }
  console.log("gate-documentos: VERDE");
  process.exit(0);
}
