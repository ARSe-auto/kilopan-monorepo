"use client";
// Identidad del equipo (client-side), en IndexedDB. PROMPT_MAESTRO.md §4 declara
// explícitamente esta garantía menor que Keychain como aceptada: "el secreto vive en
// IndexedDB [...] en el cliente". Antes vivía en localStorage — un secreto ahí es
// legible con `localStorage.getItem("kp_dispositivo")` desde CUALQUIER script del
// origen (consola, extensión, librería de terceros comprometida) sin ninguna barrera;
// IndexedDB no impide eso ante un XSS activo, pero sí cierra esa lectura trivial de un
// paso, que es la garantía que el maestro declaró y AC-SEC-05 afirma que se cumple
// ("ningún secreto ni token en localStorage") [AC-SEC-05].
// NO es la sesión del operador (esa es la cookie HttpOnly); esto identifica el EQUIPO,
// que puede quedar enrolado por meses mientras distintos operadores hacen F5 encima.
const DB_NOMBRE = "kilopan_dispositivo";
const TIENDA = "identidad";
const CLAVE = "actual";
const VERSION = 1;

export interface IdentidadDispositivo {
  id: string;
  secreto: string;
  nombre: string;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const req = indexedDB.open(DB_NOMBRE, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(TIENDA)) {
        req.result.createObjectStore(TIENDA);
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

export async function leerDispositivo(): Promise<IdentidadDispositivo | null> {
  if (typeof window === "undefined") return null;
  try {
    const valor = await conTienda<IdentidadDispositivo | undefined>("readonly", (t) => t.get(CLAVE));
    return valor ?? null;
  } catch {
    return null;
  }
}

export async function guardarDispositivo(identidad: IdentidadDispositivo): Promise<void> {
  await conTienda<IDBValidKey>("readwrite", (t) => t.put(identidad, CLAVE));
}

export async function olvidarDispositivo(): Promise<void> {
  await conTienda<undefined>("readwrite", (t) => t.delete(CLAVE));
}
