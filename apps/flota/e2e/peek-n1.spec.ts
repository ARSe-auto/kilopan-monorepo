import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { TACTIL } from "../../../packages/nucleo-comun/src/constants.ts";

// Peek N1 [AC-FSEM-04] — §2.2, §2.4 de la spec 05.
//
// DOS mitades, porque el peek tiene DOS conductas de naturaleza distinta:
//
//   (1) El MECANISMO de UI —bottom-sheet sin navegar, orden severidad × antigüedad, playbook
//       por fila, botón ≥TACTIL.operativo_min— se prueba sobre `/hoy?seed=a` (mismas semillas de AC-FSEM-01,
//       que sigue siendo la pantalla mientras el digest real no exista, AC-FSEM-06/09).
//   (2) La TRANSICIÓN `nueva → reconocida` y el 422 de re-reconocer son un contrato de
//       SERVIDOR contra `review_queue` REAL — la tabla ya existe (migración 0002, módulo 00)
//       y no hay nada que este AC deba esperar de la evaluación automática de `signal_rule`
//       para probar el mecanismo de verdad. Se prueba con HTTP crudo (mismo patrón que
//       `gobierno.spec.ts`) porque la identidad del tenant se juega en la cabecera `Host`.

const PUERTO = 3311;
const DOMINIO = "localhost";
const T = TENANTS.find((t) => t.slug === "hechos")!;
const BD = bdDeTenant(T.slug);
const HOST = `${T.slug}.${DOMINIO}:${PUERTO}`;

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };
type Respuesta = { status: number; json: Record<string, unknown> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) => con(BD, (c: Conexion) => c.sql<F>(texto, params));

