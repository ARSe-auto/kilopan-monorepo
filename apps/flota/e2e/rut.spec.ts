import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { codigoNuevo, hashDeCodigo } from "../src/dominio/invitaciones.ts";
import { expiraEn } from "../src/dominio/invitaciones.ts";
import { VALIDOS, INVALIDOS_A_PROPOSITO } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// El RUT en la pantalla y en el servidor [AC-FIDN-17] — §0, §4.2, §4.3, §5.4 F-B.
//
// LAS DOS MITADES, Y SON DOS CAPAS CON PROPÓSITOS DISTINTOS:
//
//   1. El CLIENTE valida módulo 11 EN LÍNEA sobre el RUT auto-formateado y no deja avanzar
//      mientras sea inválido. Esto le ahorra el viaje a alguien parado en un galpón sin señal;
//      no protege nada, porque el cliente se puede saltear.
//   2. El SERVIDOR rebota 422 tipado con CERO filas, y se ejercita por REQUEST DIRECTO —
//      saltándose el cliente— que es la única forma de probar que la puerta de abajo existe.
//      Con solo la prueba de pantalla, borrar la validación del servidor dejaría todo verde.
//
// Los RUTs salen de la lista congelada de AC-FIDN-21 y no de la cabeza: acá se necesita uno
// que el módulo 11 RECHACE, y esa lista ya declara cuáles son y por qué.

const PUERTO = 3311;
const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_VALIDO = Object.keys(VALIDOS)[0]!;
const RUT_INVALIDO = Object.keys(INVALIDOS_A_PROPOSITO)[0]!;
/** El MISMO cuerpo con su dígito verificador correcto. Sale de la propia lista congelada —que
 *  declara ese par a propósito— y no de `digitoVerificadorDe()`: un test que calculara la
 *  respuesta con la implementación bajo prueba estaría preguntándole al acusado. */
const cuerpoDe = (rut: string) => rut.split("-")[0];
const RUT_CORREGIDO = Object.keys(VALIDOS).find((r) => cuerpoDe(r) === cuerpoDe(RUT_INVALIDO));
/** Lo que se TECLEA: el RUT sin puntos ni guion, que es como llega desde el teclado propio. */
const soloAlfabeto = (rut: string) => rut.replace(/[^0-9kK]/g, "").toUpperCase();

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
      [Object.keys(VALIDOS)[1]!],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into invitaciones (rol, token_hash, expira_at, creada_por)
       values ('chofer', $1, $2, $3)`,
      [hashDeCodigo(codigo), expiraEn(new Date()), u!.id],
    );
  });
});

async function contar(tabla: string): Promise<number> {
  const [f] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(`select count(*)::text as n from ${tabla}`),
  );
  return Number(f!.n);
}

/** Teclea en el teclado PROPIO de Miga, tecla por tecla, como lo haría una mano con guantes. */
async function teclear(pagina: import("@playwright/test").Page, caracteres: string) {
  for (const c of caracteres) await pagina.getByRole("button", { name: c, exact: true }).click();
}

test("[AC-FIDN-17] el RUT se auto-formatea mientras se teclea, sin el teclado del sistema", async ({ page }) => {
  await page.goto("/solicitar");
  await page.getByTestId("codigo").fill(codigo);
  await page.getByRole("button", { name: "Continuar" }).click();

  // El campo del RUT NO es un `input`: un input abriría el teclado del sistema al enfocarlo,
  // con autocorrector y sugerencias sobre un identificador nacional. El §5.4 exige teclado
  // propio, y esto es lo que hace que esa exigencia sea verificable y no una intención.
  expect(await page.getByTestId("rut").evaluate((n) => n.tagName)).toBe("OUTPUT");
  await expect(page.getByRole("group", { name: "Teclado numérico" })).toBeVisible();

  await teclear(page, soloAlfabeto(RUT_VALIDO));
  // Los puntos y el guion aparecen SOLOS: nadie los teclea.
  await expect(page.getByTestId("rut")).toHaveText(RUT_VALIDO);
});

test("[AC-FIDN-17] con el módulo 11 en rojo NO se avanza, y no sale un solo request", async ({ page }) => {
  const pedidos: string[] = [];
  await page.route("**/api/solicitudes", (ruta) => {
    pedidos.push(ruta.request().url());
    return ruta.abort();
  });

  await page.goto("/solicitar");
  await page.getByTestId("codigo").fill(codigo);
  await page.getByRole("button", { name: "Continuar" }).click();

  await teclear(page, soloAlfabeto(RUT_INVALIDO));
  // Formateado igual que uno bueno —el formato no juzga— pero el veredicto se dice con TEXTO
  // y no solo con color (§5.7): a pleno sol un borde rojo no se ve, y a quien no distingue
  // rojo de verde no le dice nada.
  await expect(page.getByTestId("rut")).toHaveText(RUT_INVALIDO);
  await expect(page.getByTestId("rut-estado")).toContainText("no es un RUT válido");
  await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();

  // La mitad positiva, sin la cual esto pasaría con un botón que nunca se habilita: se corrige
  // el dígito verificador y la misma pantalla deja seguir.
  expect(RUT_CORREGIDO, `la lista congelada ya no trae el par de ${RUT_INVALIDO}`).toBeDefined();
  await page.getByRole("button", { name: "Borrar" }).click();
  await teclear(page, soloAlfabeto(RUT_CORREGIDO!).slice(-1));
  await expect(page.getByTestId("rut")).toHaveText(RUT_CORREGIDO!);
  await expect(page.getByTestId("rut-estado")).toHaveText("RUT válido");
  await expect(page.getByRole("button", { name: "Continuar" })).toBeEnabled();

  expect(pedidos, "la pantalla llamó al servidor con un RUT que ella misma daba por inválido").toEqual([]);
});

test("[AC-FIDN-17] el servidor rebota 422 tipado y deja CERO filas, salteándose el cliente", async () => {
  const antes = { solicitudes: await contar("solicitudes_acceso"), personas: await contar("personas") };

  const respuesta = await new Promise<{ status: number; cuerpo: string }>((resolver, rechazar) => {
    const cuerpo = JSON.stringify({
      codigo,
      rut: RUT_INVALIDO,
      nombre: "Quien manda un RUT malo",
      pin: "1234",
      clave_publica: "clave-de-prueba",
      huella_dispositivo: "huella",
    });
    const req = pedir(
      {
        host: "127.0.0.1",
        port: PUERTO,
        path: "/api/solicitudes",
        method: "POST",
        headers: {
          Host: `${A.slug}.localhost:${PUERTO}`,
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(cuerpo)),
        },
      },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (t) => (texto += t));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, cuerpo: texto }));
      },
    );
    req.on("error", rechazar);
    req.write(cuerpo);
    req.end();
  });

  // 422 TIPADO, no 500: el §4.2 pide que PLANIFICACIÓN rebote con un motivo que la UI sepa
  // leer. Un error de restricción crudo obligaría a la pantalla a adivinar qué pasó.
  expect(respuesta.status).toBe(422);
  expect(JSON.parse(respuesta.cuerpo).error).toBe("rut_invalido");

  // CERO filas en las dos tablas. `personas` también, aunque este endpoint no la toque nunca:
  // el día que alguien mueva la creación de la persona a la solicitud —que es el atajo obvio—
  // esta línea es la que se pone roja.
  expect(await contar("solicitudes_acceso")).toBe(antes.solicitudes);
  expect(await contar("personas")).toBe(antes.personas);
});
