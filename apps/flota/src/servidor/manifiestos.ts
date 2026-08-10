import type { Pool } from "pg";
import { enActo, enLectura, registrarEvento, EVENTOS_OPERACION } from "./gobierno.ts";
import type { Sesion } from "./sesion.ts";

// El sub-manifiesto del andén [AC-FRUT-07] — §5.2 F2, §4.2, §4.5, §5.3, §7.6.
//
// ─── ES CAPTURA: ACÁ NO SE REBOTA NUNCA ────────────────────────────────────────────
//
// Al revés que todo el resto de este módulo. El §4.2 pone la custodia en la lista de CAPTURA con
// todas las letras: cuando esto llega, el camión ya se cargó. Un rechazo no impide nada — solo
// borra la única constancia de lo que pasó en el andén a las cuatro de la mañana.
//
// Por eso lo que en planificación sería un 422, acá es una fila con su flag y su evento. Lo
// único que puede fallar es el `on conflict do nothing` del replay, y eso no es un fallo: es la
// misma captura llegando dos veces (§9.3.1).
//
// ─── EL CONTRASTE SE CONGELA, NO SE RECALCULA ─────────────────────────────────────
//
// `qty_declarada` se COPIA de `items` en el momento de confirmar. Podría leerse por join cada
// vez, y ese sería el error: si mañana la planificación corrige el encargo, el manifiesto pasaría
// a decir que el andén contó contra un número que nadie tuvo delante. Un contraste que se
// recalcula no es un contraste — es una opinión sobre el pasado.
//
// ─── LA DISCREPANCIA NO ES UN ERROR, ES EL DATO ───────────────────────────────────
//
// «Faltaron seis bandejas» es lo que el manifiesto existe para registrar. Se guarda con su
// evento propio para que la señal de custodia del Anexo B tenga de dónde leer, y NO se pide
// justificación para dejarla entrar: el §7.6 prohíbe el tipeo libre obligatorio en terreno, y un
// campo requerido acá produce notas como «ok» que enseñan a ignorar el recuadro.

export type ItemDeclarado = {
  item_id: string;
  empresa_cliente_id: string;
  empresa: string;
  qty_declarada: number;
};

/**
 * Lo declarado para una parada, AGRUPADO POR EMPRESA.
 *
 * Es lo que la pantalla del andén necesita para armar un sub-manifiesto por cada una: el §5.2 F2
 * lo pide así porque cada panadería responde por lo suyo, y un conteo único con la suma haría
 * imposible decir de quién faltaron las bandejas — que es la pregunta del día siguiente.
 */
export async function loDeclaradoEn(
  pool: Pool,
  sesion: Sesion,
  paradaId: string,
): Promise<ItemDeclarado[]> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<ItemDeclarado>(
      `select i.id::text as item_id, i.empresa_cliente_id::text as empresa_cliente_id,
              e.razon_social as empresa, i.qty_planificada as qty_declarada
         from items i
         join empresas_cliente e on e.id = i.empresa_cliente_id
        where i.parada_id = $1
        order by e.razon_social`,
      [paradaId],
    );
    return rows;
  });
}

export type Conteo = { item_id: string; qty_confirmada: number; nota?: string | null };

export type Confirmacion = {
  manifiesto_id: string;
  repetido: boolean;
  items: number;
  discrepancias: number;
};

/**
 * «Conforme»: crea el sub-manifiesto de UNA empresa en UNA parada de carga.
 *
 * No hay borrador que confirmar después. Un borrador sería una fila que dice que hubo un traspaso
 * cuando todavía no lo hubo, y en una tabla append-only no se puede deshacer. El undo de 8 s del
 * §4.7 vive en el cliente, ANTES de que esto se llame.
 */
