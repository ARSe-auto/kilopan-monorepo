import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { INVITACION, PIN } from "../../../packages/nucleo-comun/src/constants.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// El flujo feliz del §5.4, contando ACCIONES [AC-FIDN-02] — §5.3, §5.4, §7.6.
//
// LO QUE ESTE AC MIDE Y NINGÚN OTRO: cuántas veces toca la pantalla cada persona. El §5.3 pone
// el presupuesto de acciones como CONTRATO, no como aspiración, y un presupuesto que nadie
// cuenta es una intención. Acá se cuenta con la convención del §5.3: una acción es un toque
// que la persona decide dar.
//
// Los tres tramos:
//   · F-A, el dueño emite: ≤4 acciones, y salen QR + link + código corto — una sola credencial
//     en tres envoltorios (AC-FIDN-03), no tres cosas que revocar.
//   · F-B, el trabajador solicita: sin campo de correo (§5.4 «CERO emails») y con teclado
//     PROPIO. Los toques del teclado numérico no son decisiones: son el dato. Lo que se cuenta
//     son los botones de avanzar.
//   · F-C, el dueño aprueba en 1 acción, y la sesión del trabajador ARRANCA SOLA: cero toques
//     de su lado. El §7.6 prohíbe depender de push, así que el aparato pregunta.
//
// LOS SELECTORES SON SOLO `data-testid`, como pide el AC: un selector por texto se rompe
// cuando alguien mejora una etiqueta, y entonces el presupuesto de acciones deja de medirse
// por una razón que no tiene nada que ver con los toques.

const PUERTO = PUERTO_E2E;
const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_DUENA = Object.keys(VALIDOS)[0]!;
const RUT_NUEVO = Object.keys(VALIDOS)[2]!;
const soloAlfabeto = (rut: string) => rut.replace(/[^0-9kK]/g, "").toUpperCase();

/** El secreto del aparato de la dueña. Su enrolamiento ya ocurrió: acá empieza el de otra persona. */
const SECRETO_DUENA = secretoNuevo();

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
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
 * Cuenta ACCIONES: cada `click` que el test le pide a la pantalla es un toque de la persona.
 * Se envuelve el locator en vez de contar a mano para que agregar un paso al flujo suba el
 * número solo — un contador manual se desactualiza y el presupuesto deja de medir.
 */
