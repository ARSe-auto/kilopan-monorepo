import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";
import { createHash } from "node:crypto";
import { leerCsv } from "../dominio/csv.ts";

// El alta de encargo de la bandeja [AC-FRUT-01] — §3.E1.5, §4.5, §4.2, §4.9.
//
// ─── TRES DATOS, Y EL ENCARGO YA ESTÁ ──────────────────────────────────────────────
//
// El §3.E1.5 pide el alta en menos de diez segundos con empresa, destino y bultos. Todo lo
// demás tiene default: `fecha_servicio` es hoy, `attrs` y `detalle_externo` nacen vacíos, y el
// estado sale de quién lo crea. Cada campo que alguien agregue como obligatorio se come esos
// diez segundos, y el operador vuelve a la planilla.
//
// ─── ES PLANIFICACIÓN: ACÁ SÍ SE REBOTA (§4.2) ────────────────────────────────────
//
// Al revés que todo lo que este servidor construyó en el módulo 02. Un encargo lo tipea alguien
// sentado con red antes de que exista el camión: rebotar no pierde ningún hecho del mundo, y
// dejar entrar 600 bultos o un `attrs` que no cumple su definición sí produce una ruta que no
// se puede cargar. Los dos rebotes van con 0 filas — uno por CHECK y el otro por trigger.
//
// El estado inicial depende del ROL, y es la única regla de la máquina que el maestro fija hoy:
// el `cliente` crea `solicitado` (§4.5) y el operador crea ya `aceptado`, porque la aceptación
// es suya (§3.E1.10). El resto de la máquina es AC-FRUT-03 y espera la pregunta 1 de la spec.

export type Encargo = {
  id: string;
  empresa_cliente_id: string;
  destino_id: string;
  bultos: number;
  fecha_servicio: string;
  estado: string;
  /** Solo en la LISTA: el alta devuelve la fila recién escrita, sin resolver los catálogos. */
  empresa?: string;
  destino?: string;
  asignado?: boolean;
};

export type AltaDeEncargo =
  | { tipo: "ok"; encargo: Encargo; repetido: boolean }
  | { tipo: "empresa_no_existe" }
  | { tipo: "destino_no_existe" }
  | { tipo: "bultos_fuera_de_rango" }
  | { tipo: "attrs_invalidos"; detalle: string };

/** Códigos de PostgreSQL que este alta traduce a un rebote tipado en vez de a un 500. */
const CHECK_VIOLATION = "23514";

const COLUMNAS = `id::text as id, empresa_cliente_id::text as empresa_cliente_id,
                  destino_id::text as destino_id, bultos,
                  to_char(fecha_servicio, 'YYYY-MM-DD') as fecha_servicio, estado::text as estado`;

export async function crearEncargo(
  pool: Pool,
  sesion: Sesion,
  datos: {
    empresaClienteId: string;
    destinoId: string;
    bultos: number;
    fechaServicio: string | null;
    attrs: Record<string, unknown>;
    clientUuid: string | null;
  },
): Promise<AltaDeEncargo> {
  // El rango se juzga antes de llegar a la base para poder devolver un error tipado con el
  // límite adentro; el CHECK de la tabla es la red que no se puede saltar (§4.2).
  if (!Number.isInteger(datos.bultos) || datos.bultos < 1 || datos.bultos > 500) {
    return { tipo: "bultos_fuera_de_rango" };
  }

  try {
    return await enActo(pool, async (c) => {
      const { rows: empresa } = await c.query("select 1 from empresas_cliente where id = $1", [
        datos.empresaClienteId,
      ]);
      if (empresa.length === 0) return { tipo: "empresa_no_existe" };
      const { rows: destino } = await c.query("select 1 from destinos where id = $1", [
        datos.destinoId,
      ]);
      if (destino.length === 0) return { tipo: "destino_no_existe" };

      // El §4.5 y el §3.E1.10: el encargo del contratante nace `solicitado` y es editable por
      // él solo hasta que el operador lo acepte. El que crea el operador ya pasó por eso.
      const estado = sesion.rol === "cliente" ? "solicitado" : "aceptado";

      const { rows } = await c.query<Encargo>(
        `insert into encargos
           (empresa_cliente_id, destino_id, bultos, fecha_servicio, attrs, estado, client_uuid)
         values ($1, $2, $3, coalesce($4::date, (now() at time zone 'America/Santiago')::date),
                 $5::jsonb, $6::encargo_estado, $7)
           on conflict (tenant_id, client_uuid) do nothing
         returning ${COLUMNAS}`,
        [
          datos.empresaClienteId,
          datos.destinoId,
          datos.bultos,
          datos.fechaServicio,
          JSON.stringify(datos.attrs),
          estado,
          datos.clientUuid,
        ],
      );

      if (!rows[0]) {
        // Ya estaba: la misma importación reintentada (centinela 1). Se devuelve la fila que
        // hay, sin evento nuevo — un segundo aviso haría creer que se pidió dos veces.
        const { rows: previo } = await c.query<Encargo>(
          `select ${COLUMNAS} from encargos where client_uuid = $1`,
          [datos.clientUuid],
        );
        return { tipo: "ok", encargo: previo[0]!, repetido: true };
      }

      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.encargo_creado,
        objetoTabla: "encargos",
        objetoId: rows[0].id,
        sesion,
        payload: { bultos: datos.bultos, estado },
      });
      return { tipo: "ok", encargo: rows[0], repetido: false };
    });
  } catch (error) {
    // El trigger de `attrs` del §4.9 rebota con `check_violation`, igual que el CHECK de
    // bultos. Se distinguen por el mensaje porque son dos causas que quien tipea arregla de
    // formas distintas: una es un número, la otra un campo del vertical.
    const e = error as { code?: string; message?: string };
    if (e.code === CHECK_VIOLATION) {
      if ((e.message ?? "").includes("bultos")) return { tipo: "bultos_fuera_de_rango" };
      return { tipo: "attrs_invalidos", detalle: e.message ?? "" };
    }
    throw error;
  }
}

