# Decisiones de ampliación (post-lectura crítica, 25-jul-2026)

Referencia rápida para el builder. Detalle completo y razonamiento en la conversación
de producto; esto es el resumen ejecutable. Ninguna toca los bordes duros del prompt
maestro: la app jamás emite DTE, cada despacho sigue saliendo con su guía propia
(art. 55 DL 825), y no hay pasarela de pago ni cobranza automática.

| # | Decisión | AC(s) |
|---|---|---|
| 1 | Foto opcional en pesaje (toggle admin) + báscula BT/serial opcional (Web Bluetooth no existe en Safari/iOS) | AC-PES-04, AC-PES-05 |
| 2 | Consolidar guías entregadas de un cliente en una factura; saldo por cliente como vista derivada de eventos | AC-FIA-01, AC-FIA-02 |
| 3 | Lectura de totales del facturador por capas: número tecleado → CSV → API (solo si el piloto lo pide) | AC-DASH-04 |
| 4 | Cola con reintento automático en pesaje/mostrador, reusando el outbox de `nucleo-pod` | AC-RED-01 |
| 5 | Catálogo de medios de pago editable por admin (no una lista fija); fiado en mesón reutiliza el saldo del punto 2 | AC-PAG-01, AC-PAG-02 |
| 6 | Mermas con estado: `pendiente` → `confirmada_perdida` / `recuperada_con_venta` (la TCK no cambia de fórmula) | AC-MERM-01 |
| 7 | Multisucursal ligero (un dueño, varios puntos, un panel) — condicional a que un piloto real lo pida | AC-SUC-01 |
| 8 | Disciplina de prueba en Android real de gama baja, no solo iPhone; instructivo de instalación separado por SO | (transversal — ver checklist de gate en cada hito de UI) |
| 9 | Botón «compartir» nativo (`navigator.share`) en vez de notificaciones/WhatsApp integrado | AC-SHARE-01 |
