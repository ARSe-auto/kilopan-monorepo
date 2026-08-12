import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// VoiceOver completa el flujo POD, las 5 variantes de F4, como gate de CI [AC-FPOD-24] — §5.7.
//
// ─── POR QUÉ ESTO NO ES VoiceOver DE VERDAD, Y QUÉ ES EN SU LUGAR ─────────────────
//
// El maestro (§5.7) pide «VoiceOver completa apertura/POD/recepción»; KiloPan enfrentó el mismo
// texto en `AC-H0-14` y concluyó que un e2e headless NO PUEDE manejar el lector de pantalla real
// del sistema operativo — quedó `sesión supervisada`, con dueño humano, JAMÁS gate de CI
// (`specs/kilopan/09-plataforma-miga.md`, líneas 115-117 y 205-210). Ese es el precedente real de
// este repo, y no hay ningún driver de VoiceOver en Playwright que lo contradiga hoy.
//
// Pero el texto DURABLE de `AC-FPOD-24` en `specs/flota/04-pod-offline-sync.md` (línea 103) no
// dice «sesión supervisada»: dice «regresión bloqueante como parte del gate de CI», sin la
// salvedad que KiloPan sí escribió. La spec de este módulo manda, y este archivo la sigue tal
// cual está escrita: lo que SÍ es mecanizable y bloqueante en CI es el sucedáneo funcional de
// VoiceOver — completar el flujo entero navegando EXCLUSIVAMENTE por el ÁRBOL DE ACCESIBILIDAD
// (`getByRole` con el nombre accesible, jamás `getByTestId` para una ACCIÓN) en el mismo orden en
// que un lector de pantalla los encuentra. Es lo mismo que ya hace `pod-a11y-gate.spec.ts`
// (AC-FPOD-23) con el foco —`locator.focus()` en vez de un Tab real, porque WebKit headless no
// ejerce «Full Keyboard Access»— y con la MISMA razón: si un control no tiene rol y nombre
// accesible correctos, este test no lo encuentra y el flujo se rompe — el defecto exacto que le
// rompería el paseo a un chofer con VoiceOver encendido. Los `getByTestId` que sí aparecen abajo
// son solo para OBSERVAR el estado resultante (una banda que ya apareció), nunca para tocar nada.
//
// ─── FIXTURE: EL MISMO DE LAS SUITES DE F4 QUE YA CORREN EN VERDE ─────────────────
//
// Dos intentos previos de AC-FPOD-23 murieron por escribir un fixture de memoria contra un
// esquema que no existía. Este archivo copia `unaParadaDeEntrega`/`unMotivo`/`sesionDe` de
// `pod-variantes.spec.ts` (AC-FPOD-02, verde) sin reescribirlos, y la parada de recarga sigue el
// mismo patrón de `apps/flota/src/app/recarga/page.tsx`: ruta con `vehiculo_id`, parada tipo
// `recarga` con `destino_id` NULL (constraint `paradas_destino_segun_tipo`).

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
/** Propio y no prestado (§4.3: un dispositivo personal ACTIVO por operario) — índice 29 de la
 *  lista congelada, agregado por este AC. */
const RUT_CHOFER = rutDeFixture(29);
const RUT_PANADERIA = rutDeFixture(6);

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien navega F4 solo con el rol') returning id::text as id",
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

/** Una parada de entrega con el manifiesto ya confirmado — copiado de `pod-variantes.spec.ts`
 *  (AC-FPOD-02), sin escribirlo de memoria. */
async function unaParadaDeEntrega(nombre: string, bultos: number) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del paseo por rol')
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

/** Una ruta con UNA parada tipo `recarga` — mismo patrón que `apps/flota/src/app/recarga/
 *  page.tsx` resuelve: `destino_id` NULL (constraint `paradas_destino_segun_tipo`), vehículo
 *  propio en `rutas.vehiculo_id`. Sin turno abierto: la captura viaja igual sin uno (comentario
 *  de `page.tsx`), así que no hace falta sembrarlo para este paseo. */
