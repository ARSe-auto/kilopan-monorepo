import type { Pool } from "pg";
import { enActo, enLectura, registrarEvento, EVENTOS_OPERACION } from "./gobierno.ts";
import { firmarConPin } from "./firmas.ts";
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

// ─── El DTE gate [AC-FRUT-08] — §7.3, §4.6, §5.2 F2, art. 55 DL 825 ─────────────────
//
// ─── LA APP REFERENCIA, JAMÁS EMITE ───────────────────────────────────────────────
//
// `reference_document` apunta a un DTE que emitió un tercero autorizado por el SII. Lo que este
// archivo hace es CREAR LA REFERENCIA con los datos que el andén lee del papel —tipo, folio,
// emisor— por escaneo del TED o tecleados a mano. Nada más.
//
// Emitir un documento con apariencia de DTE sin ser emisor autorizado es el art. 97 N°4 del
// Código Tributario, y no es una multa: es un delito. Por eso acá no hay generación de folios, ni
// de XML, ni de TED — y un grep-gate lo vigila sobre el árbol entero, porque la línea que lo
// rompa se va a escribir con la mejor intención.
//
// ─── EL FOLIO MANUAL NO ES UN FALLBACK DE SEGUNDA ─────────────────────────────────
//
// El §7.6 prohíbe depender de la cámara. En un andén a las cuatro de la mañana el TED está
// arrugado, el vidrio empañado o el teléfono es prestado y no tiene permiso: el folio tecleado es
// la vía normal, no la excepción. Las dos terminan en la misma fila.
//
// ─── DOS CAPTURAS DEL MISMO DOCUMENTO LIGAN, NO DUPLICAN ─────────────────────────
//
// El `UNIQUE(tipo, folio, emisor)` de la 0006 lo garantiza, y acá se resuelve con `on conflict
// do nothing` + relectura: es la semántica «creando/ligando» del §4.2. Un rebote acá sería la
// captura rechazada, que es justo lo que la regla de oro prohíbe.

/** Los tipos que el SII define y que este módulo puede REFERENCIAR (§4.6). */
export const TIPOS_DE_DTE = ["33", "39", "52", "61"] as const;
export type TipoDeDte = (typeof TIPOS_DE_DTE)[number];

export const esTipoDeDte = (valor: string): valor is TipoDeDte =>
  (TIPOS_DE_DTE as readonly string[]).includes(valor);

export type Asociacion =
  | { tipo: "ok"; reference_document_id: string; ligado: boolean }
  | { tipo: "item_no_existe" };

/**
 * Asocia el documento de un tercero a un ítem del manifiesto.
 *
 * Es CAPTURA y no rebota: si el documento ya estaba —porque otro ítem del mismo manifiesto va en
 * la misma guía, que es el caso normal— se liga a la fila que hay.
 */
export async function asociarDocumento(
  pool: Pool,
  sesion: Sesion,
  datos: {
    manifiestoItemId: string;
    tipo: TipoDeDte;
    folio: string;
    emisor: string;
    fecha: string | null;
  },
): Promise<Asociacion> {
  return enActo(
    pool,
    async (c) => {
      const { rows: creado } = await c.query<{ id: string }>(
        `insert into reference_document (tipo, folio, emisor, fecha)
         values ($1::dte_tipo, $2, $3, $4::date)
           on conflict (tipo, folio, emisor) do nothing
         returning id::text as id`,
        [datos.tipo, datos.folio.trim(), datos.emisor.trim(), datos.fecha],
      );

      let documentoId = creado[0]?.id;
      const ligado = documentoId === undefined;
      if (!documentoId) {
        const { rows: previo } = await c.query<{ id: string }>(
          `select id::text as id from reference_document
            where tipo = $1::dte_tipo and folio = $2 and emisor = $3`,
          [datos.tipo, datos.folio.trim(), datos.emisor.trim()],
        );
        documentoId = previo[0]!.id;
      }

      // El acto es una FILA NUEVA, no un UPDATE: `manifiesto_items` es append-only y amparar
      // ocurre después de contar. Así el acto queda con su autor y su momento, que es lo que
      // convierte esto en trazable en vez de en un atributo que alguien cambió (§7.3, §7.4).
      const { rows: acto } = await c.query<{ id: string }>(
        `insert into manifiesto_item_documento (manifiesto_item_id, reference_document_id, actor_id)
         select $1, $2, $3
           from manifiesto_items where id = $1
           on conflict (tenant_id, manifiesto_item_id) do nothing
         returning id::text as id`,
        [datos.manifiestoItemId, documentoId, sesion.usuarioId],
      );
      // Sin fila: o el ítem no existe, o ya tenía su acto. Las dos se ven igual desde afuera y
      // ninguna es un error del andén — el segundo toque sobre el mismo bulto es lo normal.
      if (!acto[0]) return { tipo: "item_no_existe" };

      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.manifiesto_documento_asociado,
        objetoTabla: "manifiesto_items",
        objetoId: datos.manifiestoItemId,
        sesion,
        payload: { tipo: datos.tipo, folio: datos.folio, ligado },
      });
      return { tipo: "ok", reference_document_id: documentoId, ligado };
    },
    sesion,
  );
}

