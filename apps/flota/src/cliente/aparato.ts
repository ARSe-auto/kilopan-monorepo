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

// ─── Abrir el sobre, del lado del teléfono [AC-FIDN-02] ───────────────────────────────
//
// El gemelo de `dominio/secretos.ts::abrir()`, escrito contra las APIs del navegador. Los
// parámetros son los MISMOS —P-256, HKDF-SHA256 con la sal del sobre y el propósito atado, y
// AES-256-GCM— y no se pueden separar sin que se note: si divergieran, el sobre no abriría y
// la sesión no arrancaría. Es la única mitad que el servidor no puede ejecutar, porque la
// privada que hace falta no salió nunca de este teléfono.

/** Ata la clave derivada a su propósito. Tiene que ser BYTE A BYTE el del servidor. */
const PROPOSITO = new TextEncoder().encode("flota:secreto-de-dispositivo");

export type Sobre = { efimera: string; sal: string; nonce: string; cifrado: string };

/** Devuelve `ArrayBuffer` y no `Uint8Array`: es lo que WebCrypto pide como `BufferSource`, y
 *  con la vista tipada TypeScript rechaza la llamada por el buffer genérico. */
const deBase64 = (s: string): ArrayBuffer => {
  const binario = atob(s);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
};

/** Abre el sobre con la privada guardada. Devuelve el secreto de sesión del aparato. */
export async function abrirSobre(sobre: Sobre, privada: CryptoKey): Promise<string> {
  const { subtle } = crypto;
  const efimera = await subtle.importKey("spki", deBase64(sobre.efimera), CURVA, true, []);
  const compartido = await subtle.deriveBits({ name: "ECDH", public: efimera }, privada, 256);
  const material = await subtle.importKey("raw", compartido, "HKDF", false, ["deriveKey"]);
  const clave = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: deBase64(sobre.sal), info: PROPOSITO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const abierto = await subtle.decrypt(
    { name: "AES-GCM", iv: deBase64(sobre.nonce) },
    clave,
    deBase64(sobre.cifrado),
  );
  return new TextDecoder().decode(abierto);
}

// ─── La sesión, guardada en el aparato ────────────────────────────────────────────────
//
// El secreto vive en el MISMO IndexedDB que la privada y no en `localStorage`: es la credencial
// del aparato, y `localStorage` lo lee cualquier script de la página. Además el §4.7 pide que
// lo del aparato sobreviva a un cierre, y `persist()` (AC-FIDN-05) protege a IndexedDB.

const SECRETO = "secreto-de-sesion";

export async function guardarSecreto(secreto: string): Promise<void> {
  await transaccion("readwrite", (almacen) => almacen.put(secreto, SECRETO));
}

export async function leerSecreto(): Promise<string | null> {
  const guardado = await transaccion<string | undefined>("readonly", (almacen) => almacen.get(SECRETO));
  return guardado ?? null;
}

// ─── La identidad rotatoria del ANDÉN [AC-FIDN-07] — §5.4 F-D, §4.7 ───────────────────
//
// En el teléfono personal la partición del outbox sale del secreto (`cliente/identidad.ts`):
// autenticarse otra identidad es un `guardarSecreto` nuevo, así que la llave cambia sola. En el
// ANDÉN no: el secreto es del APARATO y no se mueve cuando los operarios rotan por PIN. Sin esta
// huella, las capturas de A y las de B compartirían llave —y el §4.7 dice lo contrario con todas
// las letras—, así que al volver la red las tres entregas de A saldrían a nombre de B.
//
// La emite el servidor al rotar (`/api/anden/identidad`) y NO es una credencial: con ella no se
// entra a ningún lado; el request se sigue autenticando con el secreto del aparato. Por eso puede
// vivir acá al lado sin ser un segundo secreto que proteger.

const IDENTIDAD_ANDEN = "identidad-de-anden";

export async function guardarIdentidadAnden(huella: string): Promise<void> {
  await transaccion("readwrite", (almacen) => almacen.put(huella, IDENTIDAD_ANDEN));
}

/** La huella del operario activo en este andén, o null si el aparato es personal (o nadie rotó). */
export async function leerIdentidadAnden(): Promise<string | null> {
  const guardada = await transaccion<string | undefined>("readonly", (almacen) =>
    almacen.get(IDENTIDAD_ANDEN),
  );
  return guardada ?? null;
}

/**
 * `fetch` con la credencial del aparato. La sesión ES el aparato (AC-FIDN-09), así que esto es
 * todo lo que hay: sin cookie, sin refresh, sin nada que renovar.
 */
export async function pedir(url: string, opciones: RequestInit = {}): Promise<Response> {
  const secreto = await leerSecreto();
  const cabeceras = new Headers(opciones.headers);
  if (secreto) cabeceras.set("Authorization", `Portador ${secreto}`);
  if (opciones.body && !cabeceras.has("content-type")) cabeceras.set("content-type", "application/json");
  return fetch(url, { ...opciones, headers: cabeceras });
}
