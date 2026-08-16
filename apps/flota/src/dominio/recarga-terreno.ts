// El cierre de una sesión de recarga, capturado por el MISMO outbox que el POD [AC-FPOD-13] —
// §4.2, §4.6, §4.7, §4.8, §5.2 F4, §9.3 centinela 10.
//
// ─── DOS ACCIONES, COMO EL RESTO DE F4 ────────────────────────────────────────────
//
// El §5.2 F4 lo fija así: «Iniciar carga» (1 toque, sin tipeo — el vehículo ya se enchufó, no
// hay nada que preguntar todavía) y, al terminar, «SOC fin + confirmar». `iniciarCarga` no
// necesita máquina: es un booleano que pasa a `true`. Lo único que vale la pena probar sin
// navegador es `cerrarCarga`, que es donde el dato del teclado se convierte en la captura que
// el outbox va a guardar y replayear.
//
// ─── POR QUÉ `costo_clp` NI SIQUIERA EXISTE ACÁ (§4.8, centinela 10) ──────────────
//
// El chofer jamás manda un monto: `CapturaDeRecarga` no tiene el campo, ni con `null`. El
// costo lo completa `costo_de_energia()` (0027_energy_entry.sql) desde `parametros.
// tarifa_kwh_clp`, DENTRO de la transacción que aterriza esta captura — nunca en el cliente,
// que ni siquiera podría leer la tarifa (la RLS del §4.8 se lo niega).
//
// ─── Wh ENTEROS, NUNCA kWh DECIMALES (§0) ─────────────────────────────────────────
//
// El teclado propio del chofer teclea kWh (con coma decimal, como cualquier boleta de
// electrolinera); `whDesdeKwh` es la única conversión a los Wh enteros que `energy_entry.wh`
// exige, para que no haya dos lugares redondeando distinto.

/** Una sesión de recarga en curso, del lado del terreno. `vehiculoId`/`turnoId` los trae la
 *  parada tipo `recarga` (AC-FRUT-18): el chofer no los teclea. */
export type SesionDeCarga = {
  vehiculoId: string;
  turnoId: string | null;
  iniciada: boolean;
};

/** Acción 1 de 2: «Iniciar carga», UN toque, cero tipeo. No hay nada que validar —el vehículo ya
 *  está enchufado— así que no hay rama que rechace este paso. */
export function iniciarCarga(vehiculoId: string, turnoId: string | null): SesionDeCarga {
  return { vehiculoId, turnoId, iniciada: true };
}

/** El sello del dispositivo en el momento del cierre — mismo patrón que `pod-terreno.ts`: lo
 *  pone quien llama, para que la función siga siendo pura y el test pueda fijar el reloj. */
export type SelloDeCarga = {
  clientUuid: string;
  tsDispositivo: string;
  tzOffsetMin: number;
};

/** La captura de un cierre de recarga, tal como el outbox la guarda y replayea (§0, §4.6, §4.8).
 *  Sin `costo_clp`: el flujo del chofer no lo tiene, ni siquiera como `null` explícito. */
export type CapturaDeRecarga = {
  clientUuid: string;
  vehiculoId: string;
  turnoId: string | null;
  /** Energía en Wh ENTEROS (§0) — ya convertida desde los kWh del teclado. */
  wh: number;
  /** El chofer no lo teclea al iniciar (§5.2 F4: «Iniciar carga» es UN toque, sin tipeo); queda
   *  `null` hasta que exista una fuente para llenarlo sin costarle una acción más. */
  socInicial: null;
  socFinal: number | null;
  tsDispositivo: string;
  tzOffsetMin: number;
  estado: "por_replicar";
};

/** Convierte los kWh que teclea el chofer a los Wh enteros que `energy_entry.wh` exige (§0): la
 *  mitad de los errores de energía son de factor mil, y acá se resuelve UNA sola vez. */
export function whDesdeKwh(kwh: number): number {
  return Math.round(kwh * 1000);
}

/**
 * Acción 2 de 2: «SOC fin + confirmar». Devuelve `null` —y no cierra nada— si la sesión no
 * estaba iniciada, si la energía no es un dato interpretable (§4.2: la validación bloqueante
 * corre en el CLIENTE, antes de que la captura exista) o si el SOC fin viene fuera de rango.
 * Ninguna de estas ramas es «rebote del servidor»: son la pantalla negándose a fabricar una
 * captura de un toque que no pasó.
 */
export function cerrarCarga(
  sesion: SesionDeCarga,
  datos: { kwh: number; socFinal: number | null },
  sello: SelloDeCarga,
): CapturaDeRecarga | null {
  if (!sesion.iniciada) return null;
  if (!Number.isFinite(datos.kwh) || datos.kwh <= 0) return null;
  if (datos.socFinal !== null && (!Number.isInteger(datos.socFinal) || datos.socFinal < 0 || datos.socFinal > 100)) {
    return null;
  }
  const wh = whDesdeKwh(datos.kwh);
  if (wh <= 0) return null;

  return {
    clientUuid: sello.clientUuid,
    vehiculoId: sesion.vehiculoId,
    turnoId: sesion.turnoId,
    wh,
    socInicial: null,
    socFinal: datos.socFinal,
    tsDispositivo: sello.tsDispositivo,
    tzOffsetMin: sello.tzOffsetMin,
    estado: "por_replicar",
  };
}