function contador(page: Page) {
  let toques = 0;
  return {
    get toques() {
      return toques;
    },
    async tocar(testid: string, indice = 0) {
      toques++;
      await page.getByTestId(testid).nth(indice).click();
    },
    /** El teclado propio: los dígitos son el DATO, no decisiones. No entran al presupuesto. */
    async teclear(caracteres: string) {
      for (const c of caracteres) await page.getByRole("button", { name: c, exact: true }).click();
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

test("[AC-FIDN-02] F-A: la dueña emite la invitación en ≤4 acciones, con sus tres envoltorios", async ({ page }) => {
  await sesionDe(page, SECRETO_DUENA);
  const c = contador(page);
  await page.goto("/panel");
  await expect(page.getByTestId("panel")).toBeVisible();

  await c.tocar("invitar"); // 1 · «Invitar»
  await c.tocar("rol-chofer"); // 2 · el rol EMITE en el mismo toque
  await expect(page.getByTestId("invitacion-emitida")).toBeVisible();

  // LOS TRES ENVOLTORIOS, que son UNA credencial: el código corto ES la credencial, el link la
  // lleva como parámetro y el QR codifica el link.
  const codigo = (await page.getByTestId("codigo-corto").textContent())!.trim();
  expect(codigo).toHaveLength(INVITACION.codigo_corto_largo);
  for (const caracter of codigo) {
    expect(INVITACION.codigo_corto_alfabeto, `«${caracter}» no está en el alfabeto del §0`).toContain(caracter);
  }
  await expect(page.getByTestId("link")).toContainText(`codigo=${codigo}`);
  // El QR es un SVG en el DOM: sin petición extra, así que se ve en un galpón sin señal.
  const qr = page.getByTestId("qr").locator("svg");
  await expect(qr).toBeVisible();
  expect(await qr.locator("path").count()).toBeGreaterThan(0);

  await c.tocar("compartir-invitacion"); // 3 · el share-sheet del propio teléfono
  expect(c.toques, "F-A se pasó del presupuesto de 4 acciones del §5.4").toBeLessThanOrEqual(4);

  // Y quedó UNA invitación viva en la base: la pantalla no simuló nada.
  const [inv] = await con(BD_A, (c2: Conexion) =>
    c2.sql<{ n: string; rol: string }>("select count(*)::text as n, min(rol::text) as rol from invitaciones"),
  );
  expect(inv!.n).toBe("1");
  expect(inv!.rol).toBe("chofer");
});

test("[AC-FIDN-02] F-B y F-C: el trabajador solicita sin correo y la sesión ARRANCA SOLA", async ({ browser }) => {
  // Dos contextos, porque son DOS teléfonos: el de la dueña y el del trabajador. Con uno solo,
  // «la sesión arranca sola» se probaría sobre el aparato equivocado.
  const telefonoDuena = await browser.newContext();
  const telefonoTrabajador = await browser.newContext();
  const dueña = await telefonoDuena.newPage();
  const trabajador = await telefonoTrabajador.newPage();
  await sesionDe(dueña, SECRETO_DUENA);

  // ── F-A: emitir, para tener el código con que solicitar ────────────────────────────
  await dueña.goto("/panel");
  await dueña.getByTestId("invitar").click();
  await dueña.getByTestId("rol-chofer").click();
  const codigo = (await dueña.getByTestId("codigo-corto").textContent())!.trim();

  // ── F-B: el trabajador entra por el LINK, como si le hubiera llegado por WhatsApp ──
  const t = contador(trabajador);
  await trabajador.goto(`/solicitar?codigo=${codigo}`);
  // El código viene PRECARGADO del link: la persona no lo teclea, solo confirma.
  await expect(trabajador.getByTestId("codigo")).toHaveValue(codigo);
  await t.tocar("continuar-codigo");

  await t.teclear(soloAlfabeto(RUT_NUEVO)); // el RUT es dato, no decisión
  await t.tocar("continuar-rut");
  await trabajador.getByTestId("nombre").fill("Quien se enrola hoy");
  await t.tocar("continuar-nombre");
  await t.teclear("2468");
  await t.tocar("continuar-pin");
  await t.teclear("2468");
  await t.tocar("solicitar-acceso");

  await expect(trabajador.getByTestId("esperando-aprobacion")).toBeVisible();
  // CERO campo de correo en todo el recorrido (§5.4): se verifica sobre el DOM, no de memoria.
  expect(
    await trabajador.evaluate(() => document.querySelectorAll('input[type="email"], input[name*="mail" i]').length),
  ).toBe(0);
  // El PIN se tecleó con el teclado PROPIO: si hubiera un input de PIN, el del sistema se
  // abriría encima con autocorrector.
  expect(await trabajador.evaluate(() => document.querySelectorAll("input").length)).toBeLessThanOrEqual(1);
  expect(t.toques, "F-B pide más acciones que pasos tiene el formulario").toBe(5);

  // ── F-C: la dueña aprueba en UNA acción ────────────────────────────────────────────
  const d = contador(dueña);
  await dueña.getByTestId("volver-invitacion").click();
  await expect(dueña.getByTestId("solicitud")).toBeVisible({ timeout: 10_000 });
  await expect(dueña.getByTestId("badge-pendientes")).toHaveText("1");
  await d.tocar("aprobar-solicitud");
  expect(d.toques, "aprobar tiene que ser 1 acción (§5.4 F-C)").toBe(1);

  // ── Y LA SESIÓN ARRANCA SOLA: cero toques del trabajador ──────────────────────────
  const antes = t.toques;
  await expect(trabajador.getByTestId("sesion-activa")).toBeVisible({ timeout: 15_000 });
  expect(t.toques, "el trabajador tuvo que tocar algo para entrar").toBe(antes);

  // El secreto quedó guardado en SU aparato, abierto con la privada que nunca salió de ahí.
  const secreto = await trabajador.evaluate(
    () =>
      new Promise<string | null>((res) => {
        const p = indexedDB.open("flota-aparato", 1);
        p.onsuccess = () => {
          const req = p.result.transaction("claves", "readonly").objectStore("claves").get("secreto-de-sesion");
          req.onsuccess = () => res((req.result as string) ?? null);
          req.onerror = () => res(null);
        };
      }),
  );
  expect(secreto, "el aparato no abrió su sobre").toBeTruthy();

  // Y es EL secreto que la aprobación emitió: su hash está en la fila del aparato nuevo.
  const [d2] = await con(BD_A, (c2: Conexion) =>
    c2.sql<{ n: string }>(
      "select count(*)::text as n from dispositivos where secreto_hash = $1 and revocado_at is null",
      [hashDeSecreto(secreto!)],
    ),
  );
  expect(d2!.n, "el secreto abierto no es el que la aprobación emitió").toBe("1");

  // El sobre es de UN SOLO USO: la fila ya no lo tiene esperando.
  const [s] = await con(BD_A, (c2: Conexion) =>
    c2.sql<{ sobre: string | null }>("select sobre::text as sobre from solicitudes_acceso limit 1"),
  );
  expect(s!.sobre).toBeNull();

  // Y el PIN quedó con argon2id del lado del servidor, nunca en claro (§4.3).
  const [u] = await con(BD_A, (c2: Conexion) =>
    c2.sql<{ h: string }>("select pin_hash as h from usuarios where rol = 'chofer'"),
  );
  expect(u!.h.startsWith("$argon2id$")).toBe(true);
  expect(u!.h).not.toContain("2468");
  expect(PIN.digitos).toBe(4);

  await telefonoDuena.close();
  await telefonoTrabajador.close();
});