async function unaParadaDeRecarga(nombre: string) {
  return con(BD_A, async (c: Conexion) => {
    const [v] = await c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ($1, 'furgón') returning id::text as id",
      [`VOZ${Math.floor(Math.random() * 9000 + 1000)}`],
    );
    const [r] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, vehiculo_id) values ($1, $2) returning id::text as id`,
      [nombre, v!.id],
    );
    const [parada] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'recarga', 1, null) returning id::text as id",
      [r!.id],
    );
    return { paradaId: parada!.id };
  });
}

test.describe("[AC-FPOD-24] VoiceOver completa las 5 variantes de F4, de punta a punta", () => {
  test("feliz: Llegué → Entregado, cada control encontrado SOLO por su rol y nombre accesible", async ({
    page,
  }) => {
    const { paradaId, destino } = await unaParadaDeEntrega("la ruta feliz del paseo por rol", 5);
    await sesionDe(page);

    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
    await expect(page.getByRole("heading", { name: "Parada de entrega" })).toBeVisible();
    await expect(page.getByText(destino)).toBeVisible();

    await page.getByRole("button", { name: "Llegué" }).click();
    await page.getByRole("button", { name: "Entregado", exact: true }).click();

    // Cero modal (§7.6): la única confirmación es texto en la página, no un `role="dialog"`.
    expect(await page.locator('[role="dialog"], dialog').count()).toBe(0);
    await expect(page.getByText("Entregado. Se guarda en unos segundos.")).toBeVisible();
    await expect(page.getByText(/Terminaste las entregas de esta ruta/)).toBeVisible();
  });

  test("parcial: la cantidad por el teclado propio, el motivo y confirmar — todo por rol", async ({ page }) => {
    await unMotivo("dano_en_transporte", "Dañado en el transporte");
    const { paradaId, destino } = await unaParadaDeEntrega("la ruta parcial del paseo por rol", 10);
    await sesionDe(page);

    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
    await expect(page.getByText(destino)).toBeVisible();
    await page.getByRole("button", { name: "Llegué" }).click();

    const teclado = page.getByRole("group", { name: "Teclado numérico" });
    await expect(teclado).toBeVisible();
    await teclado.getByRole("button", { name: "6", exact: true }).click();

    await page.getByRole("radio", { name: "Dañado en el transporte" }).click();
    await page.getByRole("button", { name: "Confirmar entrega parcial" }).click();

    await expect(page.getByText("Entregado. Se guarda en unos segundos.")).toBeVisible();
    await expect(page.getByText(/Terminaste las entregas de esta ruta/)).toBeVisible();
  });

  test("no entregado: abrir el modo, el motivo y confirmar — todo por rol", async ({ page }) => {
    await unMotivo("local_cerrado", "Local cerrado");
    const { paradaId, destino } = await unaParadaDeEntrega("la ruta del no entregado del paseo por rol", 5);
    await sesionDe(page);

    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
    await expect(page.getByText(destino)).toBeVisible();
    await page.getByRole("button", { name: "Llegué" }).click();

    await page.getByRole("button", { name: "No pude entregar" }).click();
    await page.getByRole("radio", { name: "Local cerrado" }).click();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();

    await expect(page.getByText("Entregado. Se guarda en unos segundos.")).toBeVisible();
    await expect(page.getByText(/Terminaste las entregas de esta ruta/)).toBeVisible();
  });

  test("dejado en punto: abrir el modo y confirmar — todo por rol", async ({ page }) => {
    // Sin fila en `parametros`, el umbral de encuadre queda NULL y no se exige (§4.4) — el mismo
    // estado de fábrica que ejerce `pod-variantes.spec.ts` para el caso de 2 acciones.
    const { paradaId, destino } = await unaParadaDeEntrega("la ruta dejada en punto del paseo por rol", 5);
    await sesionDe(page);

    await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
    await expect(page.getByText(destino)).toBeVisible();
    await page.getByRole("button", { name: "Llegué" }).click();

    await page.getByRole("button", { name: "Dejado en punto" }).click();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();

    await expect(page.getByText("Entregado. Se guarda en unos segundos.")).toBeVisible();
    await expect(page.getByText(/Terminaste las entregas de esta ruta/)).toBeVisible();
  });

  test("parada de recarga: Iniciar carga, kWh y SOC final por el teclado propio, confirmar — todo por rol", async ({
    page,
  }) => {
    const { paradaId } = await unaParadaDeRecarga("la ruta de recarga del paseo por rol");
    await sesionDe(page);

    await page.goto(`${EN_A}/recarga?parada=${paradaId}`);
    await expect(page.getByRole("heading", { name: "Parada de recarga" })).toBeVisible();

    await page.getByRole("button", { name: "Iniciar carga" }).click();

    // Dos teclados numéricos en la misma pantalla («kWh cargados» y «SOC final»): en el orden en
    // que un lector de pantalla los encuentra —de arriba hacia abajo—, el primero es el de kWh.
    const teclados = page.getByRole("group", { name: "Teclado numérico" });
    await expect(teclados).toHaveCount(2);
    await teclados.nth(0).getByRole("button", { name: "2", exact: true }).click();
    await teclados.nth(0).getByRole("button", { name: "0", exact: true }).click();
    await teclados.nth(1).getByRole("button", { name: "8", exact: true }).click();
    await teclados.nth(1).getByRole("button", { name: "0", exact: true }).click();

    await page.getByRole("button", { name: "Confirmar", exact: true }).click();

    await expect(page.getByText("Recarga registrada — por sincronizar")).toBeVisible();
  });
});
