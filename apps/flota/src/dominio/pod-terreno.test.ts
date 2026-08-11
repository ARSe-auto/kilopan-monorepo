import test from "node:test";
import assert from "node:assert/strict";
import { UNDO } from "../../../../packages/nucleo-comun/src/constants.ts";
import {
  ENTREGA_FELIZ_ACCIONES,
  iniciarRecorrido,
  paradaActual,
  llegar,
  entregar,
  entregarParcial,
  noEntregar,
  dejarEnPunto,
  exigeEncuadre,
  requisitosPendientes,
  deshacer,
  cerrarLaVentana,
  sacarDeLaCola,
  terminado,
  type Recorrido,
  type ParadaDeRuta,
} from "./pod-terreno.ts";

// Mutantes del bucle de terreno de F4 [AC-FPOD-01] — §5.2 F4, §5.3, §4.7, §0.
//
// El presupuesto de toques es un CONTRATO (§5.3) y acá se mide sobre la máquina: cada
// transición que el chofer provoca con un dedo pasa por el contador, y el camino feliz tiene
// que costar exactamente `ENTREGA_FELIZ_ACCIONES`. El e2e mide lo mismo sobre la pantalla real
// (`e2e/pod-feliz.spec.ts`); acá se protege el bucle aunque la pantalla cambie de forma.

const PARADAS: ParadaDeRuta[] = [
  {
    id: "p1",
    orden: 1,
    destino: "Sucursal Independencia",
    ventana: "08:00 a 10:00",
    bultos: 12,
    items: [{ id: "i1", empresa: "Panadería del bucle", qtyPlanificada: 12 }],
    requisitos: [],
  },
  {
    id: "p2",
    orden: 2,
    destino: "Sucursal Recoleta",
    ventana: null,
    bultos: 4,
    items: [{ id: "i2", empresa: "Panadería del bucle", qtyPlanificada: 4 }],
    requisitos: [],
  },
  {
    id: "p3",
    orden: 3,
    destino: "Sucursal Conchalí",
    ventana: null,
    bultos: 7,
    items: [{ id: "i3", empresa: "Panadería del bucle", qtyPlanificada: 7 }],
    requisitos: [],
  },
];

const SELLO = {
  clientUuid: "019853b7-0000-7000-8000-00000000aaaa",
  tsDispositivo: "2026-08-11T13:20:00.000Z",
  tzOffsetMin: -240,
};

/** Cuenta ACCIONES con la convención cerrada del §5.3, igual que el e2e. */
function contador(r: Recorrido) {
  let acciones = 0;
  let estado = r;
  return {
    get acciones() {
      return acciones;
    },
    get estado() {
      return estado;
    },
    tocar(transicion: (r: Recorrido) => Recorrido) {
      acciones++;
      estado = transicion(estado);
    },
  };
}

test("[AC-FPOD-01] la entrega feliz cuesta DOS acciones exactas y deja al chofer en la siguiente", () => {
  const c = contador(iniciarRecorrido(PARADAS));

  c.tocar(llegar);
  c.tocar((r) => entregar(r, SELLO));

  assert.equal(c.acciones, ENTREGA_FELIZ_ACCIONES);
  assert.equal(c.acciones, 2, "el §5.2 F4 fija dos toques exactos por entrega");
  // El avance es parte de la segunda acción, no un toque más: la tarjeta que quedó a la vista
  // ya es la de la parada siguiente.
  assert.equal(paradaActual(c.estado)?.id, "p2");
  assert.equal(c.estado.llegada, false, "la parada nueva arranca sin «Llegué» dado");
});

