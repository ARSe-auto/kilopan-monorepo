import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { registrarBaseline } from "./baseline-acciones.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Las variantes cerradas de F4, contadas en acciones [AC-FPOD-02] — §5.2 F4, §5.3, §4.5, §4.4.
//
// ─── LO QUE ESTE ARCHIVO PROTEGE ──────────────────────────────────────────────────
//
// El presupuesto se cuenta DESDE que la entrega está abierta —después de «Llegué», que tiene su
// propio presupuesto y su propio test en AC-FPOD-01— hasta que la parada cierra: abrir el modo
// YA es la primera acción de la variante (§5.3, y así lo cuenta `dominio/pod-terreno.ts`):
//
//   · parcial: la cantidad (un campo del teclado propio = 1) + el motivo + confirmar = 3 con
//     una parada de un solo ítem. El stepper NO cobra un toque de apertura —está a la vista
//     sobre la entrega abierta—, y es eso lo que deja lugar bajo el techo para la evidencia.
//   · no entregado: abrir el modo + el motivo + confirmar = 3, fijas por el maestro.
//   · dejado en punto: abrir el modo + confirmar = 2 sin exigir encuadre; + el encuadre = 3
//     cuando `parada.bultos` supera `parametros.bultos_max_sin_receptor` (§4.4).
//   · evidencia extra: +1 por cada `stop_requirement` OBLIGATORIO de la parada, y solo por eso
//     (§4.6). La suma más cara —la parcial con una firma exigida— cierra en las 4 acciones que
//     el §5.2 F4 fija como techo del operario.
//
// El replay de la cola hacia el servidor NO se ejerce acá (AC-FPOD-03/04); este AC es dueño del
// presupuesto de toques de las tres salidas secundarias del bucle de terreno.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
/** Propio y no prestado (§4.3: un dispositivo personal ACTIVO por operario) — el mismo motivo
 *  por el que AC-FPOD-01 tiene el suyo. */
const RUT_CHOFER = Object.keys(VALIDOS)[9]!;
const RUT_PANADERIA = Object.keys(VALIDOS)[6]!;

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien cierra variantes') returning id::text as id",
      [RUT_CHOFER],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );
  });
});

async function sesionDe(page: Page) {
  await page.addInitScript((s) => {
    const guardar = () =>
      new Promise<void>((res) => {
        const r = indexedDB.open("flota-aparato", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("claves");
        r.onsuccess = () => {
          const tx = r.result.transaction("claves", "readwrite").objectStore("claves").put(s, "secreto-de-sesion");
          tx.onsuccess = () => res();
          tx.onerror = () => res();
        };
      });
    void guardar();
  }, SECRETO);
}

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
    /** El toque no cae sobre un testid propio (un radio dentro de un `SelectorUnToque`
     *  compartido) sino sobre un locator ya armado por quien llama. */
    async tocarLocator(locator: ReturnType<Page["locator"]>) {
      acciones++;
      await locator.click();
    },
    /** Teclear en el teclado propio DENTRO de un contenedor con testid: N dígitos, 1 acción. */
    async escribir(testidContenedor: string, digitos: string) {
      acciones++;
      for (const digito of digitos) {
        await page.getByTestId(testidContenedor).getByRole("button", { name: digito, exact: true }).click();
      }
    },
  };
}

/** Una ruta con una sola parada de entrega, con su carga ya confirmada en el andén — el ESTADO
 *  previo del bucle de terreno, no lo que este AC ejerce (eso es AC-FRUT-07/AC-FRUT-22). */
