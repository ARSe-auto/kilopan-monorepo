#!/usr/bin/env node
// Ensayo EN SECO de las migraciones pendientes contra la base real. Siempre termina
// en ROLLBACK: nunca deja nada aplicado.
//
// Por qué existe (incidente del 26-jul-2026): el Dockerfile arranca con
//   CMD node apps/kilopan/db/migrar.mjs && node apps/kilopan/server.js
// o sea que una migración que no puede aplicarse NO es un aviso, es un deploy caído:
// el servidor nunca arranca, el healthcheck se agota y el contenedor entra en
// crash-loop. Ese día la 0011 no pudo crear el índice único
// `rutas_una_activa_por_repartidor_dia` porque en producción había 3 rutas del mismo
// repartidor y la misma fecha sin cerrar — datos que el propio bug que esa migración
// viene a impedir había dejado ahí. El gate no lo detectó porque `check.sh` nunca
// aplica migraciones y `db/test-invariantes.mjs` usa una PGlite EN MEMORIA, o sea una
// base vacía: los datos reales de producción no participaban de ninguna verificación.
//
// El ensayo aplica cada migración pendiente dentro de una transacción y hace rollback,
// así que detecta CUALQUIER motivo de fallo (constraint violado por datos existentes,
// objeto duplicado, permisos), no solo los que a alguien se le ocurrió anticipar.
//
// Uso:  node db/preflight-migraciones.mjs        (respeta DB_MODE/.env.local igual que migrar.mjs)
// Sale con código 1 si alguna migración pendiente NO podría aplicarse.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { conectar } from "./migrar.mjs";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const MIGRACIONES_DIR = join(RAIZ, "migraciones");

const { db, modo, cerrar } = await conectar();
console.log(`preflight: modo=${modo}`);

let salida = 0;
try {
  const aplicadas = new Set(
    (await db.query(`select archivo from pan.migraciones_aplicadas`)).rows.map((r) => r.archivo)
  );
  const pendientes = readdirSync(MIGRACIONES_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !aplicadas.has(f));

  if (pendientes.length === 0) {
    console.log("preflight: no hay migraciones pendientes — nada que ensayar.");
  } else {
    console.log(`preflight: ${pendientes.length} pendiente(s): ${pendientes.join(", ")}\n`);
  }

  // Las pendientes se ensayan ENCADENADAS dentro de UNA sola transacción: la 0013
  // puede depender de la 0012, así que probarlas por separado contra el esquema
  // actual daría falsos fallos. Al final, rollback de todo.
  if (pendientes.length > 0) {
    await db.exec("begin");
    try {
      for (const archivo of pendientes) {
        const sql = readFileSync(join(MIGRACIONES_DIR, archivo), "utf8");
        try {
          await db.exec(sql);
          console.log(`  OK  ${archivo}`);
        } catch (err) {
          salida = 1;
          console.log(`  !!  ${archivo} — NO se puede aplicar`);
          console.log(`        ${err.message}`);
          if (err.detail) console.log(`        detalle:    ${err.detail}`);
          if (err.hint) console.log(`        sugerencia: ${err.hint}`);
          if (err.constraint) console.log(`        constraint: ${err.constraint}`);
          // Una vez que la transacción aborta, el resto no se puede evaluar.
          console.log(`        (el ensayo se detiene acá: la transacción quedó abortada)`);
          break;
        }
      }
    } finally {
      await db.exec("rollback").catch(() => undefined);
    }
  }
} catch (err) {
  salida = 1;
  console.error("preflight: no se pudo completar:", err.message);
} finally {
  await cerrar();
}

console.log(
  salida === 0
    ? "\npreflight: VERDE — las migraciones pendientes se aplicarían sin problema."
    : "\npreflight: ROJO — desplegar así deja el contenedor en crash-loop (migrar.mjs && server.js)."
);
process.exit(salida);