/**
 * La bandeja del día: lo que el operador tiene para armar rutas (§5.2-F1).
 *
 * Trae la razón social y el nombre del destino y no solo sus ids: la pantalla de armar rutas
 * elige con estos nombres y sin ellos tendría que pedir los dos catálogos completos para
 * traducir cada fila (§5.7 — un id crudo en pantalla no le dice nada a nadie).
 *
 * `asignado` dice si ese encargo ya está en una ruta. No los esconde: un encargo que desaparece
 * de la bandeja sin que nadie lo borre se lee como un dato perdido, y el operador vuelve a
 * cargarlo.
 */
export async function listarEncargos(pool: Pool, fecha: string | null): Promise<Encargo[]> {
  const { rows } = await pool.query<Encargo>(
    // Calificado con `encargos.`: con los dos joins, `id` está en las tres tablas y sin el
    // prefijo la consulta rebota por ambigüedad.
    `select encargos.id::text as id,
            encargos.empresa_cliente_id::text as empresa_cliente_id,
            encargos.destino_id::text as destino_id, encargos.bultos,
            to_char(encargos.fecha_servicio, 'YYYY-MM-DD') as fecha_servicio,
            encargos.estado::text as estado,
            em.razon_social as empresa, d.nombre as destino,
            exists (select 1 from items i where i.encargo_id = encargos.id) as asignado
       from encargos
       join empresas_cliente em on em.id = encargos.empresa_cliente_id
       join destinos d on d.id = encargos.destino_id
      where encargos.fecha_servicio
              = coalesce($1::date, (now() at time zone 'America/Santiago')::date)
      order by encargos.creado_en desc`,
    [fecha],
  );
  return rows;
}

// ─── Importación CSV de la bandeja [AC-FRUT-02] — §5.2-F1, §4.2, §9.3.1 ─────────────
//
// ─── LA GRANULARIDAD NO ESTÁ DECIDIDA, Y ACÁ SE ELIGE LA CONDUCTA SEGURA ──────────
//
// La **pregunta 6** de la spec 03 deja abierto si una fila inválida invalida el ARCHIVO entero
// o solo esa fila. El AC pide asertar lo invariante bajo las dos semánticas: que la fila
// inválida NO entre y que la respuesta sea 422 tipado.
//
// Entre las dos, esta implementación elige Todo-o-nada y lo declara como provisional. La razón
// no es que sea más fácil —sale gratis de una transacción, es cierto— sino que es la que se
// puede deshacer: una importación a medias deja al operador sin saber qué entró, y completarla
// son veinte altas a mano; volver a subir el archivo corregido es un clic. Si el dueño elige
// por-fila, cambia esta función y su cláusula, no el resto del módulo.
//
// Y se reportan TODAS las filas malas, no la primera: quien arma el archivo lo corrige de una
// vez en vez de subirlo cinco veces descubriendo un error por vez.
//
// ─── EL `client_uuid` ES POR FILA, NO POR ARCHIVO ────────────────────────────────────
//
// El centinela 1 pide que el replay doble deje exactamente una fila POR client_uuid. Si el
// identificador fuera del lote, reimportar un archivo con una fila más crearía todas de nuevo.
// Por fila, el segundo intento no duplica nada y la fila nueva sí entra.