async function unaParadaDeEntrega(
  nombre: string,
  bultos: number,
  requisitos: { tipo: string; obligatorio: boolean }[] = [],
) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del bucle')
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [RUT_PANADERIA],
    );
    const [origen] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ($1) returning id::text as id",
      [`Depósito de ${nombre}`],
    );
    const [r] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, publicada_en, version) values ($1, now(), 1) returning id::text as id`,
      [nombre],
    );
    const [carga] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, origen!.id],
    );
    const destinoNombre = `Sucursal de ${nombre}`;
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ($1) returning id::text as id",
      [destinoNombre],
    );
    const [parada] = await c.sql<{ id: string }>(
      `insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2)
       returning id::text as id`,
      [r!.id, destino!.id],
    );
    const [encargo] = await c.sql<{ id: string }>(
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
      [empresa!.id, destino!.id, bultos],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)", [
      parada!.id,
      encargo!.id,
      bultos,
    ]);
    await c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [carga!.id, empresa!.id],
    );

    // La evidencia que la parada exige (§4.6). En la ruta real las filas las deriva del
    // cargo_type el publicar del día (AC-FRUT-04); acá se insertan directo porque lo que este
    // AC ejerce es el flujo del operario ARMADO POR DATOS, no el momento de la derivación.
    let orden = 0;
    for (const req of requisitos) {
      orden++;
      await c.sql(
        `insert into stop_requirement (parada_id, tipo_evidencia, obligatorio, orden)
         values ($1, $2::evidencia_tipo, $3, $4)`,
        [parada!.id, req.tipo, req.obligatorio, orden],
      );
    }

    return { paradaId: parada!.id, destino: destinoNombre };
  });
}

async function unMotivo(codigo: string, etiqueta: string) {
  return con(BD_A, async (c: Conexion) => {
    const [m] = await c.sql<{ id: string }>(
      `insert into motivos (codigo, etiqueta, estado_asociado, orden)
       values ($1, $2, 'parada_fallida', 1)
         on conflict (tenant_id, codigo) do update set etiqueta = excluded.etiqueta
       returning id::text as id`,
      [codigo, etiqueta],
    );
    return m!.id;
  });
}

test("[AC-FPOD-02] parcial cierra en 3 acciones exactas: la cantidad, el motivo y confirmar", async ({
  page,
}) => {
  await unMotivo("dano_en_transporte", "Dañado en el transporte");
  const { paradaId, destino } = await unaParadaDeEntrega("la ruta de la parcial", 10);
  await sesionDe(page);
  const c = contador(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.getByTestId("llegue").click();

  const itemTestid = await page
    .getByTestId("modo-parcial-panel")
    .locator("[data-testid^='cantidad-item-']")
    .getAttribute("data-testid");
  await c.escribir(itemTestid!, "6"); // 1 · la cantidad, un campo = 1 acción
  const motivoTestid = itemTestid!.replace("cantidad-item-", "motivo-item-");
  await c.tocarLocator(page.getByTestId(motivoTestid).getByRole("radio").first()); // 2 · el motivo
  await c.tocar("confirmar-parcial"); // 3 · confirmar

  // El avance es parte de la acción final, igual que el camino feliz (AC-FPOD-01).
  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await expect(page.getByTestId("ruta-terminada")).toBeVisible();

  expect(c.acciones, "la parcial de un solo ítem cuesta 3: el stepper no cobra apertura").toBe(3);

  const { baseline, acciones } = registrarBaseline({ flujo: "entrega-parcial", ac: "AC-FPOD-02", acciones: c.acciones });
  expect(
    acciones,
    `la variante parcial pasó de ${baseline} a ${acciones} acciones: una regresión no se mergea (§5.3)`,
  ).toBeLessThanOrEqual(baseline);
});

test("[AC-FPOD-02] la evidencia extra aparece SOLO si stop_requirement la exige", async ({ page }) => {
  const sinRequisito = await unaParadaDeEntrega("la ruta sin evidencia extra", 5);
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${sinRequisito.paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(sinRequisito.destino);
  await page.getByTestId("llegue").click();
  // Lo normal en E1: ninguna fila en `stop_requirement` y ningún paso extra que pagar.
  await expect(page.getByTestId("evidencia-exigida")).toHaveCount(0);
  await expect(page.getByTestId("entregado")).toBeVisible();

  const conRequisito = await unaParadaDeEntrega("la ruta con firma exigida", 5, [
    { tipo: "firma", obligatorio: true },
    // El opcional no bloquea: `obligatorio` es la columna que separa «hay que» de «se puede».
    { tipo: "foto", obligatorio: false },
  ]);
  const c = contador(page);

  await page.goto(`${EN_A}/entrega?parada=${conRequisito.paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(conRequisito.destino);
  await page.getByTestId("llegue").click();

  // Con la firma pendiente, la entrega efectuada NO se ofrece — y «No pude entregar» sí, porque
  // una parada fallida no tiene evidencia de entrega que dar (§4.2, §7.6).
  await expect(page.getByTestId("evidencia-exigida")).toBeVisible();
  await expect(page.getByTestId("entregado")).toHaveCount(0);
  await expect(page.getByTestId("modo-no-entregado")).toBeVisible();

  await c.tocarLocator(page.getByTestId("evidencia-exigida").getByRole("button").first()); // 1 · la firma
  await c.tocar("entregado"); // 2 · entregado

  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await expect(page.getByTestId("ruta-terminada")).toBeVisible();
  expect(c.acciones, "la evidencia exigida cuesta 1 acción y ninguna más").toBe(2);

  const { baseline, acciones } = registrarBaseline({
    flujo: "entrega-con-evidencia-exigida",
    ac: "AC-FPOD-02",
    acciones: c.acciones,
  });
  expect(
    acciones,
    `la entrega con evidencia exigida pasó de ${baseline} a ${acciones} acciones (§5.3)`,
  ).toBeLessThanOrEqual(baseline);
});

