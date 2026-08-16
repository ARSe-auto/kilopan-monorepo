// La passkey/WebAuthn de «transferir propiedad» [AC-FIDN-13] — §5.4 F-H.
//
// ÚNICO lugar del sistema donde WebAuthn se usa (grep del manifiesto de rutas lo prueba). La
// Pregunta 4 la respondió Alexis el 11-ago-2026: la credencial se registra AL PRIMER USO de
// «transferir propiedad» y no en un paso de setup aparte; si se pierde, se recupera por el
// break-glass del §7.9, ya aprobado.
//
// POR QUÉ ESTE ARCHIVO DECODIFICA CBOR A MANO, en vez de traer una librería. El §4.2 del
// maestro no habla de WebAuthn, pero la costumbre del método sí es escribir el algoritmo
// propio en un módulo sensible: acá la superficie es chica y CERRADA —un solo `fmt`
// ("none"), una sola curva (P-256/ES256), un solo formato de attestation— y traer un paquete
// entero para decodificar tres campos de un mapa es más superficie de la que este AC necesita
// cubrir. Se verifica DOBLE y sin oráculo externo: `passkey.test.ts` construye sus propios
// vectores firmándolos con `crypto.subtle` (el mismo primitivo que usa este archivo, jamás
// una librería de WebAuthn de terceros), y el e2e de Playwright ejerce la ceremonia REAL
// contra el autenticador virtual de Chromium — el intérprete que manda en la práctica.
//
// Este archivo entero usa `crypto.subtle`, la MISMA API que corre en el navegador (igual
// criterio que `dominio/secretos.ts`).

const RP_NOMBRE = "KiloRuta";
const ALG_ES256 = -7;

/** Vida del reto y timeout de la ceremonia. Detalle de implementación de una ceremonia
 *  criptográfica estándar —no una respuesta del dueño—, así que vive acá y no en
 *  `constants.ts`: 5 minutos alcanzan de sobra para una huella dactilar y acotan la ventana
 *  de un reto interceptado sin usar. */
export const PASSKEY = {
  reto_vigencia_min: 5,
  timeout_ms: 60_000,
} as const;

// ─── base64url, sin depender de cómo se armó el Uint8Array ────────────────────────────

export function aBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Copia SIEMPRE a un buffer propio (byteOffset 0): lo que sigue hace aritmética de offsets
 *  contra `.buffer` y un view compartido del pool de Node la rompería en silencio. */
export function deBase64Url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

/** Puente de TIPOS entre el `Uint8Array` que devuelve `Buffer`/`subarray` y el `BufferSource`
 *  que pide Web Crypto: `@types/node` parametriza `Uint8Array` sobre `ArrayBufferLike` (que
 *  incluye `SharedArrayBuffer`) y el DOM exige `ArrayBuffer` a secas. Node jamás respalda un
 *  `Buffer` con `SharedArrayBuffer`, así que esto es un cast de tipos y no de runtime. */
function comoBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

function concatenar(a: Uint8Array, b: Uint8Array): Uint8Array {
  const salida = new Uint8Array(a.length + b.length);
  salida.set(a, 0);
  salida.set(b, a.length);
  return salida;
}

function bytesIguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function bytesDeUuid(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`passkey: uuid con forma inesperada «${uuid}»`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// ─── CBOR: solo lo que un attestationObject y un COSE_Key EC2 necesitan ───────────────
//
// Longitud definida siempre; indefinida rebota. Un decoder que aceptara «no sé cuánto mide
// esto» sobre datos que llegan de un cliente es superficie que no hace falta abrir.

export type ValorCbor =
  | number
  | Uint8Array
  | string
  | boolean
  | null
  | ValorCbor[]
  | Map<ValorCbor, ValorCbor>;

function vistaEn(buf: Uint8Array, pos: number, largo: number): DataView {
  if (pos + largo > buf.length) throw new Error("CBOR: buffer agotado leyendo un entero");
  return new DataView(buf.buffer, buf.byteOffset + pos, largo);
}

function leerCbor(buf: Uint8Array, offset: number): { valor: ValorCbor; fin: number } {
  const inicial = buf[offset];
  if (inicial === undefined) throw new Error("CBOR: buffer agotado");
  const tipoMayor = inicial >> 5;
  const info = inicial & 0x1f;
  let pos = offset + 1;
  let n: number;
  if (info < 24) {
    n = info;
  } else if (info === 24) {
    n = vistaEn(buf, pos, 1).getUint8(0);
    pos += 1;
  } else if (info === 25) {
    n = vistaEn(buf, pos, 2).getUint16(0);
    pos += 2;
  } else if (info === 26) {
    n = vistaEn(buf, pos, 4).getUint32(0);
    pos += 4;
  } else if (info === 27) {
    const alto = vistaEn(buf, pos, 8).getBigUint64(0);
    if (alto > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("CBOR: entero fuera de rango seguro");
    n = Number(alto);
    pos += 8;
  } else {
    throw new Error(`CBOR: longitud indefinida no soportada (info ${info})`);
  }

  switch (tipoMayor) {
    case 0:
      return { valor: n, fin: pos };
    case 1:
      return { valor: -1 - n, fin: pos };
    case 2: {
      if (pos + n > buf.length) throw new Error("CBOR: byte string más larga que el buffer");
      return { valor: buf.subarray(pos, pos + n), fin: pos + n };
    }
    case 3: {
      if (pos + n > buf.length) throw new Error("CBOR: text string más larga que el buffer");
      return { valor: new TextDecoder().decode(buf.subarray(pos, pos + n)), fin: pos + n };
    }
    case 4: {
      const arr: ValorCbor[] = [];
      let cursor = pos;
      for (let i = 0; i < n; i++) {
        const leido = leerCbor(buf, cursor);
        arr.push(leido.valor);
        cursor = leido.fin;
      }
      return { valor: arr, fin: cursor };
    }
    case 5: {
      const mapa = new Map<ValorCbor, ValorCbor>();
      let cursor = pos;
      for (let i = 0; i < n; i++) {
        const clave = leerCbor(buf, cursor);
        const valor = leerCbor(buf, clave.fin);
        mapa.set(clave.valor, valor.valor);
        cursor = valor.fin;
      }
      return { valor: mapa, fin: cursor };
    }
    case 6:
      // Una etiqueta antepone un número al valor que sigue; para lo que este módulo lee
      // (attestationObject, COSE_Key) ninguna etiqueta importa — se decodifica el contenido.
      return leerCbor(buf, pos);
    case 7:
      if (info === 20) return { valor: false, fin: pos };
      if (info === 21) return { valor: true, fin: pos };
      if (info === 22) return { valor: null, fin: pos };
      throw new Error(`CBOR: simple ${info} no soportado`);
    default:
      throw new Error(`CBOR: tipo mayor ${tipoMayor} no soportado`);
  }
}

function comoCoseEc2(valor: ValorCbor | undefined): { x: Uint8Array; y: Uint8Array } {
  if (!(valor instanceof Map)) throw new Error("COSE: la clave pública no es un mapa CBOR");
  const kty = valor.get(1);
  const alg = valor.get(3);
  const crv = valor.get(-1);
  const x = valor.get(-2);
  const y = valor.get(-3);
  if (kty !== 2) throw new Error(`COSE: kty «${String(kty)}» no es EC2 (2)`);
  if (alg !== ALG_ES256) throw new Error(`COSE: alg «${String(alg)}» no es ES256 (-7)`);
  if (crv !== 1) throw new Error(`COSE: crv «${String(crv)}» no es P-256 (1)`);
  if (!(x instanceof Uint8Array) || x.length !== 32) throw new Error("COSE: coordenada x inválida");
  if (!(y instanceof Uint8Array) || y.length !== 32) throw new Error("COSE: coordenada y inválida");
  return { x, y };
}

// ─── authenticatorData: el layout binario fijo del §6.1 de la spec ────────────────────

type AuthData = {
  rpIdHash: Uint8Array;
  up: boolean;
  uv: boolean;
  at: boolean;
  signCount: number;
  credencial?: { credentialId: Uint8Array; clavePublicaRaw: Uint8Array };
};

function leerAuthData(bytes: Uint8Array): AuthData {
  if (bytes.length < 37) throw new Error("authenticatorData: más corto que rpIdHash+flags+signCount");
  const rpIdHash = bytes.subarray(0, 32);
  const flags = bytes[32]!;
  const up = (flags & 0x01) !== 0;
  const uv = (flags & 0x04) !== 0;
  const at = (flags & 0x40) !== 0;
  const signCount = vistaEn(bytes, 33, 4).getUint32(0);

  if (!at) return { rpIdHash, up, uv, at, signCount };

  let pos = 37;
  pos += 16; // aaguid: no se usa acá
  const credIdLen = vistaEn(bytes, pos, 2).getUint16(0);
  pos += 2;
  if (pos + credIdLen > bytes.length) throw new Error("authenticatorData: credentialId trunca el buffer");
  const credentialId = bytes.subarray(pos, pos + credIdLen);
  pos += credIdLen;
  const { valor: coseKey } = leerCbor(bytes, pos);
  const { x, y } = comoCoseEc2(coseKey);
  const clavePublicaRaw = new Uint8Array(65);
  clavePublicaRaw[0] = 0x04;
  clavePublicaRaw.set(x, 1);
  clavePublicaRaw.set(y, 33);
  return { rpIdHash, up, uv, at, signCount, credencial: { credentialId, clavePublicaRaw } };
}

// ─── DER → raw (r‖s): WebCrypto firma y verifica ECDSA en crudo, jamás en ASN.1 ────────

function leerLongitudAsn1(buf: Uint8Array, pos: number): { longitud: number; pos: number } {
  const primero = buf[pos];
  if (primero === undefined) throw new Error("ASN.1: buffer agotado leyendo longitud");
  if ((primero & 0x80) === 0) return { longitud: primero, pos: pos + 1 };
  const nBytes = primero & 0x7f;
  let longitud = 0;
  for (let i = 0; i < nBytes; i++) longitud = (longitud << 8) | buf[pos + 1 + i]!;
  return { longitud, pos: pos + 1 + nBytes };
}

function leerEnteroAsn1(buf: Uint8Array, pos: number): { bytes: Uint8Array; pos: number } {
  if (buf[pos] !== 0x02) throw new Error("ASN.1: se esperaba un INTEGER");
  const { longitud, pos: pos2 } = leerLongitudAsn1(buf, pos + 1);
  return { bytes: buf.subarray(pos2, pos2 + longitud), pos: pos2 + longitud };
}

/** Quita el `0x00` que ASN.1 antepone cuando el bit alto queda en 1, o rellena con ceros si
 *  el INTEGER vino más corto que la coordenada de la curva. WebCrypto exige EXACTAMENTE
 *  `tamano` bytes por componente. */
function aTamanoFijo(bytes: Uint8Array, tamano: number): Uint8Array {
  let recorte = bytes;
  while (recorte.length > tamano && recorte[0] === 0x00) recorte = recorte.subarray(1);
  if (recorte.length > tamano) throw new Error("ASN.1: componente más largo que la curva");
  const salida = new Uint8Array(tamano);
  salida.set(recorte, tamano - recorte.length);
  return salida;
}

function derARaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("firma: no es una SEQUENCE ASN.1");
  const { pos } = leerLongitudAsn1(der, 1);
  const r = leerEnteroAsn1(der, pos);
  const s = leerEnteroAsn1(der, r.pos);
  const raw = new Uint8Array(64);
  raw.set(aTamanoFijo(r.bytes, 32), 0);
  raw.set(aTamanoFijo(s.bytes, 32), 32);
  return raw;
}

// ─── clientDataJSON ─────────────────────────────────────────────────────────────────────

function leerClientData(
  clientDataJSONB64: string,
  tipoEsperado: "webauthn.create" | "webauthn.get",
  retoEsperado: string,
  origenEsperado: string,
): Uint8Array {
  const bytes = deBase64Url(clientDataJSONB64);
  let datos: { type?: unknown; challenge?: unknown; origin?: unknown };
  try {
    datos = JSON.parse(new TextDecoder().decode(bytes)) as typeof datos;
  } catch {
    throw new Error("clientDataJSON: no es JSON válido");
  }
  if (datos.type !== tipoEsperado) {
    throw new Error(`clientDataJSON: type «${String(datos.type)}» inesperado`);
  }
  if (datos.challenge !== retoEsperado) throw new Error("clientDataJSON: el desafío no coincide");
  if (datos.origin !== origenEsperado) {
    throw new Error(`clientDataJSON: origin «${String(datos.origin)}» inesperado`);
  }
  return bytes;
}

// ─── Las opciones que arman `navigator.credentials.create()` / `.get()` ────────────────

export type OpcionesDeRegistro = {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  authenticatorSelection: { userVerification: "required"; residentKey: "preferred" };
  attestation: "none";
  timeout: number;
};

export function opcionesDeRegistro(args: {
  rpId: string;
  reto: string;
  usuarioId: string;
  nombre: string;
}): OpcionesDeRegistro {
  return {
    challenge: args.reto,
    rp: { id: args.rpId, name: RP_NOMBRE },
    user: { id: aBase64Url(bytesDeUuid(args.usuarioId)), name: args.nombre, displayName: args.nombre },
    pubKeyCredParams: [{ type: "public-key", alg: ALG_ES256 }],
    authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
    attestation: "none",
    timeout: PASSKEY.timeout_ms,
  };
}

export type OpcionesDeAutenticacion = {
  challenge: string;
  rpId: string;
  allowCredentials: { type: "public-key"; id: string }[];
  userVerification: "required";
  timeout: number;
};

export function opcionesDeAutenticacion(args: {
  rpId: string;
  reto: string;
  credentialId: string;
}): OpcionesDeAutenticacion {
  return {
    challenge: args.reto,
    rpId: args.rpId,
    allowCredentials: [{ type: "public-key", id: args.credentialId }],
    userVerification: "required",
    timeout: PASSKEY.timeout_ms,
  };
}

export function retoNuevo(): string {
  return aBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

// ─── Lo que el navegador devuelve, en la forma en que este servidor lo pide ────────────

export type CredencialDeRegistro = { id: string; clientDataJSON: string; attestationObject: string };
export type CredencialDeAutenticacion = {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
};

/**
 * Verifica un `navigator.credentials.create()`. Exige `fmt: "none"` — es lo único que este
 * módulo sabe leer, y una attestation que dijera otra cosa se rechaza en vez de tratarse como
 * si fuera "none": aceptar un formato sin verificarlo de verdad sería peor que no soportarlo.
 */
export async function verificarRegistro(args: {
  credencial: CredencialDeRegistro;
  retoEsperado: string;
  rpId: string;
  origenEsperado: string;
}): Promise<{ credentialId: string; clavePublicaRaw: Uint8Array }> {
  leerClientData(args.credencial.clientDataJSON, "webauthn.create", args.retoEsperado, args.origenEsperado);

  const { valor: mapaAtt } = leerCbor(deBase64Url(args.credencial.attestationObject), 0);
  if (!(mapaAtt instanceof Map)) throw new Error("attestationObject: no es un mapa CBOR");
  const fmt = mapaAtt.get("fmt");
  const authDataBytes = mapaAtt.get("authData");
  if (fmt !== "none") throw new Error(`attestation «${String(fmt)}» no soportada: solo "none"`);
  if (!(authDataBytes instanceof Uint8Array)) throw new Error("attestationObject: sin authData");

  const rpIdHashEsperado = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(args.rpId)),
  );
  const authData = leerAuthData(authDataBytes);
  if (!bytesIguales(authData.rpIdHash, rpIdHashEsperado)) throw new Error("authData: rpIdHash no coincide");
  if (!authData.up) throw new Error("authData: sin presencia del usuario (UP)");
  if (!authData.uv) throw new Error("authData: sin verificación del usuario (UV)");
  if (!authData.credencial) throw new Error("authData: el registro no trae credencial atestiguada (AT)");

  const credentialId = aBase64Url(authData.credencial.credentialId);
  if (credentialId !== args.credencial.id) throw new Error("authData: el id de la credencial no coincide");

  return { credentialId, clavePublicaRaw: authData.credencial.clavePublicaRaw };
}

