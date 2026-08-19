import test from "node:test";
import assert from "node:assert/strict";
import {
  aBase64Url,
  deBase64Url,
  retoNuevo,
  opcionesDeRegistro,
  opcionesDeAutenticacion,
  verificarRegistro,
  verificarAutenticacion,
} from "./passkey.ts";

// La ceremonia passkey/WebAuthn de «transferir propiedad» [AC-FIDN-13] — §5.4 F-H.
//
// SIN ORÁCULO EXTERNO: este archivo NO importa ninguna librería de WebAuthn. Construye sus
// propios vectores —CBOR, COSE_Key, authenticatorData, la firma DER— con el mismo primitivo
// que usa `dominio/passkey.ts`, `crypto.subtle`, y verifica que el decoder propio los lee
// igual que los escribió. El otro brazo de la verificación, contra un autenticador REAL, es
// el e2e con el virtual authenticator de Playwright (`e2e/transferencia-propiedad.spec.ts`):
// dos caminos independientes al mismo código.

const RP_ID = "acme.localhost";
const ORIGEN = "http://acme.localhost:3311";

// Puente de TIPOS entre el `Uint8Array` que arma este archivo y el `BufferSource` de Web
// Crypto — misma razón que `comoBufferSource` en `passkey.ts`: `@types/node` parametriza
// `Uint8Array` sobre `ArrayBufferLike`, el DOM exige `ArrayBuffer` a secas, y acá nunca hay
// un `SharedArrayBuffer` detrás.
const comoBufferSource = (bytes: Uint8Array): BufferSource => bytes as BufferSource;

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const salida = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    salida.set(a, o);
    o += a.length;
  }
  return salida;
}

// ─── Un CBOR encoder de juguete, el inverso del decoder que se está probando ───────────

function cabeceraCbor(tipoMayor: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((tipoMayor << 5) | n);
  if (n < 256) return Uint8Array.of((tipoMayor << 5) | 24, n);
  const b = new Uint8Array(3);
  b[0] = (tipoMayor << 5) | 25;
  new DataView(b.buffer).setUint16(1, n);
  return b;
}
const encEntero = (n: number) => cabeceraCbor(n >= 0 ? 0 : 1, n >= 0 ? n : -1 - n);
const encBytes = (b: Uint8Array) => concatBytes(cabeceraCbor(2, b.length), b);
const encText = (s: string) => {
  const b = new TextEncoder().encode(s);
  return concatBytes(cabeceraCbor(3, b.length), b);
};
function encMap(entradas: [Uint8Array, Uint8Array][]): Uint8Array {
  let salida = cabeceraCbor(5, entradas.length);
  for (const [k, v] of entradas) salida = concatBytes(salida, k, v);
  return salida;
}

function coseEc2(x: Uint8Array, y: Uint8Array): Uint8Array {
  return encMap([
    [encEntero(1), encEntero(2)], // kty: EC2
    [encEntero(3), encEntero(-7)], // alg: ES256
    [encEntero(-1), encEntero(1)], // crv: P-256
    [encEntero(-2), encBytes(x)],
    [encEntero(-3), encBytes(y)],
  ]);
}

function attestationObjectNone(authData: Uint8Array): Uint8Array {
  return encMap([
    [encText("fmt"), encText("none")],
    [encText("attStmt"), encMap([])],
    [encText("authData"), encBytes(authData)],
  ]);
}

function armarAuthData(args: {
  rpIdHash: Uint8Array;
  up: boolean;
  uv: boolean;
  signCount: number;
  credencial?: { id: Uint8Array; cosePublica: Uint8Array };
}): Uint8Array {
  let flags = 0;
  if (args.up) flags |= 0x01;
  if (args.uv) flags |= 0x04;
  if (args.credencial) flags |= 0x40;
  const contador = new Uint8Array(4);
  new DataView(contador.buffer).setUint32(0, args.signCount);
  const base = concatBytes(args.rpIdHash, Uint8Array.of(flags), contador);
  if (!args.credencial) return base;
  const aaguid = new Uint8Array(16);
  const credIdLen = new Uint8Array(2);
  new DataView(credIdLen.buffer).setUint16(0, args.credencial.id.length);
  return concatBytes(base, aaguid, credIdLen, args.credencial.id, args.credencial.cosePublica);
}

