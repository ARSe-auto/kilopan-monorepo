import { readFileSync } from "node:fs";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { UNDO } from "../../../packages/nucleo-comun/src/constants.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Covering array 2-way de la pantalla de parada [AC-FPOD-18] — §5.2 F4, §5.3, §9.2 (desglosado
// de AC-FPOD-02).
//
// ─── QUÉ PRUEBA ESTE ARCHIVO, Y QUÉ NO ────────────────────────────────────────────
//
// El array que se ejerce acá NO está escrito a mano: sale de `covering-array-parada.generado.
// json`, que `db/flota/generar-covering-array.mjs` calcula desde `covering-array-parada.pict`
// (implementación propia — no hay binario `pict` instalable en el runner del motor). El gate
// (`db/flota/gate-covering-array-parada.mjs`) recalcula ese mismo array en cada corrida y lo
// compara contra el `.json` comiteado: agregar un flag al `.pict` sin correr el generador dos
// veces cambia el array y el hash de la fuente, y el gate lo ve — sin que este spec necesite
// saber nada de eso. Este archivo solo consume el array e itera SUS filas, así que un factor
// nuevo agrega tests automáticamente, no a mano.
//
// Por cada fila se llega a la combinación exacta de flags que describe (§9.2) y se ejerce:
//   · el presupuesto de toques que costó llegar hasta ahí, contra el techo del §5.2 F4 (4
//     acciones — el conteo POR VARIANTE, con su propio baseline, es de AC-FPOD-02: acá el
//     covering array no duplica ese oráculo, solo confirma que ninguna combinación lo rompe);
//   · el botón primario que la pantalla ofrece en ese estado exacto — o su ausencia, cuando el
//     diseño no ofrece ninguno a propósito (candado cerrado, ruta terminada: §7.6 «no hay botón
//     gris, no hay candado mudo — hay texto»).
//
// `enVentana` y `enCola_gt0` no son independientes del reloj: se realizan cerrando 0, 1 o 2
// paradas «previas» antes de la que la fila realmente ejerce, con o sin red, según haga falta
// que la ventana de 8 s siga abierta o ya haya vencido hacia la cola (§4.7).

const A = TENANTS.find((t) => t.slug === "hechos")!;
const BD_A = bdDeTenant(A.slug);
const EN_A = `http://${A.slug}.localhost:${PUERTO_E2E}`;
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
/** Propio y no prestado (§4.3: un dispositivo personal ACTIVO por operario) — decimotercer
 *  operario de F4, mismo motivo que cada suite hermana. */
const RUT_CHOFER = rutDeFixture(23);
/** La empresa con el manifiesto SIEMPRE confirmado: la que usan todas las paradas «previas» y
 *  las filas cuyo candado tiene que estar abierto. */
const RUT_EMPRESA_CONFIRMADA = rutDeFixture(6);
/** La empresa cuyo manifiesto ESTE archivo deja sin confirmar a propósito, para las filas
 *  candadoCerrado="si" — la misma «Pastelería del candado» de `entrega.spec.ts` (AC-FRUT-22):
 *  reusar el RUT de una empresa ya declarada no pisa nada, `empresas_cliente` es upsert por
 *  (tenant, rut). */
const RUT_EMPRESA_SIN_CONFIRMAR = rutDeFixture(7);

type FilaCovering = {
  terminado: "si" | "no";
  llegada: "si" | "no";
  modo: "elegir" | "no_entregado" | "dejado_en_punto";
  candadoCerrado: "si" | "no";
  evidenciaPendiente: "si" | "no";
  enVentana: "si" | "no";
  enCola_gt0: "si" | "no";
  gpsDenegado: "si" | "no";
};

const DOCUMENTO = JSON.parse(
  readFileSync(new URL("../../../db/flota/covering-array-parada.generado.json", import.meta.url), "utf8"),
) as { filas: FilaCovering[] };
const FILAS = DOCUMENTO.filas;

/** El techo del §5.2 F4: «el operario nunca supera 4 acciones» en NINGUNA combinación. El
 *  conteo exacto por variante —2, 3 o 4 según parcial/no-entregado/dejado-en-punto— es el
 *  oráculo propio de AC-FPOD-02 (`packages/metodo/panel/acciones-*.json`); acá solo se vigila
 *  que ninguna combinación del covering array lo rompa. */
const TECHO_TOQUES = 4;

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Covering array de la parada') returning id::text as id",
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
    // El motivo que la variante no-entregado necesita para dejar visible «Confirmar»: propio
    // y no compartido, mismo criterio que `pod-variantes.spec.ts` (AC-FPOD-02).
    await c.sql(
      `insert into motivos (codigo, etiqueta, estado_asociado, orden)
       values ('covering_array_no_entregado', 'No había nadie (covering array)', 'parada_fallida', 1)
         on conflict (tenant_id, codigo) do update set etiqueta = excluded.etiqueta`,
    );
  });
});

