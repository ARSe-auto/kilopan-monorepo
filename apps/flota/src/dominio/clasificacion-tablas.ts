// La frontera de clases del motor de sync [AC-FPOD-20] — §4.2: toda tabla del esquema declara,
// por `COMMENT ON TABLE`, si es PLANIFICACIÓN (valida online, rebota 422 con error tipado) o
// CAPTURA (2xx SIEMPRE, degrada a flag). El linter estático de `db/flota/lint-migraciones.mjs`
// exige ese comentario en cada migración; esta función es su gemela en RUNTIME — traduce el
// mismo texto, ya leído de la BD viva por `servidor/clasificacion-tablas.ts`, a la clase que
// declara.

export type ClaseTabla = "PLANIFICACION" | "CAPTURA";

const PREFIJOS: Record<ClaseTabla, string> = {
  PLANIFICACION: "PLANIFICACIÓN",
  CAPTURA: "CAPTURA",
};

/** `null` cuando el comentario está ausente o no empieza con ninguno de los dos prefijos: una
 *  tabla sin clase declarada NUNCA se trata como CAPTURA por omisión — el motor solo confía en
 *  lo que la migración dejó dicho explícito [AC-FPOD-20]. */
export function clasificacionDesdeComentario(comentario: string | null): ClaseTabla | null {
  if (!comentario) return null;
  const mayusculas = comentario.toUpperCase();
  if (mayusculas.startsWith(PREFIJOS.PLANIFICACION)) return "PLANIFICACION";
  if (mayusculas.startsWith(PREFIJOS.CAPTURA)) return "CAPTURA";
  return null;
}
