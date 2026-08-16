#!/usr/bin/env node
// Aislamiento del rol `cliente` sobre TODA tabla operativa del módulo 06, con el rol de app
// REAL [AC-FTAR-10].
//
// §9.3.2/§9.3.3/§4.3/§0: «sesión `cliente` de la empresa X ⇒ 0 filas de tarifas/liquidaciones/
// líneas de la empresa Y en toda tabla operativa (política en BD + vistas)». El patrón —
// `app_t_<slug>` NOSUPERUSER, LOGIN, NOBYPASSRLS conectado de verdad— es el mismo que
// `confinamiento.test.mjs` (AC-FRUT-12) usó para encargos/items/paradas/rutas y que
// `disputa-por-linea.test.mjs` (AC-FTAR-06) usó para UNA función SECURITY DEFINER: acá se repite
// contra las CINCO tablas propias del módulo 06 —`tarifas`, `tarifa_zonas`,
// `tarifa_recargo_horario`, `liquidaciones`, `liquidacion_lineas`— con SELECT crudo, no a través
// de una función que podría esconder el defecto detrás de su propio filtro.
//
// `confinamiento.test.mjs` ya trae un invariante genérico («toda tabla con `empresa_cliente_id`
// lleva su política restrictiva») que detecta una tabla SIN política. Lo que ese invariante no
// puede ver es una política PRESENTE pero rota para estas tablas puntuales — de ahí que cada
// tabla lleve acá su propio positivo (ve lo suyo) y su propio negativo (no ve lo ajeno), como
// pide la spec 06 en su nota sobre «cada negativo lleva su positivo».
//
// La otra mitad del AC —«payloads sin columnas de economía interna del operador (costos de
// energía, `tarifa_kwh_clp`, ahorro vs diésel)»— se prueba estructuralmente: estas cinco tablas
// NO llevan ninguna columna de esa familia, y `apps/flota/src/servidor/liquidaciones.ts` (el
// único lector hoy) no las selecciona (AC-FTAR-07). El portal del contratante (módulo 07,
// dependencia INVERSA) es quien algún día armará el endpoint que un `cliente` real llama; hasta
// entonces la garantía verificable es que la fuga no puede venir NI del esquema NI de la única
// consulta que existe.
//
// La suite HTTP A-contra-B autogenerada del manifiesto (AC-FTEN-26, `cruce-tenant.spec.ts`) ya
// cubre las dos rutas de recurso de este módulo (`/api/liquidaciones/[id]`,
// `/api/liquidacion-lineas/[id]/evidencia`) porque ambas declaran su `cruce` desde AC-FTAR-07 —
// es autogenerada, así que no hay una tercera suite que escribir para eso: correr
// `check.sh --full` alcanza para ejercerla.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_aislamiento_modulo06";

const TABLAS = ["tarifas", "tarifa_zonas", "tarifa_recargo_horario", "liquidaciones", "liquidacion_lineas"];

// Cero cadenas de economía interna del operador (§8, §3.E1.10) en ninguna columna de estas
// cinco tablas: costos de energía, tarifa por kWh, ahorro vs diésel.
const PATRONES_PROHIBIDOS = [/kwh/i, /diesel/i, /di[eé]sel/i, /ahorro/i, /energ/i];

let tenant;
let app;
let migrador;
/** Los ids del fixture, resueltos en `before`. */
const id = {
  suya: "",
  ajena: "",
  tarifaSuya: "",
  tarifaAjena: "",
  zonaSuya: "",
  zonaAjena: "",
  recargoSuya: "",
  recargoAjena: "",
  liqSuya: "",
  liqAjena: "",
  lineaSuya: "",
  lineaAjena: "",
};

/** Mismo helper que `confinamiento.test.mjs`/`disputa-por-linea.test.mjs`: LOCAL a la transacción. */
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

/** Sin rol declarado: el operador y el dueño. La política no los toca. */
async function sinRolDeclarado(fn) {
  await app.sql("begin");
  try {
    return await fn();
  } finally {
    await app.sql("commit");
  }
}