// ─── DER, el inverso de `derARaw` que vive dentro del archivo bajo prueba ──────────────

function enteroAsn1(bytes32: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes32.length - 1 && bytes32[i] === 0) i++;
  let recorte = bytes32.subarray(i);
  if (recorte[0]! & 0x80) {
    const conCero = new Uint8Array(recorte.length + 1);
    conCero.set(recorte, 1);
    recorte = conCero;
  }
  return concatBytes(Uint8Array.of(0x02, recorte.length), recorte);
}
function rawADer(raw64: Uint8Array): Uint8Array {
  const r = enteroAsn1(raw64.subarray(0, 32));
  const s = enteroAsn1(raw64.subarray(32, 64));
  const cuerpo = concatBytes(r, s);
  const longitud = cuerpo.length < 128 ? Uint8Array.of(cuerpo.length) : Uint8Array.of(0x81, cuerpo.length);
  return concatBytes(Uint8Array.of(0x30), longitud, cuerpo);
}

// ─── El autenticador de juguete: un par P-256 real, firmado con WebCrypto ──────────────

async function autenticadorNuevo() {
  const par = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", par.publicKey));
  const x = raw.subarray(1, 33);
  const y = raw.subarray(33, 65);
  const rpIdHash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(RP_ID)));
  const credencialId = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { par, raw, x, y, rpIdHash, credencialId };
}

function clientDataJSON(tipo: "webauthn.create" | "webauthn.get", challenge: string, origin: string): string {
  return aBase64Url(new TextEncoder().encode(JSON.stringify({ type: tipo, challenge, origin })));
}

async function registrarCredencial(
  auten: Awaited<ReturnType<typeof autenticadorNuevo>>,
  reto: string,
  opts: { uv?: boolean; origin?: string; rpIdHash?: Uint8Array; fmt?: string } = {},
) {
  const authData = armarAuthData({
    rpIdHash: opts.rpIdHash ?? auten.rpIdHash,
    up: true,
    uv: opts.uv ?? true,
    signCount: 0,
    credencial: { id: auten.credencialId, cosePublica: coseEc2(auten.x, auten.y) },
  });
  const attestationObject =
    opts.fmt && opts.fmt !== "none"
      ? encMap([
          [encText("fmt"), encText(opts.fmt)],
          [encText("attStmt"), encMap([])],
          [encText("authData"), encBytes(authData)],
        ])
      : attestationObjectNone(authData);
  return {
    id: aBase64Url(auten.credencialId),
    clientDataJSON: clientDataJSON("webauthn.create", reto, opts.origin ?? ORIGEN),
    attestationObject: aBase64Url(attestationObject),
  };
}

async function autenticarCon(
  auten: Awaited<ReturnType<typeof autenticadorNuevo>>,
  reto: string,
  opts: { uv?: boolean; origin?: string; signCount?: number; claveDeFirma?: CryptoKey } = {},
) {
  const authData = armarAuthData({
    rpIdHash: auten.rpIdHash,
    up: true,
    uv: opts.uv ?? true,
    signCount: opts.signCount ?? 1,
  });
  const cdj = clientDataJSON("webauthn.get", reto, opts.origin ?? ORIGEN);
  const clientDataHash = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", comoBufferSource(deBase64Url(cdj))),
  );
  const firmado = concatBytes(authData, clientDataHash);
  const firmaRaw = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      opts.claveDeFirma ?? auten.par.privateKey,
      comoBufferSource(firmado),
    ),
  );
  return {
    id: aBase64Url(auten.credencialId),
    clientDataJSON: cdj,
    authenticatorData: aBase64Url(authData),
    signature: aBase64Url(rawADer(firmaRaw)),
  };
}

