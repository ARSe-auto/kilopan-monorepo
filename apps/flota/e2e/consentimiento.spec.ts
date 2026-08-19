import { test, expect, type Page } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { codigoNuevo, hashDeCodigo, expiraEn } from "../src/dominio/invitaciones.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// La UI de enrolamiento no le pide consentimiento a nadie [AC-FIDN-20] — §7.8, §5.4.
//
// EL GATE ESTÁTICO MIRA EL CÓDIGO; ESTA SUITE MIRA LA PANTALLA. No es redundancia: el gate no
// puede ver un checkbox que llega dentro de un componente importado, ni un texto que se arma
// concatenando; el navegador ve lo que la persona ve. Y al revés, esta suite solo recorre las
// ramas que el test recorre, mientras que el gate las ve todas. Las dos juntas cubren lo que
// ninguna cubre sola.
//
// POR QUÉ IMPORTA. La base de licitud del tratamiento de los datos de un trabajador es la
// EJECUCIÓN DEL CONTRATO, no su consentimiento. Un checkbox le finge una opción que no tiene
// —necesita el teléfono para trabajar— y bajo la Ley 21.719 un consentimiento que no se puede
// negar sin costo no es consentimiento: invita a discutir si el tratamiento tenía base legal.
// El checkbox no sobra, hace daño.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_DUENA = Object.keys(VALIDOS)[0]!;
const RUT_QUIEN_SOLICITA = Object.keys(VALIDOS)[1]!;
const soloAlfabeto = (rut: string) => rut.replace(/[^0-9kK]/g, "").toUpperCase();

/** Lo que ninguna pantalla del enrolamiento puede decir. Misma familia que el gate estático. */
const PALABRAS_DE_CONSENTIMIENTO = [
  "consentimiento",
  "consiento",
  "acepto",
  "aceptás",
  "autorizo",
  "términos y condiciones",
  "política de privacidad",
  "tratamiento de datos",
];

let codigo = "";

test.beforeAll(async () => {
  codigo = codigoNuevo();
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
      "insert into invitaciones (rol, token_hash, expira_at, creada_por) values ('chofer', $1, $2, $3)",
      [hashDeCodigo(codigo), expiraEn(new Date()), u!.id],
    );
  });
});

async function teclear(pagina: Page, caracteres: string) {
  for (const c of caracteres) await pagina.getByRole("button", { name: c, exact: true }).click();
}

/** El juicio, sobre lo que el navegador REALMENTE pintó. */
async function sinConsentimiento(pagina: Page, donde: string) {
  const casillas = await pagina.evaluate(
    () => document.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length,
  );
  expect(casillas, `${donde}: hay una casilla de consentimiento en pantalla`).toBe(0);

  const texto = (await pagina.evaluate(() => document.body.innerText)).toLowerCase();
  expect(texto.length, `${donde}: la pantalla no pintó nada, el juicio sería vacuo`).toBeGreaterThan(20);
  for (const palabra of PALABRAS_DE_CONSENTIMIENTO) {
    expect(texto, `${donde}: dice «${palabra}»`).not.toContain(palabra);
  }

  // Y CERO campo de correo (§5.4, «CERO emails»): va junto porque es la otra cosa que un
  // formulario de alta arrastra por costumbre y que este flujo no puede tener.
  const correos = await pagina.evaluate(
    () => document.querySelectorAll('input[type="email"], input[name*="mail" i]').length,
  );
  expect(correos, `${donde}: hay un campo de correo`).toBe(0);
}

test("[AC-FIDN-20] F-B «Solicitar acceso», paso por paso, sin una casilla", async ({ page }) => {
  await page.goto("/solicitar");
  await sinConsentimiento(page, "F-B código");

  await page.getByTestId("codigo").fill(codigo);
  await page.getByRole("button", { name: "Continuar" }).click();
  await sinConsentimiento(page, "F-B RUT");

  await teclear(page, soloAlfabeto(RUT_QUIEN_SOLICITA));
  await page.getByRole("button", { name: "Continuar" }).click();
  await sinConsentimiento(page, "F-B nombre");

  // El paso del NOMBRE es donde un formulario de alta pondría el checkbox por costumbre: es el
  // único con datos personales escritos a mano y el último antes de enviar.
  await page.getByTestId("nombre").fill("Quien solicita acceso");
  await page.getByRole("button", { name: "Continuar" }).click();
  await sinConsentimiento(page, "F-B PIN");

  await teclear(page, "1234");
  await page.getByRole("button", { name: "Continuar" }).click();
  await sinConsentimiento(page, "F-B confirmar PIN");

  await teclear(page, "1234");
  await page.getByRole("button", { name: "Solicitar acceso" }).click();

  // F-C, «Esperando aprobación»: la pantalla donde la persona queda esperando es la más fácil
  // de olvidar en una revisión, y es donde un consentimiento «informativo» suele colarse.
  await expect(page.getByTestId("esperando-aprobacion")).toBeVisible();
  await sinConsentimiento(page, "F-C esperando aprobación");
});

test("[AC-FIDN-20] F-E «Ya tengo cuenta» tampoco pide nada de eso", async ({ page }) => {
  await page.goto("/ya-tengo-cuenta");
  await sinConsentimiento(page, "F-E RUT");

  await teclear(page, soloAlfabeto(RUT_DUENA));
  await page.getByRole("button", { name: "Continuar" }).click();
  await sinConsentimiento(page, "F-E PIN");
});

test("[AC-FIDN-20] la solicitud llegó de verdad: el recorrido no fue una pantomima", async () => {
  // Sin esto, los dos tests de arriba pasarían igual con un botón «Solicitar acceso» que no
  // hace nada — y el AC estaría probado sobre un flujo que no funciona.
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string; rut: string }>(
      "select count(*)::text as n, min(rut_propuesto) as rut from solicitudes_acceso where estado = 'pendiente'",
    ),
  );
  expect(Number(f!.n)).toBe(1);
  expect(f!.rut).toBe(RUT_QUIEN_SOLICITA);
});
