// El baseline de acciones de un camino feliz SIN presupuesto en el maestro [AC-FVEH-01].
//
// POR QUÉ EXISTE ESTE ARCHIVO. El §5.3 fija presupuestos para los flujos de terreno —apertura
// ≤9, cierre ≤6, entrega feliz = 2— pero no para el alta de vehículo: el §5.4 la acota por
// TIEMPO («<2 min»), no por toques. Y sin embargo la última frase del §5.3 aplica igual: «una
// feature que sube el conteo del camino feliz no se mergea». Un contrato de regresión sin
// número de referencia no es un contrato, así que el número se FIJA en el primer verde y de
// ahí en adelante se defiende.
//
// La primera corrida escribe el baseline; las siguientes lo leen y el test rebota si el
// conteo subió. Bajarlo es libre —una mejora no necesita permiso—, y cuando baja se registra
// en el histórico sin mover el techo: el techo lo baja una persona editando el artefacto, para
// que un flujo que quedó a medias por un bug no fije un baseline imposible en su lugar.
//
// El histórico se deduplica por SHA, igual que el contador de exenciones de rutas
// (`packages/metodo/panel/exenciones-rutas.historico.jsonl`, AC-FTEN-26): veinte corridas del
// gate sobre el mismo commit no dibujan una tendencia que nadie provocó.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
const PANEL = join(RAIZ, "packages", "metodo", "panel");

const archivoDe = (flujo) => join(PANEL, `acciones-${flujo}.json`);
const historicoDe = (flujo) => join(PANEL, `acciones-${flujo}.historico.jsonl`);

function shaDeHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: RAIZ, encoding: "utf8" }).trim();
  } catch {
    // Sin git (un tarball, un contenedor de CI sin historia) el baseline igual se defiende:
    // se pierde la tendencia, no el techo.
    return "sin-git";
  }
}

/** Lo que hay hoy en disco, o `null` si este flujo nunca se midió. */
export function leerBaseline(flujo) {
  const ruta = archivoDe(flujo);
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, "utf8"));
}

/**
 * Registra la medición y devuelve el veredicto contra el techo vigente.
 *
 * `{ baseline, acciones, primeraVez }` — `primeraVez` es verdadero en la corrida que FIJÓ el
 * número, que es la única en que el archivo nace. Quien llama decide qué hacer con el
 * veredicto: acá no se afirma nada, para que la aserción viva en el test y se vea en el diff.
 */
export function registrarBaseline({ flujo, ac, acciones }) {
  const previo = leerBaseline(flujo);
  const sha = shaDeHead();
  const baseline = previo ? previo.baseline : acciones;
  const primeraVez = previo === null;

  if (primeraVez) {
    writeFileSync(
      archivoDe(flujo),
      JSON.stringify({ ac, flujo, baseline, fijado_en_sha: sha }, null, 2) + "\n",
    );
  }

  const registro = { ac, flujo, sha, acciones, baseline };
  const historico = historicoDe(flujo);
  const antes = existsSync(historico) ? readFileSync(historico, "utf8") : "";
  const yaEsta = antes
    .split("\n")
    .filter(Boolean)
    .some((linea) => {
      try {
        return JSON.parse(linea).sha === sha;
      } catch {
        return false;
      }
    });
  if (!yaEsta && sha !== "sin-git") appendFileSync(historico, JSON.stringify(registro) + "\n");

  return { baseline, acciones, primeraVez };
}
