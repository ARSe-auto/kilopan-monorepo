import { GRILLA, HTTP, TIPOGRAFIA } from "../../../../packages/nucleo-comun/src/constants.ts";

// Las dos páginas que el ruteo sirve cuando NO hay tenant que servir [AC-FTEN-05].
//
// Son HTML plano y no componentes de React a propósito: se responden ANTES de que exista
// contexto de tenant —o justamente porque el tenant está suspendido—, así que no hay tema,
// ni terminología, ni sesión que aplicar. Meterlas al árbol de la app obligaría a montar
// todo eso para renderizar un cartel de dos líneas.
//
// Cero información que no corresponda: la del 404 NO dice si el subdominio existe, si está
// archivado o si nunca existió. Esa es la razón entera de que el dueño eligiera 404 para los
// dos casos (Pregunta 9, 09-ago-2026); un texto distinto por caso desharía la decisión desde
// el cuerpo de la respuesta.

function documento(titulo: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${titulo}</title>
</head>
<body style="margin:0;padding:${GRILLA.base_px * 3}px;font-size:${TIPOGRAFIA.escala_pt.cuerpo}px;line-height:1.5;font-family:${TIPOGRAFIA.familia}">
<h1 style="margin:0 0 ${GRILLA.base_px}px">${titulo}</h1>
${cuerpo}
</body>
</html>
`;
}

const HTML = { "content-type": "text/html; charset=utf-8" } as const;

/** Subdominio sin tenant en `control`, o tenant archivado. Un solo cuerpo para los dos. */
export function respuestaSinTenant(): Response {
  return new Response(
    documento(
      "No encontrado",
      "<p>La dirección que abriste no corresponde a ninguna cuenta.</p>",
    ),
    { status: HTTP.recurso_ajeno, headers: HTML },
  );
}

/** El namespace `/cliente/*` con el portal apagado: 403 [AC-FPOR-04] — HTTP.modulo_apagado. Un
 *  solo cuerpo para TODA la ruta, exista o no en el árbol: el candado es del prefijo. */
export function respuestaPortalApagado(): Response {
  return new Response(
    documento(
      "Portal no disponible",
      "<p>Esta cuenta no tiene el portal del contratante habilitado.</p>",
    ),
    { status: HTTP.modulo_apagado, headers: HTML },
  );
}

/** Tenant suspendido: 503 y ni una conexión contra su base. */
export function respuestaSuspendido(): Response {
  return new Response(
    documento(
      "Cuenta suspendida",
      "<p>Esta cuenta está suspendida temporalmente. Escríbele a quien administra tu cuenta para reactivarla.</p>",
    ),
    {
      status: HTTP.tenant_suspendido,
      headers: {
        ...HTML,
        // 503 sin `Retry-After` deja a los buscadores y a los reintentos automáticos
        // adivinando; con él, la suspensión se lee como temporal, que es lo que es.
        "retry-after": "3600",
      },
    },
  );
}
