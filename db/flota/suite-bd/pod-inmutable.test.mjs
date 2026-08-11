#!/usr/bin/env node
// El POD es write-once, visto por el ROL DE APP real. [AC-FPOD-11]
//
// Fuente: §4.5 (`entregas_pod` write-once + `UNIQUE(encargo) WHERE cerrada AND supersede IS
// NULL`) · §7.4 (REVOKE UPDATE/DELETE; corrección = supersede con motivo y autor) · §9.3.6
// (centinela 6: UPDATE/DELETE sobre POD/evidencia/evento como app_user ⇒ 42501; supersede ⇒
// 2 filas, original intacta).
//
// La forma de la tabla y sus CHECKs se prueban en `db/flota/pgtap/0022_inmutabilidad_del_pod.
// sql`, con el rol migrador. Lo que NO se puede probar ahí es el sujeto del centinela 6: el
// rol `app_t_<slug>` con el que corre la aplicación. Son dos caminos distintos hacia el mismo
// 42501 —el REVOKE detiene a la app, el trigger detiene a quien tiene más privilegios— y una
// suite que solo mirara uno declararía cubierto el otro.
//
// Provisiona su propio tenant y lo borra al final: dejar PODs en `t_gate_a` correría las
// cuentas de las otras suites.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { provisionar, refrescarPlantilla } from "../provisionar.mjs";
import { borrarRolDeApp } from "../rol-app.mjs";
import { con, conectar, ROL_MIGRADOR, bdDeTenant } from "../conectar.mjs";

const SLUG = "gate_pod";
/** La lista LITERAL del centinela 6 (§9.3.6): POD, evidencia y evento. */
const APPEND_ONLY = ["entregas_pod", "evidence", "eventos"];

let tenant;
/** El rol con el que corre la aplicación: el sujeto del rebote del §9.3.6. */
let app;
let migrador;
let fixture;

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
  await refrescarPlantilla();
  await limpiar();
  tenant = await provisionar(SLUG, { recrear: true });
  app = await conectar(tenant.bd, { usuario: tenant.rol, clave: tenant.clave });
  migrador = await conectar(tenant.bd, { usuario: ROL_MIGRADOR });

  // El día del encargo, sembrado por el migrador: lo que se prueba acá es el POD, no la
  // planificación. El RUT sale de la lista congelada de fixtures (§7.8, §10).
  await migrador.sql(
    "insert into empresas_cliente (rut, razon_social) values ('76.111.111-6', 'Panadería de prueba')",
  );
  await migrador.sql("insert into destinos (nombre) values ('Almacén de la esquina')");
  await migrador.sql(
    "insert into motivos (codigo, etiqueta, estado_asociado) " +
      "values ('local_cerrado', 'Local cerrado', 'no_entregado')",
  );
  await migrador.sql(
    "insert into encargos (empresa_cliente_id, destino_id, bultos, estado) " +
      "select (select id from empresas_cliente limit 1), (select id from destinos limit 1), " +
      "8, 'solicitado'",
  );
  await migrador.sql("insert into rutas (nombre) values ('Ruta del gate')");
  await migrador.sql(
    "insert into paradas (ruta_id, tipo, orden, destino_id) " +
      "select (select id from rutas limit 1), 'entrega', 1, (select id from destinos limit 1)",
  );
  const [tipo] = await migrador.sql(
    "insert into evento_tipo (codigo, descripcion) values ('prueba.pod', 'fixture del gate') " +
      "returning id::text as id",
  );
  const [filas] = await migrador.sql(
    "select (select id::text from encargos limit 1) as encargo, " +
      "       (select id::text from paradas limit 1) as parada, " +
      "       (select id::text from motivos limit 1) as motivo",
  );
  fixture = { ...filas, tipoEvento: tipo.id, actor: "019fe000-0000-7000-8000-0000000000ad" };
});

after(async () => {
  await app?.cerrar();
  await migrador?.cerrar();
  await limpiar();
});

test("[AC-FPOD-11] `entregas_pod` nace en la plantilla como CAPTURA, con su tenant horneado", async () => {
  const [clase] = await app.sql(
    "select obj_description('entregas_pod'::regclass, 'pg_class') as clase",
  );
  assert.match(
    clase.clase ?? "",
    /^CAPTURA —/,
    `entregas_pod no declara su clase del §4.2: «${clase.clase}»`,
  );

  const [fila] = await app.sql(
    "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) " +
      "values ($1, $2, 'exito', now(), -240) returning id::text as id, tenant_id::text as tenant_id",
    [fixture.encargo, fixture.parada],
  );
  assert.equal(fila.tenant_id, tenant.id, "el DEFAULT no puso la constante de la BD");
  fixture.pod = fila.id;

  await assert.rejects(
    () =>
      app.sql(
        "insert into entregas_pod (tenant_id, encargo_id, parada_id, resultado, cerrada, " +
          "event_time, tz_offset_min) " +
          "values ('019fe000-0000-7000-8000-000000000000', $1, $2, 'exito', false, now(), -240)",
        [fixture.encargo, fixture.parada],
      ),
    { code: "23514" },
    "un POD de otro tenant entró a la BD de este",
  );
});

