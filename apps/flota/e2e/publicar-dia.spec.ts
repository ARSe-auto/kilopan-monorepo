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

test("[AC-FRUT-05] un bloque de RECARGA no es un solape: es una parada más", async ({ request }) => {
  await sembrar();

  // La distinción que decide si el módulo sirve: el §5.2 F4 dice que un bloque de recarga es una
  // parada de la ruta, no un compromiso que compita con ella. Si contara como choque, no se
  // podría publicar el día de ningún camión que cargue de noche — que son todos.
  await con(BD_A, async (c: Conexion) => {
    await c.sql(
      `insert into bloques_agenda (vehiculo_id, tipo, empieza_en, termina_en)
       values ($1, 'recarga',
               (now() at time zone 'America/Santiago')::date::timestamptz + interval '22 hours',
               (now() at time zone 'America/Santiago')::date::timestamptz + interval '30 hours')`,
      [vehiculoId],
    );
  });

  const ruta = (await (
    await request.post(`${EN_A}/api/rutas`, {
      headers: comoOperador,
      data: { nombre: "Ruta con recarga nocturna", vehiculo_id: vehiculoId },
    })
  ).json()) as { ruta: { id: string } };
  await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/asignar`, {
    headers: comoOperador,
    data: { encargos: encargosDeHoy },
  });

  const publicada = await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/publicar`, {
    headers: comoOperador,
  });
  expect(publicada.ok(), "un bloque de recarga rebotó la publicación del día").toBe(true);
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

// ─── El bloque de recarga es una parada más [AC-FRUT-18] — §5.2 F4, §4.5 ─────────────
//
// El §5.2 F4 lo dice sin rodeos. No es una nota al margen ni un recordatorio en otra pantalla:
// el chofer que a las once de la noche tiene que enchufar el camión lo tiene que ver en la MISMA
// lista donde ve las entregas, o no lo ve.
//
// El módulo 02 PROVEE el bloque; la materialización la ejecuta este módulo al publicar. Los dos
// casos que siguen son la conducta entera: que la parada aparezca, y que aparezca en el LUGAR
// que le toca dentro del día — una recarga de mediodía entre la mañana y la tarde, no al final
// por ser recarga.

test("[AC-FRUT-18] el bloque de recarga del día aparece como parada de la ruta publicada", async ({
  request,
}) => {
  await sembrar();

  await con(BD_A, async (c: Conexion) => {
    await c.sql(
      `insert into bloques_agenda (vehiculo_id, tipo, empieza_en, termina_en, nota)
       values ($1, 'recarga',
               (now() at time zone 'America/Santiago')::date::timestamptz + interval '22 hours',
               (now() at time zone 'America/Santiago')::date::timestamptz + interval '30 hours',
               'Carga nocturna')`,
      [vehiculoId],
    );
  });

  const ruta = (await (
    await request.post(`${EN_A}/api/rutas`, {
      headers: comoOperador,
      data: { nombre: "Ruta con carga nocturna", vehiculo_id: vehiculoId },
    })
  ).json()) as { ruta: { id: string } };
  await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/asignar`, {
    headers: comoOperador,
    data: {
      encargos: encargosDeHoy,
      ventana: { desde: "2026-08-10T09:00:00.000Z", hasta: "2026-08-10T12:00:00.000Z" },
    },
  });

  const publicada = await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/publicar`, {
    headers: comoOperador,
  });
  expect(publicada.ok()).toBe(true);
  // Una entrega agrupada + la recarga: el bloque se sumó al día, no lo reemplazó.
  expect((await publicada.json()) as { paradas: number }).toMatchObject({ paradas: 2 });

  const armada = (await (
    await request.get(`${EN_A}/api/rutas/${ruta.ruta.id}`, { headers: comoOperador })
  ).json()) as { paradas: { tipo: string; orden: number; destino: string | null }[] };

  const recarga = armada.paradas.find((p) => p.tipo === "recarga");
  expect(recarga, "el bloque de recarga no se materializó como parada").toBeTruthy();
  // Sin destino: una recarga va a un enchufe, no a una dirección (CHECK de la 0037).
  expect(recarga!.destino).toBeNull();
  // Nocturna: va DESPUÉS de la entrega de la mañana.
  expect(recarga!.orden).toBeGreaterThan(armada.paradas.find((p) => p.tipo === "entrega")!.orden);

  await con(BD_A, async (c: Conexion) => {
    const [ligada] = await c.sql<{ n: string }>(
      `select count(*)::text as n from paradas p join bloques_agenda b on b.id = p.bloque_agenda_id
        where p.ruta_id = $1 and b.tipo = 'recarga'`,
      [ruta.ruta.id],
    );
    // La parada sabe DE QUÉ bloque salió: sin esa liga, mover el bloque y republicar dejaría dos
    // paradas de recarga y nadie sabría cuál es la vigente.
    expect(ligada!.n).toBe("1");
  });
});

