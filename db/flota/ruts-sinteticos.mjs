// LISTA CONGELADA de RUTs sintéticos [AC-FIDN-21] — §7.8, §10.
//
// QUÉ MECANIZA. El §7.8 exige «cero datos personales reales en seeds» y el maestro pide RUTs
// «sintácticamente válidos pero irreales». «Irreal» no tiene oráculo: ningún test puede mirar
// un RUT y decidir si le pertenece a alguien. Lo que sí se puede mecanizar es lo de al lado, y
// alcanza: que cada RUT que aparezca en el árbol esté en esta lista, revisada una vez y
// congelada. Un RUT nuevo no se puede sembrar sin agregarlo acá, y agregarlo es un acto
// visible en el diff que alguien mira.
//
// POR QUÉ ESTO Y NO UN VALIDADOR. Un test que solo verificara el módulo 11 diría que un RUT
// real y válido está perfecto — y un RUT real en un seed es exactamente el problema. La lista
// invierte la carga: el default es que un RUT no se puede sembrar.
//
// El módulo 11 NO se implementa acá. Hay UNA implementación y vive en la base
// (`rut_valido()`, AC-FIDN-01); `db/flota/suite-bd/ruts.test.mjs` pasa esta lista por ella,
// así que las dos mitades del AC quedan cubiertas sin un segundo algoritmo que se separe del
// primero.

/**
 * RUTs sintéticos VÁLIDOS. Son los únicos que pueden aparecer como dato sembrado.
 * Cada uno con para qué existe: una lista sin razones se vuelve un cajón donde todo entra.
 */