// ─── Registro ───────────────────────────────────────────────────────────────────────────

test("[AC-FIDN-13] registro feliz: la clave pública que sale es la que firmó el autenticador", async () => {
  const auten = await autenticadorNuevo();
  const reto = retoNuevo();
  const credencial = await registrarCredencial(auten, reto);

  const { credentialId, clavePublicaRaw } = await verificarRegistro({
    credencial,
    retoEsperado: reto,
    rpId: RP_ID,
    origenEsperado: ORIGEN,
  });

  assert.equal(credentialId, aBase64Url(auten.credencialId));
  assert.deepEqual(clavePublicaRaw, auten.raw);
});

test("[AC-FIDN-13] registro: el desafío tiene que ser EXACTAMENTE el emitido", async () => {
  const auten = await autenticadorNuevo();
  const credencial = await registrarCredencial(auten, retoNuevo());
  await assert.rejects(() =>
    verificarRegistro({ credencial, retoEsperado: retoNuevo(), rpId: RP_ID, origenEsperado: ORIGEN }),
  );
});

test("[AC-FIDN-13] registro: origin de otro sitio rebota", async () => {
  const auten = await autenticadorNuevo();
  const reto = retoNuevo();
  const credencial = await registrarCredencial(auten, reto, { origin: "http://otro-sitio.localhost:3311" });
  await assert.rejects(() =>
    verificarRegistro({ credencial, retoEsperado: reto, rpId: RP_ID, origenEsperado: ORIGEN }),
  );
});

test("[AC-FIDN-13] registro: rpIdHash de otro tenant rebota — cada subdominio es su propia RP", async () => {
  const auten = await autenticadorNuevo();
  const reto = retoNuevo();
  const rpIdHashAjeno = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("otro.localhost")),
  );
  const credencial = await registrarCredencial(auten, reto, { rpIdHash: rpIdHashAjeno });
  await assert.rejects(() =>
    verificarRegistro({ credencial, retoEsperado: reto, rpId: RP_ID, origenEsperado: ORIGEN }),
  );
});

test("[AC-FIDN-13] registro: sin verificación del usuario (UV) rebota — la ceremonia lo exige", async () => {
  const auten = await autenticadorNuevo();
  const reto = retoNuevo();
  const credencial = await registrarCredencial(auten, reto, { uv: false });
  await assert.rejects(() =>
    verificarRegistro({ credencial, retoEsperado: reto, rpId: RP_ID, origenEsperado: ORIGEN }),
  );
});

test("[AC-FIDN-13] registro: attestation distinta de «none» rebota — es lo único que este módulo lee", async () => {
  const auten = await autenticadorNuevo();
  const reto = retoNuevo();
  const credencial = await registrarCredencial(auten, reto, { fmt: "packed" });
  await assert.rejects(() =>
    verificarRegistro({ credencial, retoEsperado: reto, rpId: RP_ID, origenEsperado: ORIGEN }),
  );
});

// ─── Autenticación ──────────────────────────────────────────────────────────────────────

test("[AC-FIDN-13] autenticación feliz contra la clave ya registrada", async () => {
  const auten = await autenticadorNuevo();
  const reto = retoNuevo();
  const credencial = await autenticarCon(auten, reto, { signCount: 7 });

  const { contadorNuevo } = await verificarAutenticacion({
    credencial,
    retoEsperado: reto,
    rpId: RP_ID,
    origenEsperado: ORIGEN,
    clavePublicaRaw: auten.raw,
    contadorAnterior: 3,
  });

  assert.equal(contadorNuevo, 7);
});

