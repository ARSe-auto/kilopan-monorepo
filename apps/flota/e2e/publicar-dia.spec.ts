import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { registrarBaseline } from "./baseline-acciones.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Armar y publicar el día en ≤15 clics, y los tres rebotes de planificación [AC-FRUT-05]
// — §5.2-F1, §5.3, §4.2, §4.5, §9.3.5.
//
// ─── EL CONTEO RECORRE LA SECUENCIA COMPLETA, NO UNA PANTALLA ────────────────────
//
// El §5.2 fija cuatro fases: bandeja → armar rutas → «Listos para salir» → publicar. El
// presupuesto del §5.3 son quince clics para las CUATRO, y el AC pide expresamente que el
// tablero —que es del módulo 02— entre en el conteo: así, el día que alguien le agregue un paso
// a esa pantalla, lo que se pone rojo es este número y no la intuición de nadie.
//
// ─── LOS TRES REBOTES SON DE PLANIFICACIÓN, Y VAN CON 0 FILAS ────────────────────
//
// Documento vencido y certificación vencida SOLO con su feature encendida (§4.9); el solape de
// agenda siempre, porque no depende de ninguna feature: un camión no puede estar en dos lugares.
// Los tres se verifican además contra la BASE —que la ruta siga sin publicar y sin promesa
// congelada—, porque un 422 con la fila escrita igual es peor que no rebotar: nadie lo mira.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_OPERADOR = Object.keys(VALIDOS)[1]!;
const SECRETO = secretoNuevo();
const comoOperador = { Authorization: `Portador ${SECRETO}` };
const PATENTE = "KLPP01";

let vehiculoId = "";
let encargosDeHoy: string[] = [];

/** El fixture entero, para poder rearmarlo entre casos sin arrastrar el día anterior. */
async function sembrar() {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien planifica el día') returning id::text as id",
      [RUT_OPERADOR],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'operador') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );

    // Con sus datos EV: el tablero es una FASE del flujo y no un adorno, así que tiene que
    // poder decir algo. `soc` NO se escribe acá —es una proyección y solo la mueve
    // `proyectar_lectura()` (0019)—, y por eso el tablero va a nombrar qué falta, que es
    // exactamente su conducta de vacío accionable (§5.7).
    const [v] = await c.sql<{ id: string }>(
      `insert into vehiculos (patente, tipo, autonomia_nominal_km, bateria_wh)
       values ($1, 'furgon', 250, 60000) returning id::text as id`,
      [PATENTE],
    );
    vehiculoId = v!.id;

    const [panaderia] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del barrio') returning id::text as id",
      [Object.keys(VALIDOS)[4]!],
    );
    const [pasteleria] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Pastelería de la esquina') returning id::text as id",
      [Object.keys(VALIDOS)[5]!],
    );
    const [compartido] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Sucursal compartida', 'Santiago') returning id::text as id",
    );

    // Dos empresas al MISMO destino: el caso del §3.E1.5 recorrido de punta a punta por la
    // pantalla, no solo por el endpoint.
    const ids: string[] = [];
    for (const [empresa, bultos] of [
      [panaderia!.id, 12],
      [pasteleria!.id, 8],
    ] as const) {
      const [e] = await c.sql<{ id: string }>(
        `insert into encargos (empresa_cliente_id, destino_id, bultos)
         values ($1, $2, $3) returning id::text as id`,
        [empresa, compartido!.id, bultos],
      );
      ids.push(e!.id);
    }
    encargosDeHoy = ids;
  });
}

test.beforeAll(sembrar);

/** Cuenta ACCIONES con la convención cerrada del §5.3: un campo de teclado propio = 1. */
function contador(page: Page) {
  let acciones = 0;
  return {
    get acciones() {
      return acciones;
    },
    async tocar(testid: string) {
      acciones++;
      await page.getByTestId(testid).click();
    },
  };
}