export const VALIDOS = {
  "11.111.111-1": "la dueña del tenant en los fixtures de enrolamiento; dígitos repetidos, imposible de confundir con uno real",
  "12.345.678-5": "el ejemplo canónico del §0; el que aparece en la documentación y en las pantallas",
  "20.347.878-K": "el caso del dígito verificador K, que el módulo 11 produce y hay que ejercer",
  "5.126.663-3": "cuerpo de siete dígitos, para el caso del primer grupo de una sola cifra",
  "7.654.321-6": "dígitos descendentes; segundo operario donde hace falta más de una persona",
  "9.999.999-3": "el máximo de siete dígitos; comparte dígito verificador con 5.126.663-3, que es lo que prueba la máscara",
  "76.111.111-6": "la EMPRESA contratante de los fixtures del módulo 03 (AC-FRUT-01): rango 76.xxx de persona jurídica, que es el que usan las empresas en Chile y ninguna persona natural",
  "77.222.222-K": "la SEGUNDA empresa contratante (AC-FRUT-04): sin dos, la agrupación multi-empresa no se puede ejercer — el caso entero es que dos contratantes distintos mandan al mismo destino. Lleva K a propósito: el dígito verificador que más se rompe también aparece en una persona jurídica",
  // Los nuevos van AL FINAL, siempre: media docena de suites toma su RUT por índice sobre este
  // objeto (`Object.keys(VALIDOS)[6]`), y meter uno en el medio se los corre a todos en silencio.
  "6.666.666-2": "el chofer del bucle de terreno de F4 (AC-FPOD-01), propio y no prestado: el índice «un dispositivo personal ACTIVO por operario» (§4.3) impide que dos suites que comparten persona tengan cada una su aparato enrolado, y la segunda en correr se pone roja por un choque de fixture que no tiene nada que ver con lo que prueba",
  "8.765.432-K": "el chofer de las variantes cerradas de F4 (AC-FPOD-02), propio y no prestado: mismo motivo que el de arriba — un dispositivo personal por operario — así que esta suite necesita el suyo, no el de AC-FPOD-01",
  "4.444.444-5": "el chofer del POD sin red (AC-FPOD-03), propio y no prestado: tercera suite de F4, tercer operario — la regla de un dispositivo personal por persona no admite compartirlo con las dos de arriba",
  "3.333.333-1": "el chofer de la idempotencia del outbox (AC-FPOD-04), propio y no prestado: cuarta suite de F4, cuarto operario — mismo motivo que los tres de arriba",
  "2.222.222-8": "el chofer de la regla de oro con reloj corrido (AC-FPOD-05), propio y no prestado: quinta suite de F4, quinto operario — mismo motivo que los cuatro de arriba",
  "1.111.112-2": "el chofer del módulo apagado con turno abierto (AC-FPOD-06), propio y no prestado: sexta suite de F4, sexto operario — mismo motivo que las cinco de arriba",
  "9.876.543-3": "el chofer revocado DENTRO de la ventana de 72h (AC-FPOD-07), propio y no prestado: séptima suite de F4, séptimo operario — mismo motivo que las seis de arriba",
  "1.234.567-4": "el chofer revocado FUERA de la ventana de 72h (AC-FPOD-07), propio y no prestado: la misma suite necesita un SEGUNDO operario porque cada caso enrola su propio aparato con su propio `revocado_at`",
  "6.543.210-2": "el chofer A del centinela 9 (AC-FPOD-09), propio y no prestado: octava suite de F4, octavo operario — el que captura 3 entregas sin señal y después ya no vuelve a este teléfono",
  "8.888.888-K": "el chofer B del centinela 9 (AC-FPOD-09): la SEGUNDA identidad que se autentica en el MISMO aparato de A: sin ella no hay quién pise el outbox, que es todo lo que el caso prueba",
  "9.123.456-4": "el chofer de la secuencia monotónica por dispositivo (AC-FPOD-10), propio y no prestado: novena suite de F4, noveno operario — mismo motivo que las ocho de arriba",
  "8.642.097-K": "el segundo operario de AC-FPOD-10, el que ejerce el replay-on-online con Background Sync inexistente: la misma suite necesita su propio aparato aparte del que deja el hueco de secuencia",
  "7.777.777-6": "el chofer de foto y GPS como mejoras progresivas (AC-FPOD-12), propio y no prestado: décima suite de F4, décimo operario — mismo motivo que las nueve de arriba",
  "6.789.012-4": "el chofer del outbox generalizado a la recarga (AC-FPOD-13), propio y no prestado: undécima suite de F4, undécimo operario — mismo motivo que las diez de arriba",
  "5.555.555-9": "el chofer del encuadre degradado por cámara denegada (AC-FPOD-17), propio y no prestado: duodécima suite de F4, duodécimo operario — mismo motivo que las once de arriba",
  "9.234.561-0": "el chofer del covering array 2-way de la pantalla de parada (AC-FPOD-18), propio y no prestado: decimotercera suite de F4, decimotercer operario — mismo motivo que las doce de arriba",
  "10.234.567-3": "el operario A del centinela 9 del ANDÉN (AC-FIDN-07): el que captura 3 entregas sin señal en el aparato compartido y rota fuera antes de que vuelva la red — no comparte persona con el A del teléfono personal (AC-FPOD-09) porque acá el aparato es UNO SOLO por índice de dispositivos y las dos suites corren en paralelo",
  "13.579.246-2": "el operario B del centinela 9 del ANDÉN (AC-FIDN-07): rota por PIN en el MISMO aparato que A mientras A sigue sin red — la segunda identidad cuyo `guardarSecreto` nunca ocurre, porque en el andén el secreto es del aparato y lo que rota es la huella",
  "15.973.428-5": "el operador del candado del servidor sobre el POD que llega por sync (AC-FRUT-23), propio y no prestado: nació tomando `Object.keys(VALIDOS)[10]` directo en vez de `rutDeFixture`, que ya era de `pod-offline.spec.ts` (AC-FPOD-03) — las dos suites comparten la base `hechos` y ninguna limpia su fixture, así que cualquier corrida completa donde entrega-candado-servidor corriera antes chocaba con «duplicate key» en `personas_tenant_id_rut_key` sin que el texto del error dijera cuál de las dos suites era la intrusa",
  "16.273.849-6": "el chofer de los 4 estados obligatorios de la pantalla de parada (AC-FPOD-22), propio y no prestado: comparte el patrón de las suites de F4 de arriba — un dispositivo personal ACTIVO por operario (§4.3) — y esta suite además fuerza fallos de IndexedDB del aparato, así que necesita el suyo para no ensuciar el aparato de ninguna otra",
  "17.345.678-6": "el chofer del gate AA axe de la pantalla de parada (AC-FPOD-23), propio y no prestado: mismo motivo que el de AC-FPOD-22 — un dispositivo personal ACTIVO por operario (§4.3) — y esta suite necesita la pantalla real en dos estados (candado abierto, entrega en curso) sin que otra suite le pise el aparato",
  "18.456.789-K": "el chofer del paseo por accesibilidad de las 5 variantes de F4 (AC-FPOD-24), propio y no prestado: mismo motivo que AC-FPOD-22/23 — un dispositivo personal ACTIVO por operario (§4.3) — y esta suite navega la pantalla real de principio a fin SOLO por rol/nombre accesible en 5 flujos distintos, sin que otra suite le pise el aparato",
  "3.141.592-6": "la dueña del refresco del digest (AC-FSEM-06), propia y no prestada: compartía el índice 20 con pod-foto-gps-degradado y pod-evidencia-sha256, y como refresco-digest usa el MISMO tenant que una de ellas, la segunda en correr moría con duplicate key sobre personas_tenant_id_rut_key — pasaba sola y fallaba dentro de la suite, que es la forma más cara de fallar",
  // Los seis de abajo (índices 31..36) nacieron el 12-ago-2026 en el fix de los choques de
  // fixture y entraron por error en INVALIDOS_A_PROPOSITO: los seis pasan el módulo 11, así que
  // `ruts.test.mjs` los pasaba por `rut_valido()` esperando un rechazo que la base no da, y las
  // cuatro suites que los pedían por índice morían en `rutDeFixture` contra una lista de 31.
  "3.141.593-4": "el chofer de la ventana de undo de F4 (AC-FPOD-08), propio y no prestado: compartía el índice 11 con idempotencia-outbox.spec.ts — los seis choques de índice los encontró `gate-fixtures-exclusivos.mjs` el 12-ago-2026: dos suites contra el mismo tenant y la segunda moría con duplicate key en su beforeAll, con el rojo apareciendo a tres pasos de la causa",
  "2.718.283-6": "la panadería de la ventana de undo (AC-FPOD-08), propia y no prestada: compartía el índice 12 con pod-reloj-desfasado.spec.ts — mismo hallazgo del 12-ago-2026 que el de arriba",
  "1.618.034-3": "la dueña del Peek N1 del «Hoy» (AC-FSEM-04), propia y no prestada: compartía el índice 13 con pod-modulo-apagado.spec.ts — mismo hallazgo del 12-ago-2026 que los de arriba",
  "4.142.136-3": "el chofer del Peek N1 del «Hoy» (AC-FSEM-04), propio y no prestado: compartía el índice 14 con pod-dispositivo-revocado.spec.ts — mismo hallazgo del 12-ago-2026 que los de arriba",
  "5.772.157-K": "la dueña del Detalle N2 del «Hoy» (AC-FSEM-05), propia y no prestada: compartía el índice 18 con pod-secuencia-hueco.spec.ts — mismo hallazgo del 12-ago-2026 que los de arriba",
  "6.180.340-8": "el chofer de la foto y el GPS degradados de F4 (AC-FPOD-12), propio y no prestado: compartía el índice 20 con pod-evidencia-sha256.spec.ts — mismo hallazgo del 12-ago-2026 que los de arriba",
  "76.543.219-7": "la empresa cliente del drill-down línea→evidencia (AC-FTAR-07): rango 76.xxx de persona jurídica, propia y no prestada — la suite necesita SU propia empresa contratante para sembrar tarifa y encargo sin pisar la de otro módulo",
  "76.222.333-3": "la empresa cliente de la contracción sin pérdida de filas del módulo de tarifas (AC-FTAR-12): rango 76.xxx de persona jurídica, propia y no prestada — la suite necesita SU propia empresa para sembrar tarifa+zona+recargo+liquidación+línea sin pisar la de AC-FTAR-07 ni de AC-FTAR-10",
  "6.396.828-5": "el operario C de la transferencia de propiedad con passkey (AC-FIDN-13), propio y no prestado: la ceremonia muta el rol de A y de C en el mismo acto (admin_tenant ⇄ operador/chofer), así que el tercer operario necesita su propia identidad para no pisar el rol que otra suite da por fijo",
  "19.283.746-4": "el cliente del detalle de encargo con evidencia (AC-FPOR-11), propio y no prestado: los índices 9 y 10 que la suite pedía originalmente ya eran de pod-variantes.spec.ts y pod-offline.spec.ts — gate-fixtures-exclusivos.mjs lo atajó antes de llegar a producción",
  "76.445.588-6": "la empresa contratante del detalle de encargo con evidencia (AC-FPOR-11), propia y no prestada: rango 76.xxx de persona jurídica, mismo motivo que el RUT de arriba",
  "19.345.678-2": "el chofer de la telemetría de toques del teclado propio (AC-FMIG-03), propio y no prestado: la suite escribe filas reales en `client_metric` contra la base `hechos` que ya comparten `chequeos`/`energy_entry`, y necesita su propia identidad para no pisar el fixture de otro módulo",
  "78.333.333-3": "la CUARTA empresa jurídica de los seeds de tenant del hito g (AC-FMIG-18): tenant A siembra 3 empresas contratantes y tenant B siembra 4 panaderías cliente EN LA MISMA base cada uno — con solo 3 RUTs de rango 76/77.xxx ya declarados, el cuarto tenant que necesita 4 empresas distintas dentro de su propia BD se queda corto. Nació el 16-ago-2026 con el dígito verificador escrito a mano y EQUIVOCADO (`-4`), que es exactamente lo que esta lista no puede permitirse: `empresas_cliente.rut` no lo valida, así que el seed de B pasaba en verde mientras `ruts.test.mjs` y `rut.test.ts` se ponían rojos por un RUT que ninguna suite de seeds tocaba. El dígito se DERIVA (módulo 11), jamás se elige",
  "76.999.999-K": "el EMISOR de la factura ya emitida que ampara la liquidación cerrada del tenant A (AC-FMIG-25): es la flota misma facturándole a su contratante, y por eso no puede ser ninguno de los RUTs de empresa cliente ya declarados — el folio se REGISTRA como `reference_document`, jamás se genera (art. 97 N°4 CT), y sin un emisor propio el seed estaría diciendo que la farmacia se factura a sí misma. Dígito verificador DERIVADO por módulo 11, no elegido: cuerpo 76999999 ⇒ suma ponderada 276, resto 1, dv 11−1 = 10 = K",
  "76.543.210-3": "la empresa cliente del rol `cliente` en el covering array entitlements × rol del manifest (AC-FMIG-21): ese rol exige `empresa_cliente_id` con FK real y la suite necesita la suya, propia y no prestada. Dígito verificador DERIVADO por módulo 11: cuerpo 76543210 ⇒ suma ponderada 118, resto 8, dv 11−8 = 3",
  "19.500.000-K": "la empresa del detalle de encargo con evidencia del portal (AC-FPOR-11), propia y no prestada: el merge de las tres ramas dejó a `portal-encargo-detalle.spec.ts` y a `voiceover-proxy-3-flujos.spec.ts` reclamando el MISMO índice 39 — cada suite siembra su persona y la segunda en correr moría con duplicate key",
  "9.111.222-1": "la dueña de la contracción por modo/entitlement del módulo de tarifas (AC-FTAR-18), propia y no prestada: la suite sella `config_version` en OFF y en ON sobre su propia base y necesita un `admin_tenant` que ninguna otra suite enrole. Dígito verificador DERIVADO por módulo 11: cuerpo 9111222 ⇒ suma ponderada 54, resto 10, dv 11−10 = 1",
  "76.303.404-6": "la empresa cliente de la contracción por modo/entitlement (AC-FTAR-18), propia y no prestada: rango 76.xxx de persona jurídica — la suite necesita SU propia contratante para que el 403 pruebe que la puerta cerró y no que no había nada que devolver. Dígito verificador DERIVADO por módulo 11: cuerpo 76303404 ⇒ suma ponderada 93, resto 5, dv 11−5 = 6",
  "76.111.222-8": "la empresa a la que se le intenta pactar un OTD fuera de rango (AC-FTAR-13), propia y no prestada: el pgTAP 0036 la usa DOS veces para los dos bordes del CHECK —49 y 101— y ninguna de las dos llega a crear fila, que es justamente lo que ese test comprueba",
};

