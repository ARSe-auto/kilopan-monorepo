import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { registrarBaseline } from "./baseline-acciones.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { CIFRA_OPERATIVA, UNDO } from "../../../packages/nucleo-comun/src/constants.ts";

// La recepción de carga en el andén (F2) [AC-FRUT-07] — §5.2 F2, §5.3, §0, §4.7, §7.6.
//
// ─── LO QUE ESTE ARCHIVO PROTEGE ──────────────────────────────────────────────────
//
// Tres cosas que se pierden calladas y cuestan caro:
//
//   1. El PRESUPUESTO. ≤4 acciones por acción de terreno (§5.3). El andén se opera a las cuatro
//      de la mañana con guantes; cada toque de más es un conteo que se hace de memoria al final.
//   2. La CIFRA operativa del §0 —su tamaño, su peso y `tabular-nums`—, medida sobre el DOM
//      computado y contra la familia canónica, no contra números escritos acá: si el dueño la
//      cambia, este test tiene que enterarse. Sin `tabular-nums` los dígitos bailan al mirarlos.
//   3. El SUB-MANIFIESTO POR EMPRESA. Un conteo único con la suma haría imposible decir de quién
//      faltaron las bandejas, que es la pregunta del día siguiente.
//
// ─── Y QUE «CONFORME» SEA LA ÚNICA CONFIRMACIÓN ──────────────────────────────────
//
// Cero modales (§7.6). El toque abre una ventana de ocho segundos y recién entonces la captura
// viaja: el caso del undo verifica que deshacer DENTRO de la ventana no deja fila. Sin él, «hay
// un botón de deshacer» sería cierto y no significaría nada.

// El tenant de los HECHOS, como `recargas` y `chequeos`. Esta suite deja manifiestos, y un
// manifiesto es append-only: sostiene su parada, su ruta, sus ítems, sus encargos y el vehículo,
// y ninguno de esos se puede borrar después. En el tenant compartido eso le rompe la limpieza a
// las demás — que fue exactamente lo que pasó.
const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const comoOperador = { Authorization: `Portador ${SECRETO}` };
const PATENTE = "KLPC01";

