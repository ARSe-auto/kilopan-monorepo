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
- [ ] (P1) Pantalla F3 `/cargar`: contador N/M en 96 px, captura MANUAL del código con
      el teclado propio + checklist 44 px equivalente para bultos sin código, duplicado
      = banner ámbar, «Salir a ruta» al 100 % o la única modal permitida (motivo +
      quién — el override auditado de 0024) **y** todos los DTE asociados. e2e móvil
      390×844 del camino feliz y del duplicado. — **Reabierto 06-ago-2026 (supervisado):
      el cierre fue prematuro — la pantalla, banners, modal de override y POST
      /api/rutas/salir EXISTEN (commit 6100516), pero sus DOS e2e
      (`cargar-bultos-pantalla.spec.ts`) fallan: `GET /api/bultos?rutaId=…` responde
      not-ok (desajuste de contrato con la API de AC-DES-05). Cerrar recién cuando esos
      e2e pasen en el gate completo.** [AC-DES-06]
- [ ] (P2) Escáner de cámara full-screen con linterna (48 px, alcanzable con pulgar) +
      beep + vibración con zxing-js, como MEJORA PROGRESIVA sobre la captura manual de
      AC-DES-06 — que sigue siendo el camino primario en iOS (§7). Cámara denegada o
      sin soporte degrada a manual sin bloquear nada [AC-DES-07]

## Notas de implementación

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
