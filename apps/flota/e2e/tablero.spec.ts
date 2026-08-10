import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El tablero «Listos para salir» (F1) [AC-FVEH-12] — §5.2-F1, §3.E1.12, §5.7, §5.1.
//
// LO QUE EL AC ACOTA COMO VERIFICABLE HOY, con esas palabras: fórmula única aplicada,
// sugerencia a 1 clic y degradación. La rama «necesario» —cuántos km pide el plan del día—
// espera `rutas.km_presupuesto_energia` del hito (d), y hasta entonces el semáforo no afirma
// que un camión llega: afirmarlo sin saber a dónde va es el cálculo con folleto que el Anexo A
// prohíbe (305 km de catálogo contra 185–245 reales).

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_OPERADOR = Object.keys(VALIDOS)[1]!;
const SECRETO = secretoNuevo();
const CON_FICHA = "TAB0001";
const SIN_FICHA = "TAB0002";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarFixture(c.sql);
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien planifica') returning id::text as id",
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

    // Uno con la ficha EV completa y otro sin nada: las dos mitades del AC en la misma pantalla.
    const [conFicha] = await c.sql<{ id: string }>(
      `insert into vehiculos (patente, tipo, autonomia_nominal_km, soh_pct)
       values ($1, 'furgón', 300, 90) returning id::text as id`,
      [CON_FICHA],
    );
    await c.sql("insert into vehiculos (patente, tipo) values ($1, 'furgón')", [SIN_FICHA]);

    // Una proyección de carga, que solo se puede llegar por `reading` (AC-FVEH-05).
    const [cv] = await c.sql<{ id: string }>("select crear_config_version('fixture tablero')::text as id");
    const [t] = await c.sql<{ id: string }>(
      "insert into turnos (vehiculo_id, config_version_id) values ($1, $2) returning id::text as id",
      [conFicha!.id, cv!.id],
    );
    await c.sql(
      `insert into reading (magnitud_id, valor_int, fuente, turno_id, ts_dispositivo, tz_offset_min)
       select id, 80, 'declarada', $1, now(), -240 from magnitud where codigo = 'soc'`,
      [t!.id],
    );

    // Y su agenda de hoy y mañana, de donde sale el hueco nocturno de la sugerencia.
    const hoy = new Date();
    const enHoras = (h: number) => new Date(hoy.getTime() + h * 60 * 60 * 1000).toISOString();
    await c.sql(
      `insert into bloques_agenda (vehiculo_id, tipo, empieza_en, termina_en) values
         ($1, 'ruta', $2, $3), ($1, 'ruta', $4, $5)`,
      [conFicha!.id, enHoras(1), enHoras(5), enHoras(26), enHoras(30)],
    );
  });
});

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

test("[AC-FVEH-12] el tablero aplica la fórmula única y descuenta la reserva UNA vez", async ({
  request,
}) => {
  const r = await request.get("/api/tablero", { headers: { Authorization: `Portador ${SECRETO}` } });
  expect(r.status()).toBe(200);
  const { flota } = (await r.json()) as {
    flota: { patente: string; rango_efectivo_km: number | null; max_distance_km: number | null }[];
  };

  const conFicha = flota.find((f) => f.patente === CON_FICHA)!;
  // 300 km × 0,90 de salud × el factor por omisión del §0. Lo que importa no es el número
  // exacto —sale de la familia canónica— sino que el alcance sea MENOR que el rango efectivo y
  // por una sola reserva: restarla dos veces deja al camión «sin alcance» con media batería.
  expect(conFicha.rango_efectivo_km).not.toBeNull();
  expect(conFicha.max_distance_km).not.toBeNull();
  expect(conFicha.max_distance_km!).toBeLessThan(conFicha.rango_efectivo_km!);
  expect(
    conFicha.max_distance_km!,
    "la reserva se está restando dos veces: el alcance quedó por debajo de la mitad del rango",
  ).toBeGreaterThan(conFicha.rango_efectivo_km! / 2);

  // El que no tiene ficha no produce números inventados.
  const sinFicha = flota.find((f) => f.patente === SIN_FICHA)!;
  expect(sinFicha.rango_efectivo_km, "se calculó un rango sin datos EV").toBeNull();
  expect(sinFicha.max_distance_km).toBeNull();
});

test("[AC-FVEH-12] sin plan del día no se afirma nada, y el vacío dice QUÉ falta", async ({ page }) => {
  await sesionDe(page, SECRETO);
  await page.goto("/listos");
  await expect(page.getByTestId("listos-para-salir")).toBeVisible();

  // El semáforo del vehículo CON ficha tampoco afirma: falta el plan del día, que lo suministra
  // el hito (d). Verde diría que el camión llega, y nadie midió contra qué.
  await expect(page.getByTestId(`semaforo-${CON_FICHA}`)).toContainText("Sin plan del día");

  // Y el que no tiene ficha NOMBRA lo que falta, en vez de mostrar un guion (§5.7).
  const falta = page.getByTestId(`falta-${SIN_FICHA}`);
  await expect(falta).toBeVisible();
  await expect(falta).toContainText("autonomía");
  await expect(falta).toContainText("salud de la batería");

  // El que sí tiene ficha muestra su alcance, con la reserva ya descontada dicha en palabras.
  await expect(page.getByTestId(`alcance-${CON_FICHA}`)).toContainText("reserva ya");
});

test("[AC-FVEH-12] un clic SUGIERE el hueco nocturno, sin crear el bloque", async ({ page }) => {
  await sesionDe(page, SECRETO);
  await page.goto("/listos");

  const antes = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from bloques_agenda"),
  );

  await page.getByTestId(`sugerir-${CON_FICHA}`).click();
  const sugerencia = page.getByTestId(`sugerencia-${CON_FICHA}`);
  await expect(sugerencia).toBeVisible({ timeout: 10_000 });
  // La ventana sale de la agenda REAL del vehículo, y se muestra en es-CL.
  await expect(sugerencia).toContainText("Hueco libre");
  await expect(sugerencia).toContainText(/\d{2}-\d{2}-\d{4}/);

  // SUGIERE: no creó el bloque. Si el clic debe crearlo o pedir confirmación es la pregunta 14,
  // y elegir una de las dos acá la respondería por el dueño sin que nadie lo notara.
  const despues = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from bloques_agenda"),
  );
  expect(despues[0]!.n, "la sugerencia creó el bloque: eso decide la pregunta 14").toBe(antes[0]!.n);
});

test("[AC-FVEH-12] sin agenda no se propone una ventana inventada: se dice qué falta", async ({
  page,
}) => {
  await sesionDe(page, SECRETO);
  await page.goto("/listos");
  await page.getByTestId(`sugerir-${SIN_FICHA}`).click();
  const sugerencia = page.getByTestId(`sugerencia-${SIN_FICHA}`);
  await expect(sugerencia).toBeVisible({ timeout: 10_000 });
  // Estado vacío accionable (§5.7): proponerle una ventana de la nada sería inventarle la
  // jornada a la empresa.
  await expect(sugerencia).toContainText("no tiene agenda");
});