async function limpiar() {
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

  id.tarifaSuya = (
    await una(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 3500, timestamptz '2026-01-01 00:00-04') returning id::text as id",
      [id.suya],
    )
  ).id;
  id.tarifaAjena = (
    await una(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 4200, timestamptz '2026-01-01 00:00-04') returning id::text as id",
      [id.ajena],
    )
  ).id;

  id.zonaSuya = (
    await una(
      "insert into tarifa_zonas (empresa_cliente_id, nombre, comunas, monto_clp) values ($1, 'Zona sur', array['La Florida'], 700) returning id::text as id",
      [id.suya],
    )
  ).id;
  id.zonaAjena = (
    await una(
      "insert into tarifa_zonas (empresa_cliente_id, nombre, comunas, monto_clp) values ($1, 'Zona norte', array['Recoleta'], 900) returning id::text as id",
      [id.ajena],
    )
  ).id;

  id.recargoSuya = (
    await una(
      "insert into tarifa_recargo_horario (empresa_cliente_id, hora_inicio, hora_fin, monto_clp) values ($1, time '19:00', time '22:00', 500) returning id::text as id",
      [id.suya],
    )
  ).id;
  id.recargoAjena = (
    await una(
      "insert into tarifa_recargo_horario (empresa_cliente_id, hora_inicio, hora_fin, monto_clp) values ($1, time '20:00', time '23:00', 600) returning id::text as id",
      [id.ajena],
    )
  ).id;

  // Un destino por encargo: `paradas_una_entrega_por_destino` admite una sola parada `entrega`
  // por destino en cada ruta (mismo fixture que `disputa-por-linea.test.mjs`).
  const destinoSuya = (
    await una(
      "insert into destinos (nombre, comuna) values ('Local del cliente', 'Ñuñoa') returning id::text as id",
    )
  ).id;
  const destinoAjena = (
    await una(
      "insert into destinos (nombre, comuna) values ('Local del vecino', 'Ñuñoa') returning id::text as id",
    )
  ).id;
  const ruta = (
    await una("insert into rutas (nombre) values ('Ruta del aislamiento') returning id::text as id")
  ).id;

  const paradaSuya = (
    await una(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 1, $2) returning id::text as id",
      [ruta, destinoSuya],
    )
  ).id;
  const paradaAjena = (
    await una(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2) returning id::text as id",
      [ruta, destinoAjena],
    )
  ).id;

  const encargoSuya = (
    await una(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 2, 'solicitado') returning id::text as id",
      [id.suya, destinoSuya],
    )
  ).id;
  const encargoAjena = (
    await una(
      "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) values ($1, $2, 2, 'solicitado') returning id::text as id",
      [id.ajena, destinoAjena],
    )
  ).id;

  const podSuya = (
    await una(
      "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', timestamptz '2026-03-15 10:00-04', -240) returning id::text as id",
      [encargoSuya, paradaSuya],
    )
  ).id;
  const podAjena = (
    await una(
      "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) values ($1, $2, 'exito', timestamptz '2026-03-15 10:00-04', -240) returning id::text as id",
      [encargoAjena, paradaAjena],
    )
  ).id;

  id.liqSuya = (
    await una(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, date '2026-01-01', date '2026-01-07') returning id::text as id",
      [id.suya],
    )
  ).id;
  id.liqAjena = (
    await una(
      "insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin) values ($1, date '2026-01-01', date '2026-01-07') returning id::text as id",
      [id.ajena],
    )
  ).id;

  id.lineaSuya = (await una("select devengar_entrega($1, $2)::text as id", [podSuya, id.liqSuya])).id;
  id.lineaAjena = (await una("select devengar_entrega($1, $2)::text as id", [podAjena, id.liqAjena])).id;

  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

