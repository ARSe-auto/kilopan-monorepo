import { notFound } from "next/navigation";
import { tipografia } from "@kilopan/miga/tokens.ts";
import { seedA, seedC, detalleExtraDeExcepcion } from "../../../dominio/semaforo-fixtures.ts";
import { filasPeekDeDominio } from "../../../dominio/peek-n1.ts";
import { construirDetalleN2 } from "../../../dominio/detalle-n2.ts";
import { DetalleN2Vista } from "./detalle-n2-vista.tsx";

// Detalle N2 [AC-FSEM-05] — spec 05 §2.3.
//
// El `id` viaja como parámetro de CONSULTA (`?id=`) y no de ruta (`/excepciones/[id]`) a
// propósito, mismo criterio que `/api/agenda` (AC-FVEH-07): mientras el digest real de
// AC-FSEM-06/09 no exista, este `id` es literal de las semillas de `semaforo-fixtures.ts`
// —no un identificador de fila de otro tenant—, así que declarar la ruta `recurso` (§9.2,
// `rutas/manifiesto.json`) exigiría un 404-jamás-403 contra una tabla que esta pantalla no
// consulta todavía. Como parámetro de consulta, el manifiesto la ve `sin_recurso`: el caso
// que sí aplica es que la identidad de otro tenant inyectada por cabecera no cambie la
// respuesta, y esta pantalla no abre ninguna BD de tenant para violarlo.
//
// SÍ es deep-linkeable (§2.3): la URL `/hoy/excepciones?id=<id>&seed=<a|c>` es estable y
// entera — abrirla directo rinde el mismo detalle, sin pasar por el peek.
export default async function ExcepcionDetalleN2({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; seed?: string }>;
}) {
  const { id, seed } = await searchParams;
  if (!id) notFound();

  const seedUsada = seed === "c" ? "c" : "a";
  const estados = seedUsada === "c" ? seedC() : seedA();
  const fila = estados.flatMap((estado) => filasPeekDeDominio(estado)).find((f) => f.id === id);
  if (!fila) notFound();

  const extra = detalleExtraDeExcepcion[id] ?? { timeline: [], evidencia: {} };
  const detalle = construirDetalleN2(fila, extra.timeline, extra.evidencia);

  return (
    <main>
      <h1 style={{ fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 }}>
        Excepción
      </h1>
      <DetalleN2Vista detalle={detalle} />
    </main>
  );
}