test("[AC-FPOD-01] la captura nace en pending_undo y NO sale del dispositivo hasta que vence la ventana", () => {
  const entregada = entregar(llegar(iniciarRecorrido(PARADAS)), SELLO);

  assert.equal(entregada.captura?.estado, UNDO.estado_local);
  assert.equal(entregada.captura?.paradaId, "p1");
  assert.equal(entregada.captura?.resultado, "exito");
  // El doble reloj del §4.6 y el `client_uuid` del §0 viajan con ella desde el primer momento.
  assert.equal(entregada.captura?.clientUuid, SELLO.clientUuid);
  assert.equal(entregada.captura?.tsDispositivo, SELLO.tsDispositivo);
  assert.equal(entregada.captura?.tzOffsetMin, SELLO.tzOffsetMin);
  assert.deepEqual(entregada.cola, [], "dentro de la ventana no hay nada que replayar");
});

test("[AC-FPOD-01] vencida la ventana, la captura pasa a la cola del motor de sync", () => {
  const cerrada = cerrarLaVentana(entregar(llegar(iniciarRecorrido(PARADAS)), SELLO));

  assert.equal(cerrada.captura, null);
  assert.equal(cerrada.cola.length, 1);
  assert.equal(cerrada.cola[0]?.estado, "por_replicar");
  assert.equal(cerrada.cola[0]?.clientUuid, SELLO.clientUuid);
  // Cerrar una ventana que ya venció no duplica la captura: el temporizador puede dispararse
  // dos veces si la pantalla se re-monta, y una entrega contada dos veces es carga inventada.
  assert.deepEqual(cerrarLaVentana(cerrada), cerrada);
});

test("[AC-FPOD-01] deshacer dentro de la ventana cancela la captura y devuelve a la parada", () => {
  const deshecha = deshacer(entregar(llegar(iniciarRecorrido(PARADAS)), SELLO));

  assert.equal(paradaActual(deshecha)?.id, "p1", "vuelve a la parada que deshizo");
  assert.equal(deshecha.llegada, true, "y con «Llegué» ya dado: es donde estaba parado");
  assert.equal(deshecha.captura, null);
  assert.deepEqual(deshecha.cola, [], "la mutación se canceló ANTES del replay (§4.7)");
});

test("[AC-FPOD-01] deshacer fuera de la ventana no toca nada: eso ya es supersede, no undo", () => {
  const cerrada = cerrarLaVentana(entregar(llegar(iniciarRecorrido(PARADAS)), SELLO));

  // Post-replay el undo es un supersede con motivo `undo` (§4.7) y es AC-FPOD-08: acá lo que
  // importa es que esta máquina NO borre una captura que ya es un hecho.
  assert.deepEqual(deshacer(cerrada), cerrada);
});

test("[AC-FPOD-01] «Entregado» sin haber llegado no cierra la parada", () => {
  const sinLlegar = entregar(iniciarRecorrido(PARADAS), SELLO);

  assert.deepEqual(sinLlegar, iniciarRecorrido(PARADAS));
  assert.equal(paradaActual(sinLlegar)?.id, "p1");
});

test("[AC-FPOD-01] dos entregas seguidas dentro de los 8 s no pierden la primera", () => {
  const primera = entregar(llegar(iniciarRecorrido(PARADAS)), SELLO);
  const segunda = entregar(llegar(primera), { ...SELLO, clientUuid: "019853b7-0000-7000-8000-00000000bbbb" });

  assert.equal(segunda.cola.length, 1, "la primera se cerró sola al llegar la segunda");
  assert.equal(segunda.cola[0]?.clientUuid, SELLO.clientUuid);
  assert.equal(segunda.captura?.paradaId, "p2");
  assert.equal(paradaActual(segunda)?.id, "p3");
});

test("[AC-FPOD-01] entregada la última parada, la ruta queda terminada y no avanza más", () => {
  let r = iniciarRecorrido(PARADAS);
  PARADAS.forEach((parada, n) => {
    assert.equal(paradaActual(r)?.id, parada.id);
    r = entregar(llegar(r), { ...SELLO, clientUuid: `019853b7-0000-7000-8000-00000000ddd${n}` });
  });

  assert.equal(terminado(r), true);
  assert.equal(paradaActual(r), null);
  // Sobre una ruta terminada los dos toques no hacen nada: no hay parada que cerrar.
  assert.deepEqual(llegar(r), r);
  assert.deepEqual(entregar(r, SELLO), r);
});

