import { test, expect } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { TENANTS } from "./preparar-tenants.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { PUERTO_E2E } from "./puerto.ts";

// La regla de contracción, de punta a punta [AC-FMIG-09] — §5.5, §0.
//
// Lo que este AC pide y que AC-FMIG-08/AC-FVEH-18/AC-FRUT-10 todavía no probaban junto:
//   (1) manifest server-side SIN el módulo apagado (AC-FMIG-08 prueba la pantalla que lo apaga,
//       no el manifest de navegación que lo esconde);
//   (2) 403 REAL en los endpoints de planificación/lectura del módulo — GET /api/vehiculos y
//       POST /api/gobierno/vehiculos —, que hasta hoy no consultaban la feature (ver
//       db/migraciones-flota/control/0007_feature_del_modulo.sql: "las puertas de
//       planificación de este módulo NO consultan esta feature todavía");
//   (3) app mínima todo-OFF: abrir turno → captura → cerrar turno sigue siendo producto
//       completo con el módulo de vehículos apagado.
//
// BASE PROPIA (`contraccion`): sella `config_version` directamente con `crear_config_version`
// (mismo patrón que `turnoConConfig` de `pod-modulo-apagado.spec.ts`, AC-FPOD-06) y no por
// `PATCH /api/gobierno/funciones`, porque esa pantalla exige la feature EN EL PLAN del tenant
// (AC-FMIG-08) y este AC prueba el MECANISMO de contracción, no el plan comercial. Compartir
// `ruteo_activo` resellaría la config a mitad de `vehiculos.spec.ts`/`documentos.spec.ts`.

const PUERTO = PUERTO_E2E;
const DOMINIO = "localhost";
const T = TENANTS.find((t) => t.slug === "contraccion")!;
const BD = bdDeTenant(T.slug);
const HOST = `${T.slug}.${DOMINIO}:${PUERTO}`;

type Conexion = { sql: <F = Record<string, string>>(t: string, p?: unknown[]) => Promise<F[]> };
type Respuesta = { status: number; json: Record<string, unknown> };

const sql = <F = Record<string, string>>(texto: string, params?: unknown[]) =>
  con(BD, (c: Conexion) => c.sql<F>(texto, params));

function pedir(
  ruta: string,
  metodo: string,
  opciones: { secreto?: string; cuerpo?: unknown } = {},
): Promise<Respuesta> {
  const llevaCuerpo = opciones.cuerpo !== undefined && metodo !== "GET";
  const cuerpo = llevaCuerpo ? JSON.stringify(opciones.cuerpo) : null;
  const cabeceras: Record<string, string> = { Host: HOST };
  if (opciones.secreto) cabeceras.Authorization = `Portador ${opciones.secreto}`;
  if (cuerpo !== null) {
    cabeceras["content-type"] = "application/json";
    cabeceras["content-length"] = String(Buffer.byteLength(cuerpo));
  }
  return new Promise((resolver, rechazar) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PUERTO, path: ruta, method: metodo, headers: cabeceras },
      (res) => {
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
      },
    );
    req.on("error", rechazar);
    if (cuerpo !== null) req.write(cuerpo);
    req.end();
  });
}

/** Sella una config_version del tenant con los entitlements dados — igual que hará «Funciones»,
 *  pero sin pasar por el guard de plan (que es de AC-FMIG-08, no de este AC). */
async function sellar(entitlements: Record<string, boolean>) {
  await sql("select crear_config_version($1, $2::jsonb)", [
    "fixture del e2e de AC-FMIG-09",
    JSON.stringify(entitlements),
  ]);
}

let duena = { secreto: "" };

