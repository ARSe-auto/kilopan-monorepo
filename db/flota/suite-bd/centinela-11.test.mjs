#!/usr/bin/env node
// Centinela 11 COMPLETO [AC-FPOR-02] — spec 07 §9.3.11, sobre docs/PROMPT_MAESTRO_KILORUTA.md.
//
// `modo.spec.ts` [AC-FRUT-14] y `semaforo-contraccion.spec.ts` [AC-FSEM-13] ya ejercen el
// centinela 11, pero cada uno mirando SOLO las tablas de su propio módulo (empresas_cliente y
// encargos uno; signal_rule y review_queue el otro). Un módulo nuevo que conmutara y perdiera
// filas de UNA tabla que nadie mira ahí pasaría en verde. Esta suite es la versión que el AC
// pide «completa»: en vez de una lista a mano de tablas, enumera CADA tabla con llave primaria
// del esquema `public` del tenant vía `information_schema` — agregar una tabla de dominio la
// suma sola al centinela, sin tocar este archivo — y para cada una compara por PK (no por
// count a secas: un DELETE seguido de un INSERT deja el count igual y solo la comparación por
// PK lo delata) sobre un tenant sembrado a lo ancho de ~20 tablas operativas.
//
// El alcance es la BASE DEL TENANT, no `control`: `control` es el plano de tenancy (tablas,
// planes, features) y no lleva datos de dominio operativo — lo prueba el centinela 14
// (`control.test.mjs`). «Cada tabla de dominio» del AC vive en la base del tenant (§4.1).
//
// Conmutar es ADITIVO, jamás destructivo (servidor/modo.ts, AC-FRUT-14): esta suite replica en
// SQL crudo las dos escrituras que hace `conmutarModo()` (autoridad en `control.tenants`,
// réplica en `tenant_info`) porque es lo único que el AC necesita ejercer — mismo patrón que
// `semaforo-contraccion.spec.ts` — sin la capa de sesión/HTTP del plano de control.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { con, BD_CONTROL, bdDeTenant } from "../conectar.mjs";
import { provisionar, desalta } from "../provisionar.mjs";

const SLUG = "gate_centinela11";
const BD = bdDeTenant(SLUG);

async function borrar(slug) {
  await desalta(slug);
  await con("postgres", ({ sql }) => sql(`drop database if exists ${bdDeTenant(slug)} with (force)`));
}

/**
 * Cada tabla con llave primaria del esquema `public` del tenant, con sus columnas de PK en
 * orden. Genérico a propósito: no hay lista a mano que alguien tenga que recordar actualizar.
 */
async function tablasDeDominio(sql) {
  const filas = await sql(`
    select tc.table_name as tabla, kcu.column_name as columna
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
     where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
     order by tc.table_name, kcu.ordinal_position
  `);
  const porTabla = new Map();
  for (const f of filas) {
    if (!porTabla.has(f.tabla)) porTabla.set(f.tabla, []);
    porTabla.get(f.tabla).push(f.columna);
  }
  return porTabla;
}

/**
 * Foto de cada tabla: el CONJUNTO de PKs presentes (comparación por PK, no por count a secas).
 * Las columnas de PK se concatenan a texto porque una fila se compara por su llave, no por su
 * contenido completo — el AC exige «sigue presente», no «no cambió ni una columna».
 */
async function foto(sql, tablas) {
  const resultado = new Map();
  for (const [tabla, cols] of tablas) {
    const expr = cols.map((c) => `"${c}"::text`).join(` || '|' || `);
    const filas = await sql(`select ${expr} as pk from "${tabla}"`);
    resultado.set(tabla, new Set(filas.map((f) => f.pk)));
  }
  return resultado;
}

/** Replica las dos escrituras de `conmutarModo()` (servidor/modo.ts): autoridad en `control`,
 *  réplica en el tenant — el UPDATE dispara el mismo trigger de la empresa implícita. */
async function conmutar(modo) {
  await con(BD_CONTROL, ({ sql }) =>
    sql("update tenants set modo = $2::tenant_modo where slug = $1", [SLUG, modo]),
  );
  await con(BD, ({ sql }) => sql("update tenant_info set modo = $1", [modo]));
}

/**
 * Datos operativos sembrados a lo ancho de ~20 tablas de dominio, para que el centinela no sea
 * vacuo: personas/usuarios/dispositivos/invitaciones/solicitudes (identidad), vehículos/
 * chequeos/defectos/turnos (flota), rutas/motivos/destinos/paradas/empresas/encargos/items
 * (planificación), manifiestos/manifiesto_items/firmas/custody_transfer (terreno), review_queue
 * (semáforo), tarifas/entregas_pod/liquidaciones (DaaS — el devengo deja además una línea).
 * Mismo patrón que `sembrarIdentidadDelVecino` de `preparar-tenants.mjs`, con RUTs de la lista
 * congelada (AC-FIDN-21).
 */
