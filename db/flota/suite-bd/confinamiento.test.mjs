#!/usr/bin/env node
// El rol `cliente` confinado a SU empresa, con el rol de app real [AC-FRUT-12].
//
// Esto NO se puede probar con pgTAP ni con el e2e: los dos corren como superusuario, y a un
// superusuario la RLS no se le aplica. Hace falta `app_t_<slug>` —NOSUPERUSER, NOBYPASSRLS— que
// es el sujeto real del §7.2 y del §9.3.3. Es la misma vía por la que se cerró la RLS de dinero
// (AC-FTEN-21) y la de grupos, y por la misma razón.
//
// ─── LO QUE SE EJERCE ─────────────────────────────────────────────────────────────
//
// «Dentro del tenant, sesión `cliente` de la empresa X ⇒ 0 filas de la empresa Y en toda tabla
// del módulo» (§9.3.3). Sobre las cinco tablas que hoy existen —`encargos`, `items`, `paradas`,
// `rutas` y `posiciones`— y con el caso que decide si sirve de algo: la parada AGRUPADA, donde
// las dos empresas comparten destino y cada una tiene que ver solo su pedazo.
//
// Cada negativo lleva su positivo. Sin ellos, «0 filas de la otra empresa» lo cumpliría una
// política que devuelve cero filas siempre, y el portal del contratante del módulo 07 nacería
// mostrando una pantalla vacía que nadie sabría explicar.
//
// `posiciones` es distinta a las otras cuatro: no tiene `empresa_cliente_id` que recortar —una
// posición es del VEHÍCULO, no de una empresa puntual—, así que su caso no tiene positivo propio
// (no hay «su» posición para un contratante) y es 0 filas SIEMPRE, mismo patrón que `rutas`
// [AC-FTEL-05, §4.3].
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar, desalta } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_confinamiento";

let tenant;
let app;
let migrador;
/** Los ids del fixture, resueltos en `before`. */
const id = {
  suya: "",
  ajena: "",
  suEncargo: "",
  encargoAjeno: "",
  ruta: "",
  parada: "",
  vehiculo: "",
  turno: "",
  posicion: "",
};

/**
 * Corre `fn` declarando quién pregunta, igual que `enLectura`/`enActo` de la app.
 *
 * `set_config(..., true)` es LOCAL a la transacción: un `set` de sesión sobreviviría a la
 * conexión y la consulta siguiente heredaría el rol de la anterior.
 */
async function comoCliente(empresa, fn) {
  await app.sql("begin");
  try {
    await app.sql("select set_config('app.current_role', 'cliente', true)");
    await app.sql("select set_config('app.current_empresa', $1, true)", [empresa ?? ""]);
    return await fn();
  } finally {
    await app.sql("commit");
  }
}

/** Sin rol declarado: el operador, el chofer y el dueño. La política no los toca. */
async function sinRolDeclarado(fn) {
  await app.sql("begin");
  try {
    return await fn();
  } finally {
    await app.sql("commit");
  }
}

async function limpiar() {
  // Complemento del alta en `control.tenants` [AC-FPOR-01]: sin esto, la fila sobrevive al
  // DROP DATABASE y el job exportador la reporta huérfana en la corrida siguiente.
  await desalta(SLUG);
  await con("postgres", ({ sql }) => sql(`drop database if exists ${bdDeTenant(SLUG)} with (force)`));
  await borrarRolDeApp(SLUG);
}

