import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS, rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
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

async function metricasDeToques() {
  return sql<{ flujo: string | null; valor_int: string }>(
    "select flujo, valor_int::text as valor_int from client_metric where tipo = 'toques_flujo' order by record_time desc",
  );
}

let duena: { personaId: string; usuarioId: string; secreto: string };
let chofer: { personaId: string; usuarioId: string; secreto: string };

test.beforeAll(async () => {
  // RUTs [18]/[19]: 15/16/17 se ven libres a primera vista pero 16 y 17 ya los usa
  // `pod-outbox-multiusuario.spec.ts` (AC-FPOD-09) contra el mismo tenant `hechos` — reusar
  // cualquiera de los índices ya tomados choca con la unicidad de `personas.rut`.
  duena = await enrolar(rutDeFixture(35), "Dueña del detalle N2", "admin_tenant");
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

test.describe("contrato de servidor: toques del drill-down contra client_metric real", () => {
  // Telemetría de producto (§5, §5.3, §4.6) [AC-FSEM-05]: «toques del drill-down a
  // client_metric tipo toques_flujo». El camino de UI (peek → «Ver detalle») es fixture-only
  // mientras el digest real no exista (AC-FSEM-06/09, mismo criterio que el resto del
  // módulo) — acá se prueba el contrato de SERVIDOR contra una fila real, igual que reconocer
  // y resolver arriba.
  test("[AC-FSEM-05] registrar 2 toques sobre una excepción rojo inserta una fila real en client_metric", async () => {
    const antes = await metricasDeToques();
    const id = await nuevaExcepcion("datos_sync", "rojo");
    const r = await pedirA(`/api/semaforo/excepciones/${id}/toques`, "POST", duena.secreto, { toques: 2 });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id, registrado: true, toques: 2 });

    const despues = await metricasDeToques();
    expect(despues.length).toBe(antes.length + 1);
    expect(despues[0]!.flujo).toBe("semaforo_n2");
    expect(despues[0]!.valor_int).toBe("2");
  });

  test("[AC-FSEM-05] toques inválido (0) ⇒ 422 tipado y ninguna fila nueva en client_metric", async () => {
    const antes = await metricasDeToques();
    const id = await nuevaExcepcion();
    const r = await pedirA(`/api/semaforo/excepciones/${id}/toques`, "POST", duena.secreto, { toques: 0 });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("toques_invalidos");
    expect((await metricasDeToques()).length).toBe(antes.length);
  });

  test("[AC-FSEM-05] toques sobre una excepción que no existe ⇒ 404 y ninguna fila nueva", async () => {
    const antes = await metricasDeToques();
    const r = await pedirA(
      "/api/semaforo/excepciones/00000000-0000-4000-8000-000000000000/toques",
      "POST",
      duena.secreto,
      { toques: 2 },
    );
    expect(r.status).toBe(404);
    expect((await metricasDeToques()).length).toBe(antes.length);
  });

  test("[AC-FSEM-05] rol distinto de admin_tenant ⇒ 403 y ninguna fila nueva en client_metric", async () => {
    const antes = await metricasDeToques();
    const id = await nuevaExcepcion();
    const r = await pedirA(`/api/semaforo/excepciones/${id}/toques`, "POST", chofer.secreto, { toques: 2 });
    expect(r.status).toBe(403);
    expect((await metricasDeToques()).length).toBe(antes.length);
  });
});

