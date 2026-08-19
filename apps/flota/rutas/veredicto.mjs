// El juicio de la suite HTTP A-contra-B [AC-FTEN-26] — centinela 2 del §9.3.
//
// Está separado del driver del e2e a propósito, y no por prolijidad: es el único lugar del
// AC donde se decide si una respuesta pasa o no, y el caso que más importa —«404 y JAMÁS
// 403»— no tiene todavía ninguna ruta de producto que lo ejerza (el primer endpoint con
// identificador de recurso nace en el módulo 01). Con el juicio dentro del spec de
// Playwright, ese emisor viajaría sin probar hasta el hito (b) y nadie se enteraría el día
// que alguien lo escribió al revés. Acá se prueba hoy, contra respuestas de laboratorio.
//
// POR QUÉ 404 Y NO 403 (§0, contrato HTTP). Un 403 sobre el recurso de otro tenant
// responde la pregunta que el atacante vino a hacer: «existe». Con 404 —el mismo que da un
// id inventado— pedir el recurso de B es indistinguible de pedir uno que no existe, y la
// enumeración deja de dar información. Es la misma razón por la que el subdominio archivado
// y el inexistente dan el MISMO 404 en AC-FTEN-05.

/** Códigos que responden «existe, pero no es tuyo» y por eso están vetados. */
const REVELAN_EXISTENCIA = new Set([401, 403, 405, 409, 422]);

/**
 * Cadenas de B que jamás pueden aparecer en una respuesta servida a A. No se declaran en el
 * manifiesto: se DERIVAN de la identidad de B más el identificador que se le inyectó. Una
 * lista declarada a mano se queda corta el día que alguien olvida agregarle una columna, y
 * el centinela pasaría a estar verde por lo que no mira.
 */
/** @param {{ slug: string, bd: string, id?: string | null }} identidad */
export function centinelasDe(identidad) {
  return [identidad.slug, identidad.bd, identidad.id].filter(
    (c) => typeof c === "string" && c.length > 0,
  );
}

/**
 * ¿Sirven estos centinelas para este par de tenants? Devuelve los que NO, con su motivo.
 *
 * El fixture del e2e tiene dos activos que se llaman `ruteo_activo` y `ruteo_activo_b`: el
 * slug de uno es subcadena del del otro. Emparejados al revés —B = `ruteo_activo`—, la
 * respuesta legítima de A contiene la cadena «ruteo_activo» y el centinela dispara contra
 * datos propios: la suite entera se pone roja por una coincidencia de nombres, alguien
 * ablanda el centinela para calmarla, y el aislamiento queda sin probar. Al derecho el par
 * funciona, pero funcionar por el orden en que alguien escribió una lista no es funcionar:
 * esto lo VERIFICA y, si el día de mañana entra un tenant que rompe el par, lo dice.
 */
export function centinelasIndistinguibles(identidadPropia, centinelas) {
  const propio = identidadPropia.map((s) => String(s).toLowerCase());
  return centinelas.filter((c) => propio.some((p) => p.includes(String(c).toLowerCase())));
}

/** Las cadenas de B presentes en un texto, comparando sin distinguir mayúsculas. */
export function centinelasEn(texto, centinelas) {
  const plano = String(texto ?? "").toLowerCase();
  return centinelas.filter((c) => plano.includes(c.toLowerCase()));
}

/**
 * Juzga UNA respuesta del cruce. Devuelve `{ ok, motivo }`; `motivo` es null cuando pasa y
 * una frase que explica qué se violó cuando no.
 *
 * `tipo: "recurso"` — la ruta recibió un identificador de B. Contrato: 404 pelado.
 * `tipo: "sin_recurso"` — la ruta no puede nombrar un recurso ajeno, así que se le inyectó
 *   la identidad de B por todos los canales falsificables que hay (host propio + cabeceras
 *   de tenant apuntando a B). Contrato: la respuesta sigue siendo la de A y no trae una
 *   sola cadena de B. Es la mitad del centinela 2 que SÍ aplica a una ruta sin parámetros;
 *   fingir que aplica la otra sería un caso verde que no probó nada.
 */
export function juzgarCruce(respuesta, { tipo, centinelas }) {
  const { status, cuerpo = "", cabeceras = {} } = respuesta;

  if (tipo === "recurso") {
    if (status === 403) {
      return {
        ok: false,
        motivo:
          `respondió 403 al recurso de otro tenant; el contrato del §0 exige 404 ` +
          `(un 403 confirma que el recurso existe, que es justo lo que la enumeración busca)`,
      };
    }
    if (REVELAN_EXISTENCIA.has(status)) {
      return {
        ok: false,
        motivo: `respondió ${status} al recurso de otro tenant; el contrato del §0 exige 404`,
      };
    }
    if (status !== 404) {
      return {
        ok: false,
        motivo:
          status >= 200 && status < 300
            ? `SIRVIÓ el recurso de otro tenant (${status}): fuga cross-tenant`
            : `respondió ${status} al recurso de otro tenant; el contrato del §0 exige 404`,
      };
    }
  } else if (tipo === "sin_recurso") {
    // Un 5xx no es aislamiento: es la app cayéndose ante una cabecera falsificada, y una
    // caída deja de probar que el dato de B no salió — solo que no salió ESTA vez.
    if (status >= 500) {
      return { ok: false, motivo: `respondió ${status} ante la identidad falsificada de otro tenant` };
    }
  } else {
    return { ok: false, motivo: `tipo de cruce desconocido: «${tipo}»` };
  }

  // Las cabeceras cuentan igual que el cuerpo: una fuga por `Set-Cookie` o por una cabecera
  // de diagnóstico es una fuga. El AC nombra el body porque es el caso obvio, no el único.
  const texto = cuerpo + "\n" + JSON.stringify(cabeceras ?? {});
  const filtradas = centinelasEn(texto, centinelas);
  if (filtradas.length > 0) {
    return {
      ok: false,
      motivo: `la respuesta contiene cadenas centinela del otro tenant: ${filtradas.join(", ")}`,
    };
  }

  return { ok: true, motivo: null };
}

/**
 * La otra mitad del centinela 2, para los verbos que mutan: la BD de B no cambió.
 * `huella` es el conteo de filas por tabla de la BD de B, leído del catálogo antes y después.
 */
export function juzgarHuella(antes, despues) {
  const tablas = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].sort();
  const movidas = tablas.filter((t) => (antes[t] ?? null) !== (despues[t] ?? null));
  if (movidas.length === 0) return { ok: true, motivo: null };
  return {
    ok: false,
    motivo:
      `la mutación tocó la BD del otro tenant: ` +
      movidas.map((t) => `${t} ${antes[t] ?? "—"} → ${despues[t] ?? "—"}`).join(", "),
  };
}