export type Bajada = { tipo: "ok" } | { tipo: "item_no_existe" } | { tipo: "falta_motivo" };

/**
 * Baja un ítem del manifiesto: la vía EXPLÍCITA del §7.3 cuando no hay documento.
 *
 * Jamás un override silencioso. El motivo es obligatorio y el evento queda — sin esta puerta, el
 * operario con un camión que sale a las cinco encuentra la salida por su cuenta: confirma con un
 * folio inventado, y ahí sí la app produjo un dato falso. Con ella, la mercadería se baja, queda
 * escrito quién lo hizo y por qué, y el camión sale legal.
 */
export async function bajarDelManifiesto(
  pool: Pool,
  sesion: Sesion,
  manifiestoItemId: string,
  motivo: string,
): Promise<Bajada> {
  // El motivo es obligatorio ACÁ y no en la base: el CHECK solo sabe si hay texto, y lo que hace
  // falta es que quien baja la carga diga algo que otro pueda leer mañana.
  if (motivo.trim().length < 3) return { tipo: "falta_motivo" };

  return enActo(
    pool,
    async (c) => {
      // Igual que amparar: la bajada es un ACTO con su autor, no una columna que se edita. Es
      // lo que hace cierto el «emite evento y auditoría» del §7.3 sin depender de nadie.
      const { rows: acto } = await c.query<{ id: string }>(
        `insert into manifiesto_item_documento (manifiesto_item_id, bajado_motivo, actor_id)
         select $1, $2, $3
           from manifiesto_items where id = $1
           on conflict (tenant_id, manifiesto_item_id) do nothing
         returning id::text as id`,
        [manifiestoItemId, motivo.trim(), sesion.usuarioId],
      );
      if (!acto[0]) return { tipo: "item_no_existe" };

      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.manifiesto_item_bajado,
        objetoTabla: "manifiesto_items",
        objetoId: manifiestoItemId,
        sesion,
        payload: { motivo: motivo.trim() },
      });
      return { tipo: "ok" };
    },
    sesion,
  );
}

/** Los ítems de un manifiesto con su estado frente al gate: a bordo, amparado o bajado. */
export async function estadoDelGate(
  pool: Pool,
  sesion: Sesion,
  manifiestoId: string,
): Promise<{ id: string; qty_confirmada: number; con_documento: boolean; bajado: boolean }[]> {
  return enLectura(pool, sesion, async (c) => {
    const { rows } = await c.query<{
      id: string;
      qty_confirmada: number;
      con_documento: boolean;
      bajado: boolean;
    }>(
      `select mi.id::text as id, mi.qty_confirmada,
              (d.reference_document_id is not null) as con_documento,
              (d.bajado_motivo is not null) as bajado
         from manifiesto_items mi
         left join manifiesto_item_documento d on d.manifiesto_item_id = mi.id
        where mi.manifiesto_id = $1 order by mi.id`,
      [manifiestoId],
    );
    return rows;
  });
}