before(async () => {
  try {
    await con("postgres", ({ sql }) => sql("select 1"));
  } catch (e) {
    throw new Error(
      `no hay cluster de FLOTA en 127.0.0.1:54331 (${e.message}). ` +
        "Levantalo con `bash db/flota/cluster.sh iniciar` — esta suite no se salta.",
    );
  }
  await limpiar();
  tenant = await provisionar(SLUG, { recrear: true });
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });

  const una = async (texto, params = []) => (await migrador.sql(texto, params))[0];

  id.suya = (
    await una(
      "insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería del cliente') returning id::text as id",
    )
  ).id;
  id.ajena = (
    await una(
      "insert into empresas_cliente (rut, razon_social) values ('77.222.222-K', 'Pastelería de al lado') returning id::text as id",
    )
  ).id;
  const destino = (
    await una("insert into destinos (nombre) values ('Sucursal compartida') returning id::text as id")
  ).id;

  id.suEncargo = (
    await una(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 12) returning id::text as id",
      [id.suya, destino],
    )
  ).id;
  id.encargoAjeno = (
    await una(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 8) returning id::text as id",
      [id.ajena, destino],
    )
  ).id;

  // La parada AGRUPADA: las dos empresas al mismo destino. Es el caso del §3.E1.5 y el que
  // decide si el confinamiento sirve — con paradas separadas, esconder la ajena sería trivial.
  id.ruta = (
    await una("insert into rutas (nombre) values ('Ruta de la madrugada') returning id::text as id")
  ).id;
  id.parada = (
    await una(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [id.ruta, destino],
    )
  ).id;
  for (const encargo of [id.suEncargo, id.encargoAjeno]) {
    await migrador.sql(
      "insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 1)",
      [id.parada, encargo],
    );
  }

  // Un vehículo EN RUTA con una posición encima — el fixture de AC-FTEL-05: la torre de control
  // (AC-FTEL-04) es lo único que hoy lee `posiciones`, y es del gestor, jamás del contratante.
  id.vehiculo = (
    // La patente va sin guion: `vehiculos_patente_normalizada` (0016) exige `^[A-Z0-9]{4,12}$`.
    await una("insert into vehiculos (patente, tipo) values ('CFTL05', 'furgon') returning id::text as id")
  ).id;
  const config = (await una("select crear_config_version('fixture AC-FTEL-05')::text as id")).id;
  id.turno = (
    await una(
      "insert into turnos (vehiculo_id, config_version_id) values ($1, $2) returning id::text as id",
      [id.vehiculo, config],
    )
  ).id;
  id.posicion = (
    await una(
      "insert into posiciones (turno_id, lat, lng) values ($1, -33.45, -70.66) returning id::text as id",
      [id.turno],
    )
  ).id;

  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

test("[AC-FRUT-12] el patrón deja las tablas con RLS y sus DOS políticas", async () => {
  for (const tabla of ["encargos", "items", "paradas", "rutas", "posiciones"]) {
    const [{ rls }] = await migrador.sql(
      "select relrowsecurity as rls from pg_class where relname = $1",
      [tabla],
    );
    assert.equal(rls, true, `${tabla} quedó sin RLS: el confinamiento no se aplicó`);

    const politicas = await migrador.sql(
      "select polname, polpermissive from pg_policy where polrelid = $1::regclass order by polname",
      [tabla],
    );
    // Una PERMISSIVE base que deja pasar todo y una RESTRICTIVE que confina. Sin la base, la
    // tabla quedaría cerrada para todos: PostgreSQL sin políticas permisivas no devuelve nada.
    assert.equal(politicas.length, 2, `${tabla}: se esperaban dos políticas`);
    assert.equal(politicas.filter((p) => p.polpermissive).length, 1, `${tabla}: falta la base`);
    assert.equal(politicas.filter((p) => !p.polpermissive).length, 1, `${tabla}: falta la restrictiva`);
  }
});

test("[AC-FRUT-12] el contratante ve SUS encargos y ninguno de la otra empresa", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from encargos");
    const ids = filas.map((f) => f.id);
    // El positivo primero: si viera cero, todo lo demás lo cumpliría una política rota.
    assert.ok(ids.includes(id.suEncargo), "el contratante no ve su propio encargo");
    assert.ok(!ids.includes(id.encargoAjeno), "el contratante VE el encargo de otra empresa");
  });
});

test("[AC-FRUT-12] en la parada agrupada ve SOLO sus ítems, no los del vecino", async () => {
  await comoCliente(id.suya, async () => {
    const items = await app.sql("select empresa_cliente_id::text as empresa from items");
    // Es EL caso del §3.E1.5: una sola parada con la carga de dos empresas. Que la vea no puede
    // significar que vea lo que el vecino le manda a ese mismo local — cuánto pan pone la
    // competencia en la misma sucursal es exactamente lo que no puede saber.
    assert.equal(items.length, 1, "el contratante ve ítems de otra empresa en la parada agrupada");
    assert.equal(items[0].empresa, id.suya);

    // Y la parada SÍ la ve: es suya también, porque lleva carga suya.
    const paradas = await app.sql("select id::text as id from paradas");
    assert.deepEqual(paradas.map((p) => p.id), [id.parada]);
  });
});

test("[AC-FRUT-12] el contratante no ve NINGUNA ruta (§3.E1.10)", async () => {
  await comoCliente(id.suya, async () => {
    const rutas = await app.sql("select id::text as id from rutas");
    // Por qué otras doce puertas pasa el camión que le lleva el pan es información del negocio
    // del transportista, no suya.
    assert.equal(rutas.length, 0, "el contratante ve rutas completas");
  });
});