test("[AC-FPOD-11] write-once: un segundo POD cerrado para el mismo encargo rebota", async () => {
  // El índice del §4.5 es PARCIAL, y las dos mitades importan: la unicidad prohíbe la segunda
  // entrega vigente, y el `where` deja convivir lo que todavía no cerró la parada — sin eso,
  // «corregir es insertar otra fila» chocaría contra la unicidad y la única salida sería el
  // UPDATE que el §7.4 prohíbe.
  await assert.rejects(
    () =>
      app.sql(
        "insert into entregas_pod (encargo_id, parada_id, resultado, event_time, tz_offset_min) " +
          "values ($1, $2, 'exito', now(), -240)",
        [fixture.encargo, fixture.parada],
      ),
    { code: "23505" },
    "el mismo encargo quedó declarado entregado dos veces",
  );

  await app.sql(
    "insert into entregas_pod (encargo_id, parada_id, resultado, cerrada, event_time, tz_offset_min) " +
      "values ($1, $2, 'parcial', false, now(), -240)",
    [fixture.encargo, fixture.parada],
  );
});

test("[AC-FPOD-11] la app ESCRIBE hechos pero no los edita ni los borra ⇒ 42501 (centinela 6)", async () => {
  // La mitad positiva primero: sin ella, un rol sin ningún permiso daría los mismos 42501 y la
  // suite quedaría verde probando que la app no puede hacer NADA.
  await app.sql(
    "insert into eventos (tipo_id, objeto_tabla, objeto_id, event_time, tz_offset_min) " +
      "values ($1, 'entregas_pod', $2, now(), -240)",
    [fixture.tipoEvento, fixture.pod],
  );
  await app.sql(
    "insert into evidence (tipo, objeto_tabla, objeto_id, valor, capturada_en, tz_offset_min) " +
      "values ('pin_destinatario', 'entregas_pod', $1, '1234', now(), -240)",
    [fixture.pod],
  );

  for (const tabla of APPEND_ONLY) {
    const [{ n }] = await app.sql(`select count(*)::int as n from ${tabla}`);
    assert.ok(n > 0, `${tabla} está vacía: un UPDATE de 0 filas no ejerce el trigger`);
    await assert.rejects(() => app.sql(`update ${tabla} set tenant_id = tenant_id`), {
      code: "42501",
    });
    await assert.rejects(() => app.sql(`delete from ${tabla}`), { code: "42501" });
  }
});

test("[AC-FPOD-11] el append-only del POD detiene también al MIGRADOR: el REVOKE solo no alcanza", async () => {
  await assert.rejects(
    () => migrador.sql("update entregas_pod set resultado = 'fallo'"),
    (e) => {
      assert.equal(e.code, "42501", `entregas_pod respondió ${e.code}`);
      assert.match(e.message, /append-only/);
      return true;
    },
  );
  await assert.rejects(() => migrador.sql("truncate entregas_pod"), { code: "42501" });
});

test("[AC-FPOD-11] corregir es un supersede con motivo y autor ⇒ 2 filas, la original intacta", async () => {
  // «Supersede con motivo y AUTOR» (§7.4) lo exige el ESQUEMA: una corrección anónima o sin
  // razón es indistinguible de una adulteración, y el día que alguien audite la cadena no
  // tendría con qué separarlas.
  await assert.rejects(
    () =>
      app.sql(
        "insert into entregas_pod (encargo_id, parada_id, resultado, supersede_id, " +
          "event_time, tz_offset_min) values ($1, $2, 'fallo', $3, now(), -240)",
        [fixture.encargo, fixture.parada, fixture.pod],
      ),
    { code: "23514" },
    "entró una corrección sin motivo ni autor",
  );

  await app.sql(
    "insert into entregas_pod (encargo_id, parada_id, resultado, motivo_id, supersede_id, " +
      "supersede_motivo, actor_id, event_time, tz_offset_min) " +
      "values ($1, $2, 'fallo', $3, $4, 'el receptor no era quien firmó', $5, now(), -240)",
    [fixture.encargo, fixture.parada, fixture.motivo, fixture.pod, fixture.actor],
  );

  const filas = await app.sql(
    "select id::text as id, resultado::text as resultado, supersede_id::text as supersede_id " +
      "from entregas_pod where encargo_id = $1 and (cerrada or supersede_id is not null) " +
      "order by record_time",
    [fixture.encargo],
  );
  assert.equal(filas.length, 2, "supersede ⇒ 2 filas (centinela 6, §9.3.6)");
  assert.equal(filas[0].id, fixture.pod);
  assert.equal(filas[0].resultado, "exito", "la original se reescribió: la corrección la pisó");
  assert.equal(filas[0].supersede_id, null, "la original no apunta a nadie: es la primera");
  assert.equal(filas[1].supersede_id, fixture.pod, "la corrección no apunta a la fila que corrige");
  assert.equal(filas[1].resultado, "fallo");
});
