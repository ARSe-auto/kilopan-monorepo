import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El candado entrega←manifiesto (F4) [AC-FRUT-22] — KR-29, decisión del dueño 08-ago-2026 (D1),
// §4.2, §3.E1.5, §7.6.
//
// ─── LO QUE ESTE ARCHIVO PROTEGE ──────────────────────────────────────────────────
//
//   (a) la parada de entrega NO ofrece «Llegué» mientras el sub-manifiesto por empresa de la
//       parada de carga que la abastece no esté confirmado, y el texto nombra la vía —jamás
//       una modal, jamás un candado mudo, jamás solo color (§7.6);
//   (b) una entrega consolidada de VARIAS empresas (§3.E1.5) sigue cerrada mientras falte UNA
//       sola, y el texto nombra justo la que falta, no las dos;
//   (c) confirmadas TODAS, el candado se abre sin costar una acción de más ni una modal.
//
// El motor de sync que degrada un POD sin manifiesto confirmado (KR-29, tercera cláusula del
// AC) queda en AC-FRUT-23: depende de `entregas_pod`/el tipo de evidencia del camino feliz sin
// foto ni firma (spec 04, Pregunta al dueño 4, aún sin responder) y de un `evento_tipo` nuevo,
// que es esquema — trabajo de sesión supervisada, no de este commit.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien reparte') returning id::text as id",
      [Object.keys(VALIDOS)[0]!],
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

/** Una ruta con su carga y su entrega, e ítems de N empresas en la entrega (§3.E1.5). */
async function rutaConEntrega(empresas: { id: string; bultos: number }[]) {
  return con(BD_A, async (c: Conexion) => {
    const [destino] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Sucursal de la ronda') returning id::text as id",
    );
    const [origen] = await c.sql<{ id: string }>(
      "insert into destinos (nombre) values ('Depósito del andén') returning id::text as id",
    );
    const [r] = await c.sql<{ id: string }>(
      `insert into rutas (nombre, publicada_en, version)
       values ('Ruta del candado', now(), 1) returning id::text as id`,
    );
    const [carga] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'carga', 1, $2) returning id::text as id",
      [r!.id, origen!.id],
    );
    const [entrega] = await c.sql<{ id: string }>(
      "insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', 2, $2) returning id::text as id",
      [r!.id, destino!.id],
    );
    for (const { id: empresaId, bultos } of empresas) {
      const [e] = await c.sql<{ id: string }>(
        "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
        [empresaId, destino!.id, bultos],
      );
      await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)", [
        entrega!.id,
        e!.id,
        bultos,
      ]);
    }
    return { rutaId: r!.id, cargaId: carga!.id, entregaId: entrega!.id };
  });
}

async function empresa(rut: string, razonSocial: string) {
  return con(BD_A, async (c: Conexion) => {
    const [row] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, $2)
         on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
       returning id::text as id`,
      [rut, razonSocial],
    );
    return row!.id;
  });
}

/** El sub-manifiesto YA confirmado en el andén: se inserta directo, es el ESTADO previo del
 *  caso, no lo que este AC ejerce (eso es AC-FRUT-07). */
async function confirmarEnElAnden(paradaId: string, empresaId: string) {
  await con(BD_A, (c: Conexion) =>
    c.sql(
      `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
       values ($1, $2, now(), -240)`,
      [paradaId, empresaId],
    ),
  );
}

test("[AC-FRUT-22] sin manifiesto confirmado, la entrega no ofrece «Llegué» y el texto nombra la vía", async ({
  page,
}) => {
  const panaderia = await empresa(Object.keys(VALIDOS)[6]!, "Panadería del candado");
  const { entregaId } = await rutaConEntrega([{ id: panaderia, bultos: 10 }]);

  await sesionDe(page);
  await page.goto(`${EN_A}/entrega?parada=${entregaId}`);

  await expect(page.getByTestId("candado-cerrado")).toBeVisible();
  await expect(page.getByTestId("llegue")).toHaveCount(0);
  // Texto, jamás modal (§7.6): nombra la empresa y las DOS vías —confirmar en el andén, o
  // bajar el ítem del manifiesto (AC-FRUT-08)— nunca solo color ni un candado mudo.
  const texto = await page.getByTestId("candado-cerrado").innerText();
  expect(texto).toContain("Panadería del candado");
  expect(texto.toLowerCase()).toContain("confirmalo");
  expect(texto.toLowerCase()).toContain("bajá");
  // Ningún <dialog> ni role="dialog": el §7.6 solo permite UNA modal en todo el sistema, y no
  // es esta.
  expect(await page.locator('[role="dialog"], dialog').count()).toBe(0);
});

test("[AC-FRUT-22] entrega consolidada de dos empresas: falta UNA y el texto nombra justo esa", async ({
  page,
}) => {
  const panaderia = await empresa(Object.keys(VALIDOS)[6]!, "Panadería del candado");
  const pasteleria = await empresa(Object.keys(VALIDOS)[7]!, "Pastelería del candado");
  const { cargaId, entregaId } = await rutaConEntrega([
    { id: panaderia, bultos: 10 },
    { id: pasteleria, bultos: 6 },
  ]);
  // Confirma UNA de las dos: la consolidación multi-empresa (§3.E1.5) exige que el candado siga
  // cerrado hasta que las DOS lo estén, no que alcance con la primera.
  await confirmarEnElAnden(cargaId, panaderia);

  await sesionDe(page);
  await page.goto(`${EN_A}/entrega?parada=${entregaId}`);

  await expect(page.getByTestId("candado-cerrado")).toBeVisible();
  await expect(page.getByTestId("llegue")).toHaveCount(0);
  const texto = await page.getByTestId("candado-cerrado").innerText();
  expect(texto).toContain("Pastelería del candado");
  expect(texto).not.toContain("Panadería del candado");
});

test("[AC-FRUT-22] confirmado el manifiesto de todas las empresas, el candado se abre sin acción de más", async ({
  page,
}) => {
  const panaderia = await empresa(Object.keys(VALIDOS)[6]!, "Panadería del candado");
  const pasteleria = await empresa(Object.keys(VALIDOS)[7]!, "Pastelería del candado");
  const { cargaId, entregaId } = await rutaConEntrega([
    { id: panaderia, bultos: 10 },
    { id: pasteleria, bultos: 6 },
  ]);
  await confirmarEnElAnden(cargaId, panaderia);
  await confirmarEnElAnden(cargaId, pasteleria);

  await sesionDe(page);
  await page.goto(`${EN_A}/entrega?parada=${entregaId}`);

  // Se abre SOLO. Cero clics de más y cero modal: aparece con la carga de la pantalla, no
  // detrás de un candado mudo ni de un diálogo que confirmar.
  await expect(page.getByTestId("candado-abierto")).toBeVisible();
  await expect(page.getByTestId("llegue")).toBeVisible();
  expect(await page.locator('[role="dialog"], dialog').count()).toBe(0);

  await page.getByTestId("llegue").click();
  await expect(page.getByTestId("entrega-en-curso")).toBeVisible();
});

test("[AC-FRUT-22] una parada que no es de tipo entrega no tiene tarjeta", async ({ page }) => {
  const panaderia = await empresa(Object.keys(VALIDOS)[6]!, "Panadería del candado");
  const { cargaId } = await rutaConEntrega([{ id: panaderia, bultos: 10 }]);

  await sesionDe(page);
  const respuesta = await page.goto(`${EN_A}/entrega?parada=${cargaId}`);
  expect(respuesta?.status()).toBe(404);
});
