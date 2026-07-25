"use client";
// Obturador + compresión (AC-PERF-02). La cámara se abre SOLO por getUserMedia
// in-app: nunca un <input type=file> a la galería, porque eso permitiría adjuntar una
// foto vieja como si fuera de la entrega de ahora (PROMPT_MAESTRO.md §7).

export interface CapturaFoto {
  blob: Blob;
  sha256: string;
  bytes: number;
}

const ANCHO_MAX = 1280;
const CALIDAD = 0.72; // objetivo ≈400 KB sin perder legibilidad para auditoría

export async function abrirCamara(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1920 } },
    audio: false,
  });
}

/** Toma el cuadro actual del stream, lo comprime y devuelve blob + sha256.
 *  El sha256 se calcula sobre el BLOB YA COMPRIMIDO — es el que viaja en el POD y el
 *  que el servidor recalcula al recibir la imagen. */
export async function capturar(video: HTMLVideoElement): Promise<CapturaFoto> {
  const escala = Math.min(1, ANCHO_MAX / (video.videoWidth || ANCHO_MAX));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((video.videoWidth || ANCHO_MAX) * escala);
  canvas.height = Math.round((video.videoHeight || 720) * escala);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar la imagen");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolver, rechazar) => {
    canvas.toBlob(
      (b) => (b ? resolver(b) : rechazar(new Error("No se pudo comprimir la foto"))),
      "image/jpeg",
      CALIDAD
    );
  });

  const buffer = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { blob, sha256, bytes: blob.size };
}

export function cerrarCamara(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Sube la foto. Si falla (sin señal), NO se pierde: el POD ya viaja con su sha256 y
 *  la entrega queda 'pendiente_subida' hasta que el reintento la complete. */
export async function subirFoto(captura: CapturaFoto): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("foto", captura.blob, `${captura.sha256}.jpg`);
    form.append("sha256", captura.sha256);
    const r = await fetch("/api/fotos", { method: "POST", body: form });
    return r.ok;
  } catch {
    return false;
  }
}
