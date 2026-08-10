import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { registrarBaseline } from "./baseline-acciones.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// La apertura del turno (F3), contando toques [AC-FVEH-10] — §5.2-F3, §5.3, §5.7, §7.6, §0.
//
// EL PRESUPUESTO DEL §5.3 ES EL CONTRATO: ≤9 acciones. Se cuenta con la convención CERRADA del
// mismo §5.3 — «un campo del teclado propio = 1 acción para el presupuesto, sea cual sea su
// cantidad de dígitos; el e2e cuenta ACCIONES, no keydowns»— y por eso teclear el odómetro
// entero suma UNO, no seis.
//
// Base PROPIA (`hechos`): esta suite abre turnos y deja chequeos y lecturas, que son
// append-only y no se pueden borrar.
//
// El PIN queda fuera a propósito: es del módulo de identidad (AC-FIDN-06) y el §5.2-F3 lo
// nombra como paso previo, no como parte de esta pantalla.

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_HECHOS = `http://${A.slug}.localhost:3311`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = Object.keys(VALIDOS)[5]!;
const SECRETO = secretoNuevo();
const PATENTE = "APT0001";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarFixture(c.sql);
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien abre el turno') returning id::text as id",
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
    await c.sql(
      "insert into vehiculos (patente, tipo, autonomia_nominal_km, soh_pct) values ($1, 'furgón', 300, 95)",
      [PATENTE],
    );
  });
});

/**
 * Cuenta ACCIONES con la convención cerrada del §5.3. `teclear` suma UNO por campo entero —da
 * igual que el odómetro tenga seis dígitos—, que es exactamente lo que el maestro fija.
 */
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
    /** Un campo de teclado PROPIO = 1 acción, sin importar cuántos dígitos tenga (§5.3). */
    async teclear(caracteres: string) {
      acciones++;
      for (const c of caracteres) {
        await page.getByRole("button", { name: c, exact: true }).click();
      }
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

test("[AC-FVEH-10] la apertura entra en el presupuesto del §5.3, con teclado PROPIO", async ({ page }) => {
  await sesionDe(page, SECRETO);
  const c = contador(page);
  await page.goto(`${EN_HECHOS}/turno/abrir`);
  await expect(page.getByTestId("pantalla-apertura")).toBeVisible();

  await c.tocar(`vehiculo-${PATENTE}`); // 1 · el vehículo
  await c.tocar("todo-bien"); // 2 · OK-por-defecto: el camino feliz es UN toque
  await c.teclear("120000"); // 3 · el odómetro entero = 1 acción (§5.3)
  await c.tocar("continuar-odometro"); // 4
  await c.teclear("85"); // 5 · la carga
  await c.tocar("continuar-carga"); // 6
  await expect(page.getByTestId("semaforo-texto")).toBeVisible();
  await c.tocar("abrir-turno"); // 7
  await expect(page.getByTestId("turno-abierto")).toBeVisible({ timeout: 15_000 });

  // EL TECLADO DEL SISTEMA JAMÁS APARECE (§5.7): se verifica sobre el DOM, no de memoria. Un
  // solo `<input>` en esta pantalla abriría el teclado nativo con autocorrector encima del
  // campo, tapando media pantalla justo cuando la persona está de pie al lado del camión.
  const inputs = await page.evaluate(() => document.querySelectorAll("input, textarea").length);
  expect(inputs, "la pantalla de apertura tiene un campo del sistema").toBe(0);

  expect(c.acciones, "la apertura se pasó del presupuesto de 9 acciones del §5.3").toBeLessThanOrEqual(9);
  const { baseline, acciones } = registrarBaseline({
    flujo: "apertura-de-turno",
    ac: "AC-FVEH-10",
    acciones: c.acciones,
  });
  expect(acciones, "el contador no midió nada").toBeGreaterThan(0);
  expect(
    acciones,
    `la apertura pasó de ${baseline} a ${acciones} acciones: una regresión del camino feliz no se mergea (§5.3)`,
  ).toBeLessThanOrEqual(baseline);
});

test("[AC-FVEH-10] el turno quedó con su chequeo y sus dos lecturas colgando", async () => {
  // La apertura no es solo la fila del turno: el §5.2-F3 pide chequeo pre, odómetro y carga. Si
  // alguna captura se perdiera, el turno existiría sin el estado con el que salió.
  const [t] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string; chequeos: string; lecturas: string }>(
      `select t.id::text as id,
              (select count(*)::text from chequeos c where c.turno_id = t.id) as chequeos,
              (select count(*)::text from reading r where r.turno_id = t.id) as lecturas
         from turnos t join vehiculos v on v.id = t.vehiculo_id
        where v.patente = $1 order by t.abierto_en desc limit 1`,
      [PATENTE],
    ),
  );
  expect(Number(t!.chequeos), "la apertura no dejó su chequeo pre").toBe(1);
  expect(Number(t!.lecturas), "faltan el odómetro o la carga").toBe(2);

  // Y la proyección del vehículo se movió sola desde esas lecturas (AC-FVEH-05).
  const [v] = await con(BD_A, (c: Conexion) =>
    c.sql<{ odometro: string | null; soc: string | null }>(
      "select odometro::text as odometro, soc::text as soc from vehiculos where patente = $1",
      [PATENTE],
    ),
  );
  expect(v!.odometro).toBe("120000");
  expect(v!.soc).toBe("85");
});