test.describe("contrato de servidor: reasignar contra review_queue real", () => {
  // [AC-FSEM-20] — spec 05 §2.3: reasignar transfiere `asignado_a` a otro usuario del
  // tenant, valida online y rebota (PLANIFICACIÓN §4.2). Mismas tres ramas de rebote que
  // reconocer/resolver arriba, más la validación propia de esta acción (usuario inexistente).
  test("[AC-FSEM-20] reasignar una excepción nueva a otro usuario del tenant: 200 y asignado_a actualizado", async () => {
    const id = await nuevaExcepcion();
    const r = await pedirA(`/api/semaforo/excepciones/${id}/reasignar`, "POST", duena.secreto, {
      usuarioId: chofer.usuarioId,
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id, asignadoA: chofer.usuarioId });

    const [fila] = await sql<{ asignado_a: string }>("select asignado_a::text as asignado_a from review_queue where id = $1", [id]);
    expect(fila!.asignado_a).toBe(chofer.usuarioId);
  });

  test("[AC-FSEM-20] reasignar sobre una excepción resuelta ⇒ 422 tipado y 0 filas cambiadas", async () => {
    const id = await nuevaExcepcion();
    await reconocer(id);
    const resuelta = await pedirA(`/api/semaforo/excepciones/${id}/resolver`, "POST", duena.secreto, { nota: "Cerrada." });
    expect(resuelta.status).toBe(200);
    const antes = await estadoDe(id);

    const r = await pedirA(`/api/semaforo/excepciones/${id}/reasignar`, "POST", duena.secreto, {
      usuarioId: chofer.usuarioId,
    });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("transicion_ilegal");
    expect(r.json.estadoActual).toBe("resuelta");
    expect(await estadoDe(id)).toEqual(antes);
  });

  test("[AC-FSEM-20] reasignar una excepción que no existe ⇒ 404", async () => {
    const r = await pedirA(
      "/api/semaforo/excepciones/00000000-0000-4000-8000-000000000000/reasignar",
      "POST",
      duena.secreto,
      { usuarioId: chofer.usuarioId },
    );
    expect(r.status).toBe(404);
  });

  test("[AC-FSEM-20] reasignar a un usuario que no existe ⇒ 422 tipado y 0 filas cambiadas", async () => {
    const id = await nuevaExcepcion();
    const antes = await estadoDe(id);
    const r = await pedirA(`/api/semaforo/excepciones/${id}/reasignar`, "POST", duena.secreto, {
      usuarioId: "00000000-0000-4000-8000-000000000000",
    });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("usuario_invalido");
    expect(await estadoDe(id)).toEqual(antes);
  });

  test("[AC-FSEM-20] rol distinto de admin_tenant ⇒ 403, y la excepción sigue sin reasignar", async () => {
    const id = await nuevaExcepcion();
    const r = await pedirA(`/api/semaforo/excepciones/${id}/reasignar`, "POST", chofer.secreto, {
      usuarioId: chofer.usuarioId,
    });
    expect(r.status).toBe(403);
    const [fila] = await sql<{ asignado_a: string | null }>("select asignado_a::text as asignado_a from review_queue where id = $1", [id]);
    expect(fila!.asignado_a).toBeNull();
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

  test("[AC-FSEM-05] rojo→detalle en 2 toques desde «Hoy»: tocar la tarjeta y «Ver detalle», nada más", async ({ page }) => {
    // §2.3: «rojo→detalle ≤2 toques desde Hoy». La tarjeta `datos_sync` de la semilla A es
    // roja (AC-FSEM-01/07) y su primera fila de peek trae la excepción `exc-sync-1`.
    await page.goto("/hoy?seed=a");
    await expect(page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]')).toHaveAttribute(
      "data-color",
      "rojo",
    );

    let toques = 0;
    await page.locator('[data-testid="tarjeta-hoy"][data-dominio="datos_sync"]').click(); // toque 1: abre el peek
    toques += 1;
    await expect(page.getByTestId("peek-n1")).toBeVisible();

    const primeraFila = page.getByTestId("fila-peek").first();
    await expect(primeraFila).toHaveAttribute("data-severidad", "rojo");
    await primeraFila.getByTestId("ver-detalle").click(); // toque 2: navega al detalle
    toques += 1;

    await expect(page.getByTestId("detalle-n2")).toBeVisible();
    await expect(page.locator('[data-testid="detalle-cabecera"][data-severidad="rojo"]')).toBeVisible();
    expect(toques).toBeLessThanOrEqual(2);
  });

  test("[AC-FSEM-20] el detalle N2 renderiza la acción «llamar» — aserción de presencia", async ({ page }) => {
    await page.goto("/hoy/excepciones?id=exc-sync-1&seed=a");
    await expect(page.getByTestId("detalle-llamar")).toBeVisible();
    await expect(page.getByTestId("detalle-llamar")).toHaveText("Llamar");
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