async function sembrarDatosOperativos() {
  await con(BD, async ({ sql }) => {
    // Sin esto el trigger de AC-FRUT-14 no crea la empresa implícita: un tenant existe antes de
    // terminar de decir quién es.
    await sql("update tenant_info set rut_de_la_empresa = $1, razon_social = $2", [
      "76.111.111-6",
      "Transportes del centinela",
    ]);

    const [persona] = await sql(
      "insert into personas (rut, nombre) values ($1, 'Dueña del centinela') returning id::text as id",
      ["11.111.111-1"],
    );
    const [usuario] = await sql(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [persona.id],
    );
    await sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
       values ('personal', $1, 'hash-del-centinela-que-no-abre-nada', $2, now())`,
      [persona.id, usuario.id],
    );
    const [invitacion] = await sql(
      `insert into invitaciones (rol, token_hash, expira_at, creada_por)
       values ('chofer', 'token-hash-del-centinela', now() + interval '7 days', $1)
       returning id::text as id`,
      [usuario.id],
    );
    await sql(
      `insert into solicitudes_acceso
         (invitacion_id, rut_propuesto, nombre_propuesto, pin_hash, clave_publica, huella_dispositivo)
       values ($1, '7.654.321-6', 'Quien pide en el centinela', '$argon2id$del-centinela', 'clave-del-centinela', 'huella-del-centinela')`,
      [invitacion.id],
    );

    const [vehiculo] = await sql(
      "insert into vehiculos (patente, tipo) values ('CENT111', 'furgón del centinela') returning id::text as id",
    );
    const [chequeo] = await sql(
      `insert into chequeos (inspectable_tipo, inspectable_id, momento, ts_dispositivo, tz_offset_min)
       values ('vehiculos', $1, 'pre', now(), -240) returning id::text as id`,
      [vehiculo.id],
    );
    await sql("insert into defectos (chequeo_id, item) values ($1, 'luz de freno del centinela')", [
      chequeo.id,
    ]);
    const [config] = await sql("select crear_config_version('fixture del centinela')::text as id");
    await sql("insert into turnos (vehiculo_id, config_version_id) values ($1, $2)", [
      vehiculo.id,
      config.id,
    ]);

    await sql(
      "insert into rutas (nombre, vehiculo_id) values ('Ruta del centinela', $1)",
      [vehiculo.id],
    );
    await sql(
      `insert into motivos (codigo, etiqueta, estado_asociado, orden)
       values ('local_cerrado_del_centinela', 'Local cerrado del centinela', 'parada_fallida', 1)`,
    );

    const [destino] = await sql(
      "insert into destinos (nombre) values ('Sucursal del centinela') returning id::text as id",
    );
    const [parada] = await sql(
      `insert into paradas (ruta_id, tipo, orden, destino_id)
       select id, 'carga', 1, $1 from rutas where nombre = 'Ruta del centinela'
       returning id::text as id`,
      [destino.id],
    );

    const [empresaImplicita] = await sql(
      "select id::text as id from empresas_cliente where implicita",
    );
    const [encargo] = await sql(
      `insert into encargos (empresa_cliente_id, destino_id, bultos)
       values ($1, $2, 6) returning id::text as id`,
      [empresaImplicita.id, destino.id],
    );
    const [item] = await sql(
      `insert into items (parada_id, encargo_id, qty_planificada)
       values ($1, $2, 6) returning id::text as id`,
      [parada.id, encargo.id],
    );
    const [manifiesto] = await sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240) returning id::text as id`,
      [parada.id, empresaImplicita.id],
    );
    await sql(
      `insert into manifiesto_items (manifiesto_id, item_id, qty_declarada, qty_confirmada)
       values ($1, $2, 6, 6)`,
      [manifiesto.id, item.id],
    );

    const [firma] = await sql(
      `insert into firmas (persona_id, dispositivo_id, objeto_tabla, objeto_id, significado)
       select $1, d.id, 'manifiestos', $2, 'libero'
         from dispositivos d where d.persona_id = $1 limit 1
       returning id::text as id`,
      [persona.id, manifiesto.id],
    );
    await sql(
      `insert into custody_transfer
         (manifiesto_id, de_persona_id, a_persona_id, firma_libero_id, firma_recibio_id,
          ts_dispositivo, tz_offset_min)
       values ($1, $2, $2, $3, $3, now(), -240)`,
      [manifiesto.id, persona.id, firma.id],
    );

    await sql(`insert into review_queue (origen, severidad) values ('datos_sync', 'rojo')`);

    await sql(
      "insert into tarifas (empresa_cliente_id, concepto, precio_clp, vigente_desde) values ($1, 'por_entrega', 3900, timestamptz '2026-01-01 00:00-04')",
      [empresaImplicita.id],
    );
    const [pod] = await sql(
      `insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min)
       values ($1, $2, 'exito', now(), -240) returning id::text as id`,
      [encargo.id, parada.id],
    );
    const [liquidacion] = await sql(
      `insert into liquidaciones (empresa_cliente_id, periodo_inicio, periodo_fin)
       values ($1, current_date - 6, current_date) returning id::text as id`,
      [empresaImplicita.id],
    );
    await sql("select devengar_entrega($1, $2)", [pod.id, liquidacion.id]);
  });
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
  await provisionar(SLUG, { recrear: true, modo: "mi_flota" });
  await sembrarDatosOperativos();
});

