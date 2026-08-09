// El par de claves del aparato, del lado del NAVEGADOR [AC-FIDN-17] — §4.3, §5.4 F-B.
//
// POR QUÉ NO SE IMPORTA `dominio/secretos.ts`, QUE HACE ESTO MISMO. Ese archivo abre con
// `import { createHash, randomUUID } from "node:crypto"` y usa `Buffer` para el base64: es del
// SERVIDOR, y arrastrarlo a un componente de cliente metería un polyfill de Node en el bundle
// que el teléfono descarga con la señal de un galpón. Acá va la mitad que corre en el
// navegador, escrita contra las APIs que el navegador ya tiene.
//
// LA CRIPTOGRAFÍA ES LA MISMA, y eso no queda en la confianza: la curva y el formato de la
// clave pública se declaran una sola vez —P-256, SPKI en base64— y el sobre lo abre
// `dominio/secretos.ts` con el par que este archivo genera, ejercido en las pruebas de
// AC-FIDN-04 contra un par real. Si las dos mitades se separaran, el sobre no abriría.
//
// LA PRIVADA ES NO EXTRAÍBLE (`extractable: false`). Eso convierte «nunca salió del teléfono»
// en una propiedad del navegador y no en una promesa nuestra: ni este código puede leerla.
// Por eso se guarda el CryptoKey en IndexedDB —que sabe serializar claves no extraíbles— y no
// su material en `localStorage`, donde habría que extraerla para escribirla.

const CURVA = { name: "ECDH", namedCurve: "P-256" } as const;
const BASE = "flota-aparato";
const ALMACEN = "claves";
const CLAVE_PRIVADA = "privada";

/** Genera el par del aparato. La pública viaja en la solicitud; la privada se queda acá. */
export async function parDelAparato(): Promise<{ publica: string; privada: CryptoKey }> {
  const par = await crypto.subtle.generateKey(CURVA, false, ["deriveBits"]);
  const spki = await crypto.subtle.exportKey("spki", par.publicKey);
  return { publica: aBase64(spki), privada: par.privateKey };
}

/** base64 sin `Buffer`: el navegador tiene `btoa`, y traerse Node para esto sería absurdo. */
function aBase64(bytes: ArrayBuffer): string {
  const octetos = new Uint8Array(bytes);
  let binario = "";
  for (const b of octetos) binario += String.fromCharCode(b);
  return btoa(binario);
}

function abrirBase(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(BASE, 1);
    peticion.onupgradeneeded = () => peticion.result.createObjectStore(ALMACEN);
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

function transaccion<T>(modo: IDBTransactionMode, fn: (almacen: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrirBase().then(
    (bd) =>
      new Promise<T>((resolver, rechazar) => {
        const peticion = fn(bd.transaction(ALMACEN, modo).objectStore(ALMACEN));
        peticion.onsuccess = () => resolver(peticion.result);
        peticion.onerror = () => rechazar(peticion.error);
      }),
  );
}

/**
 * Guarda la privada del aparato. Se llama al ENVIAR la solicitud y no al aprobar, porque entre
 * las dos cosas puede pasar media hora y el teléfono se puede bloquear: si la clave viviera
 * solo en memoria, el sobre que el dueño emite llegaría a un aparato que ya no lo puede abrir
 * y la persona tendría que solicitar de nuevo sin entender por qué.
 */
export async function guardarPrivada(privada: CryptoKey): Promise<void> {
  await transaccion("readwrite", (almacen) => almacen.put(privada, CLAVE_PRIVADA));
}

/** La privada guardada, o null si este aparato nunca solicitó (o le limpiaron el navegador). */
export async function leerPrivada(): Promise<CryptoKey | null> {
  const guardada = await transaccion<CryptoKey | undefined>("readonly", (almacen) =>
    almacen.get(CLAVE_PRIVADA),
  );
  return guardada ?? null;
}

/**
 * Huella del aparato para la solicitud. NO es un identificador de rastreo y no puede serlo: es
 * lo que el dueño ve al aprobar para reconocer que el teléfono que pide es el que tiene
 * delante. Se arma con lo que el propio navegador declara de sí mismo, sin fingerprinting
 * pasivo —nada de canvas ni de fuentes—, porque el §7.8 no habilita a perfilar a nadie para
 * resolver un problema que se resuelve mirando la pantalla.
 */
export function huellaDelAparato(): string {
  const partes = [
    navigator.platform || "aparato",
    `${screen.width}x${screen.height}`,
    String(navigator.hardwareConcurrency ?? 0),
  ];
  return partes.join(" · ");
}