/**
 * El RUT sintético número `indice`, o un error que dice qué falta.
 *
 * Existe porque `Object.keys(VALIDOS)[n]!` MIENTE: el `!` de TypeScript le promete al compilador
 * que hay algo ahí, y si no lo hay el fixture inserta `undefined` como RUT. Eso no explota donde
 * se escribió — explota mucho más lejos, como una violación de `personas_anonimizacion_completa`
 * (una persona sin RUT parece anonimizada), y el rojo no menciona ni el índice ni esta lista.
 * Pasó de verdad el 11-ago-2026 con AC-FPOD-03, que pidió el índice 11 de una lista de 10.
 */
export function rutDeFixture(indice) {
  const claves = Object.keys(VALIDOS);
  const rut = claves[indice];
  if (rut === undefined) {
    throw new Error(
      `ruts-sinteticos: no existe el índice ${indice}; la lista congelada tiene ${claves.length} ` +
        `(0..${claves.length - 1}). Si esta suite necesita su propia persona, agregá un RUT AL ` +
        `FINAL de VALIDOS con su razón — nunca en el medio, que corre los índices de las demás.`,
    );
  }
  return rut;
}

/**
 * Cadenas con FORMA de RUT que NO pasan el módulo 11, y están a propósito: son los fixtures
 * que prueban que el validador rechaza. Sin declararlas, el gate las marcaría como RUTs
 * sembrados fuera de la lista; con ellas en otra lista, queda escrito que el rojo es su oficio.
 */
