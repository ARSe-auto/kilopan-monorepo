import { test, expect } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Rutas maestras y el día que nace de ellas [AC-FRUT-06] — §3.E1.6, §4.5, §5.7.
//
// ─── LO QUE EL AC FIJA, Y LO QUE DEJA ABIERTO ────────────────────────────────────
//
// Fija tres cosas observables: la ruta del día nace con origen `maestra` y versión propia, la
// maestra queda INTACTA tras editar el día, y en un viewport de 375 px no hay drag & drop y no
// se pierde nada. Deja abierto el mecanismo —copia o referencia con overrides— en la pregunta 2
// de la spec 03, y por eso este archivo mira lo observable y no cómo está hecho por dentro.
//
// ─── EL CASO QUE DECIDE SI ESTÁ BIEN HECHO ──────────────────────────────────────
//
// Editar el día y volver a mirar la maestra. Con referencias más overrides mal resueltos, esa
// edición viaja hacia arriba y cambia doce rutas futuras a la vez — y nadie lo nota hasta que un
// camión sale distinto. El test reordena las paradas del día y exige que la plantilla no se haya
// movido un milímetro.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const comoOperador = { Authorization: `Portador ${SECRETO}` };

let maestraId = "";
let vehiculoId = "";
/** Los nombres de los destinos de la maestra, en el orden en que la plantilla los pone. */
const EN_LA_PLANTILLA = ["Primera del recorrido", "Segunda del recorrido", "Tercera del recorrido"];

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien arma las plantillas') returning id::text as id",
      [Object.keys(VALIDOS)[1]!],
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
    const [v] = await c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ('KLPM01', 'furgon') returning id::text as id",
    );
    vehiculoId = v!.id;

    const [m] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, es_maestra) values ('Recorrido de la madrugada', true)
       returning id::text as id`,
    );
    maestraId = m!.id;
    for (const [i, nombre] of EN_LA_PLANTILLA.entries()) {
      const [d] = await c.sql<{ id: string }>(
        "insert into destinos (nombre) values ($1) returning id::text as id",
        [nombre],
      );
      await c.sql(
        "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', $2, $3)",
        [maestraId, i + 1, d!.id],
      );
    }
  });
});

/** Las paradas de una ruta, por nombre de destino y en su orden. */
async function elRecorridoDe(rutaId: string): Promise<string[]> {
  const filas = await con(BD_A, (c: Conexion) =>
    c.sql<{ nombre: string }>(
      `select d.nombre from paradas p join destinos d on d.id = p.destino_id
        where p.ruta_id = $1 order by p.orden`,
      [rutaId],
    ),
  );
  return filas.map((f: { nombre: string }) => f.nombre);
}

test("[AC-FRUT-06] el día nace de la maestra con origen `maestra` y versión propia", async ({
  request,
}) => {
  const hecha = await request.post(`${EN_A}/api/maestras`, {
    headers: comoOperador,
    data: { maestra_id: maestraId, vehiculo_id: vehiculoId },
  });
  expect(hecha.status()).toBe(201);

  const { ruta, paradas } = (await hecha.json()) as {
    ruta: { id: string; origen: string; version: number; publicada: boolean };
    paradas: number;
  };
  expect(ruta.origen).toBe("maestra");
  // Versión PROPIA: nace en 0 —todavía es borrador— y la fija su propio «Publicar día». Que
  // herede la de la maestra la dejaría diciendo que ya se publicó algo que nadie publicó.
  expect(ruta.version).toBe(0);
  expect(ruta.publicada).toBe(false);
  expect(paradas).toBe(EN_LA_PLANTILLA.length);
  // Y el recorrido llegó completo y en orden: una plantilla que se instancia a medias es peor
  // que ninguna, porque el operador cree que tiene el día armado.
  expect(await elRecorridoDe(ruta.id)).toEqual(EN_LA_PLANTILLA);
});

test("[AC-FRUT-06] editar el día NO toca la maestra", async ({ request }) => {
  const { ruta } = (await (
    await request.post(`${EN_A}/api/maestras`, {
      headers: comoOperador,
      data: { maestra_id: maestraId, vehiculo_id: vehiculoId, fecha_servicio: "2026-09-01" },
    })
  ).json()) as { ruta: { id: string } };

  const paradas = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "select id::text as id from paradas where ruta_id = $1 order by orden desc",
      [ruta.id],
    ),
  );

  // Al revés: la última primero. Es la edición del día.
  const alReves = await request.patch(`${EN_A}/api/rutas/${ruta.id}/paradas`, {
    headers: comoOperador,
    data: { paradas: paradas.map((p: { id: string }) => p.id) },
  });
  expect(alReves.ok()).toBe(true);

  expect(await elRecorridoDe(ruta.id)).toEqual([...EN_LA_PLANTILLA].reverse());
  // Y la plantilla no se movió un milímetro. Es EL caso: con referencias más overrides mal
  // resueltos, esta edición viaja hacia arriba y cambia todas las rutas futuras a la vez.
  expect(await elRecorridoDe(maestraId), "editar el día movió la maestra").toEqual(EN_LA_PLANTILLA);
});

test("[AC-FRUT-06] instanciar desde una ruta que NO es maestra rebota", async ({ request }) => {
  const { ruta } = (await (
    await request.post(`${EN_A}/api/rutas`, {
      headers: comoOperador,
      data: { nombre: "Un día cualquiera", vehiculo_id: vehiculoId },
    })
  ).json()) as { ruta: { id: string } };

  const rebote = await request.post(`${EN_A}/api/maestras`, {
    headers: comoOperador,
    data: { maestra_id: ruta.id },
  });
  // Copiar un día concreto produciría una plantilla con cara de plantilla que en realidad es el
  // martes pasado, y el operador la editaría creyendo que no toca nada.
  expect(rebote.status()).toBe(422);
  expect(((await rebote.json()) as { error: string }).error).toBe("no_es_maestra");
});

test("[AC-FRUT-06] las maestras no salen en la lista de días ni se publican", async ({ request }) => {
  const { rutas } = (await (
    await request.get(`${EN_A}/api/rutas`, { headers: comoOperador })
  ).json()) as { rutas: { id: string }[] };
  // La plantilla no es un día: si apareciera en la lista del día, alguien le asignaría encargos.
  expect(rutas.map((r) => r.id)).not.toContain(maestraId);

  const { maestras } = (await (
    await request.get(`${EN_A}/api/maestras`, { headers: comoOperador })
  ).json()) as { maestras: { id: string }[] };
  expect(maestras.map((m) => m.id)).toContain(maestraId);

  // Y el CHECK de la 0037 lo sostiene aunque alguien llame al endpoint de publicar.
  await con(BD_A, async (c: Conexion) => {
    await expect(
      c.sql("update rutas set publicada_en = now(), version = 1 where id = $1", [maestraId]),
    ).rejects.toThrow(/maestra_no_se_publica/);
  });
});

test("[AC-FRUT-06] reordenar con una lista incompleta no pierde ninguna parada", async ({
  request,
}) => {
  const { ruta } = (await (
    await request.post(`${EN_A}/api/maestras`, {
      headers: comoOperador,
      data: { maestra_id: maestraId, vehiculo_id: vehiculoId, fecha_servicio: "2026-09-02" },
    })
  ).json()) as { ruta: { id: string } };

  const paradas = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "select id::text as id from paradas where ruta_id = $1 order by orden",
      [ruta.id],
    ),
  );

  // Solo la última, movida al frente. Las otras dos no se nombran: es lo que manda una pantalla
  // que arrastró una sola tarjeta.
  await request.patch(`${EN_A}/api/rutas/${ruta.id}/paradas`, {
    headers: comoOperador,
    data: { paradas: [paradas[2]!.id] },
  });

  const recorrido = await elRecorridoDe(ruta.id);
  // Las tres siguen, y las no nombradas conservaron su orden relativo detrás. Perder una porque
  // la lista venía incompleta sería la pérdida de datos que el AC prohíbe.
  expect(recorrido).toHaveLength(EN_LA_PLANTILLA.length);
  expect(recorrido[0]).toBe(EN_LA_PLANTILLA[2]);
  expect(recorrido.slice(1)).toEqual([EN_LA_PLANTILLA[0], EN_LA_PLANTILLA[1]]);
});

// ─── La mitad de pantalla: arrastrar es de escritorio [AC-FRUT-06] — §3.E1.6, §5.7 ──
//
// El AC lo pide con el número adentro: «viewport móvil 375px: sin drag & drop y sin pérdida de
// datos». Las dos mitades importan y la segunda es la que se olvida — quitar el arrastre sin
// poner nada en su lugar deja al operador de teléfono sin poder reordenar, que es pérdida de
// datos por omisión.

async function sesionDe(page: import("@playwright/test").Page) {
  await page.addInitScript((s) => {
    const guardar = () =>
      new Promise<void>((res) => {
        const p = indexedDB.open("flota-aparato", 1);
        p.onupgradeneeded = () => p.result.createObjectStore("claves");
        p.onsuccess = () => {
          const r = p.result.transaction("claves", "readwrite").objectStore("claves").put(s, "secreto-de-sesion");
          r.onsuccess = () => res();
          r.onerror = () => res();
        };
      });
    void guardar();
  }, SECRETO);
}

test("[AC-FRUT-06] en 375 px no hay arrastre, y el orden igual se puede cambiar", async ({ page }) => {
  await sesionDe(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${EN_A}/maestras`);

  await page.getByTestId(`maestra-${maestraId}`).click();
  await expect(page.getByTestId("recorrido")).toBeVisible();
  // El recorrido se pinta cuando llegan las paradas: contar antes mediría el marco vacío.
  await expect(page.locator('[data-testid^="parada-"]').first()).toBeVisible();

  // NADA arrastrable: en 375 px el arrastre compite con el scroll y con el gesto de volver
  // atrás del sistema, y la parada se suelta donde nadie quiso.
  const arrastrables = await page.evaluate(
    () => document.querySelectorAll('[draggable="true"]').length,
  );
  expect(arrastrables, "hay elementos arrastrables en viewport móvil").toBe(0);

  // Y la vía que reemplaza al arrastre existe, se ve y FUNCIONA.
  await expect(page.getByTestId("como-se-ordena")).toContainText("flechas");
  const paradas = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "select id::text as id from paradas where ruta_id = $1 order by orden",
      [maestraId],
    ),
  );
  await page.getByTestId(`bajar-${paradas[0]!.id}`).click();
  await expect(page.getByTestId("aviso-orden")).toContainText("Orden guardado");

  const despues = await elRecorridoDe(maestraId);
  // La primera bajó un lugar. Sin pérdida: siguen las tres.
  expect(despues).toHaveLength(EN_LA_PLANTILLA.length);
  expect(despues[1]).toBe(EN_LA_PLANTILLA[0]);
});

test("[AC-FRUT-06] en escritorio SÍ se arrastra, y el texto lo dice", async ({ page }) => {
  await sesionDe(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${EN_A}/maestras`);

  await page.getByTestId(`maestra-${maestraId}`).click();
  await expect(page.getByTestId("recorrido")).toBeVisible();
  // El recorrido se pinta cuando llegan las paradas: contar antes mediría el marco vacío.
  await expect(page.locator('[data-testid^="parada-"]').first()).toBeVisible();

  // El texto primero: es lo que confirma que la pantalla YA resolvió en qué ancho está. Contar
  // los arrastrables antes de eso mediría el render previo al efecto y el caso pasaría —o
  // fallaría— por una carrera y no por la conducta.
  await expect(page.getByTestId("como-se-ordena")).toContainText("Arrastr");

  // Sin este positivo, «no hay arrastre en móvil» lo cumpliría una pantalla que no tiene
  // arrastre en ningún lado — y el §3.E1.6 lo pide en escritorio.
  const arrastrables = await page.evaluate(
    () => document.querySelectorAll('[draggable="true"]').length,
  );
  expect(arrastrables, "en escritorio no hay nada que arrastrar").toBeGreaterThan(0);
});