test("[AC-FIDN-13] autenticación: tocar UN byte de la firma la invalida entera", async () => {
  const auten = await autenticadorNuevo();
  const reto = retoNuevo();
  const credencial = await autenticarCon(auten, reto, { signCount: 1 });
  const bytes = deBase64Url(credencial.signature);
  bytes[0] = bytes[0]! ^ 0xff;
  const tocada = { ...credencial, signature: aBase64Url(bytes) };

  await assert.rejects(() =>
    verificarAutenticacion({
      credencial: tocada,
      retoEsperado: reto,
      rpId: RP_ID,
      origenEsperado: ORIGEN,
      clavePublicaRaw: auten.raw,
      contadorAnterior: 0,
    }),
  );
});

test("[AC-FIDN-13] autenticación: firma de OTRA credencial no verifica contra esta clave pública", async () => {
  const auten = await autenticadorNuevo();
  const intruso = await autenticadorNuevo();
  const reto = retoNuevo();
  // Firmado con la privada del intruso, pero presentado como si fuera la credencial de `auten`.
  const credencial = await autenticarCon(auten, reto, { signCount: 1, claveDeFirma: intruso.par.privateKey });

  await assert.rejects(() =>
    verificarAutenticacion({
      credencial,
      retoEsperado: reto,
      rpId: RP_ID,
      origenEsperado: ORIGEN,
      clavePublicaRaw: auten.raw,
      contadorAnterior: 0,
    }),
  );
});

test("[AC-FIDN-13] autenticación: el contador que retrocede rebota — posible clonación", async () => {
  const auten = await autenticadorNuevo();
  const reto = retoNuevo();
  const credencial = await autenticarCon(auten, reto, { signCount: 5 });

  await assert.rejects(() =>
    verificarAutenticacion({
      credencial,
      retoEsperado: reto,
      rpId: RP_ID,
      origenEsperado: ORIGEN,
      clavePublicaRaw: auten.raw,
      contadorAnterior: 10,
    }),
  );
});

test("[AC-FIDN-13] autenticación: un contador fijo en 0 no se trata como clonación", async () => {
  // Varios autenticadores de plataforma dejan el contador en 0 para siempre (spec §6.1.1).
  const auten = await autenticadorNuevo();
  const reto = retoNuevo();
  const credencial = await autenticarCon(auten, reto, { signCount: 0 });

  const { contadorNuevo } = await verificarAutenticacion({
    credencial,
    retoEsperado: reto,
    rpId: RP_ID,
    origenEsperado: ORIGEN,
    clavePublicaRaw: auten.raw,
    contadorAnterior: 0,
  });
  assert.equal(contadorNuevo, 0);
});

// ─── Opciones y reto: forma, no contenido secreto ──────────────────────────────────────

test("[AC-FIDN-13] las opciones de registro llevan alg ES256 y exigen verificación del usuario", () => {
  const opciones = opcionesDeRegistro({
    rpId: RP_ID,
    reto: retoNuevo(),
    usuarioId: "0192f0a0-1234-7000-8000-0000000000aa",
    nombre: "Dueña",
  });
  assert.equal(opciones.pubKeyCredParams[0]!.alg, -7);
  assert.equal(opciones.authenticatorSelection.userVerification, "required");
  assert.equal(opciones.attestation, "none");
  assert.equal(opciones.rp.id, RP_ID);
});

test("[AC-FIDN-13] las opciones de autenticación acotan a la credencial registrada", () => {
  const opciones = opcionesDeAutenticacion({ rpId: RP_ID, reto: retoNuevo(), credentialId: "abc123" });
  assert.deepEqual(opciones.allowCredentials, [{ type: "public-key", id: "abc123" }]);
  assert.equal(opciones.userVerification, "required");
});

test("[AC-FIDN-13] dos retos seguidos no son el mismo", () => {
  const vistos = new Set(Array.from({ length: 200 }, () => retoNuevo()));
  assert.equal(vistos.size, 200);
});
