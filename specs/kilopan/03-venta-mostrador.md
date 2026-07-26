# 03 — Venta mostrador

Fuente: §3

Módulo 3 de los siete. Venta táctil en ≤3 toques contra el stock pesado. La boleta la
emite el facturador que la panadería **ya usa**; la app registra la venta interna y
jamás genera un documento con apariencia tributaria (§7, art. 97 N°4 CT).

Sin venta en ruta — está explícitamente FUERA del MVP (§3).

## Criterios de aceptación

- [x] (P1) F6 Venta contra stock pesado, probado en vivo: pesados 5,000 kg → vendidos
      0,500 kg a $1.095 → quedan 4,500 kg, con `pan.stock_disponible()` derivando todo
      de eventos (pesajes − venta_lineas) y nunca de un contador guardado. Productos sin
      stock quedan deshabilitados en pantalla [AC-VEN-02]
- [x] (P2) Catálogo de medios de pago editable por admin (decisión #5): tabla
      `pan.medios_pago` precargada con los 8 medios; `pan_app` puede prender/apagar
      (`activo`) pero NO borrar ni renombrar — probado [AC-PAG-01]
- [x] (P2) Fiado en mostrador reutiliza el MISMO cliente y saldo que el del reparto —
      cero segundo sistema de crédito. Probado por HTTP: sin cliente rebota con mensaje
      claro, con cliente entra y suma al saldo [AC-PAG-02]
- [ ] (P1) Pantalla de cierre de caja: esperado vs declarado con la diferencia visible,
      como exige §3 módulo 3. Hoy existe la tabla `cierres_caja` y nada más — el turno no
      se puede cerrar desde la app [AC-VEN-03]
- [ ] (P2) Pantalla de admin para togglear medios de pago + fila por medio en el cierre
      de caja. La tabla y sus permisos están; la UI no [AC-PAG-03]

## Notas de implementación

- El stock se deriva **siempre** de eventos. Cualquier contador materializado sería una
  segunda fuente de verdad y rompería la TCK, que se calcula desde los mismos eventos.
- `AC-DASH-04` (lectura de totales del facturador) vive en la spec 07 porque su pantalla
  es el dashboard, pero su dato nace en este módulo.
