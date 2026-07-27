#!/usr/bin/env node
// Base aislada para el e2e: se borra, se migra y se siembra desde cero en CADA corrida.
//
// Esto NO es una comodidad, es la condición para que exista un e2e del camino dorado.
// El e2e vende, cobra y cierra caja de verdad: contra la base de desarrollo borraría el
// trabajo de quien esté probando algo, y contra la de producción sería una venta falsa
// en los libros. `.env.local` de este Mac apunta a Postgres de PRODUCCIÓN, así que el
// modo por defecto es exactamente el peligroso: de ahí el portazo de abajo.
//
// Corre como parte del `webServer` de playwright.config.ts, antes de `next dev`, para
// que el orden sea determinista: la base queda migrada y cerrada ANTES de que el
// servidor la abra. pglite es un motor embebido de un solo proceso y no admite dos.
import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const E2E = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(E2E, "..", "..", "..");

const dir = process.env.KILOPAN_PGLITE_DIR;
if (process.env.DB_MODE !== "pglite" || !dir) {
  console.error(
    "e2e: me niego a correr. Necesito DB_MODE=pglite y KILOPAN_PGLITE_DIR apuntando a una\n" +
      "base desechable. Sin las dos, `.env.local` manda y en este Mac eso es PRODUCCIÓN:\n" +
      "el camino dorado dejaría ventas y cierres de caja falsos en los libros del cliente.\n" +
      `  DB_MODE=${process.env.DB_MODE ?? "(sin definir)"}  KILOPAN_PGLITE_DIR=${dir ?? "(sin definir)"}`
  );
  process.exit(1);
}

// El aislamiento no vale si la base arrastra lo de la corrida anterior: un test que
// depende de datos que dejó otro pasa en verde por el orden y falla al correr solo.
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const correr = (script) =>
  execFileSync("node", [join(RAIZ, "db", script)], {
    cwd: RAIZ,
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  }).toString();

console.log("e2e: migrando base desechable…");
correr("migrar.mjs");
console.log("e2e: sembrando…");
correr("sembrar.mjs");

// Los ids los generan las migraciones y la semilla, así que los tests no pueden
// escribirlos a mano. Se leen acá, con la base todavía nuestra, y se dejan en un archivo
// que los specs importan. Después de este punto la base es del servidor.
const { PGlite } = await import("@electric-sql/pglite");
const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
const db = new PGlite(dir, { extensions: { pgcrypto, btree_gist } });

const uno = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const todos = async (sql, params = []) => (await db.query(sql, params)).rows;

const dispositivo = await uno(
  `select id from pan.dispositivos where nombre = 'Tablet mesón (seed)'`
);
const usuarios = Object.fromEntries(
  (await todos(`select rol, rut, id from pan.usuarios`)).map((u) => [u.rol, { rut: u.rut, id: u.id }])
);
const productos = Object.fromEntries(
  (await todos(`select nombre, id from pan.productos`)).map((p) => [p.nombre, p.id])
);

// El tramo de reparto necesita algo que repartir, y armarlo por la UI sería probar el
// alta de pedidos dentro del test de entrega. Se siembra la antesala —cliente, pedido
// confirmado y su DTE, que la BD exige para que la ruta salga (art. 55 DL 825)— y el
// test maneja de ahí en adelante, que es lo que quiere probar.
// pan.pedidos y pan.documento_tributario llevan trg_exige_sesion: exigen una sesión viva
// del par (usuario, dispositivo) que firma la fila. Es la misma regla que corre en
// producción y no se saltea ni siendo dueño de la BD, así que la antesala se arma con una
// sesión de verdad, que después se cierra para no dejar al admin logueado antes de que
// el primer test escriba su PIN.
await db.query(
  `insert into pan.sesiones_operador (dispositivo_id, usuario_id) values ($1,$2)`,
  [dispositivo.id, usuarios.admin.id]
);

const cliente = await uno(
  `insert into pan.clientes (rut, razon_social, canal, lat, lng)
   values ('76.192.083-9','Almacén Don Pepe','reparto',-33.4489,-70.6693) returning id`
);
const pedido = await uno(
  `insert into pan.pedidos (cliente_id, fecha_entrega, usuario_id, dispositivo_id)
   values ($1, current_date, $2, $3) returning id`,
  [cliente.id, usuarios.admin.id, dispositivo.id]
);
await db.query(
  `insert into pan.pedido_lineas (pedido_id, producto_id, gramos_pedidos, precio_clp)
   values ($1, $2, 20000, 1650)`,
  [pedido.id, productos.Marraqueta]
);
await db.query(`select pan.asignar_correlativo($1)`, [pedido.id]);
await db.query(`update pan.pedidos set estado = 'confirmado' where id = $1`, [pedido.id]);
// Guía de despacho (52). Sin un DTE 'registrado' por pedido, el trigger de pan.rutas no
// deja que la ruta pase a 'en_curso': art. 55 DL 825, y la multa llega al 200% de 1 UTA.
await db.query(
  `insert into pan.documento_tributario
     (tipo_dte, folio_sii, rut_emisor, rut_receptor, fecha_emision, monto_total,
      origen_captura, ind_traslado, pedido_id, usuario_id, dispositivo_id)
   values (52, 900001, '76.192.083-9', '76.192.083-9', current_date, 33000,
           'manual', 1, $1, $2, $3)`,
  [pedido.id, usuarios.admin.id, dispositivo.id]
);

// AC-PES-04: la foto por bandeja la prende el admin y no se puede apagar desde la
// pantalla de pesaje. Encendida acá para que el e2e recorra el camino CON foto — que es
// el control antifraude de verdad, y el que además cubre la cámara in-app.
await db.query(`update pan.parametros set valor = 1 where clave = 'pesaje_foto_obligatoria'`);

// AC-PES-07: frecuencias desiguales para que la grilla de /pesar tenga algo real que
// ordenar. Frica (10) > Hallulla (5) > el resto (0, sin sembrar) — bien lejos de
// cualquier incidental +1 que deje un pesaje real hecho durante el propio e2e, para que
// el test de orden no dependa de en qué momento corra respecto de los demás specs.
async function sembrarPesajes(nombreProducto, cantidad) {
  for (let i = 0; i < cantidad; i++) {
    await db.query(
      `insert into pan.pesajes
         (client_uuid, producto_id, gramos, destino, usuario_id, dispositivo_id, capturado_at)
       values (gen_random_uuid(), $1, 1000, 'mostrador', $2, $3, now())`,
      [productos[nombreProducto], usuarios.admin.id, dispositivo.id]
    );
  }
}
await sembrarPesajes("Frica", 10);
await sembrarPesajes("Hallulla", 5);

await db.query(`delete from pan.sesiones_operador`);

const datos = {
  dispositivo: { id: dispositivo.id, secreto: "demo", nombre: "Tablet mesón (seed)" },
  pin: "1234",
  usuarios,
  productos,
  cliente: { id: cliente.id, razonSocial: "Almacén Don Pepe" },
  pedido: { id: pedido.id, gramosPedidos: 20000 },
};
writeFileSync(join(E2E, "datos-semilla.json"), JSON.stringify(datos, null, 2));
await db.close();
console.log("e2e: base lista.");