test("[AC-FPOD-01] «Llegué» dos veces es una sola llegada", () => {
  const unaVez = llegar(iniciarRecorrido(PARADAS));

  assert.deepEqual(llegar(unaVez), unaVez);
});

// ─── Variantes cerradas [AC-FPOD-02] — §5.2 F4, §5.3, §4.5, §4.4 ──────────────────────

const MOTIVO_LOCAL_CERRADO = "019853b7-0000-7000-8000-0000000000f1";

test("[AC-FPOD-02] parcial escribe el ajuste por ítem con resultado 'parcial' y avanza sola", () => {
  const r = entregarParcial(
    llegar(iniciarRecorrido(PARADAS)),
    [{ itemId: "i1", qtyEntregada: 8, qtyRechazada: 4, motivoId: MOTIVO_LOCAL_CERRADO }],
    SELLO,
  );

  assert.equal(r.captura?.resultado, "parcial");
  assert.equal(r.captura?.metodoEntrega, null, "una parcial no tiene método de entrega");
  assert.deepEqual(r.captura?.items, [
    { itemId: "i1", qtyEntregada: 8, qtyRechazada: 4, motivoId: MOTIVO_LOCAL_CERRADO },
  ]);
  // El avance automático es el mismo que el camino feliz: la tarjeta a la vista ya es p2.
  assert.equal(paradaActual(r)?.id, "p2");
  assert.equal(r.llegada, false);
});

test("[AC-FPOD-02] parcial sin ajustar ningún ítem no es una transición", () => {
  const sinAjustes = entregarParcial(llegar(iniciarRecorrido(PARADAS)), [], SELLO);

  assert.deepEqual(sinAjustes, llegar(iniciarRecorrido(PARADAS)));
});

test("[AC-FPOD-02] parcial sin haber llegado no cierra la parada", () => {
  const sinLlegar = entregarParcial(
    iniciarRecorrido(PARADAS),
    [{ itemId: "i1", qtyEntregada: 8, qtyRechazada: 4, motivoId: MOTIVO_LOCAL_CERRADO }],
    SELLO,
  );

  assert.deepEqual(sinLlegar, iniciarRecorrido(PARADAS));
});

test("[AC-FPOD-02] no entregado escribe resultado 'fallo' con su motivo y avanza sola", () => {
  const r = noEntregar(llegar(iniciarRecorrido(PARADAS)), MOTIVO_LOCAL_CERRADO, SELLO);

  assert.equal(r.captura?.resultado, "fallo");
  assert.equal(r.captura?.metodoEntrega, null);
  assert.equal(r.captura?.motivoId, MOTIVO_LOCAL_CERRADO);
  assert.equal(r.captura?.items, null);
  assert.equal(paradaActual(r)?.id, "p2");
});

test("[AC-FPOD-02] no entregado sin haber llegado no cierra la parada", () => {
  const sinLlegar = noEntregar(iniciarRecorrido(PARADAS), MOTIVO_LOCAL_CERRADO, SELLO);

  assert.deepEqual(sinLlegar, iniciarRecorrido(PARADAS));
});

test("[AC-FPOD-02] dejado en punto sin umbral sembrado (parámetro NULL) nunca exige encuadre", () => {
  assert.equal(exigeEncuadre(PARADAS[0]!, null), false);

  const r = dejarEnPunto(llegar(iniciarRecorrido(PARADAS)), SELLO, {
    encuadreCapturado: false,
    bultosMaxSinReceptor: null,
  });

  assert.equal(r.captura?.resultado, "exito");
  assert.equal(r.captura?.metodoEntrega, "dejado_en_punto");
  assert.equal(paradaActual(r)?.id, "p2");
});

