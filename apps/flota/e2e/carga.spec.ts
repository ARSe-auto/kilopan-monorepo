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
