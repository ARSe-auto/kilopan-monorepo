import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { registrarBaseline, leerBaseline } from "./baseline-acciones.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El alta de vehículo, de punta a punta y contando acciones [AC-FVEH-01] — §5.4, §5.3, §4.5.
//
// LAS TRES COSAS QUE ESTE AC PIDE Y ACÁ SE VERIFICAN:
//
//   1. Con SOLO patente + tipo el vehículo queda operable: aparece en la flota, activo, y sin
//      que ninguna columna progresiva se haya rellenado con un valor inventado.
//   2. Patente duplicada en el mismo tenant ⇒ 422 tipado y CERO filas nuevas.
//   3. El camino feliz REGISTRA su conteo de acciones como baseline en el primer verde, y de
//      ahí en adelante una regresión que lo suba pone el gate rojo (§5.3, última frase).
//
// LÍMITE DECLARADO, y se dice acá porque un límite callado es un verde que promete de más: el
// AC escribe «operable de inmediato (visible en agenda y asignable)», y la AGENDA todavía no
// existe — nace con AC-FVEH-07, en este mismo módulo. Lo que hoy se puede verificar es el
// equivalente exacto de «operable» que sí tiene sujeto: el vehículo queda listado por
// `/api/vehiculos` —la lectura que el §5.4 le reserva al operador para asignar— y activo, sin
// ningún campo adicional que completar. Cuando la agenda exista, la cláusula se cierra ahí.
//
// LOS SELECTORES SON SOLO `data-testid`: un selector por texto se rompe cuando alguien mejora
// una etiqueta, y ese día el presupuesto de acciones deja de medirse por un motivo que no
// tiene nada que ver con los toques (misma razón que en `enrolamiento.spec.ts`).

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_DUENA = Object.keys(VALIDOS)[0]!;
const SECRETO_DUENA = secretoNuevo();

/** Las patentes del fixture. Sin guiones a propósito en la segunda: es la MISMA que la primera
 *  para la base, y es lo que hace que el 422 pruebe la normalización y no solo el índice. */
const PATENTE = "AB1234";
const PATENTE_OTRA_FORMA = "ab-12 34";
const TIPO = "Furgón eléctrico";

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await c.sql("delete from vehiculos");
    await c.sql("delete from solicitudes_acceso");
    await c.sql("delete from invitaciones");
    await c.sql("delete from dispositivos");
    await c.sql("delete from usuarios");
    await c.sql("delete from personas");
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Dueña') returning id::text as id",
      [RUT_DUENA],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO_DUENA), u!.id],
    );
  });
});

/**
 * Cuenta ACCIONES con la convención CERRADA del §5.3: «un campo del teclado propio = 1 acción
 * para el presupuesto, sea cual sea su cantidad de dígitos; el e2e cuenta ACCIONES, no
 * keydowns». Por eso `llenar` suma uno entero por campo —da igual que la patente tenga seis
 * caracteres— y `tocar` suma uno por botón.
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
    async llenar(testid: string, texto: string) {
      acciones++;
      await page.getByTestId(testid).fill(texto);
    },
  };
}

/** Deja la sesión de la dueña en el aparato antes de que cargue la página. */
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

const filasDeVehiculos = () =>
  con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from vehiculos"),
  ).then((r) => Number(r[0]!.n));