async function sesionDe(page: Page, secreto: string) {
  await page.addInitScript((s) => {
    const guardar = () =>
      new Promise<void>((res) => {
        const p = indexedDB.open("flota-aparato", 1);
        p.onupgradeneeded = () => p.result.createObjectStore("claves");
        p.onsuccess = () => {
          const req = p.result.transaction("claves", "readwrite").objectStore("claves").put(s, "secreto-de-sesion");
          req.onsuccess = () => res();
          req.onerror = () => res();
        };
      });
    void guardar();
  }, secreto);
}

test("[AC-FRUT-05] el día se arma y se publica dentro del presupuesto del §5.3", async ({ page }) => {
  await sesionDe(page, SECRETO);
  const c = contador(page);

  // Fase 1 · la bandeja: los encargos ya están cargados (su alta es AC-FRUT-01 y tiene su
  // propio presupuesto). Lo que se cuenta acá es armar el día con ellos.
  await page.goto(`${EN_A}/bandeja`);
  await expect(page.getByTestId("bandeja")).toBeVisible();

  // Fase 2 · armar rutas.
  await page.goto(`${EN_A}/rutas`);
  await expect(page.getByTestId("armar-rutas")).toBeVisible();
  for (const id of encargosDeHoy) await c.tocar(`encargo-${id}`); // 1, 2 · los dos encargos
  await c.tocar(`vehiculo-${PATENTE}`); // 3 · el camión
  await c.tocar("armar-ruta"); // 4

  await expect(page.getByTestId("ruta-armada")).toBeVisible();
  // La agrupación se VE: UNA parada con las dos empresas adentro. Si el operador viera dos
  // filas iguales, agregaría un tercer intento a mano.
  await expect(page.getByTestId("fila-parada")).toHaveCount(1);
  await expect(page.getByTestId("fila-parada")).toContainText("Panadería del barrio");
  await expect(page.getByTestId("fila-parada")).toContainText("Pastelería de la esquina");

  // Fase 3 · «Listos para salir», que es OBLIGATORIA y por eso se cuenta (§5.2-F1).
  await c.tocar("ir-a-listos"); // 5
  await expect(page.getByTestId("listos-para-salir")).toBeVisible();
  await expect(page.getByTestId(`semaforo-${PATENTE}`)).toBeVisible();

  // Fase 4 · publicar el día.
  await c.tocar(`publicar-dia-${PATENTE}`); // 6
  await expect(page.getByTestId(`publicacion-${PATENTE}`)).toContainText("Día publicado");

  expect(
    c.acciones,
    "armar y publicar el día se pasó de los 15 clics del §5.2-F1",
  ).toBeLessThanOrEqual(15);

  const { baseline, acciones } = registrarBaseline({
    flujo: "publicar-dia",
    ac: "AC-FRUT-05",
    acciones: c.acciones,
  });
  expect(acciones, "el contador no midió nada").toBeGreaterThan(0);
  expect(
    acciones,
    `publicar el día pasó de ${baseline} a ${acciones} clics: una feature que sube el conteo del camino feliz no se mergea (§5.3)`,
  ).toBeLessThanOrEqual(baseline);

  // Y lo que publicar CONGELA (§5.2-F1): la versión de la ruta y los requisitos de cada parada.
  await con(BD_A, async (con_: Conexion) => {
    const [ruta] = await con_.sql<{ version: string; publicada: string }>(
      `select version::text as version, (publicada_en is not null)::text as publicada
         from rutas where vehiculo_id = $1`,
      [vehiculoId],
    );
    expect(ruta!.publicada).toBe("true");
    expect(ruta!.version).toBe("1");
  });
});

