import { test, expect } from "@playwright/test";
import { con, bdDeTenant } from "../../../db/flota/conectar.mjs";
import { secretoNuevo, hashDeSecreto } from "../src/dominio/secretos.ts";
import { VALIDOS } from "../../../db/flota/ruts-sinteticos.mjs";
import { limpiarFixture, limpiarBandeja } from "./limpiar.mjs";
import { TENANTS } from "./preparar-tenants.mjs";

// Un destino SIN coordenadas opera igual que uno con ellas [AC-FRUT-15] — §4.5, §7.6, §3.E2.
//
// ─── POR QUÉ ESTE CASO ES EL QUE IMPORTA ──────────────────────────────────────────
//
// El geocoding es E2 (§3.E2). En E1, un destino nace `sin_geo` y así se queda hasta que alguien
// le ponga el pin a mano — y en la panadería que es el piloto, nadie va a ponerle el pin a
// veinte direcciones antes de la primera ruta. Si algo del módulo necesitara lat/lng, el
// producto no arrancaría: el operador cargaría el día, y a las cinco de la mañana descubriría
// que la mitad de las paradas no se pueden publicar.
//
// Por eso no alcanza con que las columnas sean nullables. Lo que este archivo ejerce es que el
// CAMINO ENTERO —armar, agrupar, publicar, derivar requisitos, congelar la promesa— produce
// exactamente lo mismo con coordenadas y sin ellas. La comparación es contra el caso con
// coordenadas y no contra números escritos a mano: así, el día que alguien meta una dependencia
// de GPS en cualquiera de esos pasos, la diferencia aparece sola.
//
// El resto del AC —enum completo en DDL, caja de Chile, `pin_confirmado` y `notas_acceso`
// persistentes— vive en `pgtap/0019`, y que E1 no pueda PRODUCIR `rooftop` ni `interpolado` lo
// vigila `gate-ganchos-e1.mjs`.

const A = TENANTS.filter((t) => t.estado === "activo")[0]!;
const BD_A = bdDeTenant(A.slug);
type Conexion = { sql: <T = Record<string, string>>(t: string, p?: unknown[]) => Promise<T[]> };

const SECRETO = secretoNuevo();
const comoOperador = { Authorization: `Portador ${SECRETO}` };

/** Los dos destinos del caso: uno con el pin puesto a mano y otro sin ninguna coordenada. */
let conPin = { destinoId: "", encargoId: "", vehiculoId: "" };
let sinGeo = { destinoId: "", encargoId: "", vehiculoId: "" };

