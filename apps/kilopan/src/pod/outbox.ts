"use client";
// Outbox de mutaciones operativas (AC-POD-02 / AC-RED-01). IndexedDB directo, sin
// Dexie: son ~80 líneas contra una dependencia más que auditar — mismo criterio que
// scrypt sobre bcrypt. Este motor es GENÉRICO a propósito: hoy lo usa el POD del
// repartidor (offline real) y mañana la cola de reintento de pesaje/mostrador
// (decisión #4, mismo LAN) sin duplicar el mecanismo.

const DB_NOMBRE = "kilopan_outbox";
const TIENDA = "pendientes";
const VERSION = 1;

export interface ItemOutbox {
  clientUuid: string;
  tipo: "entrega";
  payload: unknown;
  intentos: number;
  creadoAt: number;
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

export async function encolar(item: Omit<ItemOutbox, "intentos" | "creadoAt">): Promise<void> {
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

async function marcarIntento(item: ItemOutbox): Promise<void> {
  await conTienda("readwrite", (t) => t.put({ ...item, intentos: item.intentos + 1 }));
}

export interface ResultadoSync {
  enviadas: number;
  rechazadas: { clientUuid: string; motivo: string }[];
  sinConexion: boolean;
}

/** Intenta descargar la cola. Nunca lanza: si no hay red, devuelve sinConexion y deja
 *  todo encolado para el próximo intento (reintento infinito, cero pérdida). */
export async function sincronizar(): Promise<ResultadoSync> {
  const pendientes = await listarPendientes();
  const entregas = pendientes.filter((p) => p.tipo === "entrega");
  if (entregas.length === 0) return { enviadas: 0, rechazadas: [], sinConexion: false };

  let respuesta: Response;
  try {
    respuesta = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entregas: entregas.map((e) => e.payload) }),
    });
  } catch {
    for (const item of entregas) await marcarIntento(item);
    return { enviadas: 0, rechazadas: [], sinConexion: true };
  }

  if (!respuesta.ok) {
    for (const item of entregas) await marcarIntento(item);
    return { enviadas: 0, rechazadas: [], sinConexion: true };
  }

  const cuerpo = (await respuesta.json()) as {
    aceptadas: string[];
    rechazadas: { clientUuid: string; motivo: string }[];
  };
  for (const uuid of cuerpo.aceptadas) await quitar(uuid);
  // Un rechazo por invariante no se reintenta para siempre: se saca de la cola y se
  // reporta, para que el repartidor lo vea en vez de girar en silencio.
  for (const r of cuerpo.rechazadas) await quitar(r.clientUuid);

  return { enviadas: cuerpo.aceptadas.length, rechazadas: cuerpo.rechazadas, sinConexion: false };
}

/** Arranca el reintento automático: al volver la conexión y cada 30 s. Devuelve la
 *  función para desmontarlo. */
export function iniciarSyncAutomatico(alCambiar: (pendientes: number) => void): () => void {
  let vivo = true;

  async function ciclo() {
    if (!vivo) return;
    await sincronizar().catch(() => undefined);
    alCambiar(await contarPendientes().catch(() => 0));
  }

  const intervalo = setInterval(ciclo, 30_000);
  window.addEventListener("online", ciclo);
  void ciclo();

  return () => {
    vivo = false;
    clearInterval(intervalo);
    window.removeEventListener("online", ciclo);
  };
}
