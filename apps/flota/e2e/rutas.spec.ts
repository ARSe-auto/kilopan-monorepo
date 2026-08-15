import { test, expect } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Agrupación multi-empresa y derivación de requisitos [AC-FRUT-04] — §3.E1.5, §4.6, §4.9, §5.2 F1.
//
// EL CASO QUE ES LA RAZÓN DE SER DEL PILOTO B: tres panaderías distintas mandan a la misma
// sucursal y el camión tiene que parar UNA vez. Dos paradas serían dos veces la misma cuadra,
// dos firmas al mismo destinatario y una ecuación de cierre que hay que sumar a mano.
//
// Lo que se ejerce acá es la mitad de conducta —el HTTP, la unión de requisitos, los rebotes de
// planificación—. La otra mitad, que la agrupación sea IMPOSIBLE de romper por otro camino, vive
// en `pgtap/0020` como índice único parcial: un test de servidor no puede probar que la BD lo
// rebota.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const RUT_OPERADOR = Object.keys(VALIDOS)[1]!;
const SECRETO = secretoNuevo();
const comoOperador = { Authorization: `Portador ${SECRETO}` };

/** Los tres encargos del destino compartido y el del propio, en el orden en que se crean. */
let encargos: { panaderia: string; pasteleria: string; segundoDePanaderia: string; otroDestino: string };
let vehiculoId = "";

/**
 * Cada caso arranca con el día LIBRE.
 *
 * Desde AC-FRUT-05, publicar OCUPA la agenda del vehículo —un camión no hace dos días a la vez—
 * y sin esto el primer caso que publica le rebota el resto de la suite con `agenda_solapada`. El
 * fixture de la bandeja no se toca: los encargos son los mismos para todos.
 */
test.beforeEach(async () => {
  await con(BD_A, async (c: Conexion) => {
    // Las que ya tienen un POD aterrizado se QUEDAN (§4.5, §7.4 — mismo guardia que
    // `limpiarOperacion`, AC-FRUT-23): `entregas_pod` es el hecho write-once cuya FK sostiene la
    // parada, y desde AC-FTAR-07 el tenant A siempre tiene al menos una ruta así — un `delete`
    // sin este guardia rebota «violates foreign key constraint» en el primer caso de la suite.
    await c.sql(
      `delete from rutas r
        where not exists (
          select 1 from paradas p join entregas_pod ep on ep.parada_id = p.id where p.ruta_id = r.id
        )`,
    );
    await c.sql("delete from bloques_agenda");
  });
});

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);
    // Los catálogos del §4.9 no son de la bandeja y `limpiarBandeja` no los toca: se limpian
    // acá para que la suite pueda volver a sembrarlos sin chocar con su UNIQUE por código.
    await c.sql("delete from cargo_type_requirement");
    await c.sql("delete from cargo_type");

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien planifica') returning id::text as id",
      [RUT_OPERADOR],
    );
    const [u] = await c.sql<{ id: string }>(
      "insert into usuarios (persona_id, rol) values ($1, 'operador') returning id::text as id",
      [p!.id],
    );
    await c.sql(
      `insert into dispositivos (tipo, persona_id, secreto_hash, enrolado_por, enrolado_en, is_standalone, storage_persisted)
       values ('personal', $1, $2, $3, now(), true, true)`,
      [p!.id, hashDeSecreto(SECRETO), u!.id],
    );

    const [v] = await c.sql<{ id: string }>(
      "insert into vehiculos (patente, tipo) values ('KLPR01', 'furgon') returning id::text as id",
    );
    vehiculoId = v!.id;

    // Dos tipos de carga con requisitos que se PISAN en la firma y difieren en lo demás: es el
    // caso que decide si la unión deduplica o si el operario firma dos veces lo mismo.
    const [pan] = await c.sql<{ id: string }>(
      "insert into cargo_type (codigo, nombre) values ('pan', 'Pan de molde') returning id::text as id",
    );
    const [torta] = await c.sql<{ id: string }>(
      "insert into cargo_type (codigo, nombre) values ('torta', 'Torta refrigerada') returning id::text as id",
    );
    await c.sql(
      `insert into cargo_type_requirement (cargo_type_id, tipo_evidencia, obligatorio, orden) values
         ($1, 'firma', true, 1), ($1, 'foto', false, 2),
         ($2, 'firma', true, 1), ($2, 'lectura', true, 2)`,
      [pan!.id, torta!.id],
    );

    const [panaderia] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del barrio') returning id::text as id",
      [Object.keys(VALIDOS)[4]!],
    );
    const [pasteleria] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Pastelería de la esquina') returning id::text as id",
      [Object.keys(VALIDOS)[5]!],
    );
    const [compartido] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Sucursal compartida', 'Santiago') returning id::text as id",
    );
    const [propio] = await c.sql<{ id: string }>(
      "insert into destinos (nombre, comuna) values ('Local del centro', 'Santiago') returning id::text as id",
    );

    const alta = async (empresa: string, destino: string, bultos: number, cargoType: string) => {
      const [e] = await c.sql<{ id: string }>(
        `insert into encargos (empresa_cliente_id, destino_id, bultos, cargo_type_id)
         values ($1, $2, $3, $4) returning id::text as id`,
        [empresa, destino, bultos, cargoType],
      );
      return e!.id;
    };

    encargos = {
      panaderia: await alta(panaderia!.id, compartido!.id, 12, pan!.id),
      pasteleria: await alta(pasteleria!.id, compartido!.id, 8, torta!.id),
      segundoDePanaderia: await alta(panaderia!.id, compartido!.id, 3, pan!.id),
      otroDestino: await alta(panaderia!.id, propio!.id, 5, pan!.id),
    };
  });
});

