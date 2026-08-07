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
      regla de rol está testeada: el dashboard entero bloquea el contenido si no sos
      `admin`, así que el CLP jamás llega al teléfono del repartidor [AC-DASH-02]
      — Probado: `autorizacion.spec.ts` ingresa como repartidor (rol no admin) y
      visita `/dashboard`; confirma el bloqueo (`apps/kilopan/src/app/dashboard/page.tsx:38`)
      y la ausencia de la TCK, «Tu flota» y cualquier cifra en CLP.
- [x] (P2) CTA hermano de KiloRuta en la misma tarjeta: «Prefiero que alguien más reparta
      por mí» → tabla `lead_kiloruta` simétrica a `lead_eauto`, ambas exigiendo
      consentimiento explícito (probado). No depende del contrato técnico del Anexo B
      [AC-DASH-03]
- [ ] (P2) Lectura de totales del facturador (decisión #3, fase 1): campo en el cierre de
      caja que compara contra lo que registró KiloPan. Probado: detecta que el facturador
      marcó $310 más. Las fases CSV y API quedan para cuando el piloto lo pida
      [AC-DASH-04]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El campo y el cálculo existen
      (`apps/kilopan/src/app/api/cierre-caja/route.ts:142-188`), pero ningún test
      menciona `facturador`/`total_facturador_clp`/`diferenciaFacturador` — el escenario
      "detecta que el facturador marcó $310 más" no está en ningún archivo de prueba.
- [ ] (P2) Multisucursal ligero (decisión #7): tabla `sucursales` + `sucursal_id`
      heredado automáticamente del dispositivo (el equipo vive en un local, nadie lo
      elige a mano). Probado que con una sola sucursal queda NULL y no agrega complejidad
      [AC-SUC-01]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El modelo y su test de BD son reales
      (`db/test-invariantes.mjs`: herencia de `sucursal_id` y caso de sucursal única),
      pero la palabra «sucursal» no aparece en ninguna pantalla — el feature no tiene
      ningún efecto visible en el producto todavía (falta el selector, `AC-SUC-02`,
      abierto).
- [ ] (P2) Botón compartir nativo (decisión #9): `navigator.share()` con degradación a
      texto si el teléfono no soporta compartir archivos. Cero número de teléfono
      guardado, cero envío automático. Está en el cierre de caja [AC-SHARE-01]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** `apps/kilopan/src/comun/compartir.ts`
      implementa la degradación, pero no existe `compartir.test.ts` ni ninguna referencia
      a `navigator.share`/`compartir` en `*.test.ts` o `e2e/*.spec.ts` — la degradación
      nunca se ejercitó de forma automatizada.
- [x] (P1) Mapa estático de pines de los PODs del día (Leaflet + OSM, **solo dashboard**,
      §3 módulo 7). Probado: MapaPodsDia.tsx componente client con react-leaflet, query
      de entregas cerradas de hoy en dashboard/page.tsx, test e2e valida que se pinten
      marcadores y popups interactivos [AC-DASH-05]
- [x] (P1) Pantalla de auditoría por usuario y dispositivo sobre la tabla `eventos`
      (append-only). Construido: sección en `/dashboard` con filtros por usuario y
      dispositivo, tabla de eventos últimos 500 (append-only, REVOKE UPDATE/DELETE en BD),
      test e2e verifica encabezados y selectores [AC-DASH-06]
- [ ] (P2) Cablear el POST de ambos CTA (`lead_eauto` y `lead_kiloruta`): las tablas y el
      consentimiento están probados, pero el botón no envía [AC-DASH-07]
- [ ] (P2) Selector de sucursal en el dashboard, para que multisucursal sirva de algo
      cuando haya más de un local [AC-SUC-02]
- [ ] (P2) Botón compartir en el detalle de entrega, no solo en el cierre de caja
      [AC-SHARE-02]

## Ola 3 — «Que la dueña vea» (`docs/PROMPT_CORRECTIVO.md` §3, causas raíz R3/R4)

Salida de la ola: dado un faltante de caja sembrado en datos de prueba, la dueña
reconstruye sola quién, cuándo y en qué equipo, sin ayuda técnica. Dos piezas de esto
YA estaban escritas antes de esta planificación — se citan para no duplicar:

- **Eventos obligatorios en toda operación de plata** → `AC-ADM-10`
  (`specs/kilopan/10-administracion.md`). Prerrequisito de datos para esta ola entera:
  sin eso escrito, no hay nada que la pantalla de auditoría pueda mostrar.
- **Pantalla de auditoría por usuario y dispositivo sobre `pan.eventos`** → `AC-DASH-06`,
  arriba en esta misma spec. Ya es exactamente "la pantalla que los lee" que pide §3.

Lo que falta, verificado en el código, no supuesto:

- [ ] (P0) **Cola de entregas por revisar**, cableada a una pantalla del dashboard. Hoy
      el repartidor marca rechazo/parcial en `/ruta` (`AC-POD-05`) y ahí muere: ninguna
      pantalla de `/dashboard` lista esas entregas para que la dueña las revise y
      decida qué hacer con cada una. Sin esto, R3/R4 no se cumplen aunque el evento
      exista — el dato está, nadie lo ve [AC-DASH-08]
- [ ] (P1) **Histórico y exportación** de la conciliación diaria: hoy `/dashboard`
      (`AC-DASH-01`) solo muestra el día en curso desde `pan.conciliacion_diaria`. Sin
      rango de fechas ni exportar (CSV como mínimo), la dueña no puede reconstruir un
      faltante de una semana atrás sin pedirle el dato a alguien con acceso a la BD —
      exactamente lo que esta ola existe para evitar [AC-DASH-09]

## Notas de implementación

- «Tu flota» es descartable y **jamás** aparece en el teléfono del repartidor.
- Los defaults de `pan.parametros` llevan fuente declarada:
  `clp_km_combustible=140`, `clp_km_ev=35`, `co2_g_km_evitado=150`. Editables por admin.
- El odómetro manual manda para $/km. Los puntos GPS de los PODs son apoyo; no hay
  tracking continuo (§4).
