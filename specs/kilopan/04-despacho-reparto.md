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
- [x] (P1) F2 Armar pedido: `/pedidos` con alta de cliente, pedido con precio de la
      lista del cliente, registro de DTE y «Armar ruta y salir». El bloqueo del art. 55
      se ve en pantalla (pedidos sin documento en rojo) y está probado por HTTP: 409 sin
      guía, 200 con guía [AC-DES-03]
- [ ] (P1) F3 Cargar van: contador N/M en 96 px, escáner de cámara full-screen con
      linterna (48 px, alcanzable con pulgar — madrugada real), lectura válida = beep +
      vibración, duplicada = tono distinto + banner ámbar, sin código = checklist 44 px
      equivalente. «Salir a ruta» exige 100 % o confirmación auditada (única modal
      permitida) **y** todos los DTE asociados. **Sin construir** — es el hueco más
      grande del flujo dorado [AC-DES-04]

## Notas de implementación

- El correlativo interno se llama `correlativo_pedido`, **nunca «folio»**: el único folio
  del sistema es el del SII (§4). Lo asigna solo `pan.asignar_correlativo()` al confirmar,
  con trigger que aborta todo UPDATE posterior y `REVOKE UPDATE(correlativo_pedido)`.
- El orden de las paradas se arma a mano con drag en web. El optimizador de rutas (VRP)
  está explícitamente FUERA del MVP (§3).
- La etiqueta de bulto es Code128+QR si hay impresora, y número de bulto en 96 px si no
  — mismo flujo, cero rama muerta (§5 F2).