/**
 * Verifica un `navigator.credentials.get()` contra la clave pública YA registrada. El
 * contador solo se exige NO retroceder cuando llega distinto de cero: varios autenticadores
 * de plataforma lo dejan fijo en 0, y exigir que siempre suba los declararía todos clonados.
 */
export async function verificarAutenticacion(args: {
  credencial: CredencialDeAutenticacion;
  retoEsperado: string;
  rpId: string;
  origenEsperado: string;
  clavePublicaRaw: Uint8Array;
  contadorAnterior: number;
}): Promise<{ contadorNuevo: number }> {
  const clientDataBytes = leerClientData(
    args.credencial.clientDataJSON,
    "webauthn.get",
    args.retoEsperado,
    args.origenEsperado,
  );

  const authDataBytes = deBase64Url(args.credencial.authenticatorData);
  const rpIdHashEsperado = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(args.rpId)),
  );
  const authData = leerAuthData(authDataBytes);
  if (!bytesIguales(authData.rpIdHash, rpIdHashEsperado)) throw new Error("authData: rpIdHash no coincide");
  if (!authData.up) throw new Error("authData: sin presencia del usuario (UP)");
  if (!authData.uv) throw new Error("authData: sin verificación del usuario (UV)");
  if (authData.signCount !== 0 && authData.signCount <= args.contadorAnterior) {
    throw new Error("authData: el contador retrocedió — posible credencial clonada");
  }

  const clientDataHash = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", comoBufferSource(clientDataBytes)),
  );
  const firmado = concatenar(authDataBytes, clientDataHash);
  const clave = await globalThis.crypto.subtle.importKey(
    "raw",
    comoBufferSource(args.clavePublicaRaw),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valida = await globalThis.crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    clave,
    comoBufferSource(derARaw(deBase64Url(args.credencial.signature))),
    comoBufferSource(firmado),
  );
  if (!valida) throw new Error("firma: no verifica contra la clave pública registrada");

  return { contadorNuevo: authData.signCount };
}
