"use client";
// Outbox ÚNICO de mutaciones operativas. IndexedDB directo, sin Dexie: son ~150
// líneas contra una dependencia más que auditar.
//
// Por qué uno solo y no dos: la primera versión tenía este outbox para el reparto
// (offline real) y otra cola en sessionStorage para pesaje/mostrador, bajo el supuesto
// de que esos "nunca salen del LAN de la panadería". Operando por datos móviles ese
// supuesto es falso: el corte de señal es cotidiano en TODA la app, y sessionStorage
// se borra al cerrar la pestaña — o sea, perdía pesajes. Ahora todo va por acá:
// IndexedDB sobrevive al cierre del navegador y al reinicio del teléfono.

const DB_NOMBRE = "kilopan_outbox";
const TIENDA = "pendientes";
const VERSION = 2; // v2: outbox genérico (antes solo entregas)

export type TipoMutacion = "entrega" | "pesaje" | "venta";

export interface ItemOutbox {
  clientUuid: string;
  tipo: TipoMutacion;
  ruta: string;
  payload: unknown;
  intentos: number;
  creadoAt: number;
  ultimoError?: string;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const req = indexedDB.open(DB_NOMBRE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TIENDA)) {
        db.createObjectStore(TIENDA, { keyPath: "clientUuid" });
      }
    };
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => rechazar(req.error);
  });
}

async function conTienda<T>(modo: IDBTransactionMode, fn: (t: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await abrir();
  return new Promise<T>((resolver, rechazar) => {
    const tx = db.transaction(TIENDA, modo);
    const req = fn(tx.objectStore(TIENDA));
    req.onsuccess = () => resolver(req.result as T);
    req.onerror = () => rechazar(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function encolar(item: {
  clientUuid: string;
  tipo: TipoMutacion;
  ruta: string;
  payload: unknown;
}): Promise<void> {
  await conTienda("readwrite", (t) =>
    t.put({ ...item, intentos: 0, creadoAt: Date.now() } satisfies ItemOutbox)
  );
}

export async function listarPendientes(): Promise<ItemOutbox[]> {
  return conTienda<ItemOutbox[]>("readonly", (t) => t.getAll());
}

export async function contarPendientes(): Promise<number> {
  return conTienda<number>("readonly", (t) => t.count());
}

async function quitar(clientUuid: string): Promise<void> {
  await conTienda("readwrite", (t) => t.delete(clientUuid));
}

async function marcarFallo(item: ItemOutbox, error: string): Promise<void> {
  await conTienda("readwrite", (t) => t.put({ ...item, intentos: item.intentos + 1, ultimoError: error }));
}

export interface ResultadoSync {
  enviadas: number;
  rechazadas: { clientUuid: string; motivo: string }[];
  sinConexion: boolean;
}

/** Intenta enviar SIN encolar (camino feliz). Si falla por red, encola.
 *  Devuelve lo que pasó para que la UI diga la verdad al operador. */
export async function enviarOEncolar(
  tipo: TipoMutacion,
  ruta: string,
  payload: { clientUuid: string } & Record<string, unknown>
): Promise<{ estado: "enviado"; cuerpo: unknown } | { estado: "encolado" } | { estado: "rechazado"; error: string }> {
  try {
    const r = await fetch(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { estado: "enviado", cuerpo: await r.json().catch(() => ({})) };

    // 5xx = el servidor está mal, vale la pena reintentar. 4xx = respuesta legítima
    // (stock insuficiente, outlier, validación) que el operador tiene que ver AHORA:
    // encolarla sería mentirle diciendo que quedó registrada.
    if (r.status >= 500) {
      await encolar({ clientUuid: payload.clientUuid, tipo, ruta, payload });
      return { estado: "encolado" };
    }
    const cuerpo = await r.json().catch(() => ({}));
    return { estado: "rechazado", error: (cuerpo as { error?: string }).error ?? `Error ${r.status}` };
  } catch {
    await encolar({ clientUuid: payload.clientUuid, tipo, ruta, payload });
    return { estado: "encolado" };
  }
}

/** Descarga la cola completa. Nunca lanza. */
export async function sincronizar(): Promise<ResultadoSync> {
  const pendientes = await listarPendientes();
  if (pendientes.length === 0) return { enviadas: 0, rechazadas: [], sinConexion: false };

  let enviadas = 0;
  const rechazadas: { clientUuid: string; motivo: string }[] = [];
  let sinConexion = false;

  // Las entregas van juntas a /api/sync (idempotente por lote); el resto una por una
  // a su propia ruta. Todas son idempotentes por client_uuid, así que reenviar de más
  // nunca duplica.
  const entregas = pendientes.filter((p) => p.tipo === "entrega");
  const otras = pendientes.filter((p) => p.tipo !== "entrega");

  if (entregas.length > 0) {
    try {
      const r = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entregas: entregas.map((e) => e.payload) }),
      });
      if (r.ok) {
        const cuerpo = (await r.json()) as {
          aceptadas: string[];
          rechazadas: { clientUuid: string; motivo: string }[];
        };
        for (const uuid of cuerpo.aceptadas) {
          await quitar(uuid);
          enviadas++;
        }
        for (const rz of cuerpo.rechazadas) {
          await quitar(rz.clientUuid); // no se reintenta para siempre: se reporta
          rechazadas.push(rz);
        }
      } else {
        sinConexion = true;
      }
    } catch {
      sinConexion = true;
    }
  }

  for (const item of otras) {
    try {
      const r = await fetch(item.ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (r.ok) {
        await quitar(item.clientUuid);
        enviadas++;
      } else if (r.status < 500) {
        const cuerpo = await r.json().catch(() => ({}));
        await quitar(item.clientUuid);
        rechazadas.push({
          clientUuid: item.clientUuid,
          motivo: (cuerpo as { error?: string }).error ?? `Error ${r.status}`,
        });
      } else {
        await marcarFallo(item, `Error ${r.status}`);
        sinConexion = true;
      }
    } catch {
      await marcarFallo(item, "sin red");
      sinConexion = true;
    }
  }

  return { enviadas, rechazadas, sinConexion };
}

/** Reintento automático: al volver `online`, al volver la pestaña al frente (clave en
 *  el teléfono, que suspende todo al bloquearse) y cada 30 s como red de seguridad. */
export function iniciarSyncAutomatico(
  alCambiar: (pendientes: number, rechazadas?: { clientUuid: string; motivo: string }[]) => void
): () => void {
  let vivo = true;

  async function ciclo() {
    if (!vivo) return;
    const r = await sincronizar().catch(() => null);
    const n = await contarPendientes().catch(() => 0);
    alCambiar(n, r?.rechazadas);
  }

  const intervalo = setInterval(ciclo, 30_000);
  window.addEventListener("online", ciclo);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void ciclo();
  });
  void ciclo();

  return () => {
    vivo = false;
    clearInterval(intervalo);
    window.removeEventListener("online", ciclo);
  };
}
