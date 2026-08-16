// Export ARCO por persona [AC-FIDN-15] — §3.E1.15, §7.8, Ley 21.719.
//
// LO QUE ESTE ARCHIVO ES: la definición de QUÉ sale del tenant cuando una persona ejerce su
// derecho de acceso. No la ruta, no la transacción, no el evento — solo la forma del
// documento y las dos reglas que lo hacen legal. Vive en `dominio/` y no en `servidor/`
// porque tiene que poder ejercitarse sin una base de datos (unit) Y contra el cluster real
// desde `db/flota/suite-bd/arco.test.mjs`, que es JavaScript y no puede arrastrar `pg` ni
// `next/headers` para leer una lista de columnas.
//
// ─── LAS DOS REGLAS, Y POR QUÉ SON DOS CAPAS Y NO UNA ─────────────────────────────────
//
// El AC pide «los datos de UNA persona sin incluir datos de terceros». Eso se puede violar de
// dos maneras distintas, y cada una tiene su capa:
//
//   1. Llevándose de más de la fila propia — el `select *` que arrastra `secreto_hash` junto
//      con el resto. Se cierra con LISTA BLANCA EN EL SELECT (`SQL_*` de acá abajo): lo que no
//      está nombrado no sale de la base, así que nunca llega a haber un hash en memoria del
//      proceso que después alguien serializa por descuido.
//   2. Llevándose filas de OTRA persona — el `where` que se olvida, o el join que trae al
//      compañero de turno. Se cierra con `armarExportArco`, que REBOTA si alguna fila que le
//      pasan no es de la titular.
//
// La segunda parece redundante mientras el `where` esté bien escrito, y ese es exactamente el
// punto: el día que alguien lo toque, la que se pone roja es esta. Con una sola capa, borrar
// el `where` dejaría todo verde y publicaría la nómina entera dentro de un documento que dice
// «tus datos personales».
//
// ─── LO QUE NO SALE, AUNQUE ESTÉ EN LA MISMA FILA ─────────────────────────────────────
//
// `dispositivos.enrolado_por` es el usuario del DUEÑO que dio de alta el aparato: es un dato
// de un tercero viviendo en una fila de la titular, y es el caso que hace que «sin datos de
// terceros» no se resuelva filtrando por `persona_id`. Fuera. Igual `solicitudes_acceso`
// entera, con su `resuelta_por` y su `huella_dispositivo`: el AC acota el alcance a la
// persona, sus vínculos de usuario y sus dispositivos, y la solicitud ya se consumió al
// aprobarse.

/** La versión del documento. Va ADENTRO del JSON porque este archivo se entrega y se guarda
 *  fuera del sistema: quien lo reciba en dos años tiene que poder saber qué le dieron. */
export const FORMATO_ARCO = "arco.v1";

/**
 * Columnas que JAMÁS pueden aparecer en el documento, con nombre propio. Dos familias:
 * credenciales (un hash de PIN entregado es un hash de PIN que se puede atacar sin límite de
 * intentos, y el §4.3 lo tiene guardado justamente para que eso no pase) e identificadores de
 * TERCEROS que viven en filas de la titular.
 */
export const CAMPOS_VEDADOS: readonly string[] = [
  "pin_hash",
  "secreto_hash",
  "clave_publica",
  "clave_publica_raw",
  "token_hash",
  "credential_id",
  "huella_dispositivo",
  "enrolado_por",
  "resuelta_por",
  "creada_por",
  "actor_id",
];

export type PersonaArco = {
  id: string;
  rut: string | null;
  nombre: string | null;
  contacto: string | null;
  anonimizada_en: string | null;
  creada_en: string;
};

export type UsuarioArco = {
  id: string;
  rol: string;
  empresa_cliente_id: string | null;
  activo: boolean;
  bloqueado_hasta: string | null;
  creado_en: string;
};

export type DispositivoArco = {
  id: string;
  tipo: string;
  is_standalone: boolean;
  storage_persisted: boolean;
  enrolado_en: string | null;
  revocado_at: string | null;
  creado_en: string;
};

/** Lo que sale de la base: la fila del documento MÁS el `persona_id` con el que se verifica.
 *  Ese campo no llega al JSON — arriba ya está, y repetirlo en cada fila sería ruido. */
export type FilaConDuena<T> = T & { persona_id: string | null };

export type ExportArco = {
  formato: typeof FORMATO_ARCO;
  generado_en: string;
  tenant: string;
  titular: PersonaArco;
  usuarios: UsuarioArco[];
  dispositivos: DispositivoArco[];
};

// ─── Las consultas, con la lista blanca escrita en el SELECT ──────────────────────────
//
// Parametrizadas y sin una sola interpolación: el id entra por $1 siempre. Y `::text` en cada
// uuid y cada timestamptz porque el documento se entrega como JSON — un `Date` de `pg`
// serializado por el runtime dependería del huso del proceso, y dos exports de la misma
// persona en máquinas distintas dirían fechas distintas.

