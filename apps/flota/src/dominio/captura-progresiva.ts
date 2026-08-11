// Foto y GPS como mejoras progresivas, jamás dependencias [AC-FPOD-12] — §3.E1.7, §7.6,
// §3.E1.15, §4.2.
//
// ─── EL MISMO PRINCIPIO QUE YA CIERRA EL RESTO DEL MOTOR DE SYNC ──────────────────
//
// El §7.6 lo fija para cualquier sensor de terreno, no solo la cámara: «jamás depender de cámara,
// GPS, barcode... para completar un flujo — mejoras progresivas con degradación a captura
// manual + flag». Este archivo es la función PURA que traduce el permiso del sistema operativo
// al flag que la pantalla necesita mostrar; nunca pide el permiso ni toca `navigator` (eso es
// `cliente/camara.ts` y `cliente/gps.ts`) — la misma separación que `dominio/pod-sync.ts`
// mantiene con el servidor, y por la misma razón: la máquina se prueba sin un navegador real.
//
// ─── LA DIFERENCIA ENTRE CÁMARA Y GPS ──────────────────────────────────────────────
//
// Cámara denegada no tiene aviso propio en el texto del maestro: el requisito de evidencia
// queda satisfecho SIN foto y sigue costando la misma 1 acción, capturada o no (§5.2 F4). GPS
// es distinto: el §7.6 exige que lo bloqueado —la CAPTURA DE COORDENADAS, jamás el POD— se lo
// diga al operario con un aviso visible (Pregunta al dueño #2 de la spec 04, ya resuelta ahí:
// lo bloqueado es la coordenada, nunca el cierre ni el sync). Por eso `resolverGps` separa el
// motivo `permiso_denegado` (el único que dispara el aviso) de `no_disponible` (sin señal o sin
// fix — la mala precisión de la que el §7.6 dice «jamás bloquea»: ni el flujo ni el aviso,
// porque no es una decisión del operario que avisarle le sirva de algo).

export type PermisoDeCaptor = "concedido" | "denegado";

export type FlagDeFoto = "camara_denegada";

export type ResultadoDeFoto = {
  /** Si de verdad se abrió la cámara y quedó un binario que capturar. `false` no bloquea nada
   *  — el requisito de evidencia se marca cumplido igual (§7.6). El binario y su sha256 —cómo
   *  VIAJA la evidencia— son AC-FPOD-19; acá solo se resuelve el PERMISO. */
  hayFoto: boolean;
  flag: FlagDeFoto | null;
};

/** Cámara denegada (o sin hardware, o navegador sin soporte) ⇒ degrada a «sin foto» + flag,
 *  jamás bloquea el cierre de la parada [AC-FPOD-12] — §7.6, §3.E1.7. */
export function resolverFoto(permiso: PermisoDeCaptor): ResultadoDeFoto {
  return permiso === "concedido"
    ? { hayFoto: true, flag: null }
    : { hayFoto: false, flag: "camara_denegada" };
}

/** Por qué esta parada no tiene coordenadas: el operario negó el permiso (dispara el aviso del
 *  §7.6), o el aparato no pudo conseguir una posición (sin señal, sin fix, timeout — la mala
 *  precisión de la que «jamás bloquea» habla, y que tampoco necesita aviso: no es una decisión
 *  del operario). */
export type MotivoSinGps = "permiso_denegado" | "no_disponible";

export type ResultadoDeGps = {
  hayCoordenadas: boolean;
  motivo: MotivoSinGps | null;
  /** Si ESTE resultado tiene que mostrarle un aviso visible al operario. Solo la negación
   *  explícita del permiso lo dispara (§7.6): el resto de las razones para no tener
   *  coordenadas no son una decisión suya, y avisarle de cada una sería ruido sin ninguna
   *  acción posible detrás. */
  avisar: boolean;
};

/** GPS off por defecto (§3.E1.15): esta función solo se invoca cuando la pantalla YA decidió
 *  pedir una lectura puntual al llegar a la parada — jamás hay seguimiento continuo (`watch`),
 *  que es lo que la minimización del 21.719 prohíbe, no una lectura suelta. `motivo === null`
 *  es la lectura concedida y con fix; cualquier otro caso continúa el POD sin coordenadas
 *  (§7.6, Pregunta al dueño #2 de la spec 04) [AC-FPOD-12]. */
export function resolverGps(motivo: MotivoSinGps | null): ResultadoDeGps {
  return { hayCoordenadas: motivo === null, motivo, avisar: motivo === "permiso_denegado" };
}
