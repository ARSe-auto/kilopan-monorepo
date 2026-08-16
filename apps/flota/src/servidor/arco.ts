import type { Pool } from "pg";
import type { Sesion } from "./sesion.ts";
import { enActo, registrarEvento, EVENTOS } from "./gobierno.ts";
import {
  armarExportArco,
  SQL_TITULAR,
  SQL_USUARIOS,
  SQL_DISPOSITIVOS,
  type ExportArco,
  type PersonaArco,
  type UsuarioArco,
  type DispositivoArco,
  type FilaConDuena,
} from "../dominio/arco.ts";

// Export ARCO por persona [AC-FIDN-15] — §3.E1.15, §7.8, Ley 21.719.
//
// La forma del documento y sus dos reglas viven en `dominio/arco.ts`. Acá va lo que necesita
// la base: la transacción, el rastro y el 404.
//
// ES UNA MUTACIÓN Y NO UNA LECTURA, y por eso `enActo` y no `enLectura`. Suena al revés —un
// export no cambia nada de lo que se exporta— pero el AC no pide «leer los datos»: pide
// «entregarlos DEJANDO el acceso en la bitácora». La lectura y su rastro tienen que ser
// atómicos o el rastro no prueba nada: con el evento escrito después del commit, un fallo de
// red entre las dos deja un archivo entregado del que no queda ni una fila. Y al revés
// —evento primero, lectura después— quedaría un acceso registrado que nunca ocurrió.
//
// EL EVENTO SE ESCRIBE ANTES DE ARMAR el documento, dentro de la misma transacción. Si
// `armarExportArco` rebota por una fuga, el `rollback` de `enActo` se lleva puesto el evento:
// no se entregó nada, así que no hubo acceso que registrar.

export type ResultadoArco = { documento: ExportArco } | null;

/**
 * Genera el export ARCO de UNA persona. Devuelve `null` si esa persona no está en esta base —
 * que es también lo que pasa con el id de otro tenant, y sale gratis: cada tenant es su propia
 * base (§4.1), así que un id de B sencillamente no está acá.
 */
export async function exportarArco(
  pool: Pool,
  sesion: Sesion,
  personaId: string,
  tenant: string,
): Promise<ResultadoArco> {
  return enActo(
    pool,
    async (c) => {
      const { rows: personas } = await c.query<PersonaArco>(SQL_TITULAR, [personaId]);
      const titular = personas[0];
      if (!titular) return null;

      const { rows: usuarios } = await c.query<FilaConDuena<UsuarioArco>>(SQL_USUARIOS, [personaId]);
      const { rows: dispositivos } = await c.query<FilaConDuena<DispositivoArco>>(
        SQL_DISPOSITIVOS,
        [personaId],
      );

      await registrarEvento(c, {
        codigo: EVENTOS.arco_exportado,
        objetoTabla: "personas",
        objetoId: titular.id,
        sesion,
        // Cuánto se entregó, jamás QUÉ se entregó: el §7.8 (AC-FIDN-14) prohíbe PII en
        // `eventos`, y un ledger append-only no perdona un RUT escrito por comodidad.
        payload: { usuarios: usuarios.length, dispositivos: dispositivos.length },
      });

      return {
        documento: armarExportArco({
          generadoEn: new Date(),
          tenant,
          titular,
          usuarios,
          dispositivos,
        }),
      };
    },
    sesion,
  );
}
