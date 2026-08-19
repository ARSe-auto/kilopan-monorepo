// Eco-score v1 sin hardware [AC-FTEL-08] — §11 punto 6, maestro Anexo (etapa E1.5):
// "eficiencia por chofer y semana = consumo DECLARADO vs `km_presupuesto_energia` de sus
// rutas". Sin OBD ni sensor: lo único que la app YA MIDE sin hardware es el odómetro que el
// chofer declara al abrir/cerrar turno (§4.5, `reading`), así que "consumo declarado" es el
// kilometraje recorrido de esas rutas — no Wh, que solo existe para sesiones de RECARGA
// (`energy_entry`) y no se puede prorratear a una ruta concreta sin inventar un reparto.
//
// Función PURA a propósito, mismo criterio que `torre-de-control.ts::antiguedadDePosicion`
// (AC-FTEL-04) y `semaforo-turnos-conductores.ts` (AC-FSEM-08): el servidor arma las filas
// desde la BD real (join `rutas` + `turnos` + `eventos` de `turno.abierto` para saber QUIÉN
// manejó, sin columna `chofer_id` nueva — no existe y agregarla es DDL de sesión supervisada,
// AGENTS.md) y esta función solo agrega, sin abrir conexión ni reloj.
//
// DIVISIÓN POR CERO ⇒ ESTADO VACÍO, LITERAL DEL AC: el denominador es la SUMA de
// `km_presupuesto_energia` de las rutas del chofer esa semana. Sin ninguna ruta con
// presupuesto cargado, no hay contra qué comparar — un score inventado (0% o 100%) mentiría
// sobre datos que no existen. Un chofer que SÍ manejó rutas con presupuesto pero no se movió
// (`kmRecorridos = 0`) no es una división por cero: es un dato real (0% del presupuesto) y se
// muestra como tal.

export type FilaEcoScore = {
  choferId: string;
  choferNombre: string;
  /** Lunes de la semana ISO (yyyy-mm-dd), ya agregada por el servidor. */
  semana: string;
  /** `null` cuando la ruta todavía no tiene presupuesto de energía cargado (§4.5). */
  kmPresupuestoEnergia: number | null;
  kmRecorridos: number;
};

export type EcoScoreDeChofer =
  | { tipo: "vacio"; choferId: string; choferNombre: string; semana: string }
  | {
      tipo: "ok";
      choferId: string;
      choferNombre: string;
      semana: string;
      kmRecorridos: number;
      kmPresupuestoEnergia: number;
      /** % del presupuesto de energía de la semana que el kilometraje declarado consumió.
       *  100 = manejó exactamente lo presupuestado; sin techo — un valor sobre 100 dice que
       *  las rutas de la semana pidieron más rango del que el presupuesto asumía. */
      consumoPct: number;
      rutasConsideradas: number;
    };

type Grupo = {
  choferId: string;
  choferNombre: string;
  semana: string;
  presupuesto: number;
  recorridos: number;
  rutas: number;
};

/**
 * Agrega el eco-score v1 por chofer y por semana [AC-FTEL-08] a partir de las rutas ya
 * resueltas por el servidor. Solo las rutas con `kmPresupuestoEnergia` positivo entran al
 * cálculo — las que aún no lo tienen cargado se descuentan del denominador, jamás se leen
 * como cero (un cero se sumaría como si esa ruta no gastara nada).
 */
export function calcularEcoScoreSemanal(filas: FilaEcoScore[]): EcoScoreDeChofer[] {
  const grupos = new Map<string, Grupo>();

  for (const f of filas) {
    const clave = `${f.choferId}|${f.semana}`;
    const g = grupos.get(clave) ?? {
      choferId: f.choferId,
      choferNombre: f.choferNombre,
      semana: f.semana,
      presupuesto: 0,
      recorridos: 0,
      rutas: 0,
    };
    if (f.kmPresupuestoEnergia !== null && f.kmPresupuestoEnergia > 0) {
      g.presupuesto += f.kmPresupuestoEnergia;
      g.recorridos += f.kmRecorridos;
      g.rutas += 1;
    }
    grupos.set(clave, g);
  }

  return [...grupos.values()].map((g) => {
    if (g.presupuesto <= 0) {
      return { tipo: "vacio", choferId: g.choferId, choferNombre: g.choferNombre, semana: g.semana };
    }
    return {
      tipo: "ok",
      choferId: g.choferId,
      choferNombre: g.choferNombre,
      semana: g.semana,
      kmRecorridos: g.recorridos,
      kmPresupuestoEnergia: g.presupuesto,
      consumoPct: Math.round((g.recorridos / g.presupuesto) * 100),
      rutasConsideradas: g.rutas,
    };
  });
}

/** El aviso literal que la pantalla tiene que mostrar (AC-FTEL-08): qué mide el eco-score y
 *  qué NO. Vive acá, junto al cálculo, para que la pantalla y el test lean la MISMA frase. */
export const AVISO_ECO_SCORE =
  "Eficiencia energética DECLARADA: kilómetros recorridos contra el presupuesto de energía " +
  "de sus rutas. NO es una medición de manejo en tiempo real — no hay sensor a bordo.";
