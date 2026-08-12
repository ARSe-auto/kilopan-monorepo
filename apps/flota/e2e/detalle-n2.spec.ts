import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Detalle N2 [AC-FSEM-05] — spec 05 §2.3, §2.4, §2.8.
//
// Mismas DOS mitades de AC-FSEM-04 (`e2e/peek-n1.spec.ts`), y por el mismo motivo:
//
//   (1) El MECANISMO de UI —timeline + evidencia que degrada sin hueco, deep-link estable por
//       `?id=&seed=`, y el peek N1 que NUNCA ofrece «Resolver»— se prueba sobre las semillas
//       de `semaforo-fixtures.ts` (AC-FSEM-01/04), que siguen siendo la pantalla mientras el
//       digest real no exista (AC-FSEM-06/09).
//   (2) La TRANSICIÓN `reconocida → resuelta` con nota obligatoria es un contrato de
//       SERVIDOR contra `review_queue` REAL — mismo patrón HTTP crudo que `peek-n1.spec.ts`,
//       porque la identidad del tenant se juega en la cabecera `Host`.

const PUERTO = 3311;
const DOMINIO = "localhost";
const T = TENANTS.find((t) => t.slug === "hechos")!;
const BD = bdDeTenant(T.slug);
const HOST = `${T.slug}.${DOMINIO}:${PUERTO}`;

type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };
type Respuesta = { status: number; json: Record<string, unknown> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) => con(BD, (c: Conexion) => c.sql<F>(texto, params));