export const SQL_TITULAR = `
  select id::text                as id,
         rut,
         nombre,
         contacto,
         anonimizada_en::text    as anonimizada_en,
         creada_en::text         as creada_en
    from personas
   where id = $1::uuid`;

export const SQL_USUARIOS = `
  select id::text                 as id,
         persona_id::text         as persona_id,
         rol::text                as rol,
         empresa_cliente_id::text as empresa_cliente_id,
         activo,
         bloqueado_hasta::text    as bloqueado_hasta,
         creado_en::text          as creado_en
    from usuarios
   where persona_id = $1::uuid
   order by creado_en`;

export const SQL_DISPOSITIVOS = `
  select id::text              as id,
         persona_id::text      as persona_id,
         tipo::text            as tipo,
         is_standalone,
         storage_persisted,
         enrolado_en::text     as enrolado_en,
         revocado_at::text     as revocado_at,
         creado_en::text       as creado_en
    from dispositivos
   where persona_id = $1::uuid
   order by creado_en`;

// ─── El armado, que es donde se rebota ────────────────────────────────────────────────

export class FugaDeTerceros extends Error {
  /** Sin propiedad de parámetro (`constructor(public …)`): el type-stripping de Node no la
   *  soporta, y este archivo lo importa la suite `.mjs` del cluster. */
  readonly detalle: string;

  constructor(detalle: string) {
    super(
      `el export ARCO se abortó antes de entregar nada: ${detalle} (§7.8, Ley 21.719) ` +
        "[AC-FIDN-15]",
    );
    this.name = "FugaDeTerceros";
    this.detalle = detalle;
  }
}

/** Recorre un valor cualquiera y devuelve los nombres vedados que encuentre, en orden. Se
 *  aplica al documento YA armado y no a las filas de entrada: lo que hay que garantizar es
 *  que no salga, y el único lugar donde eso se puede afirmar es la salida. */
export function camposVedadosEn(valor: unknown, camino = ""): string[] {
  if (Array.isArray(valor)) {
    return valor.flatMap((v, i) => camposVedadosEn(v, `${camino}[${i}]`));
  }
  if (valor === null || typeof valor !== "object") return [];
  const hallados: string[] = [];
  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    const donde = camino ? `${camino}.${clave}` : clave;
    if (CAMPOS_VEDADOS.includes(clave)) hallados.push(donde);
    hallados.push(...camposVedadosEn(v, donde));
  }
  return hallados;
}

/**
 * Arma el documento y lo verifica. Rebota con `FugaDeTerceros` —sin entregar nada— si alguna
 * fila no es de la titular o si un campo vedado se coló en la salida.
 *
 * Rebotar y no filtrar es deliberado: filtrar en silencio dejaría el defecto vivo en la
 * consulta y el export saldría igual, correcto y sin decir que alguien lo escribió mal.
 */
export function armarExportArco(entrada: {
  generadoEn: Date;
  tenant: string;
  titular: PersonaArco;
  usuarios: readonly FilaConDuena<UsuarioArco>[];
  dispositivos: readonly FilaConDuena<DispositivoArco>[];
}): ExportArco {
  const { titular } = entrada;

  const ajenas = [
    ...entrada.usuarios.map((u) => ({ que: "usuarios", id: u.id, duena: u.persona_id })),
    ...entrada.dispositivos.map((d) => ({ que: "dispositivos", id: d.id, duena: d.persona_id })),
  ].filter((f) => f.duena !== titular.id);
  if (ajenas.length > 0) {
    const primera = ajenas[0]!;
    throw new FugaDeTerceros(
      `${ajenas.length} fila(s) no son de la titular ${titular.id} ` +
        `(la primera: ${primera.que} ${primera.id}, de ${primera.duena ?? "nadie"})`,
    );
  }

  const documento: ExportArco = {
    formato: FORMATO_ARCO,
    generado_en: entrada.generadoEn.toISOString(),
    tenant: entrada.tenant,
    titular: {
      id: titular.id,
      rut: titular.rut,
      nombre: titular.nombre,
      contacto: titular.contacto,
      anonimizada_en: titular.anonimizada_en,
      creada_en: titular.creada_en,
    },
    usuarios: entrada.usuarios.map((u) => ({
      id: u.id,
      rol: u.rol,
      empresa_cliente_id: u.empresa_cliente_id,
      activo: u.activo,
      bloqueado_hasta: u.bloqueado_hasta,
      creado_en: u.creado_en,
    })),
    dispositivos: entrada.dispositivos.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      is_standalone: d.is_standalone,
      storage_persisted: d.storage_persisted,
      enrolado_en: d.enrolado_en,
      revocado_at: d.revocado_at,
      creado_en: d.creado_en,
    })),
  };

  const vedados = camposVedadosEn(documento);
  if (vedados.length > 0) {
    throw new FugaDeTerceros(`campos vedados en la salida: ${vedados.join(", ")}`);
  }
  return documento;
}
