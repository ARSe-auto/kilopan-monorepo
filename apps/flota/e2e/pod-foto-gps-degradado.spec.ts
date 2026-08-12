import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Foto y GPS como mejoras progresivas, jamás dependencias [AC-FPOD-12] — §3.E1.7, §7.6,
// §3.E1.15, §4.2.
//
// ─── LO QUE ESTE ARCHIVO PROTEGE ──────────────────────────────────────────────────
//
// Este e2e NO ejerce el navegador con cámara ni GPS reales: Playwright, en el contexto por
// defecto (sin `grantPermissions`) y sin hardware de video en el runner, deniega los dos
// exactamente como lo haría un teléfono cuyo operario tocó «No permitir» — el mismo caso que
// el maestro pide degradar. Lo que se prueba es que ESA denegación, real contra el endpoint del
// navegador, jamás bloquea el bucle de terreno: la parada cierra igual, con el aviso de GPS
// visible y sin que el requisito de foto le pida nada más al chofer.
//
// El caso de permiso CONCEDIDO de cada sensor ya lo prueban `dominio/captura-progresiva.test.ts`
// y `cliente/{camara,gps}.test.ts` — con captores falsos, que es donde corresponde probar una
// rama que un runner headless sin cámara no puede ejercer de verdad.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
/** Propio y no prestado (§4.3: un dispositivo personal ACTIVO por operario) — mismo motivo que
 *  cada suite hermana de F4. */
const RUT_CHOFER = rutDeFixture(36);
const RUT_PANADERIA = rutDeFixture(6);

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien prueba foto y GPS') returning id::text as id",
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

/** Una ruta con una sola parada de entrega, con su carga ya confirmada en el andén — el ESTADO
 *  previo del bucle de terreno (AC-FRUT-07/AC-FRUT-22), no lo que este AC ejerce. */
async function unaParadaDeEntrega(
  nombre: string,
  requisitos: { tipo: string; obligatorio: boolean }[] = [],
) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería de foto y GPS')
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
      "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, 3) returning id::text as id",
      [empresa!.id, destino!.id],
    );
    await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, 3)", [
      parada!.id,
      encargo!.id,
    ]);
    await c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [carga!.id, empresa!.id],
    );

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

test("[AC-FPOD-12] cámara denegada: la foto exigida se cumple igual, sin foto, y la parada cierra", async ({
  page,
}) => {
  const { paradaId, destino } = await unaParadaDeEntrega("la ruta de la foto denegada", [
    { tipo: "foto", obligatorio: true },
  ]);
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.getByTestId("llegue").click();

  // Con la foto pendiente, la entrega efectuada no se ofrece — igual que cualquier evidencia
  // exigida (AC-FPOD-02). El contexto de Playwright, sin `grantPermissions(['camera'])`, deniega
  // `getUserMedia` de verdad: es la MISMA denegación que un operario que toca «No permitir».
  await expect(page.getByTestId("evidencia-exigida")).toBeVisible();
  await page.getByTestId("evidencia-exigida").getByRole("button").first().click();

  // La cámara denegada NUNCA deja al chofer sin salida (§7.6): el requisito se dio por cumplido
  // y «Entregado» aparece igual, sin foto.
  await expect(page.getByTestId("entregado")).toBeVisible();
  await page.getByTestId("entregado").click();

  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await expect(page.getByTestId("ruta-terminada")).toBeVisible();
});

test("[AC-FPOD-12] GPS denegado: aviso visible al operario y la entrega se sigue cerrando sola", async ({
  page,
}) => {
  const { paradaId, destino } = await unaParadaDeEntrega("la ruta del GPS denegado");
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  // El contexto por defecto no tiene el permiso `geolocation` concedido: la misma denegación de
  // verdad que el operario que toca «No permitir» en el prompt del sistema.
  await page.getByTestId("llegue").click();

  await expect(page.getByTestId("aviso-gps-denegado")).toBeVisible();
  // Cero modal (§7.6): el aviso convive con la pantalla, no la tapa ni pide un toque para
  // seguir — «Entregado» sigue disponible con el aviso a la vista.
  await expect(page.getByTestId("entregado")).toBeVisible();
  await page.getByTestId("entregado").click();

  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await expect(page.getByTestId("ruta-terminada")).toBeVisible();
});

test("[AC-FPOD-12] GPS concedido: sin aviso, ninguna coordenada bloquea nada", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -33.45, longitude: -70.66 });

  const { paradaId, destino } = await unaParadaDeEntrega("la ruta del GPS concedido");
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.getByTestId("llegue").click();

  // Con el permiso concedido y un fix real, jamás aparece el aviso de denegación.
  await expect(page.getByTestId("aviso-gps-denegado")).toHaveCount(0);
  await expect(page.getByTestId("entregado")).toBeVisible();
});