// Los dos titulares del fixture del export ARCO [AC-FIDN-15]: uno pide sus datos y el otro es
// el TERCERO cuya presencia en el mismo tenant hace que la prueba pruebe algo.
VALIDOS["18.777.333-4"] = "titular del export ARCO en db/flota/suite-bd/arco.test.mjs [AC-FIDN-15]";
VALIDOS["19.888.444-8"] = "el TERCERO del export ARCO: ni una cadena suya puede salir en el JSON de la titular [AC-FIDN-15]";
VALIDOS["21.987.654-8"] = "quien mide los toques en apps/flota/e2e/toques-flujo.spec.ts (AC-FRUT-19), propia y no prestada: la suite corre los cuatro flujos del módulo contra el tenant `hechos` y deja un manifiesto append-only, así que necesita su propia persona";
VALIDOS["76.987.654-5"] = "la empresa cliente de apps/flota/e2e/toques-flujo.spec.ts (AC-FRUT-19), propia y no prestada: rango 76.xxx de persona jurídica";

export const INVALIDOS_A_PROPOSITO = {
  "12.345.678-9": "el canónico con el dígito verificador cambiado: el caso que prueba que el módulo 11 se corre de verdad",
  "9.999.999-9": "dígito verificador repetido del cuerpo; se ve plausible y el módulo 11 dice 3",
};

/** Normaliza para comparar: el dígito verificador K se escribe en las dos cajas. */
export const normalizar = (rut) => String(rut).toUpperCase();

const DECLARADOS = new Set([...Object.keys(VALIDOS), ...Object.keys(INVALIDOS_A_PROPOSITO)].map(normalizar));

/** ¿Está declarado en la lista congelada, en cualquiera de sus dos mitades? */
export function declarado(rut) {
  return DECLARADOS.has(normalizar(rut));
}
