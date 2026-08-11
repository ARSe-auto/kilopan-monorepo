import { colaAlArrancar } from "../dominio/outbox-undo.ts";
import {
  leerOutbox,
  guardarOutbox,
  listarIdentidadesConOutbox,
  type AlmacenLocal,
  type Identidad,
} from "./outbox-local.ts";
import { replayar, type Enviar } from "./outbox.ts";

// El replay de las identidades AJENAS del outbox [AC-FPOD-09] — §4.7 (centinela 9), §4.2.
//
// ─── LA FRASE QUE HACE ESTE ARCHIVO NECESARIO ─────────────────────────────────────
//
// El §4.7 no dice «las capturas de A se replayean cuando A vuelva a estar activo»: dice que se
// replayean «AUNQUE B esté autenticado». `outbox-local.ts` ya garantiza que particionar la llave
// impide que B pise el outbox de A, pero eso por sí solo deja el outbox de A guardado para
// SIEMPRE si nadie, estando B autenticado, lo manda. Sin este archivo, «jamás se purga» se
// cumpliría de la peor forma posible: un cementerio de capturas que nunca llegan al servidor.
//
// ─── POR QUÉ NO SE MEZCLA CON `recorrido.cola` DE LA PANTALLA ─────────────────────
//
// La cola visible de `TarjetaDeEntrega` es la ruta de LA IDENTIDAD ACTIVA: sus `parada_id`
// pertenecen a la ruta que esa persona está caminando ahora. Cargar ahí el outbox de A metería
// paradas de una ruta ajena en el contador «7 de 23» de B — un bug de UI, no una corrección. Este
// archivo manda el lote ajeno directo al servidor, en silencio, sin tocar el estado de React: el
// operario actual nunca se entera de que el aparato también vació una cola que no es suya.
//
// ─── CON QUÉ CREDENCIAL VIAJA ──────────────────────────────────────────────────────
//
// Con la del aparato, que es la de quien esté autenticado AHORA (`cliente/aparato.ts::pedir`,
// §4.3: «la sesión ES el aparato»). El servidor no tiene ninguna noción de «actor original de
// esta captura» distinta de la sesión que la manda —ver `servidor/capturas.ts`—, así que el hecho
// aterriza atribuido a quien lo sincronizó. Lo que este AC exige y prueba (centinela 9) es que
// las 3 filas de A EXISTAN tras la sincronización, no de qué sesión salió el request que las
// llevó: perderlas por quedarse esperando a que A vuelva a este aparato sería el defecto real.

function mismaIdentidad(a: Identidad, b: Identidad): boolean {
  return a.tenant === b.tenant && a.usuario === b.usuario;
}

/**
 * Vacía, sin bloquear ni mostrar nada, el outbox de toda identidad DISTINTA de la activa.
 *
 * Cada partición se procesa de forma independiente: la que falla —sin señal, o el servidor no
 * contesta— deja su cola intacta para el próximo intento (mismo criterio de `replayar`, §5.7:
 * cero rechazo a la vista, acá ni siquiera hay a quién mostrárselo). La propia identidad activa
 * se salta a propósito: esa la vacía el efecto de replay normal de la pantalla, que además
 * necesita mover `recorrido.cola` en React.
 */
export async function vaciarOutboxAjeno(
  almacen: AlmacenLocal,
  activa: Identidad | null,
  enviar: Enviar,
): Promise<void> {
  for (const identidad of listarIdentidadesConOutbox(almacen)) {
    if (activa !== null && mismaIdentidad(identidad, activa)) continue;

    const cola = colaAlArrancar(leerOutbox(almacen, identidad));
    if (cola.length === 0) continue;

    const confirmadas = await replayar(cola, enviar);
    if (confirmadas.length === 0) continue;

    const restante = cola.filter((c) => !confirmadas.includes(c.clientUuid));
    guardarOutbox(almacen, identidad, restante);
  }
}