test("[AC-FRUT-18] una recarga de mediodía queda ENTRE las entregas, no al final", async ({
  request,
}) => {
  await sembrar();

  // El caso que distingue «se agrega al final» de «va en el orden que le corresponde»: si la
  // implementación solo apendara, esta recarga quedaría después de la entrega de la tarde y el
  // chofer llegaría a la última parada con la batería en el piso.
  await con(BD_A, async (c: Conexion) => {
    await c.sql(
      `insert into bloques_agenda (vehiculo_id, tipo, empieza_en, termina_en)
       values ($1, 'recarga',
               (now() at time zone 'America/Santiago')::date::timestamptz + interval '13 hours',
               (now() at time zone 'America/Santiago')::date::timestamptz + interval '14 hours')`,
      [vehiculoId],
    );
  });

  const ruta = (await (
    await request.post(`${EN_A}/api/rutas`, {
      headers: comoOperador,
      data: { nombre: "Ruta partida por la recarga", vehiculo_id: vehiculoId },
    })
  ).json()) as { ruta: { id: string } };

  // Una entrega a la mañana y otra a la tarde, cada una con su ventana.
  // El día en CHILE y no en UTC: `toISOString()` da el día UTC, y desde las 20:00 de Chile eso
  // ya es el día siguiente — la ventana caería fuera del día de servicio y la recarga quedaría
  // en otro lado. Falla cuatro horas de cada veinticuatro, justo cuando el motor construye.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
  await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/asignar`, {
    headers: comoOperador,
    data: {
      encargos: [encargosDeHoy[0]!],
      ventana: { desde: `${hoy}T12:00:00.000Z`, hasta: `${hoy}T13:00:00.000Z` }, // 08:00 en Chile
    },
  });
  // El segundo encargo va al MISMO destino, así que cae en la misma parada agrupada: para que
  // haya dos paradas de entrega hace falta otro destino.
  await con(BD_A, async (c: Conexion) => {
    const [otro] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local de la tarde', 'Santiago') returning id::text as id",
    );
    await c.sql("update encargos set destino_id = $1 where id = $2", [otro!.id, encargosDeHoy[1]!]);
  });
  await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/asignar`, {
    headers: comoOperador,
    data: {
      encargos: [encargosDeHoy[1]!],
      ventana: { desde: `${hoy}T21:00:00.000Z`, hasta: `${hoy}T22:00:00.000Z` }, // 17:00 en Chile
    },
  });

  await request.post(`${EN_A}/api/rutas/${ruta.ruta.id}/publicar`, { headers: comoOperador });

  const armada = (await (
    await request.get(`${EN_A}/api/rutas/${ruta.ruta.id}`, { headers: comoOperador })
  ).json()) as { paradas: { tipo: string; orden: number }[] };

  const tipos = armada.paradas.sort((a, b) => a.orden - b.orden).map((p) => p.tipo);
  expect(tipos, "la recarga de mediodía no quedó entre las dos entregas").toEqual([
    "entrega",
    "recarga",
    "entrega",
  ]);
});