test.beforeAll(async () => {
  await con(BD_A, async (c: Conexion) => {
    await limpiarBandeja(c.sql);
    await limpiarFixture(c.sql);
    await c.sql("delete from cargo_type_requirement");
    await c.sql("delete from cargo_type");

    const [p] = await c.sql<{ id: string }>(
      "insert into personas (rut, nombre) values ($1, 'Quien planifica sin mapa') returning id::text as id",
      [Object.keys(VALIDOS)[1]!],
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

    // Un tipo de carga con requisitos, para que la derivación del publicar tenga qué copiar: si
    // el caso `sin_geo` derivara menos requisitos, el operario del andén tendría una pantalla
    // distinta según si alguien puso un pin.
    const [pan] = await c.sql<{ id: string }>(
      "insert into cargo_type (codigo, nombre) values ('pan', 'Pan de molde') returning id::text as id",
    );
    await c.sql(
      `insert into cargo_type_requirement (cargo_type_id, tipo_evidencia, obligatorio, orden)
       values ($1, 'firma', true, 1), ($1, 'foto', false, 2)`,
      [pan!.id],
    );

    const [empresa] = await c.sql<{ id: string }>(
      "insert into empresas_cliente (rut, razon_social) values ($1, 'Panadería del barrio') returning id::text as id",
      [Object.keys(VALIDOS)[4]!],
    );

    const armar = async (
      nombre: string,
      coordenadas: { lat: number; lng: number } | null,
      patente: string,
    ) => {
      const [d] = coordenadas
        ? await c.sql<{ id: string }>(
            `insert into destinos (nombre, comuna, lat, lng, geo_confianza, pin_confirmado, notas_acceso)
             values ($1, 'Santiago', $2, $3, 'manual', true, 'Tocar el timbre de atrás')
             returning id::text as id`,
            [nombre, coordenadas.lat, coordenadas.lng],
          )
        : await c.sql<{ id: string }>(
            `insert into destinos (nombre, comuna, notas_acceso)
             values ($1, 'Santiago', 'Tocar el timbre de atrás') returning id::text as id`,
            [nombre],
          );
      const [e] = await c.sql<{ id: string }>(
        `insert into encargos (empresa_cliente_id, destino_id, bultos, cargo_type_id)
         values ($1, $2, 10, $3) returning id::text as id`,
        [empresa!.id, d!.id, pan!.id],
      );
      // Un vehículo por caso: publicar OCUPA la agenda del camión (AC-FRUT-05), y con uno solo
      // el segundo día rebotaría por solape y el caso no probaría nada de geo.
      const [v] = await c.sql<{ id: string }>(
        "insert into vehiculos (patente, tipo) values ($1, 'furgon') returning id::text as id",
        [patente],
      );
      return { destinoId: d!.id, encargoId: e!.id, vehiculoId: v!.id };
    };

    conPin = await armar("Local con pin puesto", { lat: -33.45, lng: -70.66 }, "KLPG01");
    sinGeo = await armar("Local sin coordenadas", null, "KLPG02");
  });
});

/** Recorre el día entero para un destino y devuelve lo observable de cada paso. */
async function elDiaEnteroDe(
  request: import("@playwright/test").APIRequestContext,
  caso: { destinoId: string; encargoId: string; vehiculoId: string },
) {
  const creada = await request.post("/api/rutas", {
    headers: comoOperador,
    data: { nombre: "Ruta del día", vehiculo_id: caso.vehiculoId },
  });
  const { ruta } = (await creada.json()) as { ruta: { id: string } };

  const asignada = await request.post(`/api/rutas/${ruta.id}/asignar`, {
    headers: comoOperador,
    data: {
      encargos: [caso.encargoId],
      ventana: { desde: "2026-08-10T09:00:00.000Z", hasta: "2026-08-10T12:00:00.000Z" },
    },
  });
  const publicada = await request.post(`/api/rutas/${ruta.id}/publicar`, { headers: comoOperador });
  const armada = await request.get(`/api/rutas/${ruta.id}`, { headers: comoOperador });

  return {
    asignacion: { estado: asignada.status(), cuerpo: await asignada.json() },
    publicacion: { estado: publicada.status(), cuerpo: await publicada.json() },
    paradas: ((await armada.json()) as { paradas: unknown[] }).paradas.length,
  };
}

test("[AC-FRUT-15] una parada sobre destino `sin_geo` se planifica, publica y opera igual", async ({
  request,
}) => {
  const conCoordenadas = await elDiaEnteroDe(request, conPin);
  const sinCoordenadas = await elDiaEnteroDe(request, sinGeo);

  // El día entero, paso por paso, IDÉNTICO. Se compara contra el caso con coordenadas y no
  // contra números a mano: así, el día que alguien meta una dependencia de GPS en cualquiera de
  // estos pasos, la diferencia aparece sola (§7.6 — nada del módulo depende de geocoding).
  expect(sinCoordenadas.asignacion.estado).toBe(conCoordenadas.asignacion.estado);
  expect(sinCoordenadas.asignacion.cuerpo).toEqual(conCoordenadas.asignacion.cuerpo);
  expect(sinCoordenadas.publicacion.estado).toBe(conCoordenadas.publicacion.estado);
  // Mismos requisitos derivados y misma promesa congelada: el operario del andén no puede tener
  // una pantalla distinta según si alguien puso un pin.
  expect(sinCoordenadas.publicacion.cuerpo).toEqual(conCoordenadas.publicacion.cuerpo);
  expect(sinCoordenadas.paradas).toBe(conCoordenadas.paradas);

  // Y el día quedó publicado DE VERDAD en los dos: sin esto, dos rebotes idénticos también
  // pasarían este test en verde.
  expect(sinCoordenadas.publicacion.estado).toBe(200);

  await con(BD_A, async (c: Conexion) => {
    const [destino] = await c.sql<{ confianza: string; lat: string | null }>(
      "select geo_confianza::text as confianza, lat::text as lat from destinos where id = $1",
      [sinGeo.destinoId],
    );
    // Sigue `sin_geo` después de operar el día entero: publicar no le inventó una coordenada.
    expect(destino!.confianza).toBe("sin_geo");
    expect(destino!.lat).toBeNull();

    const [parada] = await c.sql<{ promesa: string | null }>(
      `select (promesa_original is not null)::text as promesa
         from paradas where destino_id = $1`,
      [sinGeo.destinoId],
    );
    expect(parada!.promesa).toBe("true");
  });
});

test("[AC-FRUT-15] la pantalla de armado muestra el destino sin coordenadas como cualquier otro", async ({
  page,
}) => {
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
  }, SECRETO);

  await page.goto(`http://${A.slug}.localhost:3311/rutas`);
  await expect(page.getByTestId("armar-rutas")).toBeVisible();

  // Se elige por NOMBRE, que es lo que el operador conoce. Un destino que apareciera atenuado,
  // con una advertencia o al final de la lista por no tener pin le enseñaría que le falta algo
  // —y en E1 no le falta nada: el geocoding es E2 (§3.E2)—.
  await expect(page.getByTestId(`encargo-${sinGeo.encargoId}`)).toContainText("Local sin coordenadas");
  await expect(page.getByTestId(`encargo-${sinGeo.encargoId}`)).toBeEnabled();
});