export async function confirmarManifiesto(
  pool: Pool,
  sesion: Sesion,
  datos: {
    paradaId: string;
    empresaClienteId: string;
    conteos: Conteo[];
    clientUuid: string | null;
    tsDispositivo: string;
    tzOffsetMin: number;
  },
): Promise<Confirmacion> {
  return enActo(
    pool,
    async (c) => {
      // DOS conflictos posibles, y ninguno puede rebotar (§4.2): el replay del outbox —mismo
      // `client_uuid`— y el segundo «Conforme» sobre la misma parada y empresa desde otro
      // aparato, que trae un uuid distinto. El segundo es el caso real del andén compartido: dos
      // personas confirmando lo mismo. Los dos LIGAN a la fila que ya está, que es la semántica
      // «creando/ligando» que el §4.2 pide para la custodia — un 500 acá sería la captura
      // rebotando, que es exactamente lo que la regla de oro prohíbe.
      const { rows } = await c.query<{ id: string }>(
        `insert into manifiestos
           (parada_id, empresa_cliente_id, ts_dispositivo, tz_offset_min, client_uuid)
         values ($1, $2, $3, $4, $5)
           on conflict do nothing
         returning id::text as id`,
        [
          datos.paradaId,
          datos.empresaClienteId,
          datos.tsDispositivo,
          datos.tzOffsetMin,
          datos.clientUuid,
        ],
      );

      if (!rows[0]) {
        // El replay del outbox, o el segundo toque de un «Conforme» que ya viajó. Se devuelve el
        // que hay: crear otro sería contar el andén dos veces (§9.3.1).
        const { rows: previo } = await c.query<{ id: string; items: string; discrepancias: string }>(
          `select m.id::text as id,
                  (select count(*) from manifiesto_items mi where mi.manifiesto_id = m.id)::text as items,
                  (select count(*) from manifiesto_items mi
                    where mi.manifiesto_id = m.id and mi.discrepancia <> 0)::text as discrepancias
             from manifiestos m
            where m.client_uuid = $1 or (m.parada_id = $2 and m.empresa_cliente_id = $3)
            limit 1`,
          [datos.clientUuid, datos.paradaId, datos.empresaClienteId],
        );
        return {
          manifiesto_id: previo[0]!.id,
          repetido: true,
          items: Number(previo[0]!.items),
          discrepancias: Number(previo[0]!.discrepancias),
        };
      }

      const manifiestoId = rows[0].id;
      let discrepancias = 0;
      let escritos = 0;

      for (const conteo of datos.conteos) {
        // `qty_declarada` se copia AHORA: el manifiesto tiene que seguir diciendo contra qué se
        // contó aunque la planificación cambie mañana.
        const { rows: item } = await c.query<{ discrepancia: number }>(
          `insert into manifiesto_items (manifiesto_id, item_id, qty_declarada, qty_confirmada, nota)
           select $1, i.id, i.qty_planificada, $3, $4
             from items i
            where i.id = $2 and i.empresa_cliente_id = $5
           returning discrepancia`,
          [
            manifiestoId,
            conteo.item_id,
            Math.max(0, Math.trunc(conteo.qty_confirmada)),
            conteo.nota?.trim() || null,
            datos.empresaClienteId,
          ],
        );
        // Un ítem que no es de esta empresa —o que ya no está— NO rebota el acto entero: es
        // CAPTURA. Se lo deja fuera y el conteo de escritos lo dice.
        if (!item[0]) continue;
        escritos++;
        if (item[0].discrepancia !== 0) discrepancias++;
      }

      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.manifiesto_confirmado,
        objetoTabla: "manifiestos",
        objetoId: manifiestoId,
        sesion,
        payload: { parada_id: datos.paradaId, items: escritos, discrepancias },
      });

      // La discrepancia lleva su PROPIO evento: la señal de Caja/custodia del Anexo B tiene que
      // poder contarlas sin abrir cada manifiesto, y un evento genérico la obligaría a eso.
      if (discrepancias > 0) {
        await registrarEvento(c, {
          codigo: EVENTOS_OPERACION.manifiesto_discrepancia,
          objetoTabla: "manifiestos",
          objetoId: manifiestoId,
          sesion,
          payload: { discrepancias },
        });
      }

      return { manifiesto_id: manifiestoId, repetido: false, items: escritos, discrepancias };
    },
    sesion,
  );
}