// ─── El traspaso de custodia [AC-FRUT-09] — §4.3, §4.5, §4.6, §5.2 F2, §7.4 ─────────
//
// ─── ES EL MOMENTO QUE SOSTIENE LA DISPUTA ────────────────────────────────────────
//
// Tres semanas después, «yo la entregué completa» y «a mí me la dieron así» son dos
// afirmaciones sin nada en medio — salvo esta fila. Por eso lleva las dos firmas, el doble
// reloj y quién a quién, y por eso no se edita nunca.
//
// ─── DOBLE FIRMA, O UNA SI ES LA MISMA PERSONA ────────────────────────────────────
//
// El §4.5 lo dice así y la excepción no es comodidad: en un milk-run el que carga y el que
// maneja son la misma persona. Pedirle dos firmas la obligaría a inventar la segunda, que es
// exactamente lo que vacía de sentido a la primera. El CHECK de la 0043 deja pasar los dos
// casos y ninguno más.
//
// ─── LA FIRMA EN APARATO AJENO NO DESPLAZA LA SESIÓN (centinela 12) ──────────────
//
// El chofer firma en el teléfono del andén y sigue sin tener sesión ahí; la del responsable de
// carga tampoco se pierde. `firmarConPin` ya lo garantiza —recibe QUIÉN firma y DÓNDE, y no
// toca `dispositivos`— y este archivo se apoya en eso sin repetirlo: una segunda
// implementación del mismo cuidado es la que se olvida de actualizarse.

export type Traspaso =
  | { tipo: "ok"; custody_transfer_id: string; repetido: boolean; firmas: number }
  | { tipo: "manifiesto_no_existe" }
  | { tipo: "pin_invalido" }
  | { tipo: "ya_traspasado" };

/**
 * Traspasa la custodia del manifiesto: el andén libera, el chofer recibe.
 *
 * `pinLibero` y `pinRecibe` pueden venir del MISMO usuario, y entonces se firma una sola vez —
 * el milk-run. Si son personas distintas, cada una firma con su PIN en el aparato que haya a
 * mano, que es lo que el §5.2 F2 describe.
 */