let paradaId = "";
let panaderia = "";
let pasteleria = "";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien recibe en el andén') returning id::text as id",
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

    // Buscar-o-crear, y no crear a secas: un vehículo con una ruta cuya parada ya tiene
    // manifiesto NO se puede borrar (§7.4), así que sobrevive a la limpieza y el insert chocaría
    // con su UNIQUE de patente. Es la conducta correcta de la base; el fixture se adapta.
    const [v] = await c.sql<{ id: string }>(
      `insert into vehiculos (patente, tipo) values ($1, 'furgon')
         on conflict (tenant_id, patente) do update set tipo = excluded.tipo
       returning id::text as id`,
      [PATENTE],
    );
    const [una] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del barrio')
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [Object.keys(VALIDOS)[4]!],
    );
    const [otra] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Pastelería de la esquina')
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [Object.keys(VALIDOS)[5]!],
    );
    panaderia = una!.id;
    pasteleria = otra!.id;

    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Sucursal compartida') returning id::text as id",
    );
    // La ruta PUBLICADA del día, con su parada de carga y la carga de DOS empresas: es el caso
    // consolidado del piloto B y el único en que el sub-manifiesto por empresa se nota.
    const [r] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, vehiculo_id, publicada_en, version)
       values ('Ruta de la madrugada', $1, now(), 1) returning id::text as id`,
      [v!.id],
    );
    const [parada] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, destino!.id],
    );
    paradaId = parada!.id;

    for (const [empresa, bultos] of [
      [panaderia, 12],
      [pasteleria, 8],
    ] as const) {
      const [e] = await c.sql<{ id: string }>(
        "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
        [empresa, destino!.id, bultos],
      );
      await c.sql(
        "insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)",
        [paradaId, e!.id, bultos],
      );
    }
  });
});

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
    async teclear(caracteres: string, dentroDe: string) {
      acciones++;
      const alcance = page.getByTestId(dentroDe);
      for (const c of caracteres) {
        await alcance.getByRole("button", { name: c, exact: true }).click();
      }
    },
  };
}

async function sesionDe(page: Page) {
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

const cuantosManifiestos = () =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from manifiestos"),
  ).then((r) => Number(r[0]!.n));

test("[AC-FRUT-07] recibir conforme entra en el presupuesto del §5.3", async ({ page }) => {
  await sesionDe(page);
  const c = contador(page);
  await page.goto(`${EN_A}/carga`);
  await expect(page.getByTestId("recepcion-de-carga")).toBeVisible();

  await c.teclear("1234", "teclado-pin"); // 1 · el PIN entero = 1 acción (§5.3)
  await c.tocar("continuar-pin");
  await c.tocar(`vehiculo-${PATENTE}`); // 2 · el camión

  await expect(page.getByTestId("paso-conteo")).toBeVisible();
  // DOS sub-manifiestos, uno por empresa: cada panadería responde por lo suyo.
  await expect(page.getByTestId(`sub-manifiesto-${panaderia}`)).toBeVisible();
  await expect(page.getByTestId(`sub-manifiesto-${pasteleria}`)).toBeVisible();

  await c.tocar(`conforme-${panaderia}`); // 3 · «Conforme»
  await expect(page.getByTestId(`confirmado-${panaderia}`)).toBeVisible({ timeout: 15_000 });

  expect(
    c.acciones,
    "recibir la carga se pasó del presupuesto de 4 acciones del §5.3",
  ).toBeLessThanOrEqual(4);

  const { baseline, acciones } = registrarBaseline({
    flujo: "recepcion-de-carga",
    ac: "AC-FRUT-07",
    acciones: c.acciones,
  });
  expect(acciones, "el contador no midió nada").toBeGreaterThan(0);
  expect(
    acciones,
    `la recepción pasó de ${baseline} a ${acciones} acciones: una regresión del camino feliz no se mergea (§5.3)`,
  ).toBeLessThanOrEqual(baseline);

  // El teclado del SISTEMA jamás aparece (§5.7): se verifica sobre el DOM, no de memoria.
  const inputs = await page.evaluate(() => document.querySelectorAll("input, textarea").length);
  expect(inputs, "la pantalla del andén tiene un campo del sistema").toBe(0);
});

test("[AC-FRUT-07] la cifra operativa cumple la familia canónica del §0", async ({
  page,
}) => {
  await sesionDe(page);
  await page.goto(`${EN_A}/carga`);
  await page.getByTestId("teclado-pin").getByRole("button", { name: "1", exact: true }).click();
  await page.getByTestId("teclado-pin").getByRole("button", { name: "2", exact: true }).click();
  await page.getByTestId("teclado-pin").getByRole("button", { name: "3", exact: true }).click();
  await page.getByTestId("teclado-pin").getByRole("button", { name: "4", exact: true }).click();
  await page.getByTestId("continuar-pin").click();
  await page.getByTestId(`vehiculo-${PATENTE}`).click();
  await expect(page.getByTestId(`cifra-${panaderia}`)).toBeVisible();

  const medido = await page.evaluate((testid) => {
    const nodo = document.querySelector(`[data-testid="${testid}"] span`);
    const estilo = window.getComputedStyle(nodo!);
    return {
      px: Number.parseFloat(estilo.fontSize),
      peso: Number.parseInt(estilo.fontWeight, 10),
      numerica: estilo.fontVariantNumeric,
    };
  }, `cifra-${panaderia}`);

  // Se compara contra la familia canónica y NO contra números escritos a mano: el día que el
  // dueño cambie el §0, este test tiene que enterarse en vez de seguir verde con el valor viejo.
  expect(medido.px).toBe(CIFRA_OPERATIVA.tamano_px);
  expect(medido.peso).toBe(CIFRA_OPERATIVA.peso);
  // Sin esto, los dígitos bailan al actualizarse y el número se vuelve ilegible justo cuando se
  // lo mira de lejos.
  expect(medido.numerica).toContain(CIFRA_OPERATIVA.variante_numerica);
});

test("[AC-FRUT-07] deshacer DENTRO de la ventana no deja fila", async ({ page }) => {
  // `manifiestos` es append-only: no se limpia, se mide por DIFERENCIA (§7.4).
  const antes = await cuantosManifiestos();

  await sesionDe(page);
  await page.goto(`${EN_A}/carga`);
  for (const d of "1234") {
    await page.getByTestId("teclado-pin").getByRole("button", { name: d, exact: true }).click();
  }
  await page.getByTestId("continuar-pin").click();
  await page.getByTestId(`vehiculo-${PATENTE}`).click();

  await page.getByTestId(`conforme-${pasteleria}`).click();
  // El botón de deshacer está mientras dura la ventana. Que exista es la mitad; la otra es que
  // usarlo impida la captura, y eso se mide contra la BASE.
  await expect(page.getByTestId(`deshacer-${pasteleria}`)).toBeVisible();
  await page.getByTestId(`deshacer-${pasteleria}`).click();

  // Se espera MÁS que la ventana entera: si el `setTimeout` hubiera sobrevivido al deshacer, la
  // fila aparecería justo después y el test lo vería.
  await page.waitForTimeout(UNDO.ventana_ms + 1_500);
  expect(await cuantosManifiestos(), "deshacer dejó el manifiesto escrito igual").toBe(antes);
});

test("[AC-FRUT-07] la captura JAMÁS rebota, y el replay no cuenta el andén dos veces", async ({
  request,
}) => {
  // Escenario PROPIO: la parada del fixture puede traer manifiestos de los casos anteriores —son
  // hechos y no se borran— y entonces el primer POST ligaría en vez de crear. Una parada nueva
  // deja el caso midiendo lo que dice medir.
  const propia = await con(BD_A, async (c: Conexion) => {
    const [r] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, publicada_en, version)
       values ('Ruta del caso de replay', now(), 1) returning id::text as id`,
    );
    const [d] = await c.sql<{ id: string }>(
      "select id::text as id from destinos limit 1",
    );
    const [p] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, d!.id],
    );
    const [e] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 12) returning id::text as id",
      [panaderia, d!.id],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 12)", [
      p!.id,
      e!.id,
    ]);
    return p!.id;
  });

  const clientUuid = crypto.randomUUID();
  const cuerpo = {
    empresa_cliente_id: panaderia,
    client_uuid: clientUuid,
    ts_dispositivo: new Date().toISOString(),
    tz_offset_min: -240,
    conteos: [] as unknown[],
  };

  const { declarado } = (await (
    await request.get(`${EN_A}/api/paradas/${propia}/manifiesto`, { headers: comoOperador })
  ).json()) as { declarado: { item_id: string; empresa_cliente_id: string; qty_declarada: number }[] };
  const suyos = declarado.filter((d) => d.empresa_cliente_id === panaderia);
  // Se cuenta MENOS de lo declarado: la discrepancia es el dato, no un error.
  cuerpo.conteos = suyos.map((d) => ({ item_id: d.item_id, qty_confirmada: d.qty_declarada - 2 }));

  const primera = await request.post(`${EN_A}/api/paradas/${propia}/manifiesto`, {
    headers: comoOperador,
    data: cuerpo,
  });
  expect(primera.status()).toBe(201);
  expect((await primera.json()) as { discrepancias: number }).toMatchObject({ discrepancias: 1 });

  // Replay: 2xx igual —es CAPTURA, jamás rebota— y UNA sola fila (§4.2, §9.3.1).
  const segunda = await request.post(`${EN_A}/api/paradas/${propia}/manifiesto`, {
    headers: comoOperador,
    data: cuerpo,
  });
  expect(segunda.status()).toBe(200);
  expect((await segunda.json()) as { repetido: boolean }).toMatchObject({ repetido: true });

  await con(BD_A, async (c: Conexion) => {
    const [n] = await c.sql<{ n: string }>(
      "select count(*)::text as n from manifiestos where parada_id = $1",
      [propia],
    );
    expect(n!.n).toBe("1");

    // Y la discrepancia quedó GENERADA por la base, no escrita por el servidor: un tercer
    // número escrito a mano puede no cuadrar con los otros dos.
    const [item] = await c.sql<{ declarada: string; confirmada: string; discrepancia: string }>(
      `select qty_declarada::text as declarada, qty_confirmada::text as confirmada,
              discrepancia::text as discrepancia
         from manifiesto_items mi join manifiestos m on m.id = mi.manifiesto_id
        where m.parada_id = $1`,
      [propia],
    );
    expect(Number(item!.discrepancia)).toBe(Number(item!.confirmada) - Number(item!.declarada));
    expect(Number(item!.discrepancia)).toBe(-2);
  });
});