test.beforeAll(async () => {
  await limpiarFixture(sql);
  const secreto = secretoNuevo();
  const [p] = await sql<{ id: string }>(
    "insert into personas (rut, nombre) values ('11.111.111-1', 'Dueña de Contracción') returning id::text as id",
  );
  const [u] = await sql<{ id: string }>(
    "insert into usuarios (persona_id, rol) values ($1, 'admin_tenant') returning id::text as id",
    [p!.id],
  );
  await sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
     values ('personal', $1, $2, $3, now(), true, true)`,
    [p!.id, hashDeSecreto(secreto), u!.id],
  );
  duena = { secreto };
});

test("[AC-FMIG-09] módulo apagado: el manifest lo esconde, sin huecos ni candados", async () => {
  await sellar({ modulo_vehiculos: false });
  const r = await pedir("/api/manifiesto", "GET", { secreto: duena.secreto });
  expect(r.status).toBe(200);
  const items = r.json.items as { lookupKey: string }[];
  expect(items.find((i) => i.lookupKey === "modulo_vehiculos")).toBeUndefined();
});

test("[AC-FMIG-09] módulo encendido: el manifest lo trae", async () => {
  await sellar({ modulo_vehiculos: true });
  const r = await pedir("/api/manifiesto", "GET", { secreto: duena.secreto });
  expect(r.status).toBe(200);
  const items = r.json.items as { lookupKey: string; ruta: string }[];
  const item = items.find((i) => i.lookupKey === "modulo_vehiculos");
  expect(item?.ruta).toBe("/vehiculos");
});

test("[AC-FMIG-09] módulo apagado: 403 en la LECTURA (GET /api/vehiculos)", async () => {
  await sellar({ modulo_vehiculos: false });
  const r = await pedir("/api/vehiculos", "GET", { secreto: duena.secreto });
  expect(r.status).toBe(403);
  expect(r.json.error).toBe("modulo_apagado");
});

test("[AC-FMIG-09] módulo apagado: 403 en la PLANIFICACIÓN (POST /api/gobierno/vehiculos), cero filas", async () => {
  await sellar({ modulo_vehiculos: false });
  const [{ n: antes }] = await sql<{ n: string }>("select count(*)::text as n from vehiculos");
  const r = await pedir("/api/gobierno/vehiculos", "POST", {
    secreto: duena.secreto,
    cuerpo: { patente: "CTR0001", tipo: "furgón" },
  });
  expect(r.status).toBe(403);
  expect(r.json.error).toBe("modulo_apagado");
  const [{ n: despues }] = await sql<{ n: string }>("select count(*)::text as n from vehiculos");
  expect(despues).toBe(antes);
});

test("[AC-FMIG-09] módulo encendido: la lectura y la planificación vuelven a andar", async () => {
  await sellar({ modulo_vehiculos: true });
  const alta = await pedir("/api/gobierno/vehiculos", "POST", {
    secreto: duena.secreto,
    cuerpo: { patente: "CTR0002", tipo: "furgón" },
  });
  expect(alta.status).toBe(201);

  const lectura = await pedir("/api/vehiculos", "GET", { secreto: duena.secreto });
  expect(lectura.status).toBe(200);
  const vehiculos = lectura.json.vehiculos as { patente: string }[];
  expect(vehiculos.some((v) => v.patente === "CTR0002")).toBe(true);
});

test("[AC-FMIG-09] app mínima todo-OFF: abrir turno → captura → cerrar turno sigue siendo producto completo", async () => {
  // El vehículo ya existe (dado de alta arriba, con el módulo encendido): app mínima es una
  // FLOTA YA OPERANDO a la que el dueño le apaga módulos, no una flota vacía.
  await sellar({ modulo_vehiculos: false, modulo_encargos: false });
  const [v] = await sql<{ id: string }>("select id::text as id from vehiculos where patente = 'CTR0002'");

  const abrir = await pedir("/api/turnos", "POST", {
    secreto: duena.secreto,
    cuerpo: { vehiculo_id: v!.id },
  });
  expect(abrir.status, "abrir turno es la SECUENCIA mínima (§5.5), no planificación de módulo").toBe(201);
  const turno = abrir.json.turno as { id: string };

  const lectura = await pedir("/api/lecturas", "POST", {
    secreto: duena.secreto,
    cuerpo: {
      magnitud: "odometro",
      valor: 10,
      turno_id: turno.id,
      client_uuid: "00000000-0000-4000-8000-000000000001",
      ts_dispositivo: new Date().toISOString(),
    },
  });
  expect(lectura.status, "la CAPTURA jamás rebota, ni con el módulo apagado (§0)").toBe(201);

  const cerrar = await pedir(`/api/turnos/${turno.id}/cierre`, "POST", {
    secreto: duena.secreto,
    cuerpo: { enchufado: false },
  });
  expect(cerrar.status, "cerrar turno también es la secuencia mínima, no planificación de módulo").toBe(200);
});
