# 04 — Despacho y reparto

Fuente: §3

Módulo 4 de los siete. Pedidos recurrentes por cliente, armado de carga por ruta ordenada
a mano, checklist/escaneo de bultos.

**Regla legal dura:** «Salir a ruta» se bloquea si algún pedido de la carga no tiene DTE
asociado — art. 55 DL 825, el documento viaja con el pan. Multa de 10 %–200 % de 1 UTA y
retención del vehículo. Sin override, ni en BD ni en UI (§7).

## Criterios de aceptación

- [x] (P1) Bloqueo real de «Salir a ruta» sin DTE asociado: trigger en BD, sin override.
      Probado en ambos sentidos — sin guía rebota, con guía sale [AC-DES-02]
- [ ] (P1) F2 Armar pedido: `/pedidos` con alta de cliente, pedido con precio de la
      lista del cliente, registro de DTE y «Armar ruta y salir». El bloqueo del art. 55
      se ve en pantalla (pedidos sin documento en rojo) y está probado por HTTP: 409 sin
      guía, 200 con guía [AC-DES-03]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El único e2e que ejercita «Armar ruta
      y salir» de punta a punta es `camino-dorado.spec.ts:257` (test 8), el mismo test
      que `AC-POD-04` ya declara INESTABLE (pasó, agotó 30 s, volvió a pasar sobre el
      mismo commit). El invariante de BD del art. 55 sí está sólido
      (`db/test-invariantes.mjs`, etiquetado `AC-DES-02`), pero la afirmación específica
      de este AC —el flujo de pantalla completo— depende del mismo test flaky.
- [x] (P1) Capa de BD de la carga (partido 06-ago-2026: F3 completo no cabía en el
      sobre de una iteración — API → AC-DES-05, pantalla → AC-DES-06, escáner →
      AC-DES-07): `pan.bultos` con código determinista `P<correlativo>-<n>`, nacimiento
      SOLO por `pan.generar_bultos()` al cerrar el pedido, escaneo SOLO por
      `pan.cargar_bulto()` con rebote de duplicado («ya escaneado»), inmutabilidad por
      trigger + sin grants de escritura, y «Salir a ruta» exige 100 % de bultos
      escaneados o override motivo+usuario que el trigger deja en `pan.eventos`.
      Evidencia: `db/migraciones/0024_bultos_carga.sql` + 3 tests en
      `db/test-invariantes.mjs` (suite 81/0) [AC-DES-04]
- [x] (P1) API de carga por HTTP sobre 0024: generar bultos al confirmar el pedido
      (cantidad la digita quien cierra), POST de escaneo que traduce «ya escaneado» a
      409, GET de estado N/M por ruta para el contador. Probada en ambos sentidos:
      escaneo válido 2xx, duplicado 409, N/M correcto con carga parcial [AC-DES-05]
      — cerrado 06-ago-2026: `POST /api/pedidos` llama a `pan.generar_bultos()` al
      confirmar (cantidadBultos opcional; sin ella, 0 bultos, compatible con el
      histórico); `GET/POST /api/bultos` dan el contador N/M por ruta y el escaneo con
      «ya escaneado»→409 y código inexistente→404. e2e `carga-bultos.spec.ts` ejercita
      los tres endpoints por HTTP (generar, 2xx, 409, 404, N/M parcial 1/3) sobre un
      repartidor propio del test. La pantalla F3 sigue en AC-DES-06.
- [x] (P1) Pantalla F3 `/cargar`: contador N/M en 96 px, captura MANUAL del código con
      el teclado propio + checklist 44 px equivalente para bultos sin código, duplicado
      = banner ámbar, «Salir a ruta» al 100 % o la única modal permitida (motivo +
      quién — el override auditado de 0024) **y** todos los DTE asociados. e2e móvil
      390×844 del camino feliz y del duplicado. — **Cerrado 06-ago-2026:** los DOS e2e de
      `cargar-bultos-pantalla.spec.ts` pasan en verde. Se probó de punta a punta:
      contador 0/3→2/3 en 96 px; captura por LOS BOTONES del teclado propio (numérico +
      «−», prefijo «P» que agrega la pantalla — contrato de las Notas); banner ámbar en
      duplicado (409→sigue en captura); modal única con motivo (elevado sobre la
      BarraPestanas, antes intappable) que sale con override; y el camino feliz al 100 %
      que sale sin modal. Tres arreglos que faltaban para cerrar: (a) `/api/rutas/salir`
      ahora setea `bultos_override_motivo`+`_usuario_id` en el MISMO update —el trigger de
      0024 lo exige y él audita el evento—, en vez de un update pelado que rebotaba; (b)
      el modal por encima de `zIndex` 40; (c) el e2e registra la guía (DTE 52) del pedido,
      sin la cual el art. 55 rebota la salida. [AC-DES-06]
