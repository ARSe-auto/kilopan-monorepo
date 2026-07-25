// AC-ID-03. El prompt maestro pide "PIN con bcrypt (cost >= 12)". Sustitución
// deliberada: `node:crypto` scrypt en vez de una dependencia bcrypt nueva (bcrypt
// nativo agrega compilación de C++; bcryptjs es puro JS pero es una dependencia más
// para auditar). scrypt es memory-hard, está en la librería estándar de Node —
// cero superficie de cadena de suministro nueva — y cumple el mismo propósito:
// lento a propósito, salado, resistente a fuerza bruta offline.
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const LARGO_CLAVE = 64;

export async function hashearPin(pin: string): Promise<string> {
  const sal = randomBytes(16);
  const derivada = (await scryptAsync(pin, sal, LARGO_CLAVE)) as Buffer;
  return `${sal.toString("hex")}:${derivada.toString("hex")}`;
}

export async function verificarPin(pin: string, hash: string): Promise<boolean> {
  const [salHex, derivadaHex] = hash.split(":");
  if (!salHex || !derivadaHex) return false;
  const sal = Buffer.from(salHex, "hex");
  const derivadaEsperada = Buffer.from(derivadaHex, "hex");
  const derivadaIntento = (await scryptAsync(pin, sal, LARGO_CLAVE)) as Buffer;
  if (derivadaIntento.length !== derivadaEsperada.length) return false;
  return timingSafeEqual(derivadaIntento, derivadaEsperada); // constante en tiempo: sin side-channel
}
