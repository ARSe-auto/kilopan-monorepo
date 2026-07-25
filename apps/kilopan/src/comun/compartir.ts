"use client";
// AC-SHARE-01 (decisión #9): la hoja de compartir NATIVA del teléfono. No es una
// integración con WhatsApp: KiloPan no guarda ningún número ni manda nada por su
// cuenta. Es el mismo panel que el teléfono usa para compartir una foto de la
// galería — por eso no toca el límite de "cero notificaciones, cero correo saliente".

export interface ContenidoCompartible {
  titulo: string;
  texto: string;
  archivo?: { blob: Blob; nombre: string };
}

export function sePuedeCompartir(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** Devuelve true si se compartió, false si el usuario canceló o no se pudo.
 *  Mejora progresiva, mismo criterio que el escaneo del TED: si el teléfono no
 *  soporta compartir ARCHIVOS, comparte el texto igual en vez de fallar. */
export async function compartir(contenido: ContenidoCompartible): Promise<boolean> {
  if (!sePuedeCompartir()) return false;

  if (contenido.archivo) {
    const archivo = new File([contenido.archivo.blob], contenido.archivo.nombre, {
      type: contenido.archivo.blob.type || "image/jpeg",
    });
    const conArchivo = { title: contenido.titulo, text: contenido.texto, files: [archivo] };
    if (!navigator.canShare || navigator.canShare(conArchivo)) {
      try {
        await navigator.share(conArchivo);
        return true;
      } catch {
        return false; // el usuario canceló: no es un error que haya que mostrar
      }
    }
  }

  try {
    await navigator.share({ title: contenido.titulo, text: contenido.texto });
    return true;
  } catch {
    return false;
  }
}
