import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Chequeos pre/post OK-por-defecto y el ciclo del defecto [AC-FVEH-04] — §4.2, §5.2-F3/F5,
// §7.6, §6, §9.3 centinelas 1 y 4.
//
// LAS CUATRO COSAS QUE ESTE AC PIDE:
//
//   1. OK-por-defecto: solo se manda lo malo, y un chequeo sin defectos es un cuerpo con la
//      lista vacía.
//   2. Un ítem fallado JAMÁS bloquea la apertura del turno (§7.6). El `bloqueante` real lo
//      marca el OPERADOR después, con red.
//   3. La cadena chequeo → defecto → issue → resolución, y «apto» derivado del ÚLTIMO chequeo
//      firmado.
//   4. Es CAPTURA: offline + replay doble ⇒ 2xx y exactamente UNA fila por `client_uuid`,
//      rechazos = 0 (centinelas 1 y 4).
//
// Lo que solo la base sostiene —append-only, el defecto que no se reasigna, la nota obligatoria
// al resolver y de dónde sale «apto»— vive en `db/flota/pgtap/0015_chequeos_y_defectos.sql`.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_CHOFER = Object.keys(VALIDOS)[2]!;
const RUT_OPERADOR = Object.keys(VALIDOS)[4]!;
const SECRETO_CHOFER = secretoNuevo();
const SECRETO_OPERADOR = secretoNuevo();
const comoChofer = { Authorization: `Portador ${SECRETO_CHOFER}` };
const comoOperador = { Authorization: `Portador ${SECRETO_OPERADOR}` };

let vehiculoId = "";

async function enrolar(c: Conexion, rut: string, nombre: string, rol: string, secreto: string) {
  const [p] = await c.sql<{ id: string }>(
    "insert into personas (rut, nombre) values ($1, $2) returning id::text as id",
    [rut, nombre],
  );
  const [u] = await c.sql<{ id: string }>(
    "insert into usuarios (persona_id, rol) values ($1, $2::rol_usuario) returning id::text as id",
    [p!.id, rol],
  );
  await c.sql(
    `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
     values ('personal', $1, $2, $3, now(), true, true)`,
    [p!.id, hashDeSecreto(secreto), u!.id],
  );
}

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarFixture(c.sql);
    await enrolar(c, RUT_CHOFER, "Quien maneja", "chofer", SECRETO_CHOFER);
    await enrolar(c, RUT_OPERADOR, "Quien opera", "operador", SECRETO_OPERADOR);
    const [v] = await c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ('CHQ1234', 'furgón') returning id::text as id",
    );
    vehiculoId = v!.id;
  });
});

const cuantosChequeos = () =>
  con(BD_A, (c: Conexion) => c.sql<{ n: string }>("select count(*)::text as n from chequeos")).then(
    (r) => Number(r[0]!.n),
  );

const cuantosDefectos = () =>
  con(BD_A, (c: Conexion) => c.sql<{ n: string }>("select count(*)::text as n from defectos")).then(
    (r) => Number(r[0]!.n),
  );

const chequear = (
  request: import("@playwright/test").APIRequestContext,
  datos: Record<string, unknown>,
) =>
  request.post("/api/chequeos", {
    headers: comoChofer,
    data: {
      inspectable_tipo: "vehiculos",
      inspectable_id: vehiculoId,
      ts_dispositivo: new Date().toISOString(),
      ...datos,
    },
  });

test("[AC-FVEH-04] OK-por-defecto: un chequeo sin nada malo no crea ni un defecto", async ({ request }) => {
  const antes = await cuantosDefectos();
  const r = await chequear(request, { momento: "pre", client_uuid: randomUUID(), fallados: [] });
  expect(r.status()).toBe(201);
  const { chequeo } = (await r.json()) as { chequeo: { defectos: number; apto: boolean | null } };
  expect(chequeo.defectos).toBe(0);
  // Sin firma no acredita aptitud (§4.5): «apto» sigue siendo nulo, que no es lo mismo que
  // «no apto» — decir «apto» sin que nadie haya firmado sería peor que no decir nada.
  expect(chequeo.apto).toBeNull();
  expect(await cuantosDefectos(), "un chequeo limpio creó filas de defecto").toBe(antes);
});

test("[AC-FVEH-04] un ítem fallado deja su defecto y NO bloquea la apertura del turno", async ({
  request,
}) => {
  const r = await chequear(request, {
    momento: "pre",
    client_uuid: randomUUID(),
    fallados: ["luz de freno", "espejo derecho"],
  });
  expect(r.status()).toBe(201);
  expect((await r.json()).chequeo.defectos).toBe(2);

  // §5.2-F3 y §7.6, con esas palabras: «SOC bajo o ítem fallado JAMÁS bloquean la apertura».
  // Si el formulario pudiera detener un camión, la persona aprendería a no marcar nada.
  const turno = await request.post("/api/turnos", {
    headers: comoChofer,
    data: { vehiculo_id: vehiculoId },
  });
  expect(turno.status(), "un ítem fallado bloqueó la apertura del turno (§7.6)").toBe(201);
});

