import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { con, bdDeTenant, CLUSTER_LOCAL, ROL_MIGRADOR } from "../../../db/flota/conectar.mjs";
import { codigoNuevo, hashDeCodigo, expiraEn } from "../src/dominio/invitaciones.ts";
import { aprobar } from "../src/servidor/aprobacion.ts";
import { resolverSesion } from "../src/servidor/sesion.ts";
import { hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El enrolamiento no se completa sin standalone Y persist() [AC-FIDN-05] — §4.3, §5.4, §4.6.
//
// LAS DOS CONDICIONES NO SON COSMÉTICA. Sin `display-mode: standalone` la PWA es una pestaña, y
// el navegador cierra pestañas cuando necesita memoria — en medio de un turno, con capturas sin
// sincronizar. Sin `persist()` el sistema puede evictar el almacenamiento entero: el outbox del
// §4.7 se va con él, y eso son PODs del terreno que nadie va a poder rehacer.
//
// CÓMO SE PRUEBA ALGO QUE DEPENDE DEL NAVEGADOR. Ni el display-mode ni la concesión de
// `persist()` se pueden forzar desde un test, así que se sustituyen las DOS respuestas del
// navegador —`matchMedia` y `navigator.storage`— y se verifica lo que hace NUESTRO código con
// cada respuesta. Lo que se prueba es la conducta de la app, que es lo que este AC promete; que
// Chrome conteste la verdad no es algo que nos toque verificar.
//
// LA DEGRADACIÓN ES VISIBLE Y NO SILENCIOSA, que es la mitad del AC: el aparato incompleto
// TIENE sesión —si no, no habría pantalla donde decirle qué le falta— pero la sesión reporta
// `enrolamiento_completo: false`. Negarle la sesión sería exactamente el silencio que el AC
// prohíbe con esas palabras.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_DUENA = Object.keys(VALIDOS)[0]!;
const RUT_QUIEN_SOLICITA = Object.keys(VALIDOS)[1]!;
const soloAlfabeto = (rut: string) => rut.replace(/[^0-9kK]/g, "").toUpperCase();

let pool: Pool;
let codigo = "";
let duenaId = "";

test.beforeAll(async () => {
  pool = new Pool({ host: CLUSTER_LOCAL.host, port: CLUSTER_LOCAL.puerto, database: BD_A, user: ROL_MIGRADOR });
  codigo = codigoNuevo();
  await con(BD_A, async (c: Conexion) => {
    // `client_metric` NO se limpia: es CAPTURA y append-only (§7.4), y el DELETE rebota 42501
    // — que es justo lo que esa tabla promete. Por eso todo lo que esta suite cuenta de ella se
    // mide como DIFERENCIA contra lo que había, y no como total.
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
    duenaId = u!.id;
    await c.sql(
      "insert into invitaciones (rol, token_hash, expira_at, creada_por) values ('chofer', $1, $2, $3)",
      [hashDeCodigo(codigo), expiraEn(new Date()), duenaId],
    );
  });
});

test.afterAll(async () => {
  await pool?.end();
});

/**
 * Sustituye las dos respuestas del navegador ANTES de que cargue la página. `addInitScript`
 * y no una evaluación después: el componente pregunta al montarse, y un stub que llega tarde
 * mediría el navegador de verdad en el primer chequeo y el nuestro en el segundo.
 */
async function fingirNavegador(page: Page, { standalone, persiste }: { standalone: boolean; persiste: boolean }) {
  await page.addInitScript(
    ([enStandalone, concede]) => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (consulta: string) =>
        consulta.includes("display-mode: standalone")
          ? ({ matches: enStandalone, media: consulta, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList)
          : original(consulta);
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: { persist: async () => concede, persisted: async () => concede },
      });
    },
    [standalone, persiste] as [boolean, boolean],
  );
}

/** Cuántas negativas de persistencia hay registradas. Se compara por DIFERENCIA: la tabla es
 *  append-only y arrastra lo de corridas anteriores. */
async function persistDenegados(): Promise<number> {
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>("select count(*)::text as n from client_metric where tipo = 'persist_denegado'"),
  );
  return Number(f!.n);
}