test("[AC-FTEL-05] el contratante no ve NINGUNA posición (§4.3): 0 filas, con el rol de app real", async () => {
  await comoCliente(id.suya, async () => {
    const posiciones = await app.sql("select id::text as id from posiciones");
    // A diferencia de `rutas`, acá no hay un caso positivo que probar primero — no existe «su»
    // posición para ningún contratante, es 0 filas para CUALQUIER empresa declarada.
    assert.equal(posiciones.length, 0, "el contratante ve posiciones del vehículo");
  });

  // Sin empresa declarada tampoco: la política mira el ROL, no la empresa, así que el que
  // olvidó declarar la suya no se cuela por el hueco que sí abriría un `empresa_cliente_id`
  // nulo en las otras cuatro tablas.
  await comoCliente(null, async () => {
    const posiciones = await app.sql("select id::text as id from posiciones");
    assert.equal(posiciones.length, 0, "un `cliente` sin empresa declarada ve posiciones");
  });

  // Y tampoco puede ESCRIBIR una: la política es RESTRICTIVE FOR ALL, no solo FOR SELECT, así
  // que su `using` vale también de `with check` y el INSERT rebota (mismo criterio que
  // `sin_rutas_para_el_cliente` en la 0040). Defensa en profundidad: hoy ningún camino de
  // escritura del contratante toca `posiciones` — el que captura es el chofer.
  // El UPDATE no se prueba acá porque no hay nada que probar: `posiciones` es append-only y
  // el rol de app no tiene el privilegio para NINGÚN rol de aplicación (42501 antes de RLS).
  await comoCliente(id.suya, async () => {
    await assert.rejects(
      () =>
        app.sql("insert into posiciones (turno_id, lat, lng) values ($1, -33.46, -70.65)", [
          id.turno,
        ]),
      /row-level security|permission denied/i,
      "el contratante insertó una posición",
    );
  });
});

test("[AC-FRUT-12] un cliente SIN empresa declarada no ve nada: la falla es hacia el cierre", async () => {
  await comoCliente(null, async () => {
    for (const tabla of ["encargos", "items", "paradas"]) {
      const filas = await app.sql(`select 1 from ${tabla}`);
      // Una sesión de cliente sin empresa es un error de programación, y el modo seguro de un
      // error de programación es no mostrar datos — nunca mostrarlos todos.
      assert.equal(filas.length, 0, `${tabla}: un cliente sin empresa vio filas`);
    }
  });
});

test("[AC-FRUT-12] sin rol declarado la política NO estorba: el operador ve todo", async () => {
  await sinRolDeclarado(async () => {
    const encargos = await app.sql("select id::text as id from encargos");
    const ids = encargos.map((f) => f.id);
    // Lo que se confina es un rol concreto, no todo el que no se identifique. Confinar por
    // defecto habría dejado la app entera a ciegas hasta que cada consulta declarara quién es —
    // y una app a ciegas se arregla apagando la política, que es el peor final posible.
    assert.ok(ids.includes(id.suEncargo) && ids.includes(id.encargoAjeno));
    const rutas = await app.sql("select id::text as id from rutas");
    assert.equal(rutas.length, 1, "el operador no ve la ruta del día");

    const posiciones = await app.sql("select id::text as id from posiciones");
    assert.deepEqual(
      posiciones.map((p) => p.id),
      [id.posicion],
      "el operador (sin rol `cliente`) no ve la posición del vehículo",
    );
  });
});

test("[AC-FRUT-12] el contratante tampoco puede ESCRIBIR sobre la fila del vecino", async () => {
  await comoCliente(id.suya, async () => {
    // FOR ALL y no solo FOR SELECT: un cliente que pudiera escribir sobre el encargo ajeno no
    // filtraría datos, haría algo peor — cambiaría la operación de un tercero desde su portal.
    const { length } = await app.sql(
      "update encargos set bultos = 999 where id = $1 returning 1",
      [id.encargoAjeno],
    );
    assert.equal(length, 0, "el contratante escribió sobre el encargo de otra empresa");
  });

  const [{ bultos }] = await migrador.sql(
    "select bultos::text as bultos from encargos where id = $1",
    [id.encargoAjeno],
  );
  assert.equal(bultos, "8", "la fila del vecino cambió");
});

test("[AC-FRUT-12] toda tabla del módulo con `empresa_cliente_id` lleva su política", async () => {
  // EL invariante a futuro. Cuando nazcan `manifiestos`, `cierres_ruta` y `devoluciones` —todas
  // con empresa— este caso se pone rojo si alguna llega sin confinar. Sin él, «toda tabla del
  // módulo» sería cierto hoy y falso el mes que viene, que es cuando importa.
  const sinPolitica = await migrador.sql(
    `select c.relname
       from pg_class c
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'empresa_cliente_id'
      where c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and c.relnamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_policy p
           where p.polrelid = c.oid and not p.polpermissive
        )
      order by c.relname`,
  );
  assert.deepEqual(
    sinPolitica.map((f) => f.relname),
    [],
    "hay tablas con `empresa_cliente_id` sin política restrictiva: el rol `cliente` las vería enteras",
  );
});
