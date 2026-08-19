import { createHash, randomUUID } from "node:crypto";

// El secreto del dispositivo y el sobre con que viaja [AC-FIDN-04] — §4.3, §5.4 F-C.
//
// EL PROBLEMA QUE RESUELVE. La aprobación emite el secreto del aparato, pero el aparato no
// está ahí: el dueño aprueba desde SU teléfono y el trabajador espera en el suyo. El secreto
// tiene que cruzar sin que exista un momento en que el servidor —o cualquiera que mire una
// respuesta, un log o una fila— lo pueda leer. Por eso se SELLA contra la clave pública que
// el aparato registró al solicitar (AC-FIDN-03): solo su clave privada lo abre, y esa clave
// nunca salió del teléfono.
//
// LA CAJA es la construcción estándar: par efímero del servidor + ECDH P-256 + HKDF-SHA256 +
// AES-256-GCM. Cada sobre lleva su clave efímera, su sal y su nonce; el servidor tira su
// privada efímera apenas sella, así que ni él puede volver a abrirlo.
//
// P-256 y no RSA, con una razón de terreno: el par lo genera la PWA en el teléfono del
// trabajador, y generar RSA-2048 en un Android de galpón toma segundos que el flujo de 90 s
// del §5.4 no tiene para regalar. P-256 es instantáneo y su privada puede quedar NO
// EXTRAÍBLE en WebCrypto, que es lo que hace que «nunca salió del teléfono» sea una propiedad
// del navegador y no una promesa nuestra.
//
// ESTE ARCHIVO ENTERO USA `crypto.subtle`, la MISMA API que corre en el navegador. No es
// elegancia: significa que la mitad del aparato se puede probar acá, con el código exacto que
// la PWA va a ejecutar, en vez de con una simulación que un día deje de parecerse.

const CURVA = { name: "ECDH", namedCurve: "P-256" } as const;
/** Ata la clave derivada a su propósito: un sobre de este sistema no sirve en otro. */
const PROPOSITO = new TextEncoder().encode("flota:secreto-de-dispositivo");

/** Lo que viaja hasta el aparato. Nada de esto sirve sin la privada que no salió del teléfono. */
export type Sobre = {
  efimera: string;
  sal: string;
  nonce: string;
  cifrado: string;
};

const aB64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b as ArrayBuffer).toString("base64");
const deB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/**
 * El secreto del dispositivo. UUIDv4 y no bytes crudos porque viaja como cabecera de
 * autenticación en cada request y tiene que ser una cadena sin sorpresas de codificación; su
 * entropía (122 bits) es holgada para un portador que además se revoca en 1 toque.
 */
export function secretoNuevo(): string {
  return randomUUID();
}

/** En la BD queda solo esto (§4.3). El secreto en claro no se guarda en ningún lado. */
export function hashDeSecreto(secreto: string): string {
  return createHash("sha256").update(secreto, "utf8").digest("hex");
}

/** Sella el secreto contra la clave pública que el aparato registró al solicitar. */
export async function sellar(clavePublicaSpkiB64: string, secreto: string): Promise<Sobre> {
  const { subtle } = globalThis.crypto;
  const publicaDelAparato = await subtle.importKey("spki", deB64(clavePublicaSpkiB64), CURVA, true, []);
  const efimero = await subtle.generateKey(CURVA, true, ["deriveBits"]);

  const compartido = await subtle.deriveBits(
    { name: "ECDH", public: publicaDelAparato },
    efimero.privateKey,
    256,
  );
  const sal = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const material = await subtle.importKey("raw", compartido, "HKDF", false, ["deriveKey"]);
  const clave = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: sal, info: PROPOSITO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const cifrado = await subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    clave,
    new TextEncoder().encode(secreto),
  );

  // La privada efímera se va con la función: nadie la guarda, así que este sobre no se puede
  // volver a abrir del lado del servidor ni con acceso total a la base.
  return {
    efimera: aB64(await subtle.exportKey("spki", efimero.publicKey)),
    sal: aB64(sal),
    nonce: aB64(nonce),
    cifrado: aB64(cifrado),
  };
}

/**
 * La mitad del APARATO. En producción esto corre en la PWA con la privada no extraíble; acá
 * existe para que la prueba ejerza el camino completo —sellar y abrir— con el código exacto
 * que va a correr en el teléfono. Un test que solo sellara no probaría que el sobre se abre.
 */
export async function abrir(sobre: Sobre, privadaDelAparato: CryptoKey): Promise<string> {
  const { subtle } = globalThis.crypto;
  const efimera = await subtle.importKey("spki", deB64(sobre.efimera), CURVA, true, []);
  const compartido = await subtle.deriveBits({ name: "ECDH", public: efimera }, privadaDelAparato, 256);
  const material = await subtle.importKey("raw", compartido, "HKDF", false, ["deriveKey"]);
  const clave = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: deB64(sobre.sal), info: PROPOSITO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const abierto = await subtle.decrypt(
    { name: "AES-GCM", iv: deB64(sobre.nonce) },
    clave,
    deB64(sobre.cifrado),
  );
  return new TextDecoder().decode(abierto);
}

/**
 * El par que la PWA genera al solicitar. Se pide NO EXTRAÍBLE: en WebCrypto esa bandera rige
 * solo sobre la privada —la pública siempre se puede exportar, verificado contra el runtime—
 * así que el par sale con la privada encerrada en el navegador y la pública lista para viajar
 * en la solicitud. Que «nunca salió del teléfono» sea una propiedad del navegador y no una
 * promesa nuestra es todo el punto.
 */
export async function parDelAparato(): Promise<{ publica: string; privada: CryptoKey }> {
  const par = await globalThis.crypto.subtle.generateKey(CURVA, false, ["deriveBits"]);
  return {
    publica: aB64(await globalThis.crypto.subtle.exportKey("spki", par.publicKey)),
    privada: par.privateKey,
  };
}
