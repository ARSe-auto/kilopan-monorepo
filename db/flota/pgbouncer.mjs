#!/usr/bin/env node
// Config de PgBouncer GENERADA desde `control.tenants` [AC-FTEN-05].
//
// El §4.1 pone a cada tenant en su propia base. PgBouncer es multi-database, así que el
// destino se elige por nombre de base y la app no cambia una línea entre desarrollo (Postgres
// directo) y producción (PgBouncer delante). Lo que este archivo agrega es lo que un pool
// compartido no puede dar: un LÍMITE POR TENANT. Sin él, un tenant con un pico se lleva
// puesto el cupo de conexiones de todos los demás — el aislamiento físico del §4.1 se
// mantendría en los datos y se perdería en la disponibilidad.
//
// Escrita a mano, esta config se desincroniza el día que entra un tenant nuevo, y el
// síntoma es que ese tenant simplemente no puede conectarse. Por eso se GENERA del registro
// y por eso el gate compara la generada contra `control`.
//
// Uso: node db/flota/pgbouncer.mjs generar [--salida=<ruta>]
// Exit: 0 · 1 si no se pudo leer el registro.
import { writeFileSync } from "node:fs";
import { con, BD_CONTROL, CLUSTER_LOCAL } from "./conectar.mjs";

/**
 * Cupo de conexiones de servidor por tenant.
 *
 * Es un parámetro de INFRAESTRUCTURA, no una cifra de la familia §0: no describe una regla
 * de negocio sino cuánto hierro se le presta a cada cuenta. Se deriva así: el cuello de
 * botella es `max_connections` del servidor Postgres, y en modo transacción cada conexión de
 * servidor atiende a muchas de cliente. Veinte por tenant deja atender picos sin que un solo
 * tenant pueda tomar una fracción apreciable del cluster.
 *
 * Un tenant que necesite otro número es una columna en `control.tenants` el día que un
 * tenant lo necesite — hoy ninguno lo necesita, y una columna sin usuario es una columna que
 * nadie mantiene.
 */
export const POOL_POR_TENANT = 20;

/** Estados que reciben tráfico. Un suspendido o un archivado no se sirven (Pregunta 9). */
const ESTADOS_SERVIDOS = new Set(["activo"]);

/**
 * Arma el texto de la config. Separada de la lectura de la BD para que los mutantes puedan
 * ejercerla sin cluster: el generador es un formateador, y un formateador se prueba con
 * datos, no con infraestructura.
 */
export function componer(tenants, { host, puerto } = CLUSTER_LOCAL) {
  const lineas = [
    "; GENERADO por db/flota/pgbouncer.mjs desde control.tenants — no editar a mano.",
    "; Un límite de pool POR TENANT (§4.1, AC-FTEN-05): sin él, el pico de una cuenta se",
    "; lleva puesto el cupo de todas las demás.",
    "[databases]",
  ];

  const servidos = [];
  const excluidos = [];
  for (const t of [...tenants].sort((a, b) => a.slug.localeCompare(b.slug))) {
    if (ESTADOS_SERVIDOS.has(t.estado)) {
      servidos.push(t);
      lineas.push(`${t.bd} = host=${host} port=${puerto} dbname=${t.bd} pool_size=${POOL_POR_TENANT}`);
    } else {
      excluidos.push(t);
    }
  }

  // Los NO servidos se declaran, jamás se omiten en silencio: quien lea esta config tiene que
  // poder distinguir «este tenant no existe» de «este tenant está suspendido y por eso no
  // tiene entrada». Van como comentario y no como entrada con cupo 0 porque en PgBouncer
  // `pool_size=0` significa «usá el default», que es exactamente lo contrario de lo buscado.
  if (excluidos.length) {
    lineas.push("");
    lineas.push("; Sin entrada a propósito — no reciben tráfico (control.tenants.estado):");
    for (const t of excluidos) lineas.push(`;   ${t.bd} — ${t.estado}`);
  }

  lineas.push(
    "",
    "[pgbouncer]",
    "pool_mode = transaction",
    `listen_addr = ${host}`,
    "listen_port = 6432",
    "auth_type = scram-sha-256",
    "auth_file = /etc/pgbouncer/userlist.txt",
    // Techo global: la suma de los pools por tenant puede superar lo que el servidor
    // aguanta, y sin este número el que se cae es Postgres, no PgBouncer.
    `max_db_connections = ${POOL_POR_TENANT * Math.max(servidos.length, 1)}`,
    "",
  );
  return lineas.join("\n");
}

/** Lee el registro de tenants. Todos, con su estado: la exclusión se decide al componer. */
export async function tenantsRegistrados() {
  return await con(BD_CONTROL, (control) =>
    control.sql("select slug, bd, estado::text as estado from tenants order by slug"),
  );
}

async function principal(args) {
  const salida = args.find((a) => a.startsWith("--salida="))?.split("=")[1];
  const tenants = await tenantsRegistrados();
  const texto = componer(tenants);
  if (salida) {
    writeFileSync(salida, texto);
    console.log(`pgbouncer: ${tenants.length} tenant(s) registrados → ${salida}`);
  } else {
    process.stdout.write(texto);
  }
}

if (process.argv[1]?.endsWith("pgbouncer.mjs")) {
  await principal(process.argv.slice(2));
  process.exit(0);
}