function pedirA(ruta: string, metodo: string, secreto?: string): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { Host: HOST };
  if (secreto) cabeceras.Authorization = `Portador ${secreto}`;
  return new Promise((resolver, rechazar) => {
    const req = pedir({ host: "127.0.0.1", port: PUERTO, path: ruta, method: metodo, headers: cabeceras }, (res) => {
      let texto = "";
      res.setEncoding("utf8");
      res.on("data", (t) => (texto += t));
      res.on("end", () => {
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(texto) as Record<string, unknown>;
        } catch {
          json = {};
        }
        resolver({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("error", rechazar);
    req.end();
  });
}

async function enrolar(rut: string, nombre: string, rol: string) {
  const secreto = secretoNuevo();
  const [p] = await sql<{ id: string }>("insert into personas (rut, nombre) values ($1, $2) returning id::text as id", [rut, nombre]);
  const [u] = await sql<{ id: string }>(
    "insert into usuarios (persona_id, rol) values ($1, $2::rol_usuario) returning id::text as id",
    [p!.id, rol],
  );
  await sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
     values ('personal', $1, $2, $3, now())`,
    [p!.id, hashDeSecreto(secreto), u!.id],
  );
  return { personaId: p!.id, usuarioId: u!.id, secreto };
}

async function nuevaExcepcion(origen = "datos_sync", severidad = "rojo") {
  const [fila] = await sql<{ id: string }>(
    "insert into review_queue (origen, severidad) values ($1, $2) returning id::text as id",
    [origen, severidad],
  );
  return fila!.id;
}

async function estadoDe(id: string) {
  const [fila] = await sql<{ estado: string; asignado_a: string | null; reconocida_en: string | null }>(
    "select estado::text as estado, asignado_a::text as asignado_a, reconocida_en::text as reconocida_en from review_queue where id = $1",
    [id],
  );
  return fila!;
}

let duena: { personaId: string; usuarioId: string; secreto: string };
let chofer: { personaId: string; usuarioId: string; secreto: string };

test.beforeAll(async () => {
  // RUTs [13]/[14]: los índices 0-12 de la lista congelada ya los usan otras suites que
  // comparten el tenant `hechos` (apertura, chequeos, carga, entrega, pod-*, recargas) —
  // reusar uno chocaría con la unicidad de `personas.rut`.
  duena = await enrolar(rutDeFixture(33), "Dueña del peek", "admin_tenant");
  chofer = await enrolar(rutDeFixture(34), "Chofer del peek", "chofer");
});

test.describe("contrato de servidor: reconocer contra review_queue real", () => {
  test("[AC-FSEM-04] reconocer una excepción nueva: pasa a reconocida con el actor como asignado_a", async () => {
    const id = await nuevaExcepcion();
    const r = await pedirA(`/api/semaforo/excepciones/${id}/reconocer`, "POST", duena.secreto);
    expect(r.status).toBe(200);
    expect(r.json.estado).toBe("reconocida");
    expect(r.json.asignadoA).toBe(duena.usuarioId);

    const fila = await estadoDe(id);
    expect(fila.estado).toBe("reconocida");
    expect(fila.asignado_a).toBe(duena.usuarioId);
    expect(fila.reconocida_en).not.toBeNull();
  });

  test("[AC-FSEM-04] re-reconocer una ya reconocida ⇒ 422 tipado y 0 filas cambiadas", async () => {
    const id = await nuevaExcepcion();
    const primero = await pedirA(`/api/semaforo/excepciones/${id}/reconocer`, "POST", duena.secreto);
    expect(primero.status).toBe(200);
    const trasPrimero = await estadoDe(id);

    const segundo = await pedirA(`/api/semaforo/excepciones/${id}/reconocer`, "POST", duena.secreto);
    expect(segundo.status).toBe(422);
    expect(segundo.json.error).toBe("transicion_ilegal");
    expect(segundo.json.estadoActual).toBe("reconocida");

    // 0 filas cambiadas: el estado, el dueño y el instante de reconocimiento son EXACTAMENTE
    // los que dejó el primer toque — el segundo no los tocó, aunque haya vuelto 422.
    const trasSegundo = await estadoDe(id);
    expect(trasSegundo).toEqual(trasPrimero);
  });

  test("[AC-FSEM-04] una excepción que no existe ⇒ 404", async () => {
    const r = await pedirA("/api/semaforo/excepciones/00000000-0000-4000-8000-000000000000/reconocer", "POST", duena.secreto);
    expect(r.status).toBe(404);
  });

  test("[AC-FSEM-04] rol distinto de admin_tenant ⇒ 403, y la excepción sigue nueva (§2.8: el tablero es del dueño)", async () => {
    const id = await nuevaExcepcion();
    const r = await pedirA(`/api/semaforo/excepciones/${id}/reconocer`, "POST", chofer.secreto);
    expect(r.status).toBe(403);
    expect((await estadoDe(id)).estado).toBe("nueva");
  });
});

test.describe("mecánica de UI: bottom-sheet sobre las semillas del Nivel 0", () => {
  test("[AC-FSEM-04] tocar una tarjeta amarilla/roja abre el peek SIN navegar (la URL no cambia)", async ({ page }) => {
    await page.goto("/hoy?seed=a");
    const urlAntes = page.url();
    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').click();
    await expect(page.getByTestId("peek-n1")).toBeVisible();
    expect(page.url()).toBe(urlAntes);
  });

  test("[AC-FSEM-04] una tarjeta verde no abre nada (no hay excepciones que revisar)", async ({ page }) => {
    await page.goto("/hoy?seed=a");
    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="entregas_vs_plan"]').click();
    await expect(page.getByTestId("peek-n1")).toHaveCount(0);
  });

  test("[AC-FSEM-04] filas ordenadas por severidad × antigüedad, con playbook y quién/qué/cuánto/desde", async ({ page }) => {
    await page.goto("/hoy?seed=a");
    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').click();
    const filas = page.getByTestId("fila-peek");
    // Las 3 excepciones del fixture son todas rojas: 9h, 5h, 3h — la más vieja primero.
    await expect(filas).toHaveCount(3);
    await expect(filas.nth(0)).toContainText("Dispositivo del despacho 3");
    await expect(filas.nth(0).getByTestId("playbook")).toContainText("Revisar el registro de sync");
    await expect(filas.nth(1)).toContainText("Furgón CCJJ88");
    await expect(filas.nth(2)).toContainText("Parada 214");
  });

  test("[AC-FSEM-04] severidad manda sobre antigüedad: turnos/conductores (amarillo) trae sus 2 filas amarillas en orden por antigüedad", async ({
    page,
  }) => {
    await page.goto("/hoy?seed=a");
    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="turnos_conductores"]').click();
    const filas = page.getByTestId("fila-peek");
    await expect(filas).toHaveCount(2);
    await expect(filas.nth(0)).toContainText("Marcela"); // 2h, la más vieja
    await expect(filas.nth(1)).toContainText("BBLL21"); // 1h
    await expect(filas.nth(0)).toHaveAttribute("data-severidad", "amarillo");
  });

  test("[AC-FSEM-04] el botón «Reconocer» cumple el objetivo táctil mínimo del §0", async ({ page }) => {
    await page.goto("/hoy?seed=a");
    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').click();
    const boton = page.getByTestId("reconocer").first();
    const caja = await boton.boundingBox();
    expect(caja?.height).toBeGreaterThanOrEqual(TACTIL.operativo_min);
    expect(caja?.width).toBeGreaterThanOrEqual(TACTIL.operativo_min);
  });

  test("[AC-FSEM-04] tocar «Reconocer» transiciona la fila: el botón desaparece y queda marcada", async ({ page }) => {
    await page.goto("/hoy?seed=a");
    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="turnos_conductores"]').click();
    const primeraFila = page.getByTestId("fila-peek").first();
    await primeraFila.getByTestId("reconocer").click();
    await expect(primeraFila.getByTestId("reconocer")).toHaveCount(0);
    await expect(primeraFila.getByTestId("reconocida-marca")).toBeVisible();
  });

  test("[AC-FSEM-04] «Cerrar» descarta el peek sin dejar rastro en la URL", async ({ page }) => {
    await page.goto("/hoy?seed=a");
    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').click();
    await page.getByTestId("peek-cerrar").click();
    await expect(page.getByTestId("peek-n1")).toHaveCount(0);
  });
});