test("[AC-FVEH-04] el replay doble deja exactamente UNA fila, y ni un defecto de más", async ({
  request,
}) => {
  // Centinela 1: el outbox reintenta y la segunda copia no puede crear nada. Un chequeo
  // duplicado sería un defecto duplicado, y quien mira la bandeja creería que el camión tuvo
  // el mismo problema dos veces.
  const cuerpo = { momento: "post", client_uuid: randomUUID(), fallados: ["puerta lateral"] };
  const primera = await chequear(request, cuerpo);
  expect(primera.status()).toBe(201);
  const idPrimera = (await primera.json()).chequeo.id;

  const chequeosAntes = await cuantosChequeos();
  const defectosAntes = await cuantosDefectos();

  const segunda = await chequear(request, cuerpo);
  // 200 y no 201: el reintento no creó nada.
  expect(segunda.status()).toBe(200);
  const repetido = (await segunda.json()).chequeo;
  expect(repetido.id, "el replay devolvió otra fila").toBe(idPrimera);
  expect(repetido.repetido).toBe(true);

  expect(await cuantosChequeos(), "el replay duplicó el chequeo").toBe(chequeosAntes);
  expect(await cuantosDefectos(), "el replay duplicó el defecto").toBe(defectosAntes);
});

test("[AC-FVEH-04] rechazos = 0: ningún chequeo del terreno devolvió 4xx", async ({ request }) => {
  // El centinela 4 pide un número. Se mandan los casos raros que se pueden dar en terreno —sin
  // turno, con veinte ítems fallados, con nota vacía— y se cuenta.
  const casos = [
    { momento: "pre", fallados: [] },
    { momento: "post", fallados: Array.from({ length: 20 }, (_, i) => `item ${i}`) },
    { momento: "pre", fallados: ["luz"], nota: "" },
    { momento: "post", fallados: ["luz", "luz", "luz"] },
  ];
  let rechazos = 0;
  for (const caso of casos) {
    const r = await chequear(request, { ...caso, client_uuid: randomUUID() });
    if (r.status() >= 400) rechazos++;
  }
  expect(rechazos, "el centinela 4 exige rechazos = 0 (§9.3.4)").toBe(0);

  // Y el ítem repetido dentro del MISMO cuerpo no crea tres defectos iguales: el aparato puede
  // mandar de más, y tres filas iguales son tres avisos de un problema que es uno.
  const [n] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      `select count(*)::text as n from defectos d
        join chequeos c on c.id = d.chequeo_id
       where d.item = 'luz' and c.momento = 'post'`,
    ),
  );
  expect(Number(n!.n), "el mismo ítem repetido creó defectos de más").toBe(1);
});

test("[AC-FVEH-04] el ciclo del defecto: abierto → en curso → resuelto, con nota obligatoria", async ({
  request,
}) => {
  const [d] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "select id::text as id from defectos where item = 'luz de freno' order by abierto_en limit 1",
    ),
  );

  const enCurso = await request.patch(`/api/defectos/${d!.id}`, {
    headers: comoOperador,
    data: { estado: "en_curso" },
  });
  expect(enCurso.status()).toBe(200);
  expect((await enCurso.json()).estado).toBe("en_curso");

  // Cerrar SIN decir cómo rebota: un defecto así vuelve a aparecer y nadie sabe qué se probó la
  // vez anterior (misma regla que `review_queue`, §5.6).
  const sinNota = await request.patch(`/api/defectos/${d!.id}`, {
    headers: comoOperador,
    data: { estado: "resuelto" },
  });
  expect(sinNota.status()).toBe(422);
  expect((await sinNota.json()).error).toBe("resolucion_sin_nota");

  const resuelto = await request.patch(`/api/defectos/${d!.id}`, {
    headers: comoOperador,
    data: { estado: "resuelto", nota: "se cambió la ampolleta" },
  });
  expect(resuelto.status()).toBe(200);
  expect((await resuelto.json()).estado).toBe("resuelto");
});

test("[AC-FVEH-04] el `bloqueante` lo marca el OPERADOR, y recién ahí el vehículo no está apto", async ({
  request,
}) => {
  const [d] = await con(BD_A, (c: Conexion) =>
    c.sql<{ id: string }>(
      "select id::text as id from defectos where item = 'espejo derecho' order by abierto_en limit 1",
    ),
  );
  const r = await request.patch(`/api/defectos/${d!.id}`, {
    headers: comoOperador,
    data: { bloqueante: true },
  });
  expect(r.status()).toBe(200);
  expect((await r.json()).bloqueante).toBe(true);

  // El acto queda con su PROPIO evento: en la auditoría, detener un camión no puede verse
  // igual que mover un estado.
  const [e] = await con(BD_A, (c: Conexion) =>
    c.sql<{ n: string }>(
      `select count(*)::text as n from eventos e join evento_tipo t on t.id = e.tipo_id
        where t.codigo = 'defecto.bloqueante'`,
    ),
  );
  expect(Number(e!.n)).toBeGreaterThan(0);
});