after(async () => {
  await borrar(SLUG);
});

test("[AC-FPOR-02] el tenant sembrado trae datos en un número saludable de tablas de dominio", async () => {
  await con(BD, async ({ sql }) => {
    const tablas = await tablasDeDominio(sql);
    // Sanidad del propio enumerador: si esto baja de golpe, el `information_schema` dejó de ver
    // el esquema esperado y el resto de la suite estaría comparando contra casi nada.
    assert.ok(
      tablas.size >= 20,
      `solo ${tablas.size} tablas con PK en «public»: ¿el esquema del tenant no aplicó completo?`,
    );

    const antes = await foto(sql, tablas);
    for (const tabla of ["encargos", "manifiestos", "entregas_pod", "liquidacion_lineas", "empresas_cliente"]) {
      assert.ok(
        (antes.get(tabla)?.size ?? 0) > 0,
        `«${tabla}» nació vacía: el fixture no sembró lo que este AC necesita ejercer`,
      );
    }
  });
});

test("[AC-FPOR-02] mi_flota→daas→mi_flota no pierde UNA fila de ninguna tabla de dominio (centinela 11 completo)", async () => {
  const tablasAntes = await con(BD, ({ sql }) => tablasDeDominio(sql));
  const antes = await con(BD, ({ sql }) => foto(sql, tablasAntes));

  const [implicitaAntes] = await con(BD, ({ sql }) =>
    sql("select id::text as id, rut, razon_social, implicita from empresas_cliente where implicita"),
  );
  assert.ok(implicitaAntes, "el tenant nació sin empresa implícita: el fixture no la creó");

  await conmutar("daas");
  // En daas conviven 1..N contratantes: una segunda empresa que se da de alta MIENTRAS el
  // tenant está en daas tiene que sobrevivir la vuelta a mi_flota tanto como lo sembrado antes.
  await con(BD, ({ sql }) =>
    sql(
      `insert into empresas_cliente (rut, razon_social) values ('77.222.222-K', 'Contratante nueva en daas')`,
    ),
  );
  await conmutar("mi_flota");

  const tablasDespues = await con(BD, ({ sql }) => tablasDeDominio(sql));
  assert.deepEqual(
    [...tablasDespues.keys()].sort(),
    [...tablasAntes.keys()].sort(),
    "el viaje de ida y vuelta cambió el conjunto de tablas del esquema — eso no lo hace un toggle",
  );

  const despues = await con(BD, ({ sql }) => foto(sql, tablasDespues));

  for (const [tabla, pks] of antes) {
    const pksDespues = despues.get(tabla) ?? new Set();
    assert.ok(
      pksDespues.size >= pks.size,
      `«${tabla}»: count bajó de ${pks.size} a ${pksDespues.size} tras mi_flota→daas→mi_flota`,
    );
    for (const pk of pks) {
      assert.ok(
        pksDespues.has(pk),
        `«${tabla}»: la fila ${pk} desapareció al conmutar mi_flota→daas→mi_flota (centinela 11)`,
      );
    }
  }

  const [implicitaDespues] = await con(BD, ({ sql }) =>
    sql("select id::text as id, rut, razon_social, implicita from empresas_cliente where implicita"),
  );
  assert.deepEqual(
    implicitaDespues,
    implicitaAntes,
    "la empresa implícita no es la MISMA fila tras el viaje de ida y vuelta (centinela 11, §4.5)",
  );

  const empresas = despues.get("empresas_cliente");
  assert.equal(
    empresas?.size,
    (antes.get("empresas_cliente")?.size ?? 0) + 1,
    "la contratante dada de alta en daas no sobrevivió la vuelta a mi_flota",
  );
});
