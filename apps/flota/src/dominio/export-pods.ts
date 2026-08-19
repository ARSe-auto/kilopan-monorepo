// Export de PODs por rango [AC-FTEL-07] — §11: rango + empresa ⇒ CSV es-CL para que el
// gestor reconstruya qué se entregó, qué quedó parcial y qué se devolvió sin pedirle el dato
// a quien tiene acceso directo a la BD.
//
// Grano = `items` (0037): es la fila donde el §4.5 ya declara `qty_planificada`/
// `qty_entregada`/`qty_rechazada` por encargo dentro de una parada, la unidad exacta que el AC
// pide como «resultado por ítem». La evidencia es de la PARADA (`evidence.objeto_tabla =
// 'paradas'`, AC-FPOD-19) y no del ítem — una parada agrupa ítems de N encargos de la MISMA
// empresa (§3.E1.5) y comparten la misma foto/firma — así que el servidor toma la más reciente
// como referencia de esa entrega.

export type ResultadoDeItem = "pendiente" | "exito" | "parcial" | "fallo";

/**
 * El resultado del ítem con el MISMO vocabulario que `parada_resultado` (0037), en vez de uno
 * inventado para el CSV: `exito` es todo lo planificado entregado, `fallo` es cero entregado
 * (la devolución completa) y `parcial` es lo que quedó entre medio — las «parciales y
 * devoluciones» que pide el AC. `pendiente` es la parada que el terreno todavía no cerró:
 * `qty_entregada` nace NULL y NULL no es cero (0037), así que un cero acá mentiría diciendo
 * «se entregó nada» sobre una parada que ni siquiera se visitó.
 */
export function resultadoDeItem(qtyPlanificada: number, qtyEntregada: number | null): ResultadoDeItem {
  if (qtyEntregada === null) return "pendiente";
  if (qtyEntregada <= 0) return "fallo";
  if (qtyEntregada >= qtyPlanificada) return "exito";
  return "parcial";
}

export type FilaExportPod = {
  fecha_servicio: string; // `YYYY-MM-DD`, tal como sale de `rutas.fecha_servicio`
  empresa: string;
  encargo_id: string;
  destino: string;
  bultos_planificados: number;
  bultos_entregados: number | null;
  bultos_rechazados: number | null;
  evidencia_tipo: string | null;
  evidencia_sha256: string | null; // hex, o `null` cuando la captura no llevó binario (§4.6)
};

/**
 * `YYYY-MM-DD` (columna `date` de Postgres) a `dd-mm-aaaa` (§0), por SPLIT DE TEXTO y nunca
 * por `Date` + huso: una fecha-calendario no tiene hora, y pasarla por `fechaEsCl` —que
 * formatea con `timeZone: America/Santiago`— interpretaría la medianoche UTC del `Date`
 * construido y la correría un día hacia atrás. Acá no hay huso que resolver: el dato ya es el
 * día exacto que el servidor guardó.
 */
export function fechaCalendarioEsCl(iso: string): string {
  const [aaaa, mm, dd] = iso.split("-");
  return `${dd}-${mm}-${aaaa}`;
}

const SEPARADOR = ";";

const ENCABEZADO = [
  "fecha",
  "empresa",
  "encargo_id",
  "destino",
  "bultos_planificados",
  "bultos_entregados",
  "bultos_rechazados",
  "resultado_item",
  "evidencia_tipo",
  "evidencia_sha256",
  "temperatura",
].join(SEPARADOR);

/**
 * Escapa una celda para CSV es-CL: comillas dobles si trae el separador, una comilla o un
 * salto de línea — el mismo criterio RFC 4180 que cualquier planilla espera al abrir el
 * archivo, solo que con `;` como separador en vez de `,` (§0: en Chile la coma es el decimal
 * de un número, así que el separador de columnas tiene que ser otro carácter).
 */
function celda(valor: string | number | null): string {
  if (valor === null) return "";
  const texto = String(valor);
  if (texto.includes(SEPARADOR) || texto.includes('"') || texto.includes("\n")) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/**
 * El CSV completo [AC-FTEL-07], con la columna `temperatura` SIEMPRE vacía (§11 punto 4): el
 * día que llegue el sensor de frío (AC-FTEL-09, condicionado a hardware), este export no
 * cambia de forma — solo empieza a traer datos en una columna que ya existe.
 */
export function filasACsv(filas: FilaExportPod[]): string {
  const lineas = filas.map((f) => {
    const resultado = resultadoDeItem(f.bultos_planificados, f.bultos_entregados);
    return [
      fechaCalendarioEsCl(f.fecha_servicio),
      celda(f.empresa),
      f.encargo_id,
      celda(f.destino),
      f.bultos_planificados,
      f.bultos_entregados,
      f.bultos_rechazados,
      resultado,
      celda(f.evidencia_tipo),
      celda(f.evidencia_sha256),
      "",
    ].join(SEPARADOR);
  });
  return [ENCABEZADO, ...lineas].join("\n");
}