test("[AC-FVEH-01] con patente + tipo el vehículo queda operable, y el camino feliz fija su baseline", async ({
  page,
}) => {
  await sesionDe(page, SECRETO_DUENA);
  const c = contador(page);
  await page.goto("/vehiculos");
  await expect(page.getByTestId("vehiculos")).toBeVisible();
  // La flota arranca vacía y el vacío es ACCIONABLE (§5.7): dice qué hacer, no «sin datos».
  await expect(page.getByTestId("conteo-flota")).toHaveText("0");

  await c.llenar("patente", PATENTE); // 1 · la patente
  await c.llenar("tipo", TIPO); // 2 · el tipo
  await c.tocar("guardar-vehiculo"); // 3 · agregar

  await expect(page.getByTestId("conteo-flota")).toHaveText("1");
  await expect(page.getByTestId("vehiculo-patente")).toHaveText(PATENTE);

  // ── Operable: listado, activo, y sin un solo dato inventado ────────────────────────
  const [v] = await con(BD_A, (c2: Conexion) =>
    c2.sql<Record<string, string | null>>(
      `select patente, tipo, activo::text as activo,
              capacidad_bultos::text as capacidad_bultos, capacidad_kg::text as capacidad_kg,
              bateria_wh::text as bateria_wh, autonomia_nominal_km::text as autonomia_nominal_km,
              wh_por_km_base::text as wh_por_km_base, soh_pct::text as soh_pct,
              odometro::text as odometro, soc::text as soc
         from vehiculos`,
    ),
  );
  expect(v!.patente, "la patente no quedó normalizada en la base").toBe(PATENTE);
  expect(v!.tipo).toBe(TIPO);
  expect(v!.activo, "un vehículo recién dado de alta tiene que estar activo").toBe("true");
  // Ni una autonomía de folleto, ni un SOH de 100, ni un SOC de arranque: el §5.4 dice que el
  // resto es PROGRESIVO, y un default sano es una cifra falsa con cara de dato medido — el
  // Anexo A es explícito en que los 305 km CLTC no son los 185–245 reales. Además, el seed de
  // `autonomia_nominal_km` del EV48 es la pregunta 4 de esta spec, abierta.
  for (const columna of [
    "capacidad_bultos",
    "capacidad_kg",
    "bateria_wh",
    "autonomia_nominal_km",
    "wh_por_km_base",
    "soh_pct",
    "odometro",
    "soc",
  ]) {
    expect(v![columna], `el alta inventó un valor para ${columna}`).toBeNull();
  }

  // ── Y el acto quedó auditado: es alta de vehículo, o sea gobierno del dueño (§5.4) ──
  const [rastro] = await con(BD_A, (c2: Conexion) =>
    c2.sql<{ eventos: string; auditoria: string }>(
      `select (select count(*)::text from eventos e join evento_tipo t on t.id = e.tipo_id
                where t.codigo = 'gobierno.vehiculo_creado') as eventos,
              (select count(*)::text from audit_trail where tabla = 'vehiculos') as auditoria`,
    ),
  );
  expect(rastro!.eventos, "el alta no dejó su evento de gobierno").toBe("1");
  expect(rastro!.auditoria, "el alta no dejó su fila de audit_trail").toBe("1");

  // ── El baseline del §5.3, que a partir de acá es un techo ──────────────────────────
  const { baseline, acciones, primeraVez } = registrarBaseline({
    flujo: "alta-vehiculo",
    ac: "AC-FVEH-01",
    acciones: c.acciones,
  });
  // Anti-vacuidad: un contador que nunca sumó daría un baseline de cero y el techo sería
  // inalcanzable hacia arriba, o sea inútil como contrato de regresión.
  expect(acciones, "el contador de acciones no midió nada").toBeGreaterThan(0);
  expect(
    acciones,
    `el alta pasó de ${baseline} a ${acciones} acciones: una regresión del camino feliz no ` +
      "se mergea (§5.3). Si la subida es deliberada, el techo lo mueve una persona editando " +
      "packages/metodo/panel/acciones-alta-vehiculo.json.",
  ).toBeLessThanOrEqual(baseline);
  if (primeraVez) console.log(`AC-FVEH-01: baseline del alta fijado en ${acciones} acciones`);
});

test("[AC-FVEH-01] la misma patente escrita de otra forma rebota 422 y no deja ni una fila", async ({ page }) => {
  await sesionDe(page, SECRETO_DUENA);
  await page.goto("/vehiculos");
  await expect(page.getByTestId("conteo-flota")).toHaveText("1");
  const antes = await filasDeVehiculos();

  // «ab-12 34» es la MISMA patente que «AB1234». Si la normalización se ablandara, esto
  // entraría como un segundo vehículo y la empresa tendría dos historias de odómetro para un
  // solo camión — el defecto que no se ve hasta que los números no cuadran, meses después.
  await page.getByTestId("patente").fill(PATENTE_OTRA_FORMA);
  await page.getByTestId("tipo").fill(TIPO);
  await page.getByTestId("guardar-vehiculo").click();

  const rebote = page.getByTestId("rebote-alta");
  await expect(rebote).toBeVisible();
  // El mensaje NOMBRA la patente: quien la tipeó acaba de descubrir que el vehículo ya está
  // cargado, y casi nunca es error suyo — es que otra persona de la empresa lo cargó antes.
  await expect(rebote).toContainText(PATENTE);

  expect(await filasDeVehiculos(), "el rebote dejó una fila: el 422 tiene que ser de 0 filas").toBe(antes);
  await expect(page.getByTestId("conteo-flota")).toHaveText("1");
});

test("[AC-FVEH-01] el segundo vehículo elige su tipo con un CHIP: el catálogo lo arma la propia flota", async ({
  page,
}) => {
  // El §5.4 dice «tipo (chips)» sin enumerarlos en ninguna parte del maestro (pregunta 15 de
  // esta spec). Los chips salen de los tipos que este tenant ya usó: la primera alta se
  // escribe, la segunda es un toque. Se verifica que el toque exista de verdad y que el alta
  // por chip no cueste más acciones que la primera.
  await sesionDe(page, SECRETO_DUENA);
  const c = contador(page);
  await page.goto("/vehiculos");
  await expect(page.getByTestId("tipos-conocidos")).toBeVisible();

  await c.llenar("patente", "CD5678");
  await c.tocar(`tipo-${TIPO}`);
  await c.tocar("guardar-vehiculo");

  await expect(page.getByTestId("conteo-flota")).toHaveText("2");
  // Se LEE el techo, no se vuelve a registrar: el baseline lo fija el camino feliz del primer
  // test, y una segunda escritura por commit dejaría el histórico contando dos veces la misma
  // corrida.
  const techo = leerBaseline("alta-vehiculo");
  expect(techo, "el camino feliz no dejó su baseline").not.toBeNull();
  expect(c.acciones, "el alta por chip no puede costar más que el techo del camino feliz").toBeLessThanOrEqual(
    techo!.baseline,
  );

  const [v] = await con(BD_A, (c2: Conexion) =>
    c2.sql<{ tipo: string }>("select tipo from vehiculos where patente = 'CD5678'"),
  );
  expect(v!.tipo, "el chip no cargó el tipo que decía").toBe(TIPO);
});
