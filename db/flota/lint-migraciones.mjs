#!/usr/bin/env node
// lint-migraciones.mjs — el linter de esquema del §4.2 y del §9.2 [AC-FTEN-06].
//
// Exige, en TODA tabla de dominio (las que viven en la BD de un tenant), las CINCO cosas
// que el maestro pide y que ninguna revisión humana sostiene a lo largo de 197 ACs:
//
//   1. `tenant_id uuid NOT NULL`
//   2. CHECK contra la constante de la BD — `CHECK (tenant_id = tenant_actual())`
//   3. un índice que empiece por `tenant_id`
//   4. FK compuesta: la tabla ofrece `UNIQUE (tenant_id, id)` para ser referenciada, y toda
//      REFERENCES que declare lleva `tenant_id` adentro
//   5. `COMMENT ON TABLE … IS 'PLANIFICACIÓN…'` o `'CAPTURA…'` (la regla de oro, §4.2)
//
// POR QUÉ EL CHECK NO ES EL DEL MAESTRO, LITERAL. El §4.1 lo escribe
// `CHECK (tenant_id = (SELECT id FROM tenant_info))`, y PostgreSQL lo rechaza: «cannot use
// subquery in check constraint» (verificado contra 18.4 antes de escribir DDL). La forma
// implementable es una función IMMUTABLE con el uuid del tenant horneado como literal en la
// provisión — que además es la única segura ante `pg_restore`, donde las funciones se crean
// antes de que llegue el COPY de los datos y un CHECK que leyera una tabla fallaría fila a
// fila. Un invariante aparte verifica que `tenant_actual()` y `tenant_info.id` coincidan.
//
// LAS TABLAS DEL PLANO DE CONTROL NO SON DE DOMINIO: `control` no tiene tenant_id por
// definición (§4.1), así que las migraciones bajo `control/` se revisan con otra vara —
// solo se les exige la clase del COMMENT.
//
// Exenciones: se declaran EN la migración con `-- linter: exenta <tabla> — <razón>`, y el
// linter las CUENTA y las imprime siempre. Una exención silenciosa es un agujero; una
// contada es una decisión con dueño (§10).
//
// Uso: node db/flota/lint-migraciones.mjs [--dir=<ruta a db/migraciones-flota>]
// Exit: 0 verde · 1 alguna exigencia incumplida.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const DIR =
  process.argv.find((a) => a.startsWith("--dir="))?.split("=")[1] ?? join(RAIZ, "db/migraciones-flota");

const CLASES = ["PLANIFICACIÓN", "CAPTURA"];

let fallo = false;
const problemas = [];
const err = (archivo, tabla, msg) => {
  problemas.push(`${archivo} · ${tabla}: ${msg}`);
  fallo = true;
};

/** Quita comentarios de línea y de bloque para que no confundan al análisis. */
function sinComentarios(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
}

/** Recorta el cuerpo entre paréntesis balanceados que sigue a una posición dada. */
function cuerpoBalanceado(texto, desde) {
  const abre = texto.indexOf("(", desde);
  if (abre === -1) return null;
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")") {
      nivel--;
      if (nivel === 0) return { cuerpo: texto.slice(abre + 1, i), fin: i };
    }
  }
  return null;
}

function archivosSql(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d).sort()) {
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (entrada.endsWith(".sql")) salida.push(ruta);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return salida;
}

const archivos = archivosSql(DIR);
const exenciones = [];
let tablasDominio = 0;
let tablasControl = 0;