test("[AC-FRUT-07] el manifiesto es un HECHO: no se edita ni se borra", async () => {
  await con(BD_A, async (c: Conexion) => {
    const [m] = await c.sql<{ id: string }>("select id::text as id from manifiestos limit 1");
    // §7.4, desde el día 1. La corrección es supersede con motivo y autor (AC-FRUT-09); lo que
    // no puede haber es una fila de custodia que alguien edite «solo esta vez».
    await expect(
      c.sql("update manifiestos set tz_offset_min = 0 where id = $1", [m!.id]),
    ).rejects.toThrow();
    await expect(c.sql("delete from manifiestos where id = $1", [m!.id])).rejects.toThrow();
  });
});

// ─── El DTE gate [AC-FRUT-08] — §7.3, §4.6, §5.2 F2, art. 55 DL 825 ─────────────────
//
// ─── LO QUE ESTE BLOQUE PROTEGE ───────────────────────────────────────────────────
//
// Que la mercadería sin documento NO quede a bordo, y que la única salida sea BAJARLA con su
// motivo. Sin la segunda mitad, la primera se convierte en su contrario: el operario con un
// camión que sale a las cinco confirma con un folio inventado, y ahí sí la app produjo un dato
// falso — que es exactamente lo que el art. 55 vino a evitar.
//
// El invariante vive en un CHECK de la base y no en el servidor, así que la consulta que se
// olvide de mirarlo rebota igual. Y va NOT VALID: los manifiestos anteriores al gate se firmaron
// cuando nadie pedía documento, y declararlos ilegales retroactivamente sería reescribir la
// historia de una tabla append-only.