const crearRuta = (request: import("@playwright/test").APIRequestContext) =>
  request.post("/api/rutas", {
    headers: comoOperador,
    data: { nombre: "Ruta de la madrugada", vehiculo_id: vehiculoId },
  });

async function rutaNueva(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const respuesta = await crearRuta(request);
  expect(respuesta.status()).toBe(201);
  return ((await respuesta.json()) as { ruta: { id: string } }).ruta.id;
}

test("tres encargos de dos empresas al mismo destino son UNA parada [AC-FRUT-04]", async ({
  request,
}) => {
  const rutaId = await rutaNueva(request);

  const asignacion = await request.post(`/api/rutas/${rutaId}/asignar`, {
    headers: comoOperador,
    data: {
      encargos: [encargos.panaderia, encargos.pasteleria, encargos.segundoDePanaderia, encargos.otroDestino],
    },
  });
  expect(asignacion.ok()).toBe(true);
  // Cuatro encargos, DOS paradas: la agrupación es la conducta, no una optimización.
  expect((await asignacion.json()) as { paradas: number; items: number }).toMatchObject({
    paradas: 2,
    items: 4,
  });

  const armada = (await (await request.get(`/api/rutas/${rutaId}`, { headers: comoOperador })).json()) as {
    paradas: { destino: string; items: { empresa: string; qty_planificada: number }[] }[];
  };
  expect(armada.paradas).toHaveLength(2);

  const compartida = armada.paradas.find((p) => p.destino === "Sucursal compartida")!;
  expect(compartida.items).toHaveLength(3);
  // Y agrupar NO borró de quién es cada bulto: el sub-manifiesto del andén y la ecuación de
  // cierre son por empresa (§5.2 F2, §3.E1.6).
  expect(new Set(compartida.items.map((i) => i.empresa))).toEqual(
    new Set(["Panadería del barrio", "Pastelería de la esquina"]),
  );
  expect(compartida.items.reduce((suma, i) => suma + i.qty_planificada, 0)).toBe(23);
});

test("asignar dos veces el mismo encargo no duplica los bultos [AC-FRUT-04]", async ({ request }) => {
  const rutaId = await rutaNueva(request);
  const cuerpo = { encargos: [encargos.panaderia] };

  await request.post(`/api/rutas/${rutaId}/asignar`, { headers: comoOperador, data: cuerpo });
  const segunda = await request.post(`/api/rutas/${rutaId}/asignar`, {
    headers: comoOperador,
    data: cuerpo,
  });

  // Un clic repetido no es un pedido de duplicar la carga.
  expect((await segunda.json()) as { items: number; repetidos: number }).toMatchObject({
    items: 0,
    repetidos: 1,
  });
});