test("[AC-FRUT-05] publicar congela la promesa que se le hizo al cliente", async ({ request }) => {
  await sembrar();

  const ruta = (await (
    await request.post(`${EN_A}/api/rutas`, {
      headers: comoOperador,
      data: { nombre: "Ruta con ventana", vehiculo_id: vehiculoId },
    })
  ).json()) as { ruta: { id: string } };

  const desde = "2026-08-10T09:00:00.000Z";
  const hasta = "2026-08-10T12:00:00.000Z";
  await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/asignar`, {
    headers: comoOperador,
    data: { encargos: encargosDeHoy, ventana: { desde, hasta } },
  });

  await con(BD_A, async (c: Conexion) => {
    const [antes] = await c.sql<{ n: string }>(
      "select count(*)::text as n from paradas where ruta_id = $1 and promesa_original is not null",
      [ruta.ruta.id],
    );
    // Antes de publicar NO hay promesa: mientras es borrador, la ventana todavía se mueve.
    expect(antes!.n).toBe("0");
  });

  const publicada = await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/publicar`, {
    headers: comoOperador,
  });
  expect(publicada.ok()).toBe(true);
  expect((await publicada.json()) as { promesas: number }).toMatchObject({ promesas: 1 });

  await con(BD_A, async (c: Conexion) => {
    const [parada] = await c.sql<{ igual: string }>(
      `select (promesa_original = ventana)::text as igual from paradas where ruta_id = $1`,
      [ruta.ruta.id],
    );
    // La promesa se copió de la ventana comprometida y desde ahora vive APARTE (§4.5): si se
    // moviera con cada demora, nadie podría decir si se cumplió.
    expect(parada!.igual).toBe("true");
  });
});

test("[AC-FRUT-05] un vehículo con la agenda ocupada rebota 422 y no publica nada", async ({
  request,
}) => {
  await sembrar();

  // Un mantenimiento que ocupa el día entero: el camión no puede hacer dos cosas a la vez.
  await con(BD_A, async (c: Conexion) => {
    await c.sql(
      `insert into bloques_agenda (vehiculo_id, tipo, empieza_en, termina_en)
       values ($1, 'mantencion',
               (now() at time zone 'America/Santiago')::date::timestamptz,
               (now() at time zone 'America/Santiago')::date::timestamptz + interval '1 day')`,
      [vehiculoId],
    );
  });

  const ruta = (await (
    await request.post(`${EN_A}/api/rutas`, {
      headers: comoOperador,
      data: { nombre: "Ruta que choca", vehiculo_id: vehiculoId },
    })
  ).json()) as { ruta: { id: string } };
  await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/asignar`, {
    headers: comoOperador,
    data: { encargos: encargosDeHoy },
  });

  const rebote = await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/publicar`, {
    headers: comoOperador,
  });
  expect(rebote.status()).toBe(422);
  expect(((await rebote.json()) as { error: string }).error).toBe("agenda_solapada");

  // 0 filas: la ruta sigue sin publicar y su versión no se movió. Un 422 con la fila escrita
  // igual es peor que no rebotar, porque nadie lo mira.
  await con(BD_A, async (c: Conexion) => {
    const [r] = await c.sql<{ publicada: string; version: string }>(
      "select (publicada_en is not null)::text as publicada, version::text as version from rutas where id = $1",
      [ruta.ruta.id],
    );
    expect(r!.publicada).toBe("false");
    expect(r!.version).toBe("0");
    const [requisitos] = await c.sql<{ n: string }>(
      `select count(*)::text as n from stop_requirement s join paradas p on p.id = s.parada_id
        where p.ruta_id = $1`,
      [ruta.ruta.id],
    );
    expect(requisitos!.n).toBe("0");
  });
});

