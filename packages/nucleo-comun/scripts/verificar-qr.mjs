#!/usr/bin/env node
// Verificación del codificador de QR contra el decodificador del SISTEMA [AC-FIDN-02].
//
// Codifica una batería de textos —uno por cada versión que el codificador soporta, más los
// bordes—, los escribe como PNG y se los da a `verificar-qr.swift`, que los lee con Vision.
// Si lo leído coincide con lo pedido, las tablas de bloques por versión son correctas: eso es
// lo único que los oráculos matemáticos del test no pueden probar.
//
// A MANO, no en el gate: necesita macOS. Correr al tocar una tabla de `src/qr.ts`.
//   node packages/nucleo-comun/scripts/verificar-qr.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { matrizQr, versionPara, VERSIONES, capacidadDeDatos } from "../src/qr.ts";

const crc = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = tabla[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const suma = Buffer.alloc(4);
  suma.writeUInt32BE(crc(cuerpo));
  return Buffer.concat([largo, cuerpo, suma]);
}

/** PNG en escala de grises, sin dependencias: `zlib` viene con Node. */
function png(matriz, escala = 8, quiet = 4) {
  const lado = (matriz.length + quiet * 2) * escala;
  const filas = [];
  for (let y = 0; y < lado; y++) {
    const fila = Buffer.alloc(lado + 1);
    fila[0] = 0;
    for (let x = 0; x < lado; x++) {
      const f = Math.floor(y / escala) - quiet;
      const c = Math.floor(x / escala) - quiet;
      const oscuro = f >= 0 && c >= 0 && f < matriz.length && c < matriz.length && matriz[f][c] === 1;
      fila[x + 1] = oscuro ? 0 : 255;
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por muestra
  ihdr[9] = 0; // escala de grises
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", deflateSync(Buffer.concat(filas))),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

const dir = mkdtempSync(join(tmpdir(), "qr-"));
const casos = [];
// Uno por versión: se arma el texto más largo que entra en cada una, para ejercer TODAS las
// tablas de bloques. Un caso corto solo probaría la versión 1.
for (const v of VERSIONES) {
  const tope = capacidadDeDatos(v) - 2;
  const anterior = VERSIONES.find((x) => x.version === v.version - 1);
  const piso = anterior ? capacidadDeDatos(anterior) - 2 + 1 : 1;
  casos.push("https://rutapan.flota.cl/solicitar?codigo=".padEnd(tope, "X").slice(0, tope));
  if (piso < tope) casos.push("A".repeat(piso));
}
casos.push("https://rutapan.flota.cl/solicitar?codigo=7K9M2QRS");
casos.push("á é í ó ú ñ — acentos en UTF-8");

let fallos = 0;
for (const [i, texto] of casos.entries()) {
  const v = versionPara(texto);
  const archivo = join(dir, `caso-${i}.png`);
  writeFileSync(archivo, png(matrizQr(texto)));
  let leido;
  try {
    leido = execFileSync("swift", [new URL("verificar-qr.swift", import.meta.url).pathname, archivo], {
      encoding: "utf8",
    }).trim();
  } catch (e) {
    leido = `FALLO (${(e.stdout ?? "").trim() || e.message})`;
  }
  const ok = leido === texto;
  if (!ok) fallos++;
  console.log(
    `${ok ? "OK  " : "ROJO"} v${v?.version ?? "?"} · ${texto.length} bytes · ` +
      (ok ? "leído idéntico" : `leído «${leido.slice(0, 60)}»`),
  );
}
console.log(`\nverificar-qr: ${casos.length - fallos}/${casos.length} leídos por el decodificador del sistema`);
process.exit(fallos > 0 ? 1 : 0);