export type FilaImportada = { linea: number; error: string; detalle: string };

export type Importacion =
  | { tipo: "ok"; creados: number; repetidos: number }
  | { tipo: "archivo_vacio" }
  | { tipo: "faltan_columnas"; columnas: string[] }
  | { tipo: "filas_invalidas"; filas: FilaImportada[] };

/** Las columnas que el archivo tiene que traer. Son los tres datos del alta (§3.E1.5). */
export const COLUMNAS_DEL_CSV = ["empresa", "destino", "bultos"] as const;

export async function importarEncargos(
  pool: Pool,
  sesion: Sesion,
  texto: string,
): Promise<Importacion> {
  const lectura = leerCsv(texto, [...COLUMNAS_DEL_CSV]);
  if (lectura.tipo === "vacio") return { tipo: "archivo_vacio" };
  if (lectura.tipo === "faltan_columnas") return { tipo: "faltan_columnas", columnas: lectura.columnas };

  return enActo(pool, async (c) => {
    // Los catálogos se leen UNA vez: con doscientas filas, resolver empresa y destino por fila
    // serían cuatrocientas consultas dentro de una transacción abierta.
    const { rows: empresas } = await c.query<{ id: string; rut: string; razon_social: string }>(
      "select id::text as id, rut, razon_social from empresas_cliente where activa",
    );
    const { rows: destinos } = await c.query<{ id: string; nombre: string }>(
      "select id::text as id, nombre from destinos",
    );
    const porEmpresa = new Map(
      empresas.flatMap((e) => [
        [e.rut.toLowerCase(), e.id] as const,
        [e.razon_social.toLowerCase(), e.id] as const,
      ]),
    );
    const porDestino = new Map(destinos.map((d) => [d.nombre.toLowerCase(), d.id] as const));

    const malas: FilaImportada[] = [];
    const buenas: { empresaId: string; destinoId: string; bultos: number; clientUuid: string }[] = [];

    lectura.filas.forEach((fila, i) => {
      // +2: la primera línea es el encabezado y los humanos cuentan desde uno. Un número de
      // línea que no coincide con lo que la persona ve en Excel no sirve para arreglar nada.
      const linea = i + 2;
      const empresaId = porEmpresa.get((fila.empresa ?? "").toLowerCase());
      if (!empresaId) {
        malas.push({ linea, error: "empresa_no_existe", detalle: fila.empresa ?? "" });
        return;
      }
      const destinoId = porDestino.get((fila.destino ?? "").toLowerCase());
      if (!destinoId) {
        malas.push({ linea, error: "destino_no_existe", detalle: fila.destino ?? "" });
        return;
      }
      const bultos = Number(fila.bultos);
      if (!Number.isInteger(bultos) || bultos < 1 || bultos > 500) {
        malas.push({ linea, error: "bultos_fuera_de_rango", detalle: fila.bultos ?? "" });
        return;
      }
      // El `client_uuid` de cada fila se DERIVA de su contenido y no se sortea: así el mismo
      // archivo subido dos veces produce los mismos identificadores y el centinela 1 tiene de
      // dónde agarrarse. Un uuid al azar por intento haría que cada reintento duplicara todo.
      buenas.push({
        empresaId,
        destinoId,
        bultos,
        clientUuid: uuidDeterminista(`${empresaId}|${destinoId}|${bultos}|${linea}`),
      });
    });

    // Todo-o-nada, provisional (pregunta 6): la transacción se deshace sola al devolver el
    // rebote, así que ninguna de las buenas queda escrita.
    if (malas.length > 0) return { tipo: "filas_invalidas", filas: malas };

    let creados = 0;
    let repetidos = 0;
    for (const fila of buenas) {
      const { rows } = await c.query<{ id: string }>(
        `insert into encargos (empresa_cliente_id, destino_id, bultos, client_uuid)
         values ($1, $2, $3, $4)
           on conflict (tenant_id, client_uuid) do nothing
         returning id::text as id`,
        [fila.empresaId, fila.destinoId, fila.bultos, fila.clientUuid],
      );
      if (!rows[0]) {
        repetidos++;
        continue;
      }
      creados++;
      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.encargo_creado,
        objetoTabla: "encargos",
        objetoId: rows[0].id,
        sesion,
        payload: { bultos: fila.bultos, origen: "importacion_csv" },
      });
    }
    return { tipo: "ok", creados, repetidos };
  });
}