test("[AC-FRUT-05] con la feature encendida, un documento vencido rebota la publicación", async ({
  request,
}) => {
  await sembrar();

  await con(BD_A, async (c: Conexion) => {
    await c.sql(
      `insert into vehiculo_documentos (vehiculo_id, tipo, vence_el)
       values ($1, 'revisión técnica', current_date - 30)`,
      [vehiculoId],
    );
  });

  const publicar = async () => {
    const ruta = (await (
      await request.post(`${EN_A}/api/rutas`, {
        headers: comoOperador,
        data: { nombre: "Ruta con papeles vencidos", vehiculo_id: vehiculoId, client_uuid: crypto.randomUUID() },
      })
    ).json()) as { ruta: { id: string } };
    await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/asignar`, {
      headers: comoOperador,
      data: { encargos: encargosDeHoy },
    });
    return {
      id: ruta.ruta.id,
      respuesta: await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/publicar`, { headers: comoOperador }),
    };
  };

  // APAGADA no rebota: el §4.9 es explícito y un tenant que no compró la regla no puede
  // encontrarse con que su día no se publica.
  await entitlement(false, "documentos_vencidos_bloquean");
  const sinFeature = await publicar();
  expect(sinFeature.respuesta.ok()).toBe(true);

  await con(BD_A, async (c: Conexion) => await c.sql("delete from rutas"));

  // ENCENDIDA rebota, y con 0 filas.
  await entitlement(true, "documentos_vencidos_bloquean");
  const conFeature = await publicar();
  expect(conFeature.respuesta.status()).toBe(422);
  expect(((await conFeature.respuesta.json()) as { error: string }).error).toBe("documento_vencido");
  await sinPublicar(conFeature.id);
});

test("[AC-FRUT-05] con la feature encendida, una certificación vencida rebota la publicación", async ({
  request,
}) => {
  await sembrar();

  await con(BD_A, async (c: Conexion) => {
    await c.sql(
      `insert into vehicle_certification (vehiculo_id, tipo, emitida_el, vence_el)
       values ($1, 'transporte de alimentos', current_date - 400, current_date - 30)`,
      [vehiculoId],
    );
  });

  await entitlement(true, "certificaciones_vencidas_bloquean");
  const ruta = (await (
    await request.post(`${EN_A}/api/rutas`, {
      headers: comoOperador,
      data: { nombre: "Ruta sin certificación", vehiculo_id: vehiculoId },
    })
  ).json()) as { ruta: { id: string } };
  await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/asignar`, {
    headers: comoOperador,
    data: { encargos: encargosDeHoy },
  });

  const rebote = await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/publicar`, { headers: comoOperador });
  expect(rebote.status()).toBe(422);
  expect(((await rebote.json()) as { error: string }).error).toBe("certificacion_vencida");
  await sinPublicar(ruta.ruta.id);
});

test("[AC-FRUT-05] una ruta sin vehículo no se publica: nadie la haría", async ({ request }) => {
  await sembrar();
  const ruta = (await (
    await request.post(`${EN_A}/api/rutas`, { headers: comoOperador, data: { nombre: "Ruta huérfana" } })
  ).json()) as { ruta: { id: string } };
  await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/asignar`, {
    headers: comoOperador,
    data: { encargos: encargosDeHoy },
  });

  const rebote = await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/publicar`, { headers: comoOperador });
  expect(rebote.status()).toBe(422);
  expect(((await rebote.json()) as { error: string }).error).toBe("ruta_sin_vehiculo");
});

/**
 * Sella una versión de config con la feature en el estado pedido.
 *
 * El §4.4 congela los entitlements en el snapshot y el runtime NO vuelve a consultar `control`:
 * escribir el toggle allá y esperar que el rebote cambie sería probar algo que en producción no
 * pasa. Es exactamente lo que hará la pantalla «Funciones» del hito (g) cuando alguien lo mueva.
 */
async function entitlement(encendida: boolean, lookupKey: string) {
  await con(BD_A, async (c: Conexion) => {
    await c.sql("select crear_config_version($1, $2::jsonb)", [
      `toggle del fixture: ${lookupKey}`,
      JSON.stringify({ [lookupKey]: encendida }),
    ]);
  });
}

/** La ruta no quedó publicada, no ganó versión y no derivó ningún requisito: 0 filas de verdad. */
async function sinPublicar(rutaId: string) {
  await con(BD_A, async (c: Conexion) => {
    const [r] = await c.sql<{ publicada: string; version: string }>(
      "select (publicada_en is not null)::text as publicada, version::text as version from rutas where id = $1",
      [rutaId],
    );
    expect(r!.publicada).toBe("false");
    expect(r!.version).toBe("0");
  });
}