test("[AC-FVEH-10] un ítem fallado NO bloquea la apertura, y la pantalla lo dice", async ({ page }) => {
  // §7.6 y §5.2-F3 con esas palabras. Si un ítem fallado detuviera la apertura, la persona
  // aprendería a no marcar ninguno — y perderíamos justo el dato por el que existe el chequeo.
  await con(BD_A, (c: Conexion) =>
    c.sql("insert into vehiculos (patente, tipo) values ('APT0002', 'furgón')"),
  );
  await sesionDe(page, SECRETO);
  const c = contador(page);
  await page.goto(`${EN_HECHOS}/turno/abrir`);

  await c.tocar("vehiculo-APT0002");
  await c.tocar("falla-Luces");
  // La pantalla lo DICE, para que la persona marque sin miedo a quedarse sin poder trabajar.
  await expect(page.getByTestId("no-bloquea")).toContainText("no te impide salir");
  await c.tocar("seguir-con-fallas");
  await c.teclear("500");
  await c.tocar("continuar-odometro");
  await c.teclear("30");
  await c.tocar("continuar-carga");
  await c.tocar("abrir-turno");
  await expect(page.getByTestId("turno-abierto")).toBeVisible({ timeout: 15_000 });

  // El ítem fallado cuesta +2 toques (§5.2-F3) y el total SIGUE dentro del presupuesto.
  expect(c.acciones, "con un ítem fallado la apertura se pasa del presupuesto").toBeLessThanOrEqual(9);

  const [d] = await con(BD_A, (c2: Conexion) =>
    c2.sql<{ n: string }>(
      `select count(*)::text as n from defectos d join chequeos c on c.id = d.chequeo_id
        where d.item = 'Luces'`,
    ),
  );
  expect(Number(d!.n), "el ítem fallado no dejó su defecto").toBeGreaterThan(0);
});

test("[AC-FVEH-10] el semáforo se dice con TEXTO, jamás solo con color", async ({ page }) => {
  await con(BD_A, (c: Conexion) =>
    c.sql("insert into vehiculos (patente, tipo) values ('APT0003', 'furgón')"),
  );
  await sesionDe(page, SECRETO);
  await page.goto(`${EN_HECHOS}/turno/abrir`);
  await page.getByTestId("vehiculo-APT0003").click();
  await page.getByTestId("todo-bien").click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByTestId("continuar-odometro").click();
  await page.getByRole("button", { name: "9", exact: true }).click();
  await page.getByTestId("continuar-carga").click();

  const texto = page.getByTestId("semaforo-texto");
  await expect(texto).toBeVisible();
  // Este vehículo NO tiene ficha EV cargada: el semáforo no puede afirmar «no alcanza» —eso
  // afirmaría algo que nadie midió— y dice qué falta (§5.7, estado vacío accionable).
  await expect(texto).toContainText("Falta cargar la ficha");
  expect((await texto.textContent())!.trim().length, "el semáforo no dice nada").toBeGreaterThan(0);

  // Y la cifra operativa está, con su tamaño y su tabular-nums del §0.
  const cifra = await page.evaluate(() => {
    const nodos = [...document.querySelectorAll("span")];
    const grande = nodos.find((n) => Number.parseFloat(getComputedStyle(n).fontSize) >= 90);
    return grande
      ? {
          tamano: Number.parseFloat(getComputedStyle(grande).fontSize),
          peso: getComputedStyle(grande).fontWeight,
          variante: getComputedStyle(grande).fontVariantNumeric,
        }
      : null;
  });
  expect(cifra, "no hay cifra operativa en la pantalla de apertura").not.toBeNull();
  expect(cifra!.peso).toBe("700");
  expect(cifra!.variante, "la cifra baila al actualizarse: le falta tabular-nums").toContain(
    "tabular-nums",
  );
});