for (const ruta of archivos) {
  const rel = relative(RAIZ, ruta);
  const crudo = readFileSync(ruta, "utf8");
  const sql = sinComentarios(crudo);
  // Las tablas del plano de control viven bajo `control/`; las de dominio, bajo `tenant/`.
  const esControl = /(^|[\\/])control[\\/]/.test(rel);

  const exentasAqui = new Set(
    [...crudo.matchAll(/^--\s*linter:\s*exenta\s+([a-z_][a-z0-9_.]*)\s*—\s*(.+)$/gim)].map((m) => {
      exenciones.push({ archivo: rel, tabla: m[1], razon: m[2].trim() });
      return m[1];
    }),
  );

  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_.]*)/gi)) {
    const tabla = m[1];
    const cuerpoM = cuerpoBalanceado(sql, m.index + m[0].length);
    if (!cuerpoM) {
      err(rel, tabla, "no se pudo leer la definición de la tabla (¿paréntesis sin cerrar?)");
      continue;
    }
    const cuerpo = cuerpoM.cuerpo;
    const nombreCorto = tabla.includes(".") ? tabla.split(".").pop() : tabla;

    // 5. La clase de la regla de oro se exige a TODA tabla, de dominio o de control.
    const comentario = new RegExp(
      String.raw`comment\s+on\s+table\s+${tabla.replace(".", "\\.")}\s+is\s+'([^']*)'`,
      "i",
    ).exec(sql);
    if (!comentario) {
      err(rel, tabla, "sin `COMMENT ON TABLE` — el §4.2 exige clasificar cada tabla");
    } else if (!CLASES.some((c) => comentario[1].toUpperCase().startsWith(c))) {
      err(
        rel,
        tabla,
        `el COMMENT no empieza por su clase (${CLASES.join(" | ")}): «${comentario[1].slice(0, 60)}»`,
      );
    }

    if (esControl) {
      tablasControl++;
      continue;
    }
    if (exentasAqui.has(nombreCorto) || exentasAqui.has(tabla)) continue;
    tablasDominio++;

    // 1. tenant_id uuid NOT NULL
    if (!/\btenant_id\s+uuid\b[^,]*\bnot\s+null\b/i.test(cuerpo)) {
      err(rel, tabla, "sin `tenant_id uuid NOT NULL` (§4.1)");
    }

    // 2. CHECK contra la constante de la BD
    if (!/check\s*\(\s*tenant_id\s*=\s*tenant_actual\s*\(\s*\)\s*\)/i.test(cuerpo)) {
      err(rel, tabla, "sin `CHECK (tenant_id = tenant_actual())` — la constante de la BD (§4.1)");
    }

    // 3. Índices. Dos mitades, porque la primera sola no atrapa nada: la exigencia 4a ya
    //    obliga a `UNIQUE (tenant_id, id)`, que ES un índice encabezado por tenant_id — lo
    //    destapó un mutante de esta misma suite, que no lograba ponerse rojo.
    //    (a) algún índice encabezado por tenant_id;
    //    (b) y CADA FK compuesta cubierta por un índice que empiece por sus columnas:
    //        Postgres no indexa las FK solo, y una FK sin índice convierte cada borrado del
    //        padre en un scan completo del hijo.
    const indicesDeclarados = [
      ...sql.matchAll(
        new RegExp(
          String.raw`create\s+(?:unique\s+)?index[^;]*\bon\s+${tabla.replace(".", "\\.")}\s*\(([^)]*)\)`,
          "gi",
        ),
      ),
    ].map((m) => m[1].split(",").map((c) => c.trim().split(/\s+/)[0].toLowerCase()));
    for (const m2 of cuerpo.matchAll(/\b(?:primary\s+key|unique)\s*\(([^)]*)\)/gi)) {
      indicesDeclarados.push(m2[1].split(",").map((c) => c.trim().toLowerCase()));
    }
    if (!indicesDeclarados.some((cols) => cols[0] === "tenant_id")) {
      err(rel, tabla, "sin índice que empiece por `tenant_id` (§9.2)");
    }
    for (const fk of cuerpo.matchAll(/foreign\s+key\s*\(([^)]*)\)\s*references\s+([a-z_][a-z0-9_.]*)/gi)) {
      const cols = fk[1].split(",").map((c) => c.trim().toLowerCase());
      const cubierta = indicesDeclarados.some((idx) => cols.every((c, i) => idx[i] === c));
      if (!cubierta) {
        err(
          rel,
          tabla,
          `la FK (${cols.join(", ")}) hacia ${fk[2]} no tiene índice que la encabece: ` +
            "cada borrado en el padre haría scan completo de esta tabla (§9.2)",
        );
      }
    }

    // 3c. Dinero: toda columna `*_clp` es `bigint` entero (§0 fila Dinero, §4.8). [AC-FTEN-09]
    //     El sufijo ES la convención: una columna de monto se llama `<algo>_clp`, y por eso
    //     el mismo criterio sirve acá, en el catálogo de pgTAP y en la vista de quien lee.
    //     Un `numeric` en dinero no es precisión: en CLP no hay centavos, y el decimal
    //     aparece recién en el primer total que no cuadra por un peso.
    //     El tipo se recorta hasta donde TERMINA el tipo (`double precision`, `numeric(12,2)`)
    //     y no hasta la coma: leer «bigint not null» como tipo hacía fallar al positivo, que
    //     es justo el mutante que impide que este guard sea un no-op al revés.
    const TIPO = String.raw`[a-z][a-z0-9_]*(?:\s+precision)?(?:\s*\([^)]*\))?`;
    for (const col of cuerpo.matchAll(
      new RegExp(String.raw`^\s*([a-z_][a-z0-9_]*_clp)\s+(${TIPO})`, "gim"),
    )) {
      const tipo = col[2].trim().toLowerCase().replace(/\s+/g, " ");
      if (tipo !== "bigint" && tipo !== "int8") {
        err(
          rel,
          tabla,
          `la columna de dinero \`${col[1]}\` es \`${tipo}\`: todo monto es CLP bigint entero (§0)`,
        );
      }
    }

    // 4a. Ofrece (tenant_id, id) para que otras tablas la referencien compuesta.
    if (!/\b(?:primary\s+key|unique)\s*\(\s*tenant_id\s*,\s*id\s*\)/i.test(cuerpo)) {
      err(
        rel,
        tabla,
        "sin `UNIQUE (tenant_id, id)` ni PK compuesta — nadie puede referenciarla con FK compuesta (§4.1)",
      );
    }
    // 4b. Y toda FK que declare va por (tenant_id, …).
    for (const fk of cuerpo.matchAll(/foreign\s+key\s*\(([^)]*)\)\s*references\s+([a-z_][a-z0-9_.]*)/gi)) {
      if (!/\btenant_id\b/i.test(fk[1])) {
        err(rel, tabla, `la FK hacia ${fk[2]} no es compuesta: le falta tenant_id (§4.1)`);
      }
    }
    // Una REFERENCES en línea (a nivel de columna) nunca puede ser compuesta. Se excluyen
    // las palabras que abren una restricción de tabla: sin eso, `foreign key (…) references`
    // se leía como una columna llamada «foreign» y el mismo defecto se reportaba dos veces.
    const ABRE_RESTRICCION = /^(?:foreign|primary|unique|constraint|check|exclude|like)$/i;
    for (const ref of cuerpo.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+[^,\n]*\breferences\s+([a-z_][a-z0-9_.]*)/gim)) {
      if (ABRE_RESTRICCION.test(ref[1])) continue;
      err(
        rel,
        tabla,
        `la columna \`${ref[1]}\` usa REFERENCES en línea hacia ${ref[2]}: una FK de una sola columna no lleva tenant_id (§4.1)`,
      );
    }
  }
}

for (const p of problemas) console.error(`GATE: ${p}`);
for (const e of exenciones) {
  console.log(`  exención declarada: ${e.tabla} (${e.archivo}) — ${e.razon}`);
}
console.log(
  `lint-migraciones: ${archivos.length} migraciones · ${tablasDominio} tablas de dominio · ` +
    `${tablasControl} tablas de control · ${exenciones.length} exenciones · ${problemas.length} problemas`,
);
if (archivos.length === 0) {
  // Verde vacuo declarado: sin migraciones el linter no probó nada, y decirlo es la
  // diferencia entre un paso saltado y un paso verde (docs/LECCION_RALPH.md).
  console.log("lint-migraciones: SIN MIGRACIONES TODAVÍA — no se verificó ningún esquema");
}
if (fallo) {
  console.error("lint-migraciones: ROJO");
  process.exit(1);
}
console.log("lint-migraciones: VERDE");