test("publicar deriva los requisitos del cargo_type, deduplicados [AC-FRUT-04]", async ({
  request,
}) => {
  const rutaId = await rutaNueva(request);
  await request.post(`/api/rutas/${rutaId}/asignar`, {
    headers: comoOperador,
    data: { encargos: [encargos.panaderia, encargos.pasteleria] },
  });

  const publicacion = await request.post(`/api/rutas/${rutaId}/publicar`, { headers: comoOperador });
  expect(publicacion.ok()).toBe(true);

  await con(BD_A, async (c: Conexion) => {
    const requisitos = await c.sql<{ tipo_evidencia: string; obligatorio: string; orden: string }>(
      `select r.tipo_evidencia::text as tipo_evidencia, r.obligatorio::text as obligatorio,
              r.orden::text as orden
         from stop_requirement r join paradas p on p.id = r.parada_id
        where p.ruta_id = $1 order by r.orden`,
      [rutaId],
    );

    // `pan` pide firma+foto y `torta` firma+lectura: la UNIÓN son TRES, no cuatro. Dos firmas al
    // mismo destinatario porque dos empresas mandaron cosas distintas es pedirle al operario que
    // firme dos veces lo mismo, y en el andén eso se resuelve firmando cualquier cosa.
    expect(requisitos.map((r) => r.tipo_evidencia).sort()).toEqual(["firma", "foto", "lectura"]);
    // El orden se renumera de corrido: el de la plantilla es relativo a SU tipo de carga y
    // `stop_requirement` lo tiene único por parada.
    expect(requisitos.map((r) => r.orden)).toEqual(["1", "2", "3"]);
    // Y la obligatoriedad no se perdió por el camino: la foto es la mejora progresiva.
    expect(requisitos.find((r) => r.tipo_evidencia === "foto")!.obligatorio).toBe("false");
    expect(requisitos.find((r) => r.tipo_evidencia === "lectura")!.obligatorio).toBe("true");
  });
});

test("publicar dos veces rebota, y la ruta queda con una sola versión [AC-FRUT-04]", async ({
  request,
}) => {
  const rutaId = await rutaNueva(request);
  await request.post(`/api/rutas/${rutaId}/asignar`, {
    headers: comoOperador,
    data: { encargos: [encargos.otroDestino] },
  });
  await request.post(`/api/rutas/${rutaId}/publicar`, { headers: comoOperador });

  const segunda = await request.post(`/api/rutas/${rutaId}/publicar`, { headers: comoOperador });
  expect(segunda.status()).toBe(422);
  expect(((await segunda.json()) as { error: string }).error).toBe("ruta_ya_publicada");

  await con(BD_A, async (c: Conexion) => {
    const [ruta] = await c.sql<{ version: string }>(
      "select version::text as version from rutas where id = $1",
      [rutaId],
    );
    expect(ruta!.version).toBe("1");
    // Y los requisitos no se derivaron dos veces: el momento de derivación es ÚNICO (§4.6).
    const [n] = await c.sql<{ n: string }>(
      `select count(*)::text as n from stop_requirement r join paradas p on p.id = r.parada_id
        where p.ruta_id = $1`,
      [rutaId],
    );
    expect(n!.n).toBe("2");
  });
});

test("un día publicado no admite encargos nuevos [AC-FRUT-04]", async ({ request }) => {
  const rutaId = await rutaNueva(request);
  await request.post(`/api/rutas/${rutaId}/asignar`, {
    headers: comoOperador,
    data: { encargos: [encargos.panaderia] },
  });
  await request.post(`/api/rutas/${rutaId}/publicar`, { headers: comoOperador });

  const tarde = await request.post(`/api/rutas/${rutaId}/asignar`, {
    headers: comoOperador,
    data: { encargos: [encargos.otroDestino] },
  });

  // PLANIFICACIÓN: acá SÍ se rebota, y con 0 filas (§4.2). Un día que cambia bajo los pies del
  // chofer deja su pantalla sin coincidir con lo que se le prometió al cliente.
  expect(tarde.status()).toBe(422);
  await con(BD_A, async (c: Conexion) => {
    const [n] = await c.sql<{ n: string }>(
      `select count(*)::text as n from items i join paradas p on p.id = i.parada_id
        where p.ruta_id = $1`,
      [rutaId],
    );
    expect(n!.n).toBe("1");
  });
});

test("publicar un día vacío rebota: el chofer saldría sin nada que hacer [AC-FRUT-04]", async ({
  request,
}) => {
  const rutaId = await rutaNueva(request);
  const vacia = await request.post(`/api/rutas/${rutaId}/publicar`, { headers: comoOperador });

  expect(vacia.status()).toBe(422);
  expect(((await vacia.json()) as { error: string }).error).toBe("ruta_vacia");
});

test("una ruta de otro tenant es 404, no un 403 que confirme que existe [AC-FRUT-04]", async ({
  request,
}) => {
  // El id mal formado y el ausente tienen que verse IGUAL: la diferencia es media herramienta de
  // enumeración (§9.3.2).
  expect((await request.get("/api/rutas/no-es-un-uuid", { headers: comoOperador })).status()).toBe(404);
  expect(
    (
      await request.get("/api/rutas/0198f2a0-0000-7000-8000-000000000000", { headers: comoOperador })
    ).status(),
  ).toBe(404);
});