export async function traspasarCustodia(
  pool: Pool,
  sesion: Sesion,
  datos: {
    manifiestoId: string;
    liberoUsuarioId: string;
    liberoPin: string;
    recibeUsuarioId: string;
    recibePin: string;
    sello: string | null;
    clientUuid: string | null;
    tsDispositivo: string;
    tzOffsetMin: number;
  },
): Promise<Traspaso> {
  const { rows: manifiesto } = await pool.query<{ id: string }>(
    "select id::text as id from manifiestos where id = $1",
    [datos.manifiestoId],
  );
  if (!manifiesto[0]) return { tipo: "manifiesto_no_existe" };

  const laMisma = datos.liberoUsuarioId === datos.recibeUsuarioId;

  // Las firmas van ANTES del traspaso y por su propia puerta: si el PIN no valida, no hay
  // traspaso que escribir. Es la única validación que rebota en este flujo, y rebota porque
  // ocurre con la persona presente — no es una captura que llega por sync.
  const libero = await firmarConPin(pool, {
    usuarioId: datos.liberoUsuarioId,
    pin: datos.liberoPin,
    personaId: await personaDe(pool, datos.liberoUsuarioId),
    dispositivoId: sesion.dispositivoId,
    objetoTabla: "manifiestos",
    objetoId: datos.manifiestoId,
    significado: "libero",
  });
  if (libero.tipo === "rebote") return { tipo: "pin_invalido" };

  // Una sola firma cuando es la misma persona: el CHECK de la 0043 exige que los dos ids
  // coincidan en ese caso, así que se reusa la que ya existe en vez de crear una gemela.
  const recibe = laMisma
    ? libero
    : await firmarConPin(pool, {
        usuarioId: datos.recibeUsuarioId,
        pin: datos.recibePin,
        personaId: await personaDe(pool, datos.recibeUsuarioId),
        dispositivoId: sesion.dispositivoId,
        objetoTabla: "manifiestos",
        objetoId: datos.manifiestoId,
        significado: "recibio_conforme",
      });
  if (recibe.tipo === "rebote") return { tipo: "pin_invalido" };

  return enActo(
    pool,
    async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into custody_transfer
           (manifiesto_id, de_persona_id, a_persona_id, firma_libero_id, firma_recibio_id,
            sello, ts_dispositivo, tz_offset_min, client_uuid)
         select $1,
                (select persona_id from usuarios where id = $2),
                (select persona_id from usuarios where id = $3),
                $4, $5, $6, $7, $8, $9
           on conflict do nothing
         returning id::text as id`,
        [
          datos.manifiestoId,
          datos.liberoUsuarioId,
          datos.recibeUsuarioId,
          libero.firmaId,
          recibe.firmaId,
          datos.sello,
          datos.tsDispositivo,
          datos.tzOffsetMin,
          datos.clientUuid,
        ],
      );

      if (!rows[0]) {
        // O el replay del outbox, o un segundo traspaso del mismo manifiesto. Los dos LIGAN al
        // vigente: es CAPTURA y no rebota (§4.2). Corregirlo es supersede, no un segundo intento.
        const { rows: vigente } = await c.query<{ id: string }>(
          `select id::text as id from custody_transfer
            where manifiesto_id = $1 and supersede_de is null limit 1`,
          [datos.manifiestoId],
        );
        return {
          tipo: "ok",
          custody_transfer_id: vigente[0]!.id,
          repetido: true,
          firmas: laMisma ? 1 : 2,
        };
      }

      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.custodia_traspasada,
        objetoTabla: "custody_transfer",
        objetoId: rows[0].id,
        sesion,
        payload: { manifiesto_id: datos.manifiestoId, firmas: laMisma ? 1 : 2 },
      });
      return { tipo: "ok", custody_transfer_id: rows[0].id, repetido: false, firmas: laMisma ? 1 : 2 };
    },
    sesion,
  );
}

/** La persona detrás de un usuario. Se resuelve acá porque `firmarConPin` firma como PERSONA. */
async function personaDe(pool: Pool, usuarioId: string): Promise<string> {
  const { rows } = await pool.query<{ persona_id: string }>(
    "select persona_id::text as persona_id from usuarios where id = $1",
    [usuarioId],
  );
  return rows[0]?.persona_id ?? "";
}

export type Correccion =
  | { tipo: "ok"; custody_transfer_id: string }
  | { tipo: "no_existe" }
  | { tipo: "falta_motivo" };

/**
 * Corrige un traspaso: SUPERSEDE con motivo y autor [AC-FRUT-09] — centinela 6.
 *
 * No edita ni borra. Quedan DOS filas y la original intacta, y esa es la diferencia entre una
 * corrección auditable y una que nadie puede distinguir de un encubrimiento: si la primera
 * desapareciera, nada probaría que alguna vez dijo otra cosa.
 */
export async function corregirTraspaso(
  pool: Pool,
  sesion: Sesion,
  datos: { custodyTransferId: string; motivo: string; sello: string | null },
): Promise<Correccion> {
  if (datos.motivo.trim().length < 3) return { tipo: "falta_motivo" };

  return enActo(
    pool,
    async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into custody_transfer
           (manifiesto_id, de_persona_id, a_persona_id, firma_libero_id, firma_recibio_id,
            sello, ts_dispositivo, tz_offset_min,
            supersede_de, supersede_motivo, supersede_autor_id)
         select v.manifiesto_id, v.de_persona_id, v.a_persona_id,
                v.firma_libero_id, v.firma_recibio_id,
                coalesce($3, v.sello), v.ts_dispositivo, v.tz_offset_min,
                v.id, $2, $4
           from custody_transfer v
          where v.id = $1 and v.supersede_de is null
         returning id::text as id`,
        [datos.custodyTransferId, datos.motivo.trim(), datos.sello, sesion.usuarioId],
      );
      // Sin fila: o no existe, o ya fue corregido. Corregir dos veces la misma versión dejaría
      // dos «vigentes» y el índice parcial lo impide — que es donde tiene que impedirse.
      if (!rows[0]) return { tipo: "no_existe" };

      await registrarEvento(c, {
        codigo: EVENTOS_OPERACION.custodia_corregida,
        objetoTabla: "custody_transfer",
        objetoId: rows[0].id,
        sesion,
        payload: { supersede_de: datos.custodyTransferId, motivo: datos.motivo.trim() },
      });
      return { tipo: "ok", custody_transfer_id: rows[0].id };
    },
    sesion,
  );
}
