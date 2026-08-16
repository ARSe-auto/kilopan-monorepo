import { createHash, randomInt } from "node:crypto";
import { INVITACION } from "../../../../packages/nucleo-comun/src/constants.ts";

// La invitación de enrolamiento [AC-FIDN-03] — §4.3, §5.4 F-A/F-B.
//
// LO QUE UNA INVITACIÓN ES, y es la mitad del AC: un derecho a SOLICITAR, jamás a entrar.
// Quien tiene el código no obtiene sesión ni secreto de dispositivo; obtiene una fila
// `pendiente` y la pantalla «Esperando aprobación». El secreto lo emite la aprobación del
// dueño (AC-FIDN-04) contra la clave pública del aparato, y ahí recién arranca la sesión.
//
// UNA credencial en TRES envoltorios (decisión declarada). El §5.4 pide QR, link firmado y
// código corto de respaldo, y la salida cómoda sería tres secretos distintos —tres cosas que
// revocar, tres que expirar, tres que se pueden desincronizar—. Acá el código corto ES la
// credencial: el link lo lleva como parámetro y el QR codifica el link. Lo «firmado» del
// maestro lo da el propio código: 8 caracteres del alfabeto del §0 son del orden de 10^12
// combinaciones, en la BD queda solo su SHA-256, y el servidor verifica hasheando lo que
// recibe. Un atacante no puede fabricar uno válido ni leerlo de la base, que es exactamente
// lo que una firma daría — con una sola cosa que revocar.
//
// Lo que NO está acá: emitir, pausar y revocar desde el panel del dueño necesitan sesión de
// `admin_tenant`, que nace con AC-FIDN-04. Las operaciones existen como funciones de dominio
// con su prueba contra la BD; sus endpoints y su presupuesto de toques son de AC-FIDN-02.

// El alfabeto, el largo y la normalización viven en `codigo-corto.ts`, que es PURO y por eso
// lo puede importar la pantalla del teléfono. Se reexportan para que quien ya los pedía acá no
// tenga que cambiar de puerta, y para que siga habiendo UNA sola implementación.
export { normalizarCodigo } from "./codigo-corto.ts";
import { ALFABETO, LARGO } from "./codigo-corto.ts";

/**
 * Un código nuevo. `randomInt` y no `Math.random()` ni un módulo sobre bytes: el primero es
 * predecible y el segundo sesga el alfabeto —31 no divide a 256— y le regala entropía al que
 * quiera adivinar. `randomInt` es criptográfico y uniforme por construcción.
 */
export function codigoNuevo(): string {
  let codigo = "";
  for (let i = 0; i < LARGO; i++) codigo += ALFABETO[randomInt(ALFABETO.length)];
  return codigo;
}

/** En la BD queda solo el hash: la invitación no se puede leer de la base y reusar. */
export function hashDeCodigo(codigo: string): string {
  return createHash("sha256").update(codigo, "utf8").digest("hex");
}

/** Cuándo expira una invitación emitida ahora. El plazo es del §0, no de este archivo. */
export function expiraEn(desde: Date): Date {
  return new Date(desde.getTime() + INVITACION.expira_dias * 24 * 60 * 60 * 1000);
}

export type Invitacion = {
  expira_at: Date;
  pausada_at: Date | null;
  revocada_at: Date | null;
};

/**
 * Los cuatro desenlaces posibles. Son distinguibles A PROPÓSITO —el AC pide 422 tipados— y
 * eso no filtra nada: para llegar a cualquiera de ellos hay que TENER el código, y quien lo
 * tiene merece saber por qué no funciona en vez de mirar un error genérico a las 6am.
 *
 * El orden importa: revocada gana sobre pausada y sobre expirada. Revocar es el acto
 * deliberado del dueño y tiene efecto inmediato (§5.4 F-F); si una revocada vencida dijera
 * «expiró», el dueño no podría distinguir su propia acción de que se le pasó la fecha.
 */
export type VeredictoInvitacion = "vigente" | "revocada" | "pausada" | "expirada";

export function veredictoDe(inv: Invitacion, ahora: Date): VeredictoInvitacion {
  if (inv.revocada_at !== null) return "revocada";
  if (inv.pausada_at !== null) return "pausada";
  // `<=` y no `<`: el instante exacto del vencimiento ya está vencido. Con `<`, el plazo del
  // §0 valdría un milisegundo de más, y el borde es el único lugar donde alguien va a mirar.
  if (inv.expira_at.getTime() <= ahora.getTime()) return "expirada";
  return "vigente";
}

/**
 * La pausa NO mueve la fecha de vencimiento (§5.4). Reanudar tampoco: una invitación pausada
 * el día 6 y reanudada el día 9 está vencida, y eso es lo correcto — el plazo lo puso el
 * dueño para acotar la ventana, no para contar tiempo de uso. Esta función existe para que
 * la regla tenga un lugar donde probarse y no viva solo en una consulta suelta.
 */
export function reanudar(inv: Invitacion): Invitacion {
  return { ...inv, pausada_at: null };
}

export function pausar(inv: Invitacion, ahora: Date): Invitacion {
  return { ...inv, pausada_at: inv.pausada_at ?? ahora };
}