test("[AC-FTAR-10] las cinco tablas del módulo llevan RLS con sus DOS políticas", async () => {
  for (const tabla of TABLAS) {
    const [{ rls }] = await migrador.sql(
      "select relrowsecurity as rls from pg_class where relname = $1",
      [tabla],
    );
    assert.equal(rls, true, `${tabla} quedó sin RLS: el aislamiento del §9.3.3 no se aplicó`);

    const politicas = await migrador.sql(
      "select polname, polpermissive from pg_policy where polrelid = $1::regclass order by polname",
      [tabla],
    );

    // DOS PATRONES, no uno. Estas tablas llevan el aislamiento por empresa del §9.3.3 —el
    // cliente ve solo lo suyo— y, desde la migración 0073 [AC-FTAR-17], también el dinero
    // invisible del §4.8 —el chofer no ve montos—. Son protecciones distintas contra sujetos
    // distintos y coexisten: contar «dos políticas» daba por sentado que solo existía la
    // primera, y se ponía rojo justo cuando se agregó la segunda.
    const nombres = politicas.map((p) => p.polname);

    // El aislamiento por empresa va en las CINCO: es de quién puede ver la fila.
    for (const esperada of ["empresa_base", "empresa_del_cliente"]) {
      assert.ok(nombres.includes(esperada), `${tabla}: falta la política ${esperada}`);
    }

    // El dinero invisible va solo en las que TIENEN montos. `liquidaciones` es la cabecera
    // —empresa, período, estado— y su plata vive en `liquidacion_lineas`: pedirle la política
    // de dinero sería pedirle que esconda una columna que no tiene.
    const conMontos = tabla !== "liquidaciones";
    for (const esperada of ["dinero_base", "dinero_sin_chofer"]) {
      assert.equal(
        nombres.includes(esperada),
        conMontos,
        `${tabla}: ${conMontos ? "falta" : "no debería llevar"} la política ${esperada}`,
      );
    }

    // Cada patrón aporta UNA permisiva de base y UNA restrictiva que acota: con la permisiva
    // sola, el sujeto vería todo igual.
    const esperadas = conMontos ? 2 : 1;
    assert.equal(politicas.filter((p) => p.polpermissive).length, esperadas, `${tabla}: falta una base`);
    assert.equal(politicas.filter((p) => !p.polpermissive).length, esperadas, `${tabla}: falta una restrictiva`);
  }
});

test("[AC-FTAR-10] cliente de X ve SU tarifa y NINGUNA de la empresa Y", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from tarifas");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.tarifaSuya), "el cliente no vio su propia tarifa");
    assert.ok(!ids.includes(id.tarifaAjena), "el cliente VIO la tarifa de otra empresa");
  });
});

test("[AC-FTAR-10] cliente de X ve SU zona y NINGUNA de la empresa Y", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from tarifa_zonas");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.zonaSuya), "el cliente no vio su propia zona");
    assert.ok(!ids.includes(id.zonaAjena), "el cliente VIO la zona de otra empresa");
  });
});

test("[AC-FTAR-10] cliente de X ve SU recargo horario y NINGUNO de la empresa Y", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from tarifa_recargo_horario");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.recargoSuya), "el cliente no vio su propio recargo");
    assert.ok(!ids.includes(id.recargoAjena), "el cliente VIO el recargo de otra empresa");
  });
});

test("[AC-FTAR-10] cliente de X ve SU liquidación y NINGUNA de la empresa Y", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id from liquidaciones");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.liqSuya), "el cliente no vio su propia liquidación");
    assert.ok(!ids.includes(id.liqAjena), "el cliente VIO la liquidación de otra empresa");
  });
});

test("[AC-FTAR-10] cliente de X ve SU línea y NINGUNA de la empresa Y (SELECT crudo, no vía función)", async () => {
  await comoCliente(id.suya, async () => {
    const filas = await app.sql("select id::text as id, monto_clp::text as monto from liquidacion_lineas");
    const ids = filas.map((f) => f.id);
    assert.ok(ids.includes(id.lineaSuya), "el cliente no vio su propia línea");
    assert.ok(!ids.includes(id.lineaAjena), "el cliente VIO la línea de otra empresa");
    // Payload sin economía ajena: ni siquiera el monto de la línea propia trae más columnas de
    // las que la tabla declara — se afirma en el test estructural de abajo, no acá por fila.
    assert.ok(filas.every((f) => typeof f.monto === "string"), "monto_clp no vino como CLP entero");
  });
});

