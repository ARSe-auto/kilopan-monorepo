import type { Pool } from "pg";
import { enActo, registrarEvento, EVENTOS_OPERACION, offsetChileMin } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// El cierre de una sesión de recarga [AC-FVEH-08] — §3.E1.4, §4.6, §4.8, §9.3 centinela 10.
//
// ─── NO REBOTA, PORQUE EL VEHÍCULO YA SE CARGÓ ──────────────────────────────────────
//
// Es CAPTURA (§4.2). Negarle la fila al chofer no descarga la batería: lo único que hace es
// perder el registro de una energía que sí se consumió, y con él la mitad del reporte de
// ahorro vs diésel del Anexo A.
//
// ─── EL COSTO NO PASA POR ACÁ ───────────────────────────────────────────────────────
//
// `costo_clp` no está en el cuerpo que este módulo acepta, y no es un olvido: el §4.8 dice que
// el flujo del chofer no tiene campos monetarios. Lo completa el trigger de la 0027 desde
// `parametros.tarifa_kwh_clp`, dentro de la misma transacción. Si el cálculo viviera acá, el
// servidor tendría que LEER la tarifa en nombre del chofer — y esa lectura es exactamente la
// que la RLS del centinela 10 le niega.

export type RecargaEntrante = {
  vehiculoId: string;
  turnoId: string | null;
  wh: number;
  socInicial: number | null;
  socFinal: number | null;
  clientUuid: string | null;
  tsDispositivo: Date;
  tzOffsetMin: number | null;
};

export type RecargaRegistrada = { id: string; wh: number; repetida: boolean };

export type ResultadoRecarga =
  | { tipo: "ok"; recarga: RecargaRegistrada }
  | { tipo: "vehiculo_no_existe" }
  | { tipo: "energia_invalida" };

export async function cerrarSesionDeRecarga(
  pool: Pool,
  sesion: Sesion,
  entrante: RecargaEntrante,
): Promise<ResultadoRecarga> {
  // Lo único que rebota es una llamada que no se puede interpretar: sin energía no hay sesión
  // de recarga que registrar. No es degradar un dato del terreno, es un cuerpo mal formado.
  if (!Number.isInteger(entrante.wh) || entrante.wh <= 0) return { tipo: "energia_invalida" };

  return enActo(pool, async (c) => {
    const { rows: vehiculo } = await c.query("select 1 from vehiculos where id = $1", [
      entrante.vehiculoId,
    ]);
    if (vehiculo.length === 0) return { tipo: "vehiculo_no_existe" };

    // El upsert va por `registrar_recarga`, que es SECURITY DEFINER, y no por un
    // `insert … on conflict` desde acá: la RLS del §4.8 le niega al chofer el SELECT que el
    // ON CONFLICT necesita para resolver el replay, y su captura JAMÁS puede rebotar (§4.2).
    // No es teórico — se descubrió corriendo la suite con el rol de app real.
    const { rows } = await c.query<{ id: string; repetida: boolean }>(
      "select id::text as id, repetida from registrar_recarga($1, $2, $3, $4::smallint, $5::smallint, $6, $7, $8)",
      [
        entrante.vehiculoId,
        entrante.turnoId,
        entrante.wh,
        entrante.socInicial,
        entrante.socFinal,
        entrante.tsDispositivo,
        entrante.tzOffsetMin ?? offsetChileMin(entrante.tsDispositivo),
        entrante.clientUuid,
      ],
    );
    const fila = rows[0]!;

    if (fila.repetida) {
      // Replay del outbox: sin evento nuevo — un segundo aviso haría creer que el vehículo se
      // cargó dos veces, y el ahorro vs diésel contaría el doble.
      return { tipo: "ok", recarga: { id: fila.id, wh: entrante.wh, repetida: true } };
    }

    await registrarEvento(c, {
      codigo: EVENTOS_OPERACION.energia_sesion_cerrada,
      objetoTabla: "energy_entry",
      objetoId: fila.id,
      sesion,
      // Ni un peso en el payload: `eventos` es append-only y lo lee cualquiera con acceso al
      // panel de auditoría, así que un monto acá sería un monto que la RLS ya no puede esconder.
      payload: { vehiculo_id: entrante.vehiculoId, wh: entrante.wh },
    });
    return { tipo: "ok", recarga: { id: fila.id, wh: entrante.wh, repetida: false } };
  });
}