test("[AC-FPOD-02] dejado en punto bajo el umbral no exige encuadre", () => {
  // p1 trae 12 bultos; con el umbral en 20 no lo supera.
  assert.equal(exigeEncuadre(PARADAS[0]!, 20), false);

  const r = dejarEnPunto(llegar(iniciarRecorrido(PARADAS)), SELLO, {
    encuadreCapturado: false,
    bultosMaxSinReceptor: 20,
  });

  assert.equal(r.captura?.resultado, "exito");
  assert.equal(paradaActual(r)?.id, "p2");
});

test("[AC-FPOD-02] dejado en punto sobre el umbral exige encuadre: sin él no cierra la parada", () => {
  // p1 trae 12 bultos; con el umbral en 6 lo supera.
  assert.equal(exigeEncuadre(PARADAS[0]!, 6), true);

  const sinEncuadre = dejarEnPunto(llegar(iniciarRecorrido(PARADAS)), SELLO, {
    encuadreCapturado: false,
    bultosMaxSinReceptor: 6,
  });
  assert.deepEqual(sinEncuadre, llegar(iniciarRecorrido(PARADAS)), "sin encuadre no avanza");

  const conEncuadre = dejarEnPunto(llegar(iniciarRecorrido(PARADAS)), SELLO, {
    encuadreCapturado: true,
    bultosMaxSinReceptor: 6,
  });
  assert.equal(conEncuadre.captura?.resultado, "exito");
  assert.equal(conEncuadre.captura?.metodoEntrega, "dejado_en_punto");
  assert.equal(paradaActual(conEncuadre)?.id, "p2");
});

test("[AC-FPOD-02] dejado en punto sin haber llegado no cierra la parada", () => {
  const sinLlegar = dejarEnPunto(iniciarRecorrido(PARADAS), SELLO, {
    encuadreCapturado: true,
    bultosMaxSinReceptor: null,
  });

  assert.deepEqual(sinLlegar, iniciarRecorrido(PARADAS));
});

// ─── Evidencia extra armada POR DATOS [AC-FPOD-02] — §5.2 F4, §4.6 ────────────────────

/** Una parada que pide firma (obligatoria) y una foto opcional. Los tipos salen del enum del
 *  §4.6; ninguna función del dominio pregunta de qué vertical vienen. */
const CON_REQUISITOS: ParadaDeRuta[] = [
  {
    ...PARADAS[0]!,
    requisitos: [
      { id: "r1", tipo: "firma", obligatorio: true, orden: 1 },
      { id: "r2", tipo: "foto", obligatorio: false, orden: 2 },
    ],
  },
  PARADAS[1]!,
];

const FIRMA_CAPTURADA = [{ requisitoId: "r1", tipo: "firma" as const }];

test("[AC-FPOD-02] sin filas en stop_requirement no se pide evidencia extra: el camino feliz no cambia", () => {
  assert.deepEqual(requisitosPendientes(PARADAS[0]!, []), []);

  const c = contador(iniciarRecorrido(PARADAS));
  c.tocar(llegar);
  c.tocar((r) => entregar(r, SELLO));

  assert.equal(c.acciones, ENTREGA_FELIZ_ACCIONES, "una parada sin requisitos sigue costando 2");
  assert.deepEqual(c.estado.captura?.evidencias, []);
});

test("[AC-FPOD-02] el requisito OBLIGATORIO pendiente impide cerrar la entrega; capturado, la deja cerrar", () => {
  const llegado = llegar(iniciarRecorrido(CON_REQUISITOS));

  // Los pendientes salen en el orden que la parada pide, y el opcional NO es pendiente: la
  // columna `obligatorio` es justo la que separa «hay que capturarlo» de «se puede».
  assert.deepEqual(
    requisitosPendientes(CON_REQUISITOS[0]!, []).map((req) => req.id),
    ["r1"],
  );

  assert.deepEqual(entregar(llegado, SELLO), llegado, "con la firma pendiente no hay transición");

  const conFirma = entregar(llegado, SELLO, FIRMA_CAPTURADA);
  assert.equal(conFirma.captura?.resultado, "exito");
  assert.deepEqual(conFirma.captura?.evidencias, FIRMA_CAPTURADA);
  assert.equal(paradaActual(conFirma)?.id, "p2");
});