async function teclear(page: Page, caracteres: string) {
  for (const c of caracteres) await page.getByRole("button", { name: c, exact: true }).click();
}

/** Recorre F-B hasta «Esperando aprobación». Devuelve nada: lo que sigue se mira en pantalla. */
async function solicitar(page: Page) {
  await page.goto("/solicitar");
  await page.getByTestId("codigo").fill(codigo);
  await page.getByRole("button", { name: "Continuar" }).click();
  await teclear(page, soloAlfabeto(RUT_QUIEN_SOLICITA));
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByTestId("nombre").fill("Quien se enrola");
  await page.getByRole("button", { name: "Continuar" }).click();
  await teclear(page, "1234");
  await page.getByRole("button", { name: "Continuar" }).click();
  await teclear(page, "1234");
  await page.getByRole("button", { name: "Solicitar acceso" }).click();
  await expect(page.getByTestId("esperando-aprobacion")).toBeVisible();
}

test("[AC-FIDN-05] sin persist(), la pantalla lo DICE y la métrica queda registrada", async ({ page }) => {
  // El caso de terreno: la persona abrió el link desde WhatsApp, así que está en una pestaña y
  // el navegador todavía no le concedió persistencia. Ninguna de las dos condiciones se cumple.
  const metricasAntes = await persistDenegados();
  await fingirNavegador(page, { standalone: false, persiste: false });
  await solicitar(page);

  const entorno = page.getByTestId("entorno");
  await expect(entorno).toHaveAttribute("data-completo", "no");
  // DEGRADACIÓN VISIBLE: no un ícono, no un silencio — qué falta, qué hacer y por qué importa.
  await expect(entorno).toContainText("Falta un paso");
  await expect(page.getByTestId("condicion-standalone")).toHaveAttribute("data-cumple", "no");
  await expect(page.getByTestId("condicion-persistencia")).toHaveAttribute("data-cumple", "no");
  await expect(page.getByTestId("condicion-standalone")).toContainText("Agregar a la pantalla de inicio");
  await expect(page.getByTestId("condicion-persistencia")).toContainText("puede borrar lo que capturaste");

  await expect.poll(persistDenegados).toBe(metricasAntes + 1);

  // Y el entorno viajó a la solicitud: el dueño no aprueba a ciegas. Sin esto, estaría
  // habilitando un aparato sin saber si sirve para trabajar.
  const [s] = await con(BD_A, (c: Conexion) =>
    c.sql<{ standalone: string; persistido: string; visto: string | null }>(
      `select is_standalone::text as standalone, storage_persisted::text as persistido,
              entorno_visto_en::text as visto
         from solicitudes_acceso where estado = 'pendiente'`,
    ),
  );
  expect(s!.standalone).toBe("false");
  expect(s!.persistido).toBe("false");
  // Reportado en falso NO es lo mismo que nunca reportado: la fecha es lo que los distingue.
  expect(s!.visto).not.toBeNull();

  // REINTENTO SIN CAMBIO: la métrica NO se duplica. Sin la idempotencia, el panel del §10
  // contestaría «cuántas veces alguien insistió» en vez de «cuántos aparatos no consiguen
  // persistencia», que es otra pregunta y con otra respuesta.
  await page.getByRole("button", { name: "Revisar" }).click();
  await page.waitForTimeout(300);
  expect(await persistDenegados()).toBe(metricasAntes + 1);
});

