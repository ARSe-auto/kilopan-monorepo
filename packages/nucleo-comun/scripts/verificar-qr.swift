// Decodificador INDEPENDIENTE para verificar `src/qr.ts` [AC-FIDN-02].
//
// Un QR mal codificado se ve igual que uno bueno, y los oráculos matemáticos del test
// (Reed-Solomon divisible, distancia mínima del BCH, el zigzag como permutación) no alcanzan
// para las tablas de bloques por versión, que son datos de la norma y no se derivan. Esto lee
// el QR con el decodificador del SISTEMA — código que no escribimos nosotros — y devuelve lo
// que leyó. Si coincide con lo que se pidió codificar, las tablas son correctas.
//
// NO está en el gate a propósito: necesita macOS, y un paso que solo corre en una máquina es
// un paso que en otra queda saltado. Se corre a mano al tocar una tabla:
//   node packages/nucleo-comun/scripts/verificar-qr.mjs
import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
  FileHandle.standardError.write("uso: swift verificar-qr.swift <archivo.png>\n".data(using: .utf8)!)
  exit(2)
}
let ruta = CommandLine.arguments[1]
guard let imagen = NSImage(contentsOfFile: ruta),
      let cg = imagen.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  print("SIN_IMAGEN")
  exit(2)
}
let peticion = VNDetectBarcodesRequest()
peticion.symbologies = [.qr]
do {
  try VNImageRequestHandler(cgImage: cg, options: [:]).perform([peticion])
} catch {
  print("ERROR_VISION")
  exit(2)
}
let leidos = (peticion.results ?? []).compactMap { $0.payloadStringValue }
if leidos.isEmpty {
  print("SIN_LECTURA")
  exit(1)
}
for texto in leidos { print(texto) }
