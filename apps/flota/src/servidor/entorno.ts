import type { Pool } from "pg";

// El entorno que el aparato declara mientras espera aprobación [AC-FIDN-05] — §4.3, §5.4, §4.6.
//
// LAS DOS CONDICIONES, Y POR QUÉ NO SON COSMÉTICA. Sin `display-mode: standalone` la PWA no es
// la app: es una pestaña, y el navegador cierra pestañas cuando necesita memoria — en medio de
// un turno, con capturas sin sincronizar. Sin `persist()` concedido el sistema puede evictar
// el almacenamiento entero: el outbox del §4.7 se va con él, y eso son PODs del terreno que
// nadie va a poder rehacer. El §4.3 las pide juntas por eso.
//
// SE DECLARA POR CLAVE PÚBLICA y no por un id de solicitud, y la razón es una decisión ya
// tomada: `POST /api/solicitudes` NO devuelve el id (AC-FIDN-03) porque sería un identificador
// de la casa en manos de alguien que todavía no es de la casa. La clave pública ya viajó, ya
// está en la fila, y el aparato la tiene. Lo peor que puede hacer quien la intercepte es
// mover dos booleanos de una solicitud pendiente —o sea, hacer que un enrolamiento FALLE, no
// que uno malo pase— y el aparato es de todos modos la única fuente de esos dos datos: un
// cliente que quiera mentir puede mentir igual en la solicitud original.
//
// Y SOLO SOBRE `pendiente`: una vez aprobada, el entorno vive en el aparato y se vuelve a
// declarar por la sesión. Dejar que una solicitud resuelta cambie de entorno sería reescribir
// lo que el dueño vio cuando decidió.

export type Entorno = { isStandalone: boolean; storagePersisted: boolean };

export type ResultadoEntorno =
  | { tipo: "registrado"; completo: boolean }
  | { tipo: "sin_solicitud" };

/** Las dos juntas o nada: el enrolamiento se completa con las DOS (§4.3). */
export const enrolamientoCompleto = (e: Entorno): boolean => e.isStandalone && e.storagePersisted;

/**
 * Declara el entorno de una solicitud pendiente. Si `persist()` fue denegado, deja la métrica
 * `persist_denegado` en `client_metric` (§4.6).
 *
 * LA MÉTRICA NO ES UN LOG. Va a la tabla que los paneles del §10 leen, porque «cuántos
 * aparatos no consiguen persistencia» es la señal que dice si la flota está a un vaciado de
 * caché de perder trabajo — y esa pregunta se responde con una serie, no con un grep de la
 * consola de alguien.
 */
export async function declararEntorno(
  pool: Pool,
  datos: { clavePublica: string; clientUuid: string; tzOffsetMin: number } & Entorno,
): Promise<ResultadoEntorno> {
  const { rows } = await pool.query<{ id: string }>(
    `update solicitudes_acceso
        set is_standalone = $2, storage_persisted = $3, entorno_visto_en = now()
      where clave_publica = $1 and estado = 'pendiente'
      returning id::text as id`,
    [datos.clavePublica, datos.isStandalone, datos.storagePersisted],
  );
  if (!rows[0]) return { tipo: "sin_solicitud" };

  if (!datos.storagePersisted) {
    // `on conflict do nothing` sobre `client_uuid`: la pantalla puede reintentar —y lo hace,
    // porque el operario vuelve a tocar «Revisar» hasta que el navegador conceda— y una
    // métrica duplicada por reintento convertiría «cuántos aparatos» en «cuántas veces alguien
    // insistió», que es otra pregunta y con otra respuesta.
    // El huso lo declara el APARATO (§4.6, doble reloj) y no el servidor: la pregunta que esta
    // serie contesta es «a qué hora del día, donde está la persona, el navegador niega
    // persistencia», y con el huso del servidor todas las flotas se verían iguales. El `ts` sí
    // es el del servidor: este endpoint es online por naturaleza —se está declarando el
    // entorno EN ESE momento— así que no hay una hora de captura anterior que preservar.
    await pool.query(
      `insert into client_metric (tipo, flujo, valor_int, ts, tz_offset_min, client_uuid)
       values ('persist_denegado', 'enrolamiento', 1, now(), $2, $1::uuid)
       on conflict (tenant_id, client_uuid) do nothing`,
      [datos.clientUuid, datos.tzOffsetMin],
    );
  }

  return { tipo: "registrado", completo: enrolamientoCompleto(datos) };
}
