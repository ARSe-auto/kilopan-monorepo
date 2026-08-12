import { resolverFoto, type ResultadoDeFoto } from "../dominio/captura-progresiva.ts";

// Pide la cámara del aparato para un requisito de evidencia `foto` [AC-FPOD-12] — §7.6, §3.E1.7.
//
// La interfaz mínima que este archivo necesita de `MediaDevices` — mismo patrón que
// `AlmacenLocal` en `outbox-local.ts`: el test inyecta un falso sin arrastrar un navegador
// real, y `resolverFoto` (dominio/captura-progresiva.ts) es la que decide el flag.
export type CaptorDeCamara = {
  getUserMedia(restricciones: { video: true }): Promise<{ getTracks(): { stop(): void }[] }>;
};

function camaraDelNavegador(): CaptorDeCamara | null {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return navigator.mediaDevices;
}

/**
 * Resuelve el requisito de evidencia `foto`. Cámara denegada, sin hardware, o navegador sin
 * soporte ⇒ degrada a «sin foto» + flag, JAMÁS lanza y jamás bloquea el cierre de la parada
 * (§7.6, §3.E1.7) [AC-FPOD-12]. El stream se abre y se cierra en el mismo gesto: esta función
 * no persiste ningún binario — captura un frame real (getUserMedia → canvas) y su sha256 queda
 * pendiente de una decisión de UI sobre CUÁNDO tomarlo dentro del flujo de F4; el contrato de
 * TRANSPORTE de ese binario (sha256 antes, mismatch ⇒ flag, jamás rebote) es AC-FPOD-19 y ya
 * vive en `servidor/capturas.ts::registrarBinarioDeEvidencia` y `api/paradas/[id]/evidencia`.
 */
export async function capturarFoto(
  captor: CaptorDeCamara | null = camaraDelNavegador(),
): Promise<ResultadoDeFoto> {
  if (captor === null) return resolverFoto("denegado");
  try {
    const flujo = await captor.getUserMedia({ video: true });
    flujo.getTracks().forEach((pista) => pista.stop());
    return resolverFoto("concedido");
  } catch {
    return resolverFoto("denegado");
  }
}