test("[AC-FPOD-02] la suma más cara —parcial con evidencia exigida— cierra en 4 acciones", async ({ page }) => {
  await unMotivo("dano_en_transporte", "Dañado en el transporte");
  const { paradaId, destino } = await unaParadaDeEntrega("la ruta de la suma más cara", 10, [
    { tipo: "firma", obligatorio: true },
  ]);
  await sesionDe(page);
  const c = contador(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.getByTestId("llegue").click();

  await c.tocarLocator(page.getByTestId("evidencia-exigida").getByRole("button").first()); // 1 · la firma
  const itemTestid = await page
    .getByTestId("modo-parcial-panel")
    .locator("[data-testid^='cantidad-item-']")
    .getAttribute("data-testid");
  await c.escribir(itemTestid!, "6"); // 2 · la cantidad
  await c.tocarLocator(
    page.getByTestId(itemTestid!.replace("cantidad-item-", "motivo-item-")).getByRole("radio").first(),
  ); // 3 · el motivo
  await c.tocar("confirmar-parcial"); // 4 · confirmar

  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await expect(page.getByTestId("ruta-terminada")).toBeVisible();

  // El techo del §5.2 F4: «el operario nunca supera 4 acciones», evidencia extra incluida.
  expect(c.acciones, "ninguna combinación de variante y evidencia supera 4 acciones").toBe(4);

  const { baseline, acciones } = registrarBaseline({
    flujo: "entrega-parcial-con-evidencia",
    ac: "AC-FPOD-02",
    acciones: c.acciones,
  });
  expect(acciones, "la suma más cara del §5.2 F4 no puede pasar de 4").toBeLessThanOrEqual(
    Math.min(baseline, 4),
  );
});

test("[AC-FPOD-02] no entregado cierra en 3 acciones exactas: abrir, el motivo y confirmar", async ({ page }) => {
  await unMotivo("local_cerrado", "Local cerrado");
  const { paradaId, destino } = await unaParadaDeEntrega("la ruta del no entregado", 5);
  await sesionDe(page);
  const c = contador(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.getByTestId("llegue").click();

  await c.tocar("modo-no-entregado"); // 1 · abrir el modo
  await c.tocarLocator(page.getByTestId("motivo-no-entrega").getByRole("radio").first()); // 2 · el motivo
  await c.tocar("confirmar-no-entregado"); // 3 · confirmar

  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await expect(page.getByTestId("ruta-terminada")).toBeVisible();

  expect(c.acciones, "el maestro fija «no entregado» en 3 acciones exactas").toBe(3);

  const { baseline, acciones } = registrarBaseline({
    flujo: "entrega-no-entregada",
    ac: "AC-FPOD-02",
    acciones: c.acciones,
  });
  expect(
    acciones,
    `«no entregado» pasó de ${baseline} a ${acciones} acciones: una regresión no se mergea (§5.3)`,
  ).toBeLessThanOrEqual(baseline);
});

test("[AC-FPOD-02] dejado en punto sin exigir encuadre cierra en 2 acciones: abrir y confirmar", async ({
  page,
}) => {
  // Sin fila en `parametros`, `bultos_max_sin_receptor` es NULL y el encuadre nunca se exige
  // (§4.4) — es el estado de un tenant que nunca sembró la pregunta al dueño 1.
  const { paradaId, destino } = await unaParadaDeEntrega("la ruta dejada sin umbral", 5);
  await sesionDe(page);
  const c = contador(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.getByTestId("llegue").click();

  await c.tocar("modo-dejado-en-punto"); // 1 · abrir el modo
  await expect(page.getByTestId("encuadrar-dejado-en-punto")).toHaveCount(0);
  await c.tocar("confirmar-dejado-en-punto"); // 2 · confirmar

  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await expect(page.getByTestId("ruta-terminada")).toBeVisible();

  expect(c.acciones, "sin umbral sembrado, dejado en punto no exige encuadre").toBe(2);

  const { baseline, acciones } = registrarBaseline({
    flujo: "entrega-dejada-en-punto-sin-encuadre",
    ac: "AC-FPOD-02",
    acciones: c.acciones,
  });
  expect(
    acciones,
    `«dejado en punto» sin encuadre pasó de ${baseline} a ${acciones} acciones: una regresión no se mergea (§5.3)`,
  ).toBeLessThanOrEqual(baseline);
});

test("[AC-FPOD-02] dejado en punto sobre el umbral exige encuadre y cierra en 3 acciones", async ({ page }) => {
  // 12 bultos > umbral de 6 (§4.4): el encuadre pasa a ser obligatorio antes de confirmar.
  // `on conflict (unica)` y no un DELETE: `parametros` es una fila compartida por toda la
  // suite, y borrarla le voltearía a otro archivo columnas que no le tocan a este test.
  await con(BD_A, async (c: Conexion) => {
    await c.sql(
      `insert into parametros (bultos_max_sin_receptor) values (6)
         on conflict (unica) do update set bultos_max_sin_receptor = excluded.bultos_max_sin_receptor`,
    );
  });
  const { paradaId, destino } = await unaParadaDeEntrega("la ruta dejada con umbral", 12);
  await sesionDe(page);
  const c = contador(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.getByTestId("llegue").click();

  await c.tocar("modo-dejado-en-punto"); // 1 · abrir el modo
  await expect(page.getByTestId("confirmar-dejado-en-punto")).toHaveCount(0);
  await c.tocar("encuadrar-dejado-en-punto"); // 2 · el encuadre
  await c.tocar("confirmar-dejado-en-punto"); // 3 · confirmar

  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await expect(page.getByTestId("ruta-terminada")).toBeVisible();

  expect(c.acciones, "sobre el umbral, dejado en punto exige el encuadre: 3 acciones").toBe(3);

  const { baseline, acciones } = registrarBaseline({
    flujo: "entrega-dejada-en-punto-con-encuadre",
    ac: "AC-FPOD-02",
    acciones: c.acciones,
  });
  expect(
    acciones,
    `«dejado en punto» con encuadre pasó de ${baseline} a ${acciones} acciones: una regresión no se mergea (§5.3)`,
  ).toBeLessThanOrEqual(baseline);
});