test("[AC-FPOD-02] el requisito pendiente también frena la parcial y el dejado en punto", () => {
  const llegado = llegar(iniciarRecorrido(CON_REQUISITOS));
  const ajustes = [{ itemId: "i1", qtyEntregada: 8, qtyRechazada: 4, motivoId: MOTIVO_LOCAL_CERRADO }];

  assert.deepEqual(entregarParcial(llegado, ajustes, SELLO), llegado);
  assert.deepEqual(
    dejarEnPunto(llegado, SELLO, { encuadreCapturado: true, bultosMaxSinReceptor: null }),
    llegado,
  );

  const parcial = entregarParcial(llegado, ajustes, SELLO, FIRMA_CAPTURADA);
  assert.equal(parcial.captura?.resultado, "parcial");
  assert.deepEqual(parcial.captura?.evidencias, FIRMA_CAPTURADA);

  const dejada = dejarEnPunto(
    llegado,
    SELLO,
    { encuadreCapturado: true, bultosMaxSinReceptor: null },
    FIRMA_CAPTURADA,
  );
  assert.equal(dejada.captura?.metodoEntrega, "dejado_en_punto");
});

test("[AC-FPOD-02] «no pude entregar» NO exige la evidencia: el local cerrado no firma", () => {
  const llegado = llegar(iniciarRecorrido(CON_REQUISITOS));
  const fallida = noEntregar(llegado, MOTIVO_LOCAL_CERRADO, SELLO);

  // Exigirle la firma de un receptor que no está dejaría la parada sin manera de cerrarse, que
  // es el rebote en terreno que el §4.2 y el §7.6 prohíben. Su evidencia es el motivo.
  assert.equal(fallida.captura?.resultado, "fallo");
  assert.equal(fallida.captura?.motivoId, MOTIVO_LOCAL_CERRADO);
  assert.deepEqual(fallida.captura?.evidencias, []);
  assert.equal(paradaActual(fallida)?.id, "p2");
});

test("[AC-FPOD-02] la parcial con evidencia exigida cierra en UNA transición, no en dos capturas", () => {
  // El techo de 4 acciones del §5.2 F4 lo mide el e2e sobre la pantalla real
  // (`e2e/pod-variantes.spec.ts`), que es donde los toques existen. Lo que se protege ACÁ es lo
  // que haría imposible ese techo: que la evidencia obligara a una captura aparte. Viaja DENTRO
  // de la misma, así que la parada se cierra una sola vez y el conteo no se duplica.
  const parcial = entregarParcial(
    llegar(iniciarRecorrido(CON_REQUISITOS)),
    [{ itemId: "i1", qtyEntregada: 8, qtyRechazada: 4, motivoId: MOTIVO_LOCAL_CERRADO }],
    SELLO,
    FIRMA_CAPTURADA,
  );

  assert.equal(parcial.captura?.resultado, "parcial");
  assert.deepEqual(parcial.captura?.evidencias, FIRMA_CAPTURADA);
  assert.equal(parcial.cola.length, 0, "una sola captura: nada se cerró antes por la evidencia");
  assert.equal(paradaActual(parcial)?.id, "p2");
});

