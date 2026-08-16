import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Cámara denegada degrada el encuadre de `dejado_en_punto` a flag, jamás bloquea [AC-FPOD-17]
// — §5.2 F4, §4.4, §7.6.
//
// ─── LO QUE ESTE ARCHIVO PROTEGE, Y LO QUE YA PROBABA OTRO ────────────────────────
//
// AC-FPOD-02 (`pod-variantes.spec.ts`) ya ejerce «dejado en punto sobre el umbral exige encuadre
// y cierra en 3 acciones» contra el contexto por defecto de Playwright —sin `grantPermissions`,
// que deniega la cámara de verdad— y ese test YA pasaba antes de este AC porque el botón de
// encuadre nunca intentaba abrir la cámara: se limitaba a marcar el paso como cumplido. Ese es
// justo el hueco que este AC cierra: el botón ahora SÍ llama a `capturarFoto()` (el mismo
// wrapper de `cliente/camara.ts` que ya resuelve el requisito genérico `foto`, AC-FPOD-12), y lo
// que este archivo prueba es que, con la cámara denegada de verdad por el navegador, el paso se
// sigue dando por cumplido igual — nunca deja al chofer sin salida (§7.6) — y la parada cierra.
//
// El caso de cámara CONCEDIDA para el encuadre no tiene rama propia que probar: `capturarFoto`
// ya lo prueba con un captor falso en `cliente/camara.test.ts` (AC-FPOD-12) y es la MISMA
// función que este botón invoca, sin ninguna lógica nueva que dependa del resultado.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
/** Propio y no prestado (§4.3: un dispositivo personal ACTIVO por operario) — mismo motivo que
 *  cada suite hermana de F4. */
const RUT_CHOFER = rutDeFixture(22);
const RUT_PANADERIA = rutDeFixture(6);

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien encuadra sin cámara') returning id::text as id",
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
    // El umbral del §4.4 (Pregunta al dueño 1 de la spec 04): `on conflict` porque `parametros`
    // es una fila compartida por toda la suite del tenant, y un DELETE le voltearía a otro
    // archivo columnas que no le tocan a este test.
    await c.sql(
      `insert into parametros (bultos_max_sin_receptor) values (6)
         on conflict (unica) do update set bultos_max_sin_receptor = excluded.bultos_max_sin_receptor`,
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
async function unaParadaConBultos(nombre: string, bultos: number) {
  return con(BD_A, async (c: Conexion) => {
    const [empresa] = await c.sql<{ id: string }>(
      `insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del encuadre degradado')
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

test("[AC-FPOD-17] cámara denegada: el encuadre de dejado_en_punto se da por cumplido igual y la parada cierra", async ({
  page,
}) => {
  // 15 bultos > umbral de 6 (§4.4): el encuadre es obligatorio antes de confirmar.
  const { paradaId, destino } = await unaParadaConBultos("la ruta del encuadre sin cámara", 15);
  await sesionDe(page);

  await page.goto(`${EN_A}/entrega?parada=${paradaId}`);
  await expect(page.getByTestId("parada-actual")).toContainText(destino);
  await page.getByTestId("llegue").click();
  await page.getByTestId("modo-dejado-en-punto").click();

  // Con el encuadre exigido y sin capturar, «Confirmar» no se ofrece — el mismo candado que
  // AC-FPOD-02 ya prueba con el paso NUNCA intentado. Acá el paso SÍ intenta la cámara.
  await expect(page.getByTestId("confirmar-dejado-en-punto")).toHaveCount(0);

  // El contexto de Playwright, sin `grantPermissions(['camera'])` y sin hardware de video en el
  // runner, deniega `getUserMedia` de verdad: la MISMA denegación que un operario que toca «No
  // permitir». `capturarFoto` nunca lanza (AC-FPOD-12): resuelve el permiso, degrada a «sin
  // foto» y el paso de encuadre se da por cumplido igual — nunca deja al chofer sin salida.
  await page.getByTestId("encuadrar-dejado-en-punto").click();

  await expect(page.getByTestId("confirmar-dejado-en-punto")).toBeVisible();
  await page.getByTestId("confirmar-dejado-en-punto").click();

  // La parada cerró: cero rebote del cierre ni del sync por la cámara denegada (§7.6, §4.2).
  await expect(page.getByTestId("banda-undo")).toBeVisible();
  await expect(page.getByTestId("ruta-terminada")).toBeVisible();
});