/** Un manifiesto nuevo con un solo ítem, para ejercer el gate sin arrastrar los casos previos. */
async function unItemAConfirmar(request: import("@playwright/test").APIRequestContext) {
  const propia = await con(BD_A, async (c: Conexion) => {
    const [r] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, publicada_en, version)
       values ('Ruta del DTE gate', now(), 1) returning id::text as id`,
    );
    const [d] = await c.sql<{ id: string }>("select id::text as id from destinos limit 1");
    const [p] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, d!.id],
    );
    const [e] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 9) returning id::text as id",
      [panaderia, d!.id],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 9)", [
      p!.id,
      e!.id,
    ]);
    return p!.id;
  });

  const { declarado } = (await (
    await request.get(`${EN_A}/api/paradas/${propia}/manifiesto`, { headers: comoOperador })
  ).json()) as { declarado: { item_id: string; empresa_cliente_id: string }[] };

  await request.post(`${EN_A}/api/paradas/${propia}/manifiesto`, {
    headers: comoOperador,
    data: {
      empresa_cliente_id: panaderia,
      client_uuid: crypto.randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
      conteos: declarado
        .filter((d) => d.empresa_cliente_id === panaderia)
        .map((d) => ({ item_id: d.item_id, qty_confirmada: 9 })),
    },
  });

  const [item] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      `select mi.id::text as id from manifiesto_items mi
         join manifiestos m on m.id = mi.manifiesto_id where m.parada_id = $1`,
      [propia],
    ),
  );
  return item!.id;
}

test("[AC-FRUT-08] el documento del tercero se asocia, y dos capturas del mismo LIGAN", async ({
  request,
}) => {
  const itemId = await unItemAConfirmar(request);
  const documento = { tipo: "52", folio: "9876543", emisor: "76.111.111-6" };

  const primera = await request.post(`${EN_A}/api/manifiesto-items/${itemId}/documento`, {
    headers: comoOperador,
    data: documento,
  });
  expect(primera.status()).toBe(201);
  const { reference_document_id, ligado } = (await primera.json()) as {
    reference_document_id: string;
    ligado: boolean;
  };
  expect(ligado).toBe(false);

  // Otro ítem, el MISMO documento: es el caso normal —varios bultos en la misma guía— y tiene
  // que ligar a la fila que hay, no duplicarla (§4.2, `UNIQUE(tipo, folio, emisor)`).
  const otroItem = await unItemAConfirmar(request);
  const segunda = await request.post(`${EN_A}/api/manifiesto-items/${otroItem}/documento`, {
    headers: comoOperador,
    data: documento,
  });
  expect(segunda.status()).toBe(201);
  const ligada = (await segunda.json()) as { reference_document_id: string; ligado: boolean };
  expect(ligada.ligado).toBe(true);
  expect(ligada.reference_document_id).toBe(reference_document_id);

  await con(BD_A, async (c: Conexion) => {
    const [n] = await c.sql<{ n: string }>(
      "select count(*)::text as n from reference_document where folio = $1",
      [documento.folio],
    );
    expect(n!.n).toBe("1");
  });
});

test("[AC-FRUT-08] la carga sin documento NO puede salir, y bajarla la saca del gate", async ({
  request,
}) => {
  const itemId = await unItemAConfirmar(request);

  const sinDocumento = async () =>
    con(BD_A, (c: Conexion) =>
      c.sql<{ id: string }>(
        `select f.manifiesto_item_id::text as id
           from manifiesto_items mi, carga_sin_documento(mi.manifiesto_id) f
          where mi.id = $1`,
        [itemId],
      ),
    );

  // Contado y a bordo, sin papel: el art. 55 dice que así no viaja. La fila EXISTE —es captura y
  // el conteo del andén no se rechaza— pero el gate la nombra.
  expect((await sinDocumento()).map((f: { id: string }) => f.id)).toContain(itemId);

  // Primera salida: asociar el documento del tercero.
  await request.post(`${EN_A}/api/manifiesto-items/${itemId}/documento`, {
    headers: comoOperador,
    data: { tipo: "52", folio: "5550001", emisor: "76.111.111-6" },
  });
  expect((await sinDocumento()).map((f: { id: string }) => f.id)).not.toContain(itemId);

  // Segunda salida: bajarlo del manifiesto. Sin ELLA, la primera se convierte en su contrario —
  // el operario con un camión que sale a las cinco confirma con un folio inventado.
  const otro = await unItemAConfirmar(request);
  const antesDeBajar = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      `select f.manifiesto_item_id::text as id
         from manifiesto_items mi, carga_sin_documento(mi.manifiesto_id) f
        where mi.id = $1`,
      [otro],
    ),
  );
  expect(antesDeBajar.map((f: { id: string }) => f.id)).toContain(otro);

  await request.post(`${EN_A}/api/manifiesto-items/${otro}/bajar`, {
    headers: comoOperador,
    data: { motivo: "Sin guía del emisor: se baja del camión" },
  });
  const despuesDeBajar = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      `select f.manifiesto_item_id::text as id
         from manifiesto_items mi, carga_sin_documento(mi.manifiesto_id) f
        where mi.id = $1`,
      [otro],
    ),
  );
  expect(despuesDeBajar.map((f: { id: string }) => f.id)).not.toContain(otro);
});

test("[AC-FRUT-08] contar CERO no pide documento: no hay mercadería que amparar", async () => {
  await con(BD_A, async (c: Conexion) => {
    const [d] = await c.sql<{ id: string }>("select id::text as id from destinos limit 1");
    const [r] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, publicada_en, version)
       values ('Ruta del cero', now(), 1) returning id::text as id`,
    );
    const [p] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, d!.id],
    );
    const [e] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 4) returning id::text as id",
      [panaderia, d!.id],
    );
    const [i] = await c.sql<{ id: string }>(
      "insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 4) returning id::text as id",
      [p!.id, e!.id],
    );
    const [m] = await c.sql<{ id: string }>(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240) returning id::text as id`,
      [p!.id, panaderia],
    );
    await c.sql(
      `insert into manifiesto_items (manifiesto_id, item_id, qty_declarada, qty_confirmada)
       values ($1, $2, 4, 0)`,
      [m!.id, i!.id],
    );

    // «No subió nada» es una respuesta válida del andén, y la más importante. Exigirle documento
    // dejaría el manifiesto trabado por una carga que no existe.
    const trabados = await c.sql<{ id: string }>(
      "select manifiesto_item_id::text as id from carga_sin_documento($1)",
      [m!.id],
    );
    expect(trabados).toHaveLength(0);
  });
});

test("[AC-FRUT-08] bajar del manifiesto es EXPLÍCITO: exige motivo y deja evento", async ({
  request,
}) => {
  const itemId = await unItemAConfirmar(request);

  // Sin motivo no se baja. No es burocracia: sin texto, mañana nadie sabe por qué faltó esa
  // carga, y el §7.3 pide que la vía sea explícita y no un override silencioso.
  const sinMotivo = await request.post(`${EN_A}/api/manifiesto-items/${itemId}/bajar`, {
    headers: comoOperador,
    data: { motivo: "" },
  });
  expect(sinMotivo.status()).toBe(422);
  expect(((await sinMotivo.json()) as { error: string }).error).toBe("falta_motivo");

  const eventosAntes = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      "select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id where t.codigo = 'manifiesto.item_bajado'",
    ),
  );

  const bajado = await request.post(`${EN_A}/api/manifiesto-items/${itemId}/bajar`, {
    headers: comoOperador,
    data: { motivo: "La guía no llegó del emisor: sale en el viaje de la tarde" },
  });
  expect(bajado.ok()).toBe(true);

  await con(BD_A, async (c: Conexion) => {
    const [item] = await c.sql<{ motivo: string | null }>(
      "select bajado_motivo as motivo from manifiesto_item_documento where manifiesto_item_id = $1",
      [itemId],
    );
    expect(item!.motivo).toContain("La guía no llegó");

    // El evento queda: la bajada emite rastro y auditoría, jamás un override silencioso (§7.3).
    // Se cuenta por DIFERENCIA porque `eventos` es append-only y arrastra lo de cada suite.
    const [despues] = await c.sql<{ n: string }>(
      "select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id where t.codigo = 'manifiesto.item_bajado'",
    );
    expect(Number(despues!.n)).toBe(Number(eventosAntes[0]!.n) + 1);
  });
});

test("[AC-FRUT-08] un tipo de documento que el SII no define no entra", async ({ request }) => {
  const itemId = await unItemAConfirmar(request);
  const rebote = await request.post(`${EN_A}/api/manifiesto-items/${itemId}/documento`, {
    headers: comoOperador,
    data: { tipo: "99", folio: "1", emisor: "76.111.111-6" },
  });
  // El enum del §4.6 tiene los cuatro que el SII define para esto. Un quinto sería la app
  // inventando una clase de documento tributario.
  expect(rebote.status()).toBe(422);
  expect(((await rebote.json()) as { error: string }).error).toBe("documento_incompleto");
});

// ─── El traspaso de custodia [AC-FRUT-09] — §4.3, §4.5, §4.6, §7.4, centinelas 6 y 12 ──
//
// ─── LO QUE SOSTIENE LA DISPUTA ───────────────────────────────────────────────────
//
// Tres semanas después, «yo la entregué completa» y «a mí me la dieron así» son dos afirmaciones
// sin nada en medio salvo esta fila. Por eso lleva las dos firmas, el doble reloj y quién a
// quién — y por eso no se edita nunca.
//
// Los tres casos que decide este bloque: la doble firma con su excepción de UNA sola cuando el
// que carga y el que maneja son la misma persona; que la fila sea intocable para el rol de app; y
// que corregirla deje DOS filas con la original intacta, que es lo que separa una corrección
// auditable de una que nadie puede distinguir de un encubrimiento.

/** Un usuario con PIN de verdad: el hash lo pone `fijarPin`, que es la vía real de la app.
 *
 *  Fabricar el hash a mano en el fixture probaría otra cosa — el día que cambie el algoritmo,
 *  el test seguiría verde contra una credencial que la app ya no acepta. */
async function conPin(rut: string, nombre: string, rol: string, pin: string) {
  const { usuarioId, personaId } = await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
      [rut, nombre],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, $2) returning id::text as id",
      [p!.id, rol],
    );
    return { usuarioId: u!.id, personaId: p!.id };
  });
  const { Pool } = await import("pg");
  const { fijarPin } = await import("../src/servidor/pin.ts");
  const { urlDeBase } = await import("../src/servidor/conexion.ts");
  const pool = new Pool({ connectionString: urlDeBase(BD_A) });
  try {
    await fijarPin(pool, usuarioId, pin);
  } finally {
    await pool.end();
  }
  return { usuarioId, personaId };
}

const PIN_DEL_ANDEN = "4417";
const PIN_DEL_CHOFER = "9023";

/** Los dos firmantes, creados UNA vez y reusados por todos los casos de custodia.
 *
 *  La lista congelada de RUTs tiene ocho (§7.8, AC-FIDN-21) y no se inventan más para un
 *  fixture: un RUT nuevo en el árbol pasa por esa decisión, no por la comodidad de un test.
 *  Además sus firmas sostienen sus dispositivos, así que crear uno por caso dejaría basura
 *  imborrable acumulándose en cada corrida. */
let firmanteAnden: { usuarioId: string; personaId: string };
let firmanteChofer: { usuarioId: string; personaId: string };

test.beforeAll(async () => {
  firmanteAnden = await conPin(
    Object.keys(VALIDOS)[6]!, "Responsable de andén", "responsable_carga", PIN_DEL_ANDEN);
  firmanteChofer = await conPin(
    Object.keys(VALIDOS)[7]!, "Quien maneja", "chofer", PIN_DEL_CHOFER);
});

/** El manifiesto sobre el que se traspasa la custodia, recién creado para cada caso. */
async function unManifiesto(request: import("@playwright/test").APIRequestContext) {
  const propia = await con(BD_A, async (c: Conexion) => {
    const [d] = await c.sql<{ id: string }>("select id::text as id from destinos limit 1");
    const [r] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, publicada_en, version)
       values ('Ruta de custodia', now(), 1) returning id::text as id`,
    );
    const [p] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, d!.id],
    );
    const [e] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 7) returning id::text as id",
      [panaderia, d!.id],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 7)", [
      p!.id,
      e!.id,
    ]);
    return p!.id;
  });

  const { declarado } = (await (
    await request.get(`${EN_A}/api/paradas/${propia}/manifiesto`, { headers: comoOperador })
  ).json()) as { declarado: { item_id: string; empresa_cliente_id: string }[] };

  const hecho = await request.post(`${EN_A}/api/paradas/${propia}/manifiesto`, {
    headers: comoOperador,
    data: {
      empresa_cliente_id: panaderia,
      client_uuid: crypto.randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
      conteos: declarado
        .filter((d) => d.empresa_cliente_id === panaderia)
        .map((d) => ({ item_id: d.item_id, qty_confirmada: 7 })),
    },
  });
  return ((await hecho.json()) as { manifiesto_id: string }).manifiesto_id;
}