test("[AC-FTAR-10] un cliente SIN empresa declarada no ve nada en NINGUNA de las cinco tablas", async () => {
  await comoCliente(null, async () => {
    for (const tabla of TABLAS) {
      const filas = await app.sql(`select 1 from ${tabla}`);
      assert.equal(filas.length, 0, `${tabla}: un cliente sin empresa vio filas`);
    }
  });
});

test("[AC-FTAR-10] sin rol declarado: la política de EMPRESA no estorba, la de DINERO falla cerrado", async () => {
  // Cambió con la migración 0073 [AC-FTAR-17], y el cambio es deliberado. Sobre `tarifas` ahora
  // conviven DOS familias de RLS que leen GUCs distintos (`gobierno.ts::declararQuienPregunta`):
  //
  //   · la de EMPRESA (§9.3.3) no estorba cuando no hay `app.current_empresa`: el operador de la
  //     casa ve las dos empresas, que es lo que este AC pedía y sigue siendo cierto;
  //   · la de DINERO (§4.8) falla CERRADO: su política restrictiva exige que `app.current_role`
  //     esté declarado, así que sin sesión no se ven montos.
  //
  // Fallar cerrado es lo correcto y no es una decisión nueva: es la misma semántica que
  // `energy_entry` lleva desde la 0004. Una consulta sin sesión es, por definición, una que no
  // pudo demostrar quién pregunta — y el §4.8 dice que ante la duda el monto no se muestra.
  await sinRolDeclarado(async () => {
    const tarifas = await app.sql("select id::text as id from tarifas");
    assert.deepEqual(
      tarifas,
      [],
      "sin rol declarado se vieron tarifas: la política de dinero del §4.8 debe fallar cerrada",
    );
  });

  // Y la de empresa sigue sin estorbar donde el dinero no participa: sobre `liquidaciones`
  // —cabecera sin montos— el operador sigue viendo las dos empresas, que es lo que este AC
  // afirmaba desde el principio.
  await sinRolDeclarado(async () => {
    const liq = await app.sql("select empresa_cliente_id::text as e from liquidaciones");
    const empresas = new Set(liq.map((f) => f.e));
    assert.ok(
      empresas.has(id.suya) && empresas.has(id.ajena),
      "el operador sin rol declarado dejó de ver las dos empresas en la cabecera de liquidación",
    );
  });
});

test("[AC-FTAR-10] cliente tampoco puede ESCRIBIR sobre la tarifa o la liquidación del vecino", async () => {
  await comoCliente(id.suya, async () => {
    const t = await app.sql("update tarifas set precio_clp = precio_clp where id = $1 returning 1", [
      id.tarifaAjena,
    ]);
    assert.equal(t.length, 0, "el cliente escribió sobre la tarifa de otra empresa");

    const l = await app.sql("update liquidaciones set estado = estado where id = $1 returning 1", [
      id.liqAjena,
    ]);
    assert.equal(l.length, 0, "el cliente escribió sobre la liquidación de otra empresa");
  });
});

test("[AC-FTAR-10] payload sin economía interna del operador: ninguna columna de las cinco tablas es de energía/diésel", async () => {
  const columnas = await migrador.sql(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name = any($1)`,
    [TABLAS],
  );
  assert.ok(columnas.length > 0, "no se leyó ninguna columna: el test no probaría nada (verde vacuo)");

  const fugadas = columnas.filter((c) => PATRONES_PROHIBIDOS.some((p) => p.test(c.column_name)));
  assert.deepEqual(
    fugadas,
    [],
    `columnas de economía interna del operador en tablas del cliente: ${JSON.stringify(fugadas)}`,
  );
});
