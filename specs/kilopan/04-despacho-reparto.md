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
- [ ] (P1) F3 Cargar van: contador N/M en 96 px, escáner de cámara full-screen con
      linterna (48 px, alcanzable con pulgar — madrugada real), lectura válida = beep +
      vibración, duplicada = tono distinto + banner ámbar, sin código = checklist 44 px
      equivalente. «Salir a ruta» exige 100 % o confirmación auditada (única modal
      permitida) **y** todos los DTE asociados. **Sin construir** — es el hueco más
      grande del flujo dorado [AC-DES-04]

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