test("[AC-FPOD-02] una variante cerrada respeta el mismo undo de 8 s que el camino feliz", () => {
  const conParcial = entregarParcial(
    llegar(iniciarRecorrido(PARADAS)),
    [{ itemId: "i1", qtyEntregada: 8, qtyRechazada: 4, motivoId: MOTIVO_LOCAL_CERRADO }],
    SELLO,
  );

  // Deshacer DENTRO de la ventana cancela la captura y devuelve a la parada, igual que el
  // camino feliz (AC-FPOD-01): es la MISMA máquina, `cerrarParada`, la que las dos reusan.
  const deshecha = deshacer(conParcial);
  assert.equal(paradaActual(deshecha)?.id, "p1");
  assert.equal(deshecha.llegada, true);
  assert.equal(deshecha.captura, null);
  assert.deepEqual(deshecha.cola, [], "la mutación se canceló ANTES del replay (§4.7)");

  // Vencida la ventana, la captura parcial pasa a la cola igual que una feliz.
  const cerrada = cerrarLaVentana(conParcial);
  assert.equal(cerrada.cola.length, 1);
  assert.equal(cerrada.cola[0]?.resultado, "parcial");
  assert.equal(cerrada.cola[0]?.estado, "por_replicar");
});

// ─── LA COLA SE VACÍA CON LO QUE EL SERVIDOR ACUSÓ, Y CON NADA MÁS [AC-FPOD-03] ───

test("[AC-FPOD-03] tres entregas sin señal se apilan en la cola, y el contador es el largo real", () => {
  let r = iniciarRecorrido(PARADAS);
  const uuids: string[] = [];
  for (const n of [0, 1, 2]) {
    const sello = { ...SELLO, clientUuid: `019853b7-0000-7000-8000-0000000000c${n}` };
    uuids.push(sello.clientUuid);
    r = cerrarLaVentana(entregar(llegar(r), sello));
  }
  assert.equal(r.cola.length, 3, "el contador de «por sincronizar» es el largo de la cola, no un cartel");
  assert.deepEqual(r.cola.map((c) => c.clientUuid), uuids);
  assert.ok(r.cola.every((c) => c.estado === "por_replicar"));
});

test("[AC-FPOD-03] el replay saca de la cola SOLO lo que el servidor acusó por client_uuid", () => {
  let r = iniciarRecorrido(PARADAS);
  const uuids: string[] = [];
  for (const n of [0, 1, 2]) {
    const sello = { ...SELLO, clientUuid: `019853b7-0000-7000-8000-0000000000c${n}` };
    uuids.push(sello.clientUuid);
    r = cerrarLaVentana(entregar(llegar(r), sello));
  }

  // Lote parcial: la señal se cortó a mitad y el servidor solo acusó dos. La tercera se queda
  // esperando el próximo intento, en vez de perderse creyendo que llegó.
  const parcial = sacarDeLaCola(r, [uuids[0]!, uuids[2]!]);
  assert.deepEqual(parcial.cola.map((c) => c.clientUuid), [uuids[1]!]);

  // Acuse vacío —el lote no llegó— deja la cola intacta: cero rechazo, cero pérdida (§5.7).
  assert.equal(sacarDeLaCola(parcial, []).cola.length, 1);
  // Un acuse de algo que ya no está no borra de más.
  assert.equal(sacarDeLaCola(parcial, [uuids[0]!]).cola.length, 1);
  // Acusadas todas, la cola queda vacía sin que el operario toque nada.
  assert.equal(sacarDeLaCola(parcial, [uuids[1]!]).cola.length, 0);
});

test("[AC-FPOD-03] lo que está dentro de la ventana de undo no lo toca el replay", () => {
  const r = entregar(llegar(iniciarRecorrido(PARADAS)), SELLO);
  assert.equal(r.captura?.estado, UNDO.estado_local);
  // Aunque el servidor acusara ese uuid, la captura sigue en la ventana: todavía no salió del
  // dispositivo (§4.7), y sacarla de una cola donde no está no puede inventarle un aterrizaje.
  const despues = sacarDeLaCola(r, [SELLO.clientUuid]);
  assert.equal(despues.captura?.clientUuid, SELLO.clientUuid);
  assert.deepEqual(despues.cola, []);
});