test("[AC-FRUT-09] el traspaso escribe sus DOS firmas y su `custody_transfer`", async ({
  request,
}) => {
  const manifiestoId = await unManifiesto(request);
  const anden = firmanteAnden;
  const chofer = firmanteChofer;

  const traspaso = await request.post(`${EN_A}/api/manifiestos/${manifiestoId}/custodia`, {
    headers: comoOperador,
    data: {
      libero_usuario_id: anden.usuarioId,
      libero_pin: PIN_DEL_ANDEN,
      recibe_usuario_id: chofer.usuarioId,
      recibe_pin: PIN_DEL_CHOFER,
      sello: "SELLO-0091",
      client_uuid: crypto.randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });
  expect(traspaso.status()).toBe(201);
  expect((await traspaso.json()) as { firmas: number }).toMatchObject({ firmas: 2 });

  await con(BD_A, async (c: Conexion) => {
    const [t] = await c.sql<{ de: string; a: string; libero: string; recibio: string; sello: string }>(
      `select de_persona_id::text as de, a_persona_id::text as a,
              firma_libero_id::text as libero, firma_recibio_id::text as recibio, sello
         from custody_transfer where manifiesto_id = $1 and supersede_de is null`,
      [manifiestoId],
    );
    expect(t!.de).toBe(anden.personaId);
    expect(t!.a).toBe(chofer.personaId);
    // DOS firmas distintas: personas distintas responden por separado.
    expect(t!.libero).not.toBe(t!.recibio);
    expect(t!.sello).toBe("SELLO-0091");

    // Y cada firma con su SIGNIFICADO (§4.3): `libero` y `recibio_conforme` no son lo mismo, y
    // el día de la disputa la diferencia es toda la respuesta.
    const significados = await c.sql<{ significado: string }>(
      `select significado::text as significado from firmas
        where id in ($1, $2) order by significado`,
      [t!.libero, t!.recibio],
    );
    expect(significados.map((f) => f.significado)).toEqual(["libero", "recibio_conforme"]);
  });
});

test("[AC-FRUT-09] si el que carga y el que maneja son la MISMA persona, firma una vez", async ({
  request,
}) => {
  const manifiestoId = await unManifiesto(request);
  const solo = firmanteChofer;

  const traspaso = await request.post(`${EN_A}/api/manifiestos/${manifiestoId}/custodia`, {
    headers: comoOperador,
    data: {
      libero_usuario_id: solo.usuarioId,
      libero_pin: PIN_DEL_CHOFER,
      recibe_usuario_id: solo.usuarioId,
      recibe_pin: PIN_DEL_CHOFER,
      client_uuid: crypto.randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });
  expect(traspaso.status()).toBe(201);
  // UNA sola (§4.5). Pedirle dos a quien carga y maneja lo obligaría a inventar la segunda, que
  // es exactamente lo que vacía de sentido a la primera.
  expect((await traspaso.json()) as { firmas: number }).toMatchObject({ firmas: 1 });

  await con(BD_A, async (c: Conexion) => {
    const [t] = await c.sql<{ libero: string; recibio: string }>(
      `select firma_libero_id::text as libero, firma_recibio_id::text as recibio
         from custody_transfer where manifiesto_id = $1`,
      [manifiestoId],
    );
    expect(t!.libero).toBe(t!.recibio);
  });
});

test("[AC-FRUT-09] un PIN que no coincide rebota, y no deja traspaso", async ({ request }) => {
  const manifiestoId = await unManifiesto(request);
  const anden = firmanteAnden;

  const rebote = await request.post(`${EN_A}/api/manifiestos/${manifiestoId}/custodia`, {
    headers: comoOperador,
    data: {
      libero_usuario_id: anden.usuarioId,
      libero_pin: "0000",
      recibe_usuario_id: anden.usuarioId,
      recibe_pin: "0000",
      client_uuid: crypto.randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });
  // El ÚNICO rebote del flujo, y rebota porque ocurre con la persona presente: no es una captura
  // que llega por sync. El mensaje no dice cuál de los dos PIN falló — quien está enfrente ya lo
  // sabe, y decirlo le daría a un tercero la mitad de un oráculo.
  expect(rebote.status()).toBe(422);
  await con(BD_A, async (c: Conexion) => {
    const [n] = await c.sql<{ n: string }>(
      "select count(*)::text as n from custody_transfer where manifiesto_id = $1",
      [manifiestoId],
    );
    expect(n!.n).toBe("0");
  });
});

test("[AC-FRUT-09] el traspaso es INTOCABLE: UPDATE y DELETE responden 42501", async ({
  request,
}) => {
  const manifiestoId = await unManifiesto(request);
  const solo = firmanteChofer;
  await request.post(`${EN_A}/api/manifiestos/${manifiestoId}/custodia`, {
    headers: comoOperador,
    data: {
      libero_usuario_id: solo.usuarioId,
      libero_pin: PIN_DEL_CHOFER,
      recibe_usuario_id: solo.usuarioId,
      recibe_pin: PIN_DEL_CHOFER,
      client_uuid: crypto.randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });

  await con(BD_A, async (c: Conexion) => {
    const [t] = await c.sql<{ id: string }>(
      "select id::text as id from custody_transfer where manifiesto_id = $1",
      [manifiestoId],
    );
    // §7.4, las dos capas: el trigger detiene también a quien tiene más privilegios que el rol
    // de app. Un traspaso que se puede editar no prueba nada el día de la disputa.
    await expect(
      c.sql("update custody_transfer set sello = 'otro' where id = $1", [t!.id]),
    ).rejects.toThrow(/append-only|42501/);
    await expect(
      c.sql("delete from custody_transfer where id = $1", [t!.id]),
    ).rejects.toThrow(/append-only|42501/);
  });
});

test("[AC-FRUT-09] corregir es SUPERSEDE: dos filas y la original intacta (centinela 6)", async ({
  request,
}) => {
  const manifiestoId = await unManifiesto(request);
  const solo = firmanteChofer;
  const hecho = await request.post(`${EN_A}/api/manifiestos/${manifiestoId}/custodia`, {
    headers: comoOperador,
    data: {
      libero_usuario_id: solo.usuarioId,
      libero_pin: PIN_DEL_CHOFER,
      recibe_usuario_id: solo.usuarioId,
      recibe_pin: PIN_DEL_CHOFER,
      sello: "SELLO-EQUIVOCADO",
      client_uuid: crypto.randomUUID(),
      ts_dispositivo: new Date().toISOString(),
      tz_offset_min: -240,
    },
  });
  const original = ((await hecho.json()) as { custody_transfer_id: string }).custody_transfer_id;

  // Sin motivo no se corrige: una corrección sin motivo es indistinguible de un encubrimiento.
  const sinMotivo = await request.post(`${EN_A}/api/custodia/${original}`, {
    headers: comoOperador,
    data: { motivo: "" },
  });
  expect(sinMotivo.status()).toBe(422);

  const corregido = await request.post(`${EN_A}/api/custodia/${original}`, {
    headers: comoOperador,
    data: { motivo: "El sello anotado era el del otro camión", sello: "SELLO-CORRECTO" },
  });
  expect(corregido.status()).toBe(201);

  await con(BD_A, async (c: Conexion) => {
    const filas = await c.sql<{ id: string; sello: string; supersede: string | null; motivo: string | null }>(
      `select id::text as id, sello, supersede_de::text as supersede, supersede_motivo as motivo
         from custody_transfer where manifiesto_id = $1 order by record_time`,
      [manifiestoId],
    );
    // DOS filas: la original NO se tocó. Si desapareciera, nada probaría que alguna vez dijo
    // otra cosa — y eso es justo lo que el centinela 6 existe para impedir.
    expect(filas).toHaveLength(2);
    expect(filas[0]!.sello).toBe("SELLO-EQUIVOCADO");
    expect(filas[0]!.supersede).toBeNull();
    expect(filas[1]!.sello).toBe("SELLO-CORRECTO");
    expect(filas[1]!.supersede).toBe(original);
    expect(filas[1]!.motivo).toContain("otro camión");

    // Y UNO solo vigente: el corregido dejó de serlo en el mismo acto en que nació su reemplazo.
    const [vigentes] = await c.sql<{ n: string }>(
      "select count(*)::text as n from custody_transfer where manifiesto_id = $1 and supersede_de is null",
      [manifiestoId],
    );
    expect(vigentes!.n).toBe("1");
  });
});
