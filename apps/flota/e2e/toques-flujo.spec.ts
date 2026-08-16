import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { rutDeFixture } from "../../../db/flota/ruts-sinteticos.mjs";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// Toques-hasta-completar por campo del teclado propio [AC-FMIG-03] — spec 08 §1, §5.3, §4.6.
//
// Contrato de SERVIDOR contra `client_metric` real, mismo patrón HTTP crudo que
// `detalle-n2.spec.ts` usa para `registrarToquesDrillDown` (AC-FSEM-05) — la diferencia que
// esta suite existe para probar: acá NO hace falta `admin_tenant`. El campo lo completa
// quien está en terreno (chofer, responsable de carga), y `sesionDelTenant` acepta cualquier
// rol — a diferencia de `guardia`, que el N2 del semáforo usa porque ESE es plano de control
// exclusivo del dueño (§5.4).

const PUERTO = PUERTO_E2E;
const DOMINIO = "localhost";
const T = TENANTS.find((t) => t.slug === "hechos")!;
const BD = bdDeTenant(T.slug);
const HOST = `${T.slug}.${DOMINIO}:${PUERTO}`;

type Conexion = { sql: <F = Record<string, string>>(t: string, p?: unknown[]) => Promise<F[]> };
type Respuesta = { status: number; json: Record<string, unknown> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) =>
  con(BD, (c: Conexion) => c.sql<F>(texto, params));

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

async function enrolarChofer() {
  const secreto = secretoNuevo();
  const rut = rutDeFixture(38);
  const [p] = await sql<{ id: string }>("insert into personas (rut, nombre) values ($1, $2) returning id::text as id", [
    rut,
    "Chofer de la telemetría de toques",
  ]);
  const [u] = await sql<{ id: string }>(
    "insert into usuarios (persona_id, rol) values ($1, 'chofer') returning id::text as id",
    [p!.id],
  );
  await sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en)
     values ('personal', $1, $2, $3, now())`,
    [p!.id, hashDeSecreto(secreto), u!.id],
  );
  return { personaId: p!.id, usuarioId: u!.id, secreto };
}

async function metricasDeToques(flujo: string) {
  return sql<{ flujo: string | null; valor_int: string }>(
    "select flujo, valor_int::text as valor_int from client_metric where tipo = 'toques_flujo' and flujo = $1 order by record_time desc",
    [flujo],
  );
}

let chofer: { personaId: string; usuarioId: string; secreto: string };

test.beforeAll(async () => {
  chofer = await enrolarChofer();
});

test.describe("contrato de servidor: toques de campo contra client_metric real", () => {
  test("[AC-FMIG-03] registrar 3 toques sobre el odómetro de apertura inserta una fila real en client_metric", async () => {
    const antes = await metricasDeToques("turno_abrir_odometro");
    const r = await pedirA("/api/metricas/toques-flujo", "POST", chofer.secreto, {
      flujo: "turno_abrir_odometro",
      toques: 3,
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ registrado: true, flujo: "turno_abrir_odometro", toques: 3 });

    const despues = await metricasDeToques("turno_abrir_odometro");
    expect(despues.length).toBe(antes.length + 1);
    expect(despues[0]!.valor_int).toBe("3");
  });

  test("[AC-FMIG-03] un rol de TERRENO —no admin_tenant— reporta su propio campo (a diferencia del N2 del semáforo)", async () => {
    const antes = await metricasDeToques("carga_pin");
    const r = await pedirA("/api/metricas/toques-flujo", "POST", chofer.secreto, { flujo: "carga_pin", toques: 4 });
    expect(r.status).toBe(200);
    expect((await metricasDeToques("carga_pin")).length).toBe(antes.length + 1);
  });

  test("[AC-FMIG-03] flujo fuera de la whitelist ⇒ 422 tipado y ninguna fila nueva", async () => {
    const r = await pedirA("/api/metricas/toques-flujo", "POST", chofer.secreto, {
      flujo: "cualquier_cosa_inventada",
      toques: 2,
    });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("toques_invalidos");
    expect((await metricasDeToques("cualquier_cosa_inventada")).length).toBe(0);
  });

  test("[AC-FMIG-03] toques inválido (0) ⇒ 422 tipado y ninguna fila nueva", async () => {
    const antes = await metricasDeToques("turno_abrir_soc");
    const r = await pedirA("/api/metricas/toques-flujo", "POST", chofer.secreto, {
      flujo: "turno_abrir_soc",
      toques: 0,
    });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("toques_invalidos");
    expect((await metricasDeToques("turno_abrir_soc")).length).toBe(antes.length);
  });

  test("[AC-FMIG-03] sin sesión ⇒ 404 pelado y ninguna fila nueva", async () => {
    const antes = await metricasDeToques("entrega_cantidad_parcial");
    const r = await pedirA("/api/metricas/toques-flujo", "POST", undefined, {
      flujo: "entrega_cantidad_parcial",
      toques: 1,
    });
    expect(r.status).toBe(404);
    expect((await metricasDeToques("entrega_cantidad_parcial")).length).toBe(antes.length);
  });
});