function pedirA(ruta: string, metodo: string, secreto?: string, cuerpo?: unknown): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { Host: HOST };
  if (secreto) cabeceras.Authorization = `Portador ${secreto}`;
  const texto = cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined;
  if (texto !== undefined) {
    cabeceras["Content-Type"] = "application/json";
    cabeceras["Content-Length"] = Buffer.byteLength(texto).toString();
  }
  return new Promise((resolver, rechazar) => {
    const req = pedir({ host: "127.0.0.1", port: PUERTO, path: ruta, method: metodo, headers: cabeceras }, (res) => {
      let salida = "";
      res.setEncoding("utf8");
      res.on("data", (t) => (salida += t));
      res.on("end", () => {
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(salida) as Record<string, unknown>;
        } catch {
          json = {};
        }
        resolver({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("error", rechazar);
    if (texto !== undefined) req.write(texto);
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

async function reconocer(id: string) {
  await sql("update review_queue set estado = 'reconocida', reconocida_en = now() where id = $1", [id]);
}

async function estadoDe(id: string) {
  const [fila] = await sql<{ estado: string; nota: string | null; resuelta_en: string | null }>(
    "select estado::text as estado, nota, resuelta_en::text as resuelta_en from review_queue where id = $1",
    [id],
  );
  return fila!;
}

let duena: { personaId: string; usuarioId: string; secreto: string };
let chofer: { personaId: string; usuarioId: string; secreto: string };

test.beforeAll(async () => {
  // RUTs [18]/[19]: 15/16/17 se ven libres a primera vista pero 16 y 17 ya los usa
  // `pod-outbox-multiusuario.spec.ts` (AC-FPOD-09) contra el mismo tenant `hechos` — reusar
  // cualquiera de los índices ya tomados choca con la unicidad de `personas.rut`.
  duena = await enrolar(Object.keys(VALIDOS)[18]!, "Dueña del detalle N2", "admin_tenant");
  chofer = await enrolar(Object.keys(VALIDOS)[19]!, "Chofer del detalle N2", "chofer");
});

test.describe("contrato de servidor: resolver contra review_queue real", () => {
  test("[AC-FSEM-05] resolver una excepción reconocida CON nota: pasa a resuelta con la nota guardada", async () => {
    const id = await nuevaExcepcion();
    await reconocer(id);
    const r = await pedirA(`/api/semaforo/excepciones/${id}/resolver`, "POST", duena.secreto, { nota: "Confirmado con el conductor." });
    expect(r.status).toBe(200);
    expect(r.json.estado).toBe("resuelta");

    const fila = await estadoDe(id);
    expect(fila.estado).toBe("resuelta");
    expect(fila.nota).toBe("Confirmado con el conductor.");
    expect(fila.resuelta_en).not.toBeNull();
  });

  test("[AC-FSEM-05] resolver SIN nota ⇒ 422 tipado y 0 filas cambiadas", async () => {
    const id = await nuevaExcepcion();
    await reconocer(id);
    const antes = await estadoDe(id);

    const r = await pedirA(`/api/semaforo/excepciones/${id}/resolver`, "POST", duena.secreto, { nota: "" });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("nota_requerida");

    const despues = await estadoDe(id);
    expect(despues).toEqual(antes);
    expect(despues.estado).toBe("reconocida");
  });

  test("[AC-FSEM-05] resolver una excepción todavía NUEVA (sin pasar por reconocer) ⇒ 422 tipado — «el rojo lo exige»", async () => {
    const id = await nuevaExcepcion();
    const r = await pedirA(`/api/semaforo/excepciones/${id}/resolver`, "POST", duena.secreto, { nota: "Nota cualquiera" });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("transicion_ilegal");
    expect(r.json.estadoActual).toBe("nueva");
    expect((await estadoDe(id)).estado).toBe("nueva");
  });

  test("[AC-FSEM-05] re-resolver una ya resuelta ⇒ 422 tipado y 0 filas cambiadas", async () => {
    const id = await nuevaExcepcion();
    await reconocer(id);
    const primero = await pedirA(`/api/semaforo/excepciones/${id}/resolver`, "POST", duena.secreto, { nota: "Primera nota" });
    expect(primero.status).toBe(200);
    const trasPrimero = await estadoDe(id);

    const segundo = await pedirA(`/api/semaforo/excepciones/${id}/resolver`, "POST", duena.secreto, { nota: "Segunda nota" });
    expect(segundo.status).toBe(422);
    expect(segundo.json.error).toBe("transicion_ilegal");
    expect(segundo.json.estadoActual).toBe("resuelta");

    // 0 filas cambiadas: la nota y el instante de resolución son EXACTAMENTE los del primer
    // toque — el segundo no los pisó, aunque haya vuelto 422.
    expect(await estadoDe(id)).toEqual(trasPrimero);
  });

  test("[AC-FSEM-05] una excepción que no existe ⇒ 404", async () => {
    const r = await pedirA(
      "/api/semaforo/excepciones/00000000-0000-4000-8000-000000000000/resolver",
      "POST",
      duena.secreto,
      { nota: "Nota" },
    );
    expect(r.status).toBe(404);
  });

  test("[AC-FSEM-05] rol distinto de admin_tenant ⇒ 403, y la excepción sigue reconocida", async () => {
    const id = await nuevaExcepcion();
    await reconocer(id);
    const r = await pedirA(`/api/semaforo/excepciones/${id}/resolver`, "POST", chofer.secreto, { nota: "Nota" });
    expect(r.status).toBe(403);
    expect((await estadoDe(id)).estado).toBe("reconocida");
  });
});

test.describe("mecánica de UI: detalle N2 sobre las semillas del Nivel 0", () => {
  test("[AC-FSEM-05] abrir la URL del detalle directo (deep-link) rinde el mismo contenido que llegando desde el peek", async ({
    page,
  }) => {
    await page.goto("/hoy?seed=a");
    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').click();
    const link = page.getByTestId("ver-detalle").first();
    const href = await link.getAttribute("href");
    expect(href).toContain("/hoy/excepciones?id=");

    await page.goto(href!);
    await expect(page.getByTestId("detalle-n2")).toBeVisible();
  });

  test("[AC-FSEM-05] timeline y evidencia: la excepción del hueco de secuencia trae sync presente y foto/GPS/SOC degradados sin hueco", async ({
    page,
  }) => {
    await page.goto("/hoy/excepciones?id=exc-sync-1&seed=a");
    await expect(page.getByTestId("timeline-evento")).toHaveCount(2);

    const items = page.getByTestId("evidencia-item");
    await expect(items).toHaveCount(4); // los 4 tipos SIEMPRE aparecen, sin hueco.
    await expect(page.locator('[data-testid="evidencia-item"][data-tipo="sync"]')).toHaveAttribute("data-presente", "true");
    await expect(page.locator('[data-testid="evidencia-item"][data-tipo="foto"]')).toHaveAttribute("data-presente", "false");
    await expect(page.locator('[data-testid="evidencia-item"][data-tipo="gps"]')).toHaveAttribute("data-presente", "false");
    await expect(page.locator('[data-testid="evidencia-item"][data-tipo="soc"]')).toHaveAttribute("data-presente", "false");
  });

  test("[AC-FSEM-05] «entrega sin evidencia»: degradación TOTAL — los 4 tipos aparecen, ninguno presente", async ({ page }) => {
    await page.goto("/hoy/excepciones?id=exc-sync-3&seed=a");
    const items = page.getByTestId("evidencia-item");
    await expect(items).toHaveCount(4);
    for (const tipo of ["foto", "gps", "soc", "sync"]) {
      await expect(page.locator(`[data-testid="evidencia-item"][data-tipo="${tipo}"]`)).toHaveAttribute("data-presente", "false");
    }
  });

  test("[AC-FSEM-05] resolver exige nota: enviar vacía muestra el error y NO transiciona; con nota, resuelve", async ({ page }) => {
    await page.goto("/hoy/excepciones?id=exc-sync-1&seed=a");
    await page.getByTestId("detalle-reconocer").click();
    await expect(page.getByTestId("detalle-resolver-form")).toBeVisible();

    await page.getByTestId("detalle-resolver-enviar").click();
    await expect(page.getByTestId("detalle-resolver-error")).toBeVisible();
    await expect(page.getByTestId("detalle-estado-texto")).toContainText("reconocida");

    await page.getByTestId("detalle-resolver-nota").fill("Se confirmó el reenvío con el conductor.");
    await page.getByTestId("detalle-resolver-enviar").click();
    await expect(page.getByTestId("detalle-estado-texto")).toContainText("resuelta");
    await expect(page.getByTestId("detalle-nota-resuelta")).toContainText("Se confirmó el reenvío con el conductor.");
  });

  test("[AC-FSEM-05] el bottom-sheet N1 NUNCA renderiza «Resolver» — ni para la fila roja ni para la amarilla", async ({ page }) => {
    await page.goto("/hoy?seed=a");

    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').click(); // rojas
    await expect(page.getByTestId("peek-n1").getByTestId("detalle-resolver-enviar")).toHaveCount(0);
    await expect(page.getByTestId("peek-n1").getByText("Resolver", { exact: true })).toHaveCount(0);
    await page.getByTestId("peek-cerrar").click();

    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="turnos_conductores"]').click(); // amarillas
    await expect(page.getByTestId("peek-n1").getByTestId("detalle-resolver-enviar")).toHaveCount(0);
    await expect(page.getByTestId("peek-n1").getByText("Resolver", { exact: true })).toHaveCount(0);
  });
});
