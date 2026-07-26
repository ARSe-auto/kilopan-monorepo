# 07 — Dashboard del dueño y tarjeta de flota

Fuente: §3

Módulo 7 de los siete. Es donde el dueño ve **esa misma noche** qué pasó con cada kilo
que salió del horno — el argumento de venta al gremio.

La variable norte es la **TCK** (Tasa de Conciliación diaria de Kilos), calculada
SIEMPRE desde eventos y jamás desde snapshots (§2).

Regla de rol, testeada: el CLP y el $/km viven **únicamente** aquí. El fin de ruta del
repartidor muestra solo km y kg (§5).

## Criterios de aceptación

- [x] (P1) Conciliación del día: `/dashboard` con TCK en vivo desde
      `pan.conciliacion_diaria` (vista sobre eventos, no escribible — probado), gramos
      por destino, merma perdida vs recuperada separadas, semáforo contra la meta de
      95 %. Probado en vivo: 13.000 g pesados, 9.000 vendidos + 1.000 merma ⇒ 77 % en
      ámbar [AC-DASH-01]
- [x] (P1) Tarjeta «Tu flota»: km reales del odómetro, combustión vs EV desde
      `pan.parametros` (editables, con fuente), aparece solo con ≥20 rutas cerradas. La
      regla de rol está testeada: el dashboard entero rebota si no sos `admin`, así que
      el CLP jamás llega al teléfono del repartidor [AC-DASH-02]
- [x] (P2) CTA hermano de KiloRuta en la misma tarjeta: «Prefiero que alguien más reparta
      por mí» → tabla `lead_kiloruta` simétrica a `lead_eauto`, ambas exigiendo
      consentimiento explícito (probado). No depende del contrato técnico del Anexo B
      [AC-DASH-03]
- [x] (P2) Lectura de totales del facturador (decisión #3, fase 1): campo en el cierre de
      caja que compara contra lo que registró KiloPan. Probado: detecta que el facturador
      marcó $310 más. Las fases CSV y API quedan para cuando el piloto lo pida
      [AC-DASH-04]
- [x] (P2) Multisucursal ligero (decisión #7): tabla `sucursales` + `sucursal_id`
      heredado automáticamente del dispositivo (el equipo vive en un local, nadie lo
      elige a mano). Probado que con una sola sucursal queda NULL y no agrega complejidad
      [AC-SUC-01]
- [x] (P2) Botón compartir nativo (decisión #9): `navigator.share()` con degradación a
      texto si el teléfono no soporta compartir archivos. Cero número de teléfono
      guardado, cero envío automático. Está en el cierre de caja [AC-SHARE-01]
- [ ] (P1) Mapa estático de pines de los PODs del día (Leaflet + OSM, **solo dashboard**,
      §3 módulo 7). Sin construir [AC-DASH-05]
- [ ] (P1) Pantalla de auditoría por usuario y dispositivo sobre la tabla `eventos`
      (append-only). Sin construir: hoy los eventos se escriben y nadie puede leerlos
      desde la app [AC-DASH-06]
- [ ] (P2) Cablear el POST de ambos CTA (`lead_eauto` y `lead_kiloruta`): las tablas y el
      consentimiento están probados, pero el botón no envía [AC-DASH-07]
- [ ] (P2) Selector de sucursal en el dashboard, para que multisucursal sirva de algo
      cuando haya más de un local [AC-SUC-02]
- [ ] (P2) Botón compartir en el detalle de entrega, no solo en el cierre de caja
      [AC-SHARE-02]

## Notas de implementación

- «Tu flota» es descartable y **jamás** aparece en el teléfono del repartidor.
- Los defaults de `pan.parametros` llevan fuente declarada:
  `clp_km_combustible=140`, `clp_km_ev=35`, `co2_g_km_evitado=150`. Editables por admin.
- El odómetro manual manda para $/km. Los puntos GPS de los PODs son apoyo; no hay
  tracking continuo (§4).