// ─── «Duplicar encargos de ayer» [AC-FRUT-17] — §5.2-F1, §3.E1.5, §9.3.1 ────────────
//
// ─── ES UNA VÍA MASIVA SEPARADA DEL CSV, Y NO POR PROLIJIDAD ────────────────────────
//
// La panadería que reparte a las mismas doce sucursales todos los días no tiene un Excel: tiene
// el día de ayer. Pedirle que exporte y vuelva a subir un archivo para repetirlo sería devolverle
// el trabajo que esta pantalla vino a sacarle.
//
// ─── ENCARGOS NUEVOS, JAMÁS LOS DE AYER MOVIDOS DE FECHA ───────────────────────────
//
// El de ayer YA OCURRIÓ: tiene su ruta, su parada y —si el módulo 04 ya corrió— su POD. Cambiarle
// la fecha de servicio le borraría el día a la historia y dejaría una entrega firmada colgando de
// un encargo que dice ser de hoy. Se copia empresa, destino, bultos y `attrs`; el resto nace de
// cero, incluido el estado.
//
// ─── EL `client_uuid` SE DERIVA DEL ORIGEN Y DEL DESTINO ───────────────────────────
//
// El centinela 1 pide que el replay doble deje exactamente una fila por `client_uuid`. Derivarlo
// del encargo original MÁS la fecha a la que se copia da las dos cosas que hacen falta: apretar
// el botón dos veces no duplica nada, y mañana el mismo encargo de ayer se puede volver a
// duplicar porque la fecha cambió. Un uuid al azar por intento duplicaría el día entero al
// segundo clic — que es exactamente lo que pasa cuando la pantalla tarda y alguien insiste.

export type Duplicacion = { creados: number; repetidos: number; origen: string };

export async function duplicarEncargos(
  pool: Pool,
  sesion: Sesion,
  origen: string | null,
  destino: string | null,
): Promise<Duplicacion> {
  return enActo(pool, async (c) => {
    const { rows: fechas } = await c.query<{ origen: string; destino: string }>(
      `select to_char(coalesce($1::date, (now() at time zone 'America/Santiago')::date - 1),
                      'YYYY-MM-DD') as origen,
              to_char(coalesce($2::date, (now() at time zone 'America/Santiago')::date),
                      'YYYY-MM-DD') as destino`,
      [origen, destino],
    );
    const { origen: deAyer, destino: paraHoy } = fechas[0]!;

    const { rows: previos } = await c.query<{
      id: string;
      empresa_cliente_id: string;
      destino_id: string;
      bultos: number;
      attrs: Record<string, unknown>;
      cargo_type_id: string | null;
    }>(
      `select id::text as id, empresa_cliente_id::text as empresa_cliente_id,
              destino_id::text as destino_id, bultos, attrs, cargo_type_id::text as cargo_type_id
         from encargos where fecha_servicio = $1::date order by creado_en`,
      [deAyer],
    );

    let creados = 0;
    let repetidos = 0;
    for (const previo of previos) {
      const { rows } = await c.query<{ id: string }>(
        `insert into encargos
           (empresa_cliente_id, destino_id, bultos, attrs, cargo_type_id, fecha_servicio, client_uuid)
         values ($1, $2, $3, $4::jsonb, $5, $6::date, $7)
           on conflict (tenant_id, client_uuid) do nothing
         returning id::text as id`,
        [
          previo.empresa_cliente_id,
          previo.destino_id,
          previo.bultos,
          JSON.stringify(previo.attrs),
          previo.cargo_type_id,
          paraHoy,
          uuidDeterminista(`duplicado|${previo.id}|${paraHoy}`),
        ],
      );
      if (!rows[0]) {
        repetidos++;
        continue;
      }
      creados++;
      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.encargo_creado,
        objetoTabla: "encargos",
        objetoId: rows[0].id,
        sesion,
        payload: { bultos: previo.bultos, origen: "duplicado", duplicado_de: previo.id },
      });
    }
    return { creados, repetidos, origen: deAyer };
  });
}

/**
 * Un UUID v5-ish derivado del contenido de la fila: el mismo archivo produce los mismos
 * identificadores en cada intento, que es lo que hace posible el centinela 1 sin pedirle al
 * operador que ponga un id en su Excel.
 *
 * Se arma del sha256 del contenido, con los bits de versión y variante fijados a mano. No es un
 * UUIDv7 —no lleva tiempo— y no tiene por qué serlo: el §0 exige v7 en las PK, que las genera
 * el servidor; esto es el identificador de idempotencia del cliente.
 */
function uuidDeterminista(contenido: string): string {
  const h = createHash("sha256").update(contenido).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((Number.parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
}