async function sesionDe(page: Page) {
  await page.addInitScript((s: string) => {
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

type ParadaSpec = {
  empresaRut: string;
  confirmarManifiesto: boolean;
  requisitos?: { tipo: string; obligatorio: boolean }[];
};

/** Una ruta con UNA parada de carga y las paradas de entrega que `paradas` describe, en orden.
 *  El candado de cada entrega se decide por SU empresa: `confirmarManifiesto` inserta (o no) el
 *  sub-manifiesto de esa empresa en la parada de carga (§4.5, `dominio/candado-entrega.ts`). */
async function construirRuta(nombre: string, paradas: ParadaSpec[]) {
  return con(BD_A, async (c: Conexion) => {
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

    const empresasYaConfirmadas = new Set<string>();
    const resultado: { id: string; destino: string }[] = [];
    let orden = 1;
    for (const p of paradas) {
      orden++;
      const [empresa] = await c.sql<{ id: string }>(
        `insert into empresas_cliente (rut, razon_social) values ($1, $2)
           on conflict (tenant_id, rut) do update set razon_social = excluded.razon_social
         returning id::text as id`,
        [p.empresaRut, p.empresaRut === RUT_EMPRESA_SIN_CONFIRMAR ? "Pastelería del candado" : "Panadería del covering array"],
      );
      const destinoNombre = `Sucursal ${orden} de ${nombre}`;
      const [destino] = await c.sql<{ id: string }>(
        "insert into destinos (nombre) values ($1) returning id::text as id",
        [destinoNombre],
      );
      const [parada] = await c.sql<{ id: string }>(
        `insert into paradas (ruta_id, tipo, orden, destino_id) values ($1, 'entrega', $2, $3)
         returning id::text as id`,
        [r!.id, orden, destino!.id],
      );
      const [encargo] = await c.sql<{ id: string }>(
        "insert into encargos (empresa_cliente_id, destino_id, bultos) values ($1, $2, $3) returning id::text as id",
        [empresa!.id, destino!.id, 3],
      );
      await c.sql("insert into items (parada_id, encargo_id, qty_planificada) values ($1, $2, $3)", [
        parada!.id,
        encargo!.id,
        3,
      ]);
      let ordenReq = 0;
      for (const req of p.requisitos ?? []) {
        ordenReq++;
        await c.sql(
          `insert into stop_requirement (parada_id, tipo_evidencia, obligatorio, orden)
           values ($1, $2::evidencia_tipo, $3, $4)`,
          [parada!.id, req.tipo, req.obligatorio, ordenReq],
        );
      }
      if (p.confirmarManifiesto && !empresasYaConfirmadas.has(empresa!.id)) {
        empresasYaConfirmadas.add(empresa!.id);
        await c.sql(
          `insert into manifiestos (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min)
           values ($1, $2, now(), -240)`,
          [carga!.id, empresa!.id],
        );
      }
      resultado.push({ id: parada!.id, destino: destinoNombre });
    }
    return { rutaId: r!.id, paradas: resultado };
  });
}

/** Cierra UNA parada (Llegué + Entregado) por el camino feliz — las «previas» de la fila,
 *  ninguna de las cuales lleva evidencia pendiente. */
async function cerrarParadaFeliz(page: Page) {
  await expect(page.getByTestId("llegue")).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("llegue").click();
  await page.getByTestId("entregado").click();
}

/**
 * Realiza UNA fila del covering array: construye el escenario mínimo que la produce, la
 * alcanza, y devuelve cuántos toques costó la parte que la fila mide (excluidas las paradas
 * «previas» que solo existen para dejar la ventana o la cola en el estado que la fila pide).
 */
async function ejercerFila(
  page: Page,
  context: BrowserContext,
  fila: FilaCovering,
  indice: number,
): Promise<{ toques: number; primario: string | null }> {
  if (fila.gpsDenegado === "no") {
    await context.grantPermissions(["geolocation"], { origin: EN_A });
    await context.setGeolocation({ latitude: -33.45, longitude: -70.6667 });
  }
  // gpsDenegado="si": el contexto por defecto NO tiene permisos concedidos, y Playwright
  // deniega igual que un operario que tocó «No permitir» (mismo criterio que AC-FPOD-12).

  const nombreRuta = `Covering-${indice}`;
  const hayTarget = fila.terminado === "no";
  const paradasSpec: ParadaSpec[] = [];
  const previa = (): ParadaSpec => ({ empresaRut: RUT_EMPRESA_CONFIRMADA, confirmarManifiesto: true });

  // terminado="si" sin rastro (enVentana="no", enCola_gt0="no"): no hay parada objetivo — las
  // «previas» SON toda la ruta, y sin cerrar ninguna nunca se llega a `terminado()===true`
  // (`dominio/pod-terreno.ts`). Necesita 1 parada propia, cerrada online y con el drenaje
  // COMPLETO (ventana vencida Y replay confirmado), a diferencia del resto de los casos
  // enVentana="no"/enCola_gt0="no" con target, que llegan gratis con 0 toques (recorrido recién
  // iniciado: `captura===null`, `cola=[]`).
  const casoTerminalSinRastro = !hayTarget && fila.enVentana === "no" && fila.enCola_gt0 === "no";

  // Las paradas «previas», SIEMPRE por el camino feliz y SIN evidencia: solo dejan la
  // ventana/cola en el estado que la fila necesita antes de llegar a la que se mide.
  if (fila.enVentana === "si" && fila.enCola_gt0 === "si") {
    paradasSpec.push(previa(), previa());
  } else if (fila.enVentana === "si" || fila.enCola_gt0 === "si" || casoTerminalSinRastro) {
    paradasSpec.push(previa());
  }
  const cantidadPrevias = paradasSpec.length;

  if (hayTarget) {
    paradasSpec.push({
      empresaRut: fila.candadoCerrado === "si" ? RUT_EMPRESA_SIN_CONFIRMAR : RUT_EMPRESA_CONFIRMADA,
      confirmarManifiesto: fila.candadoCerrado !== "si",
      requisitos: fila.evidenciaPendiente === "si" ? [{ tipo: "firma", obligatorio: true }] : [],
    });
  }

  const { paradas } = await construirRuta(nombreRuta, paradasSpec);
  await sesionDe(page);
  // La página carga SIEMPRE online: recién después el offline corta la red que el motor de
  // sync usaría. Cortarla ANTES del primer `goto` no prueba «sin red desde antes de llegar»
  // (§3.E1.7) — solo hace que el navegador no pueda ni pedir el documento, y WebKit lo aborta
  // con un error interno en vez del error de red que un tenant sin señal daría de verdad.
  await page.goto(`${EN_A}/entrega?parada=${paradas[0]!.id}`);
  if (fila.enCola_gt0 === "si") {
    // Desde acá: lo que caiga a la cola tiene que QUEDARSE ahí y no replicarse solo, que es lo
    // que probaría enCola_gt0="no" por accidente.
    await context.setOffline(true);
  }

  // ─── Cierra las previas, en el orden que produce enVentana/enCola_gt0 ────────────
  if (cantidadPrevias === 2) {
    // Recipe (enVentana=si, enCola_gt0=si): la 1ª vence hacia la cola ANTES de cerrar la 2ª.
    await cerrarParadaFeliz(page);
    await expect(page.getByTestId("por-sincronizar")).toBeVisible({ timeout: UNDO.ventana_ms * 1.5 });
    await expect(page.getByTestId("contador-cola")).toHaveText("1");
    await cerrarParadaFeliz(page);
  } else if (cantidadPrevias === 1 && casoTerminalSinRastro) {
    // Drenaje COMPLETO: online desde el arranque (nunca se pidió offline para esta fila), la
    // ventana vence y el replay-on-online/startup confirma la captura sola — la cola vuelve a 0
    // sin que el chofer toque nada (§4.7).
    await cerrarParadaFeliz(page);
    await expect(page.getByTestId("banda-undo")).toHaveCount(0, { timeout: UNDO.ventana_ms * 1.5 });
    await expect(page.getByTestId("por-sincronizar")).toHaveCount(0, { timeout: UNDO.ventana_ms });
  } else if (cantidadPrevias === 1 && fila.enCola_gt0 === "si") {
    // Recipe (enVentana=no, enCola_gt0=si): cierra y espera a que la ventana venza.
    await cerrarParadaFeliz(page);
    await expect(page.getByTestId("por-sincronizar")).toBeVisible({ timeout: UNDO.ventana_ms * 1.5 });
    await expect(page.getByTestId("banda-undo")).toHaveCount(0);
  } else if (cantidadPrevias === 1) {
    // Recipe (enVentana=si, enCola_gt0=no): cierra y NO espera — sigue dentro de la ventana.
    await cerrarParadaFeliz(page);
  }

  if (!hayTarget) {
    // terminado="si": las previas fueron TODA la ruta. Nada más que tocar.
    if (fila.enVentana === "si") await expect(page.getByTestId("banda-undo")).toBeVisible();
    else await expect(page.getByTestId("banda-undo")).toHaveCount(0);
    if (fila.enCola_gt0 === "si") await expect(page.getByTestId("por-sincronizar")).toBeVisible();
    else await expect(page.getByTestId("por-sincronizar")).toHaveCount(0);
    await expect(page.getByTestId("ruta-terminada")).toBeVisible();
    // §7.6: la ruta terminada es texto, cero botón primario — no hay más nada que ofrecer.
    return { toques: cantidadPrevias * 2, primario: null };
  }

  // ─── La parada que la fila realmente mide ────────────────────────────────────────
  let toques = 0;
  const tocar = async (testid: string) => {
    await page.getByTestId(testid).click();
    toques++;
  };

  if (fila.candadoCerrado === "si") {
    await expect(page.getByTestId("candado-cerrado")).toBeVisible();
    // §7.6: candado cerrado es texto que dice qué falta, cero botón gris.
    return { toques: 0, primario: null };
  }

  await expect(page.getByTestId("candado-abierto")).toBeVisible();
  if (fila.llegada === "no") {
    // Nada más que hacer: el botón primario de este estado es «Llegué», y llegar es lo que
    // convertiría esta fila en OTRA fila (llegada="si") del mismo covering array.
    await expect(page.getByTestId("llegue")).toBeEnabled();
    return { toques: 0, primario: "llegue" };
  }

  await tocar("llegue");

  if (fila.gpsDenegado === "si") {
    await expect(page.getByTestId("aviso-gps-denegado")).toBeVisible({ timeout: 3_000 });
  } else {
    await page.waitForTimeout(800);
    await expect(page.getByTestId("aviso-gps-denegado")).toHaveCount(0);
  }

  if (fila.evidenciaPendiente === "si") {
    await expect(page.getByTestId("evidencia-exigida")).toBeVisible();
  }

  if (fila.modo === "elegir") {
    if (fila.evidenciaPendiente === "si") {
      const primero = page.getByTestId("evidencia-exigida").getByRole("button").first();
      await expect(primero).toBeEnabled();
      return { toques, primario: "evidencia-exigida (primer requisito)" };
    }
    await expect(page.getByTestId("entregado")).toBeEnabled();
    return { toques, primario: "entregado" };
  }

  if (fila.modo === "no_entregado") {
    await tocar("modo-no-entregado");
    await expect(page.getByTestId("modo-no-entregado-panel")).toBeVisible();
    await page.getByTestId("motivo-no-entrega").getByRole("radio").first().click();
    toques++;
    await expect(page.getByTestId("confirmar-no-entregado")).toBeEnabled();
    return { toques, primario: "confirmar-no-entregado" };
  }

  // modo === "dejado_en_punto" (evidenciaPendiente="no" siempre acá: restricción del .pict).
  await tocar("modo-dejado-en-punto");
  await expect(page.getByTestId("modo-dejado-en-punto-panel")).toBeVisible();
  // Sin `bultos_max_sin_receptor` sembrado (parámetro sin responder, spec 04 Pregunta 1) el
  // encuadre nunca se exige (§4.4): «Confirmar» está visible de entrada.
  await expect(page.getByTestId("confirmar-dejado-en-punto")).toBeEnabled();
  return { toques, primario: "confirmar-dejado-en-punto" };
}

for (const [indice, fila] of FILAS.entries()) {
  const descripcion = Object.entries(fila)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

  test(`[AC-FPOD-18] fila ${indice + 1}/${FILAS.length}: ${descripcion}`, async ({ page, context }) => {
    const { toques, primario } = await ejercerFila(page, context, fila, indice);

    expect(toques, `la fila ${indice + 1} costó ${toques} toques — el techo del §5.2 F4 es ${TECHO_TOQUES}`).toBeLessThanOrEqual(
      TECHO_TOQUES,
    );

    // El camino feliz puro (candado abierto, llegada+entregado, sin evidencia) sigue costando
    // EXACTO 2 dentro de este mismo array — el mismo contrato que AC-FPOD-01 fija, visto desde
    // otra combinación de flags.
    if (fila.llegada === "si" && fila.modo === "elegir" && fila.evidenciaPendiente === "no") {
      expect(toques).toBe(1); // acá se cuenta solo hasta «Llegué»: «Entregado» queda sin tocar
      // a propósito, para que el botón primario de esta fila sea observable antes del cierre.
    }

    if (primario !== null) {
      // Cero botón gris (§7.6): si esta fila tiene un primario, ya se verificó `toBeEnabled()`
      // arriba. Acá solo se deja escrito CUÁL era, para que un cambio de nombre de testid se
      // note en el diff de este archivo y no como un `undefined` silencioso.
      expect(primario.length).toBeGreaterThan(0);
    }
  });
}