test("[AC-FIDN-05] con las dos concedidas, el aparato queda ACTIVO y la sesión lo confirma", async ({ page }) => {
  await con(BD_A, async (c: Conexion) => {
    await c.sql("delete from solicitudes_acceso");
    await c.sql("delete from dispositivos");
    await c.sql("delete from usuarios where rol <> 'admin_tenant'");
    await c.sql("delete from personas where rut <> $1", [RUT_DUENA]);
  });

  const metricasAntes = await persistDenegados();
  await fingirNavegador(page, { standalone: true, persiste: true });
  await solicitar(page);

  const entorno = page.getByTestId("entorno");
  await expect(entorno).toHaveAttribute("data-completo", "si");
  await expect(entorno).toContainText("queda listo");
  // Cumplida, la condición no repite la instrucción: una pantalla que sigue diciendo qué hacer
  // cuando ya está hecho enseña a no leerla.
  await expect(page.getByTestId("condicion-standalone")).not.toContainText("Tocá «Compartir»");

  // Sin métrica NUEVA: nadie negó nada.
  expect(await persistDenegados()).toBe(metricasAntes);

  const [s] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string; clave: string }>(
      "select id::text as id, clave_publica as clave from solicitudes_acceso where estado = 'pendiente'",
    ),
  );
  const r = await aprobar(pool, s!.id, duenaId);
  expect(r.tipo).toBe("aprobada");
  if (r.tipo !== "aprobada") return;

  // EL ACTO COMPLETO: el entorno declarado mientras esperaba viaja al aparato en la misma
  // aprobación. Sin esto, quien hizo todo bien quedaría «no operable» igual, y el enrolamiento
  // se completaría dos pantallas después de haberse completado.
  const [d] = await con(BD_A, (c: Conexion) =>
    c.sql<{ standalone: string; persistido: string }>(
      "select is_standalone::text as standalone, storage_persisted::text as persistido from dispositivos where id = $1",
      [r.dispositivoId],
    ),
  );
  expect(d!.standalone).toBe("true");
  expect(d!.persistido).toBe("true");

  // Y la sesión del aparato lo confirma de punta a punta, con el secreto REAL que la
  // aprobación selló contra su clave pública.
  const privada = await page.evaluate(async () => {
    const bd = await new Promise<IDBDatabase>((res, rej) => {
      const p = indexedDB.open("flota-aparato", 1);
      p.onsuccess = () => res(p.result);
      p.onerror = () => rej(p.error);
    });
    return new Promise<boolean>((res) => {
      const req = bd.transaction("claves", "readonly").objectStore("claves").get("privada");
      req.onsuccess = () => res(req.result !== undefined);
      req.onerror = () => res(false);
    });
  });
  // La privada quedó guardada en el aparato: sin ella el sobre no se puede abrir nunca más.
  expect(privada, "el aparato no guardó su clave privada").toBe(true);

});

test("[AC-FIDN-05] el aparato incompleto TIENE sesión, y la sesión dice qué le falta", async () => {
  // La mitad que hace VISIBLE la degradación: el aparato entra, y el servidor informa que le
  // falta. Negarle la sesión lo dejaría sin ninguna pantalla donde enterarse — exactamente el
  // silencio que el AC prohíbe con esas palabras. Lo que no puede hacer es capturar en terreno,
  // y eso lo exigen los endpoints de captura del módulo 04 (hito e): ALCANCE DECLARADO.
  //
  // Los dos aparatos se arman con secreto conocido y no con el sobre de la aprobación: la
  // privada que abre un sobre es NO EXTRAÍBLE y vive en el IndexedDB del teléfono, que es
  // justo la propiedad que AC-FIDN-04 prueba. Acá interesa la otra mitad.
  await con(BD_A, async (c: Conexion) => {
    await c.sql("delete from dispositivos");
    const [p] = await c.sql<{ id: string }>("select id::text as id from personas where rut = $1", [RUT_DUENA]);
    const [u] = await c.sql<{ id: string }>("select id::text as id from usuarios where persona_id = $1", [p!.id]);
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, false)`,
      [p!.id, hashDeSecreto("secreto-a-medias"), u!.id],
    );
  });

  const aMedias = await resolverSesion(pool, "Portador secreto-a-medias");
  expect(aMedias.tipo, "el aparato incompleto se quedó sin pantalla donde enterarse").toBe("valida");
  if (aMedias.tipo !== "valida") return;
  expect(aMedias.sesion.isStandalone).toBe(true);
  expect(aMedias.sesion.storagePersisted).toBe(false);

  // El POSITIVO, sin el cual esto pasaría con dos columnas que siempre devuelven lo mismo.
  await con(BD_A, async (c: Conexion) => {
    await c.sql("update dispositivos set storage_persisted = true where secreto_hash = $1", [
      hashDeSecreto("secreto-a-medias"),
    ]);
  });
  const completo = await resolverSesion(pool, "Portador secreto-a-medias");
  expect(completo.tipo === "valida" && completo.sesion.storagePersisted).toBe(true);
});