- [x] (P2) Escáner de cámara full-screen con linterna (48 px, alcanzable con pulgar) +
      beep + vibración con zxing-js, como MEJORA PROGRESIVA sobre la captura manual de
      AC-DES-06 — que sigue siendo el camino primario en iOS (§7). Cámara denegada o
      sin soporte degrada a manual sin bloquear nada [AC-DES-07]
      — cerrado 7-ago-2026: `EscanerBulto.tsx` (mismo patrón que `EscanerTed.tsx` de
      AC-DTE-03) — `BrowserMultiFormatReader` de zxing-js sobre un stream propio de
      `getUserMedia({facingMode:"environment"})`, overlay full-screen (`zIndex` 200, por
      encima de la barra y de la modal de override de AC-DES-04/06), linterna 48 px vía
      `applyConstraints({advanced:[{torch}]})` que solo aparece si `getCapabilities().torch`
      existe, beep sintetizado con Web Audio (sin asset) y `navigator.vibrate(200)` al
      decodificar. Botón «Escanear con cámara» agregado en `/cargar` junto al «Escanear
      código» manual (AC-DES-06), reusando el mismo `escanear()` — mismo dedup/contador/
      error. Si `getUserMedia` no existe el componente devuelve `null`: no hay botón, la
      captura manual sigue siendo el único camino, sin bloqueo. Sin cámara real
      disponible en el harness de CI, probado por contrato de código (mismo patrón que
      `camara.test.ts` para AC-PERF-02): 7 tests en `EscanerBulto.test.ts` verifican
      zxing-js, degradación sin cámara, overlay full-screen, linterna 48 px +
      `applyConstraints`/`torch`, beep por `AudioContext`, `navigator.vibrate(200)`, y que
      la cámara se abre solo in-app (nunca `<input type=file>`).

## Notas de implementación

- **Contrato de captura manual (decisión supervisada 06-ago-2026, cierra la ambigüedad
  que reventó los e2e de AC-DES-06):** el código `P<correlativo>-<n>` se digita en el
  teclado PROPIO con las teclas [0-9] + una tecla «−» (guión); el prefijo «P» lo agrega
  la pantalla automáticamente y el display muestra el código completo (`P7-1`). Teclear
  `7-1` = 3 pulsaciones. El POST a /api/bultos lleva el código completo. Los e2e operan
  LOS BOTONES del teclado propio (`button "7"`, `button "−"`, …) — JAMÁS
  `input[type=text]` ni `page.keyboard` (el teclado del sistema no existe en terreno,
  §5). La vía sin tipeo sigue siendo el checklist de 44 px por bulto.

- **Esquema de bultos (0024, sesión supervisada 06-ago-2026):** F3 se construye SOBRE
  `pan.bultos` — nacen solo por `pan.generar_bultos(pedido_id, cantidad)` al cerrar el
  pedido (código determinista `P<correlativo_pedido>-<n>`); el escaneo es
  `pan.cargar_bulto(codigo, usuario, dispositivo)` (duplicado ⇒ excepción «ya
  escaneado» ⇒ API 409 ⇒ banner ámbar); «Salir a ruta» con bultos pendientes rebota en
  BD salvo override con motivo+usuario en el MISMO update, que el trigger deja escrito
  en `pan.eventos` (`ruta.salida_con_bultos_pendientes`). Invariantes probadas en
  `db/test-invariantes.mjs` (3 tests AC-DES-04). La UI jamás reimplementa estas reglas.
- El correlativo interno se llama `correlativo_pedido`, **nunca «folio»**: el único folio
  del sistema es el del SII (§4). Lo asigna solo `pan.asignar_correlativo()` al confirmar,
  con trigger que aborta todo UPDATE posterior y `REVOKE UPDATE(correlativo_pedido)`.
- El orden de las paradas se arma a mano con drag en web. El optimizador de rutas (VRP)
  está explícitamente FUERA del MVP (§3).
- La etiqueta de bulto es Code128+QR si hay impresora, y número de bulto en 96 px si no
  — mismo flujo, cero rama muerta (§5 F2).
